import { singleton } from 'tsyringe';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/index';
import { projects, agents, stages, classifiers, contextTransformers, tools, globalActions, guardrails, knowledgeCategories, knowledgeItems, providers } from '../db/schema';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';
import { logger } from '../utils/logger';
import { NotFoundError } from '../errors';
import type {
  ProjectExchangeBundle,
  ProjectExchangeBundleV1,
  ProjectExchangeImportResult,
  ProviderHint,
  ProviderHintResolution,
  ProviderHintResolutionTarget,
  AsrConfigExchangeV1,
  StorageConfigExchangeV1,
  ModerationConfigExchangeV1,
  FillerSettingsExchangeV1,
} from '../http/contracts/projectExchange';

/**
 * Produces a hint string key used to deduplicate and look up provider hints.
 */
function hintKey(hint: ProviderHint): string {
  return `${hint.type}:${hint.apiType}`;
}

/**
 * Service responsible for exporting and importing complete projects in the
 * provider-agnostic exchange format.
 *
 * Export replaces every `*ProviderId` FK with a `ProviderHint` (`type` + `apiType`),
 * strips runtime metadata (`version`, `createdAt`, `updatedAt`, etc.) and
 * produces a `ProjectExchangeBundleV1`.
 *
 * Import resolves each hint back to a local provider UUID (best-effort, first match
 * on `providerType + apiType`), remaps all entity IDs to fresh UUIDs so repeated
 * imports never collide with existing data, and inserts everything in FK-safe order.
 */
@singleton()
export class ProjectExchangeService extends BaseService {
  /**
   * Exports a complete project as a `ProjectExchangeBundleV1`.
   *
   * @param projectId - ID of the project to export.
   * @param context - Request context for permission checking.
   * @returns Self-contained exchange bundle.
   * @throws {NotFoundError} When the project does not exist.
   */
  async exportProject(projectId: string, context: RequestContext): Promise<ProjectExchangeBundleV1> {
    this.requirePermission(context, PERMISSIONS.PROJECT_READ);

    logger.info({ projectId, operatorId: context.operatorId }, 'Exporting project exchange bundle');

    // Fetch project
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);

    // Fetch all child entities in parallel
    const [
      agentRows,
      stageRows,
      classifierRows,
      transformerRows,
      toolRows,
      globalActionRows,
      guardrailRows,
      knowledgeCategoryRows,
      knowledgeItemRows,
    ] = await Promise.all([
      db.select().from(agents).where(eq(agents.projectId, projectId)),
      db.select().from(stages).where(eq(stages.projectId, projectId)),
      db.select().from(classifiers).where(eq(classifiers.projectId, projectId)),
      db.select().from(contextTransformers).where(eq(contextTransformers.projectId, projectId)),
      db.select().from(tools).where(eq(tools.projectId, projectId)),
      db.select().from(globalActions).where(eq(globalActions.projectId, projectId)),
      db.select().from(guardrails).where(eq(guardrails.projectId, projectId)),
      db.select().from(knowledgeCategories).where(eq(knowledgeCategories.projectId, projectId)),
      db.select().from(knowledgeItems).where(eq(knowledgeItems.projectId, projectId)),
    ]);

    // Collect all referenced provider IDs
    const providerIds = new Set<string>();
    if (project.asrConfig?.asrProviderId) providerIds.add(project.asrConfig.asrProviderId);
    if (project.storageConfig?.storageProviderId) providerIds.add(project.storageConfig.storageProviderId);
    if (project.moderationConfig?.llmProviderId) providerIds.add(project.moderationConfig.llmProviderId);
    for (const a of agentRows) {
      if (a.ttsProviderId) providerIds.add(a.ttsProviderId);
      if (a.fillerSettings?.llmProviderId) providerIds.add(a.fillerSettings.llmProviderId);
    }
    for (const s of stageRows) if (s.llmProviderId) providerIds.add(s.llmProviderId);
    for (const c of classifierRows) if (c.llmProviderId) providerIds.add(c.llmProviderId);
    for (const t of transformerRows) if (t.llmProviderId) providerIds.add(t.llmProviderId);
    for (const t of toolRows) if (t.llmProviderId) providerIds.add(t.llmProviderId);

