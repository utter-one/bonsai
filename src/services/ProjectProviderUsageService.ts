import { sql } from 'drizzle-orm';
import { injectable, inject } from 'tsyringe';
import { db } from '../db/index';
import { providers, projects } from '../db/schema';
import { NotFoundError } from '../errors';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import type { ProjectProviderUsageResponse, UsedProviderDetail } from '../http/contracts/projectProviders';
import { projectProviderUsageResponseSchema } from '../http/contracts/projectProviders';
import { LlmProviderFactory } from './providers/llm/LlmProviderFactory';

/**
 * Internal row returned by the SQL query that collects all provider references
 * across project entities. Column names match PostgreSQL lowercase aliases.
 */
interface UsageRow {
  provider_id: string;
  provider_name: string;
  provider_type: string;
  api_type: string;
  entity_type: string;
  entity_id: string;
  entity_name: string;
  model_name: string | null;
}

/**
 * Service that aggregates provider usage across all project-scoped entities.
 * Queries agents, stages, classifiers, tools, contextTransformers, testers,
 * and project-level settings (ASR, storage, moderation) to find which global
 * providers are actively referenced.
 */
@injectable()
export class ProjectProviderUsageService extends BaseService {
  constructor(@inject(LlmProviderFactory) private readonly llmProviderFactory: LlmProviderFactory) {
    super();
  }

  /**
   * Returns a comprehensive report of all providers used within a project.
   *
   * @param projectId - The project to analyze
   * @param context - Request context for authorization
   * @param checkIfAvailable - When true, checks model availability via provider API (LLM only)
   * @throws {NotFoundError} When the project does not exist
   */
  async getUsedProviders(
    projectId: string,
    context: RequestContext,
    checkIfAvailable: boolean = false,
  ): Promise<ProjectProviderUsageResponse> {
    this.requirePermission(context, PERMISSIONS.PROVIDER_READ);
    logger.info({ projectId, checkIfAvailable, operatorId: context.operatorId }, 'Fetching used providers for project');

    // Verify project exists
    const projectExists = await db.select({ id: projects.id }).from(projects).where(sql`${projects.id} = ${projectId}`).limit(1);
    if (projectExists.length === 0) {
      throw new NotFoundError(`Project with id ${projectId} not found`);
    }

    // Single query that unions all entity references into providers
    const queryResult = await db.execute(sql`
      SELECT
        p.id        AS provider_id,
        p.name      AS provider_name,
        p.provider_type AS provider_type,
        p.api_type  AS api_type,
        ref.entity_type AS entity_type,
        ref.entity_id   AS entity_id,
        ref.entity_name AS entity_name,
        ref.model_name  AS model_name
      FROM (
        -- Agents (TTS)
        SELECT
          'agent'              AS entity_type,
          a.id                 AS entity_id,
          a.name               AS entity_name,
          a.tts_provider_id    AS provider_id,
          (a.tts_settings->>'model')::text AS model_name
        FROM agents a
        WHERE a.project_id = ${projectId}
          AND a.tts_provider_id IS NOT NULL

        UNION ALL

        -- Stages (LLM)
        SELECT
          'stage' AS entity_type,
          s.id    AS entity_id,
          s.name  AS entity_name,
          s.llm_provider_id AS provider_id,
          (s.llm_settings->>'model')::text AS model_name
        FROM stages s
        WHERE s.project_id = ${projectId}
          AND s.llm_provider_id IS NOT NULL

        UNION ALL

        -- Classifiers (LLM)
        SELECT
          'classifier' AS entity_type,
          c.id         AS entity_id,
          c.name       AS entity_name,
          c.llm_provider_id AS provider_id,
          (c.llm_settings->>'model')::text AS model_name
        FROM classifiers c
        WHERE c.project_id = ${projectId}
          AND c.llm_provider_id IS NOT NULL

        UNION ALL

        -- Tools (LLM, smart_function type only)
        SELECT
          'tool' AS entity_type,
          t.id   AS entity_id,
          t.name AS entity_name,
          t.llm_provider_id AS provider_id,
          (t.llm_settings->>'model')::text AS model_name
        FROM tools t
        WHERE t.project_id = ${projectId}
          AND t.llm_provider_id IS NOT NULL

        UNION ALL

        -- Context Transformers (LLM)
        SELECT
          'contextTransformer' AS entity_type,
          ct.id                AS entity_id,
          ct.name              AS entity_name,
          ct.llm_provider_id   AS provider_id,
          (ct.llm_settings->>'model')::text AS model_name
        FROM context_transformers ct
        WHERE ct.project_id = ${projectId}
          AND ct.llm_provider_id IS NOT NULL

        UNION ALL

        -- Testers (LLM)
        SELECT
          'tester' AS entity_type,
          te.id    AS entity_id,
          te.name  AS entity_name,
          te.llm_provider_id AS provider_id,
          (te.llm_settings->>'model')::text AS model_name
        FROM testers te
        WHERE te.project_id = ${projectId}
          AND te.llm_provider_id IS NOT NULL

        UNION ALL

        -- Project-level ASR (ASR)
        SELECT
          'project' AS entity_type,
          pr.id    AS entity_id,
          pr.name  AS entity_name,
          (pr.asr_config->>'asrProviderId')::text AS provider_id,
          NULL::text AS model_name
        FROM projects pr
        WHERE pr.id = ${projectId}
          AND pr.asr_config->>'asrProviderId' IS NOT NULL

        UNION ALL

        -- Project-level Storage (Storage)
        SELECT
          'project' AS entity_type,
          pr.id    AS entity_id,
          pr.name  AS entity_name,
          (pr.storage_config->>'storageProviderId')::text AS provider_id,
          NULL::text AS model_name
        FROM projects pr
        WHERE pr.id = ${projectId}
          AND pr.storage_config->>'storageProviderId' IS NOT NULL

        UNION ALL

        -- Project-level Moderation (LLM)
        SELECT
          'project' AS entity_type,
          pr.id    AS entity_id,
          pr.name  AS entity_name,
          (pr.moderation_config->>'llmProviderId')::text AS provider_id,
          NULL::text AS model_name
        FROM projects pr
        WHERE pr.id = ${projectId}
          AND pr.moderation_config->>'llmProviderId' IS NOT NULL
      ) ref
      JOIN providers p ON p.id = ref.provider_id
      ORDER BY p.name, ref.entity_type, ref.entity_name
    `);

    // Group rows by provider
    const rows = queryResult.rows as unknown as UsageRow[];
    const providerMap = new Map<string, UsageRow[]>();
    for (const row of rows) {
      const existing = providerMap.get(row.provider_id) ?? [];
      existing.push(row);
      providerMap.set(row.provider_id, existing);
    }

    // Build response with optional availability checks
    const providerDetails = await Promise.all(
      Array.from(providerMap.entries()).map(async ([providerId, usages]) => {
        const first = usages[0];
        const detail: UsedProviderDetail = {
          id: providerId,
          name: first.provider_name,
          providerType: first.provider_type as UsedProviderDetail['providerType'],
          apiType: first.api_type,
          usage: usages.map(u => ({
            entityType: u.entity_type as UsedProviderDetail['usage'][number]['entityType'],
            entityId: u.entity_id,
            entityName: u.entity_name,
            modelName: u.model_name ?? null,
          })),
        };

        // Optional availability check (LLM providers only)
        if (checkIfAvailable) {
          detail.availability = await this.checkProviderAvailability(providerId, first.provider_type, usages);
        }

        return detail;
      }),
    );

    // Build summary
    const byType: Record<string, number> = { llm: 0, tts: 0, asr: 0, embeddings: 0, storage: 0, channel: 0 };
    for (const entry of providerDetails) {
      const key = entry.providerType;
      if (key in byType) {
        byType[key] = (byType[key] ?? 0) + 1;
      }
    }

    const response = projectProviderUsageResponseSchema.parse({
      providers: providerDetails,
      summary: {
        totalProviders: providerDetails.length,
        byType,
      },
    });

    logger.info({ projectId, totalProviders: response.summary.totalProviders }, 'Used providers fetched successfully');
    return response;
  }