    // Batch-fetch providers and build hint map
    const hintMap = new Map<string, ProviderHint>();
    if (providerIds.size > 0) {
      const providerRows = await db.select({ id: providers.id, providerType: providers.providerType, apiType: providers.apiType }).from(providers).where(inArray(providers.id, [...providerIds]));
      for (const p of providerRows) {
        hintMap.set(p.id, { type: p.providerType as ProviderHint['type'], apiType: p.apiType });
      }
    }

    const hint = (id: string | null | undefined): ProviderHint | undefined => (id ? hintMap.get(id) : undefined);

    // Transform asrConfig
    const asrConfig: AsrConfigExchangeV1 = project.asrConfig ? {
      asrHint: hint(project.asrConfig.asrProviderId),
      settings: project.asrConfig.settings as any,
      unintelligiblePlaceholder: project.asrConfig.unintelligiblePlaceholder,
      voiceActivityDetection: project.asrConfig.voiceActivityDetection,
    } : undefined;

    // Transform storageConfig
    const storageConfig: StorageConfigExchangeV1 = project.storageConfig ? {
      storageHint: hint(project.storageConfig.storageProviderId),
      settings: project.storageConfig.settings as Record<string, unknown>,
    } : undefined;

    // Transform moderationConfig
    const moderationConfig: ModerationConfigExchangeV1 | null = project.moderationConfig ? {
      enabled: project.moderationConfig.enabled,
      llmHint: hint(project.moderationConfig.llmProviderId) ?? { type: 'llm', apiType: 'unknown' },
      blockedCategories: project.moderationConfig.blockedCategories,
    } : null;

    // Transform filler settings helper
    const transformFiller = (f: { llmProviderId: string; llmSettings?: any; prompt: string } | null | undefined): FillerSettingsExchangeV1 | null => {
      if (!f) return null;
      return { llmHint: hint(f.llmProviderId) ?? { type: 'llm', apiType: 'unknown' }, llmSettings: f.llmSettings, prompt: f.prompt };
    };