  /**
   * Checks model availability for a provider by querying its API.
   * Only LLM providers support model enumeration; other types return not_applicable.
   * Each provider check is bounded by a 10-second timeout.
   */
  private async checkProviderAvailability(
    providerId: string,
    providerType: string,
    usages: UsageRow[],
  ): Promise<NonNullable<import('../http/contracts/projectProviders').UsedProviderDetail['availability']>> {
    // Non-LLM providers don't have model enumeration
    if (providerType !== 'llm') {
      return { status: 'not_applicable', models: [] };
    }

    // Collect distinct model names from entity usage
    const modelMap = new Map<string, string[]>(); // model -> [entityIds]
    for (const u of usages) {
      if (u.model_name) {
        const existing = modelMap.get(u.model_name) ?? [];
        existing.push(u.entity_id);
        modelMap.set(u.model_name, existing);
      }
    }

    // If no models are configured, mark as available (nothing to check)
    if (modelMap.size === 0) {
      return { status: 'available', models: [] };
    }

    // Fetch available models from the provider API with timeout
    const availableModelIds = await this.fetchAvailableModels(providerId);

    // Compare configured models against available ones
    const models = Array.from(modelMap.entries()).map(([model, usedBy]) => ({
      model,
      status: availableModelIds.has(model) ? 'available' as const : 'unavailable' as const,
      usedBy,
    }));

    const availableCount = models.filter(m => m.status === 'available').length;
    const status: NonNullable<import('../http/contracts/projectProviders').UsedProviderDetail['availability']>['status'] =
      availableCount === models.length
        ? 'available'
        : availableCount > 0
          ? 'partially_available'
          : 'unavailable';

    return { status, models };
  }

  /**
   * Fetches available model IDs from an LLM provider's API.
   * Falls back to empty set on any error (network, auth, timeout).
   * Bounded by a 10-second timeout per provider.
   */
  private async fetchAvailableModels(providerId: string): Promise<Set<string>> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Provider model enumeration timed out after 10s')), 10_000);
    });

    try {
      const provider = await db.query.providers.findFirst({
        where: (p, { eq }) => eq(p.id, providerId),
      });

      if (!provider) {
        logger.warn({ providerId }, 'Provider not found during availability check');
        return new Set();
      }

      const racePromise = this.llmProviderFactory
        .createProviderForEnumeration(provider)
        .then(async (instance) => {
          await instance.init();
          try {
            const models = await instance.enumerateModels();
            return new Set(models.map(m => m.id));
          } finally {
            await instance.cleanup();
          }
        });

      const result = await Promise.race([racePromise, timeoutPromise]);
      logger.info({ providerId, modelCount: result.size }, 'Provider model enumeration completed');
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ providerId, error: msg }, 'Provider model enumeration failed');
      return new Set();
    }
  }
}