    const bundle: ProjectExchangeBundleV1 = {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        asrConfig,
        acceptVoice: project.acceptVoice,
        generateVoice: project.generateVoice,
        storageConfig,
        moderationConfig,
        constants: project.constants,
        metadata: project.metadata,
        timezone: project.timezone,
        autoCreateUsers: project.autoCreateUsers,
        userProfileVariableDescriptors: project.userProfileVariableDescriptors,
        defaultGuardrailClassifierId: project.defaultGuardrailClassifierId,
        conversationTimeoutSeconds: project.conversationTimeoutSeconds,
      },
      agents: agentRows.map(a => ({
        id: a.id,
        name: a.name,
        description: a.description,
        prompt: a.prompt,
        ttsHint: hint(a.ttsProviderId) ?? null,
        ttsSettings: a.ttsSettings as any,
        tags: a.tags,
        metadata: a.metadata,
        fillerSettings: transformFiller(a.fillerSettings),
      })),
      classifiers: classifierRows.map(c => ({
        id: c.id,
        name: c.name,
        description: c.description,
        prompt: c.prompt,
        llmHint: hint(c.llmProviderId) ?? null,
        llmSettings: c.llmSettings as any,
        tags: c.tags,
        metadata: c.metadata,
      })),
      contextTransformers: transformerRows.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        prompt: t.prompt,
        contextFields: t.contextFields,
        llmHint: hint(t.llmProviderId) ?? null,
        llmSettings: t.llmSettings as any,
        tags: t.tags,
        metadata: t.metadata,
      })),
      tools: toolRows.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        type: t.type,
        // smart_function fields
        prompt: t.prompt ?? null,
        llmHint: hint(t.llmProviderId) ?? null,
        llmSettings: t.llmSettings as any ?? null,
        inputType: t.inputType ?? null,
        outputType: t.outputType ?? null,
        // webhook fields
        url: t.url ?? null,
        webhookMethod: t.webhookMethod as any ?? null,
        webhookHeaders: t.webhookHeaders ?? null,
        webhookBody: t.webhookBody ?? null,
        // script fields
        code: t.code ?? null,
        // shared fields
        parameters: t.parameters,
        tags: t.tags,
        metadata: t.metadata,
      })),
      globalActions: globalActionRows.map(g => ({
        id: g.id,
        name: g.name,
        condition: g.condition,
        triggerOnUserInput: g.triggerOnUserInput,
        triggerOnClientCommand: g.triggerOnClientCommand,
        classificationTrigger: g.classificationTrigger,
        overrideClassifierId: g.overrideClassifierId,
        parameters: g.parameters,
        effects: g.effects,
        examples: g.examples,
        tags: g.tags,
        metadata: g.metadata,
      })),
      guardrails: guardrailRows.map(g => ({
        id: g.id,
        name: g.name,
        condition: g.condition,
        classificationTrigger: g.classificationTrigger,
        effects: g.effects,
        examples: g.examples,
        tags: g.tags,
        metadata: g.metadata,
      })),
      knowledgeCategories: knowledgeCategoryRows.map(k => ({
        id: k.id,
        name: k.name,
        promptTrigger: k.promptTrigger,
        tags: k.tags,
        order: k.order,
      })),
      knowledgeItems: knowledgeItemRows.map(k => ({
        id: k.id,
        categoryId: k.categoryId,
        question: k.question,
        answer: k.answer,
        order: k.order,
      })),
      stages: stageRows.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        prompt: s.prompt,
        llmHint: hint(s.llmProviderId) ?? null,
        llmSettings: s.llmSettings as any,
        agentId: s.agentId,
        enterBehavior: s.enterBehavior,
        useKnowledge: s.useKnowledge,
        knowledgeTags: s.knowledgeTags,
        useGlobalActions: s.useGlobalActions,
        globalActions: s.globalActions,
        variableDescriptors: s.variableDescriptors,
        actions: s.actions,
        defaultClassifierId: s.defaultClassifierId,
        transformerIds: s.transformerIds,
        tags: s.tags,
        metadata: s.metadata,
      })),
    };

    logger.info({ projectId, agentCount: agentRows.length, stageCount: stageRows.length, operatorId: context.operatorId }, 'Project exchange bundle exported');
    return bundle;
  }

  /**
   * Imports a project from an exchange bundle.
   *
   * Each entity receives a fresh UUID so repeated imports never collide.
   * Provider hints are resolved to local provider IDs by matching on
   * `providerType + apiType` (first match wins; `null` when unresolved).
   *
   * Entities are inserted in FK-safe order:
   * project → agents → classifiers → contextTransformers → tools
   * → globalActions → guardrails → knowledgeCategories → knowledgeItems → stages
   *
   * @param bundle - Validated exchange bundle.
   * @param context - Request context for permission checking.
   * @returns Import summary with the new project ID and entity counts.
   */
  async importProject(bundle: ProjectExchangeBundle, context: RequestContext): Promise<ProjectExchangeImportResult> {
    this.requirePermission(context, PERMISSIONS.PROJECT_WRITE);

    if (bundle.formatVersion !== 1) throw new Error(`Unsupported exchange format version: ${(bundle as any).formatVersion}`);
    const v1 = bundle as ProjectExchangeBundleV1;

    logger.info({ exportedAt: v1.exportedAt, operatorId: context.operatorId }, 'Importing project exchange bundle');

    // Collect unique provider hints across entire bundle
    const hints = new Map<string, ProviderHint>();
    const collectHint = (h: ProviderHint | null | undefined) => { if (h) hints.set(hintKey(h), h); };

    collectHint(v1.project.asrConfig?.asrHint);
    collectHint(v1.project.storageConfig?.storageHint);
    collectHint(v1.project.moderationConfig?.llmHint);
    for (const a of v1.agents) {
      collectHint(a.ttsHint);
      collectHint(a.fillerSettings?.llmHint);
    }
    for (const s of v1.stages) collectHint(s.llmHint);
    for (const c of v1.classifiers) collectHint(c.llmHint);
    for (const t of v1.contextTransformers) collectHint(t.llmHint);
    for (const t of v1.tools) collectHint(t.llmHint);

    // Resolve hints to local provider IDs
    const hintToProviderId = new Map<string, string | null>();
    for (const [key, h] of hints) {
      const [row] = await db.select({ id: providers.id }).from(providers).where(eq(providers.providerType, h.type)).limit(1);
      // Narrow by apiType as a secondary filter using JS (Drizzle `and(eq, eq)` works too but this is simpler for now)
      const [precise] = await db.select({ id: providers.id }).from(providers).where(eq(providers.apiType, h.apiType)).limit(1);
      hintToProviderId.set(key, precise?.id ?? row?.id ?? null);
    }

    const resolveHint = (h: ProviderHint | null | undefined): string | null => (h ? (hintToProviderId.get(hintKey(h)) ?? null) : null);

    // Build ID remap table (old bundle IDs → new local IDs)
    const idMap = new Map<string, string>();
    const remap = (oldId: string, prefix: string): string => {
      if (!idMap.has(oldId)) idMap.set(oldId, generateId(prefix));
      return idMap.get(oldId)!;
    };
    const remapNullable = (oldId: string | null | undefined): string | null => (oldId ? remap(oldId, 'unknown') : null);

    // Pre-generate all IDs
    const newProjectId = remap(v1.project.id, ID_PREFIXES.PROJECT);
    for (const a of v1.agents) remap(a.id, ID_PREFIXES.AGENT);
    for (const c of v1.classifiers) remap(c.id, ID_PREFIXES.CLASSIFIER);
    for (const t of v1.contextTransformers) remap(t.id, ID_PREFIXES.CONTEXT_TRANSFORMER);
    for (const t of v1.tools) remap(t.id, ID_PREFIXES.TOOL);
    for (const g of v1.globalActions) remap(g.id, ID_PREFIXES.GLOBAL_ACTION);
    for (const g of v1.guardrails) remap(g.id, ID_PREFIXES.GUARDRAIL);
    for (const k of v1.knowledgeCategories) remap(k.id, ID_PREFIXES.KNOWLEDGE_CATEGORY);
    for (const k of v1.knowledgeItems) remap(k.id, ID_PREFIXES.KNOWLEDGE_ITEM);
    for (const s of v1.stages) remap(s.id, ID_PREFIXES.STAGE);

    // Build hint → targets map now that all new IDs are known
    const hintTargets = new Map<string, ProviderHintResolutionTarget[]>();
    const addTarget = (h: ProviderHint | null | undefined, target: ProviderHintResolutionTarget) => {
      if (!h) return;
      const key = hintKey(h);
      if (!hintTargets.has(key)) hintTargets.set(key, []);
      hintTargets.get(key)!.push(target);
    };

    if (v1.project.asrConfig?.asrHint) addTarget(v1.project.asrConfig.asrHint, { entityType: 'project', entityId: newProjectId, entityName: v1.project.name, field: 'asrConfig.asrProviderId' });
    if (v1.project.storageConfig?.storageHint) addTarget(v1.project.storageConfig.storageHint, { entityType: 'project', entityId: newProjectId, entityName: v1.project.name, field: 'storageConfig.storageProviderId' });
    if (v1.project.moderationConfig?.llmHint) addTarget(v1.project.moderationConfig.llmHint, { entityType: 'project', entityId: newProjectId, entityName: v1.project.name, field: 'moderationConfig.llmProviderId' });
    for (const a of v1.agents) {
      if (a.ttsHint) addTarget(a.ttsHint, { entityType: 'agent', entityId: idMap.get(a.id)!, entityName: a.name, field: 'ttsProviderId' });
      if (a.fillerSettings?.llmHint) addTarget(a.fillerSettings.llmHint, { entityType: 'agent', entityId: idMap.get(a.id)!, entityName: a.name, field: 'fillerSettings.llmProviderId' });
    }
    for (const s of v1.stages) if (s.llmHint) addTarget(s.llmHint, { entityType: 'stage', entityId: idMap.get(s.id)!, entityName: s.name, field: 'llmProviderId' });
    for (const c of v1.classifiers) if (c.llmHint) addTarget(c.llmHint, { entityType: 'classifier', entityId: idMap.get(c.id)!, entityName: c.name, field: 'llmProviderId' });
    for (const t of v1.contextTransformers) if (t.llmHint) addTarget(t.llmHint, { entityType: 'contextTransformer', entityId: idMap.get(t.id)!, entityName: t.name, field: 'llmProviderId' });
    for (const t of v1.tools) if (t.llmHint) addTarget(t.llmHint, { entityType: 'tool', entityId: idMap.get(t.id)!, entityName: t.name, field: 'llmProviderId' });

    await db.transaction(async (tx) => {
      // 1. Project
      const p = v1.project;
      await tx.insert(projects).values({
        id: newProjectId,
        name: p.name + ` (imported ${new Date().toLocaleString()})`,
        description: p.description ?? null,
        asrConfig: p.asrConfig ? {
          asrProviderId: resolveHint(p.asrConfig.asrHint) ?? undefined,
          settings: p.asrConfig.settings,
          unintelligiblePlaceholder: p.asrConfig.unintelligiblePlaceholder,
          voiceActivityDetection: p.asrConfig.voiceActivityDetection,
        } : null,
        acceptVoice: p.acceptVoice ?? true,
        generateVoice: p.generateVoice ?? true,
        storageConfig: p.storageConfig ? {
          storageProviderId: resolveHint(p.storageConfig.storageHint) ?? undefined,
          settings: p.storageConfig.settings,
        } : null,
        moderationConfig: p.moderationConfig ? {
          enabled: p.moderationConfig.enabled,
          llmProviderId: resolveHint(p.moderationConfig.llmHint) ?? '',
          blockedCategories: p.moderationConfig.blockedCategories,
        } : null,
        constants: p.constants ?? null,
        metadata: p.metadata ?? null,
        timezone: p.timezone ?? null,
        autoCreateUsers: p.autoCreateUsers ?? false,
        userProfileVariableDescriptors: p.userProfileVariableDescriptors ?? [],
        defaultGuardrailClassifierId: p.defaultGuardrailClassifierId ? idMap.get(p.defaultGuardrailClassifierId) ?? null : null,
        conversationTimeoutSeconds: p.conversationTimeoutSeconds ?? null,
      });

      // 2. Agents
      for (const a of v1.agents) {
        const fillerSettings = a.fillerSettings ? {
          llmProviderId: resolveHint(a.fillerSettings.llmHint) ?? '',
          llmSettings: a.fillerSettings.llmSettings as any,
          prompt: a.fillerSettings.prompt,
        } : null;
        await tx.insert(agents).values({
          id: idMap.get(a.id)!,
          projectId: newProjectId,
          name: a.name,
          description: a.description ?? null,
          prompt: a.prompt,
          ttsProviderId: resolveHint(a.ttsHint) ?? null,
          ttsSettings: a.ttsSettings as any,
          tags: a.tags ?? [],
          metadata: a.metadata ?? null,
          fillerSettings: fillerSettings ?? undefined,
        });
      }

      // 3. Classifiers
      for (const c of v1.classifiers) {
        await tx.insert(classifiers).values({
          id: idMap.get(c.id)!,
          projectId: newProjectId,
          name: c.name,
          description: c.description ?? null,
          prompt: c.prompt,
          llmProviderId: resolveHint(c.llmHint) ?? null,
          llmSettings: c.llmSettings as any,
          tags: c.tags ?? [],
          metadata: c.metadata ?? null,
        });
      }

      // 4. Context transformers
      for (const t of v1.contextTransformers) {
        await tx.insert(contextTransformers).values({
          id: idMap.get(t.id)!,
          projectId: newProjectId,
          name: t.name,
          description: t.description ?? null,
          prompt: t.prompt,
          contextFields: t.contextFields ?? null,
          llmProviderId: resolveHint(t.llmHint) ?? null,
          llmSettings: t.llmSettings as any,
          tags: t.tags ?? [],
          metadata: t.metadata ?? null,
        });
      }

      // 5. Tools
      for (const t of v1.tools) {
        await tx.insert(tools).values({
          id: idMap.get(t.id)!,
          projectId: newProjectId,
          name: t.name,
          description: t.description ?? null,
          type: t.type ?? 'smart_function',
          // smart_function fields
          prompt: t.prompt ?? null,
          llmProviderId: resolveHint(t.llmHint) ?? null,
          llmSettings: t.llmSettings as any ?? null,
          inputType: t.inputType ?? null,
          outputType: t.outputType ?? null,
          // webhook fields
          url: t.url ?? null,
          webhookMethod: t.webhookMethod as any ?? null,
          webhookHeaders: t.webhookHeaders as any ?? null,
          webhookBody: t.webhookBody ?? null,
          // script fields
          code: t.code ?? null,
          // shared fields
          parameters: t.parameters ?? [],
          tags: t.tags ?? [],
          metadata: t.metadata ?? null,
        });
      }

      // 6. Global actions
      for (const g of v1.globalActions) {
        await tx.insert(globalActions).values({
          id: idMap.get(g.id)!,
          projectId: newProjectId,
          name: g.name,
          condition: g.condition ?? null,
          triggerOnUserInput: g.triggerOnUserInput ?? true,
          triggerOnClientCommand: g.triggerOnClientCommand ?? false,
          classificationTrigger: g.classificationTrigger ?? null,
          overrideClassifierId: g.overrideClassifierId ? (idMap.get(g.overrideClassifierId) ?? null) : null,
          parameters: g.parameters ?? [],
          effects: g.effects ?? [],
          examples: g.examples ?? null,
          tags: g.tags ?? [],
          metadata: g.metadata ?? null,
        });
      }

      // 7. Guardrails
      for (const g of v1.guardrails) {
        await tx.insert(guardrails).values({
          id: idMap.get(g.id)!,
          projectId: newProjectId,
          name: g.name,
          condition: g.condition ?? null,
          classificationTrigger: g.classificationTrigger ?? null,
          effects: g.effects ?? [],
          examples: g.examples ?? null,
          tags: g.tags ?? [],
          metadata: g.metadata ?? null,
        });
      }

      // 8. Knowledge categories
      for (const k of v1.knowledgeCategories) {
        await tx.insert(knowledgeCategories).values({
          id: idMap.get(k.id)!,
          projectId: newProjectId,
          name: k.name,
          promptTrigger: k.promptTrigger,
          tags: k.tags ?? [],
          order: k.order ?? 0,
        });
      }

      // 9. Knowledge items
      for (const k of v1.knowledgeItems) {
        await tx.insert(knowledgeItems).values({
          id: idMap.get(k.id)!,
          projectId: newProjectId,
          categoryId: idMap.get(k.categoryId) ?? k.categoryId,
          question: k.question,
          answer: k.answer,
          order: k.order ?? 0,
        });
      }

      // 10. Stages (last — depend on agents and classifiers)
      for (const s of v1.stages) {
        await tx.insert(stages).values({
          id: idMap.get(s.id)!,
          projectId: newProjectId,
          name: s.name,
          description: s.description ?? null,
          prompt: s.prompt,
          llmProviderId: resolveHint(s.llmHint) ?? null,
          llmSettings: s.llmSettings as any,
          agentId: idMap.get(s.agentId) ?? s.agentId,
          enterBehavior: s.enterBehavior ?? 'generate_response',
          useKnowledge: s.useKnowledge ?? false,
          knowledgeTags: s.knowledgeTags ?? [],
          useGlobalActions: s.useGlobalActions ?? true,
          globalActions: (s.globalActions ?? []).map(gid => idMap.get(gid) ?? gid),
          variableDescriptors: s.variableDescriptors ?? [],
          defaultClassifierId: s.defaultClassifierId ? (idMap.get(s.defaultClassifierId) ?? null) : null,
          actions: Object.fromEntries(
            Object.entries(s.actions ?? {}).map(([key, action]) => [
              key,
              {
                ...action,
                overrideClassifierId: action.overrideClassifierId ? (idMap.get(action.overrideClassifierId) ?? null) : action.overrideClassifierId,
              },
            ])
          ),
          transformerIds: (s.transformerIds ?? []).map(tid => idMap.get(tid) ?? tid),
          tags: s.tags ?? [],
          metadata: s.metadata ?? null,
        });
      }
    });

    const result: ProjectExchangeImportResult = {
      projectId: newProjectId,
      counts: {
        agents: v1.agents.length,
        stages: v1.stages.length,
        classifiers: v1.classifiers.length,
        contextTransformers: v1.contextTransformers.length,
        tools: v1.tools.length,
        globalActions: v1.globalActions.length,
        guardrails: v1.guardrails.length,
        knowledgeCategories: v1.knowledgeCategories.length,
        knowledgeItems: v1.knowledgeItems.length,
      },
      providerResolution: [...hints.values()].map((h): ProviderHintResolution => {
        const resolvedProviderId = hintToProviderId.get(hintKey(h)) ?? null;
        return { hint: h, resolvedProviderId, resolved: resolvedProviderId !== null, targets: hintTargets.get(hintKey(h)) ?? [] };
      }),
    };

    logger.info({ newProjectId, counts: result.counts, operatorId: context.operatorId }, 'Project exchange bundle imported successfully');
    return result;
  }
}
