import { singleton } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index';
import { BaseService } from '../BaseService';
import type { RequestContext } from '../RequestContext';
import { PERMISSIONS } from '../../permissions';
import { InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import type { FunnelQueryRequest, FunnelQueryResponse, FunnelStep } from '../../http/contracts/funnels';

/**
 * Executes user-centric funnel queries over conversation events.
 * Each step narrows the qualifying user set by requiring cascading event presence.
 */
@singleton()
export class FunnelQueryService extends BaseService {
  /**
   * Runs a funnel query for the given project and returns per-step user counts with conversion metrics.
   * @param projectId - Project to run the query against
   * @param input - Funnel query definition including steps and time range
   * @param context - Request context for authorization
   * @throws {InvalidOperationError} When step count, time range, or step params are invalid
   */
  async runQuery(projectId: string, input: FunnelQueryRequest, context: RequestContext): Promise<FunnelQueryResponse> {
    this.requirePermission(context, PERMISSIONS.ANALYTICS_READ);

    this.validateTimeRange(input);
    this.validateSteps(input.steps);

    const { windowStart, windowEnd } = this.resolveTimeRange(input);
    this.validateTimeWindow(windowStart, windowEnd);

    logger.info({ projectId, stepCount: input.steps.length, windowStart, windowEnd }, 'Running funnel query');

    const userCounts: number[] = [];
    let currentUsers: string[] | null = null;

    for (let i = 0; i < input.steps.length; i++) {
      const step = input.steps[i];

      if (currentUsers !== null && currentUsers.length === 0) {
        for (let j = i; j < input.steps.length; j++) {
          userCounts.push(0);
        }
        break;
      }

      const users = await this.getUsersForStep(projectId, step, windowStart, windowEnd, currentUsers);
      currentUsers = users;
      userCounts.push(users.length);
    }

    const usersAtStart = userCounts[0] ?? 0;
    const usersAtEnd = userCounts[userCounts.length - 1] ?? 0;
    const totalConversionRate = usersAtStart === 0 ? 0 : this.round(usersAtEnd / usersAtStart * 100);

    const steps = input.steps.map((step, i) => {
      const userCount = userCounts[i] ?? 0;
      const prevCount = i === 0 ? userCount : (userCounts[i - 1] ?? 0);
      const dropoffCount = i === 0 ? 0 : prevCount - userCount;
      return {
        stepNumber: i + 1,
        label: this.generateLabel(step),
        userCount,
        percentage: usersAtStart === 0 ? 0 : this.round(userCount / usersAtStart * 100),
        dropoffCount,
        dropoffPercentage: usersAtStart === 0 ? 0 : this.round(dropoffCount / usersAtStart * 100),
      };
    });

    logger.info({ projectId, usersAtStart, usersAtEnd, totalConversionRate }, 'Funnel query completed');
    return { totalConversionRate, usersAtStart, usersAtEnd, steps };
  }

  private async getUsersForStep(projectId: string, step: FunnelStep, windowStart: Date, windowEnd: Date, previousUsers: string[] | null): Promise<string[]> {
    if (step.eventType === 'session_started') {
      return this.getUsersForSessionStarted(projectId, step.params, windowStart, windowEnd, previousUsers);
    }
    return this.getUsersForEventStep(projectId, step, windowStart, windowEnd, previousUsers);
  }

  private async getUsersForEventStep(projectId: string, step: FunnelStep, windowStart: Date, windowEnd: Date, previousUsers: string[] | null): Promise<string[]> {
    const p = this.escapeParam(projectId);
    const ws = windowStart.toISOString();
    const we = windowEnd.toISOString();
    const cascadeFilter = this.buildCascadeFilter(previousUsers);

    let stageJoin = '';
    let eventCondition = '';

    switch (step.eventType) {
      case 'enter_stage': {
        const stageName = this.escapeParam(step.params.stageName);
        stageJoin = `JOIN stages s ON s.project_id = ce.project_id AND s.name = '${stageName}'`;
        eventCondition = `(ce.event_type = 'conversation_start' AND ce.event_data->>'stageId' = s.id OR ce.event_type = 'jump_to_stage' AND ce.event_data->>'toStageId' = s.id)`;
        break;
      }
      case 'end_stage': {
        const stageName = this.escapeParam(step.params.stageName);
        stageJoin = `JOIN stages s ON s.project_id = ce.project_id AND s.name = '${stageName}'`;
        const reasonFilter = step.params.reason !== undefined
          ? `AND ce.event_data->>'reason' = '${this.escapeParam(step.params.reason)}'`
          : '';
        eventCondition = `(ce.event_type = 'jump_to_stage' AND ce.event_data->>'fromStageId' = s.id OR ce.event_type IN ('conversation_end', 'conversation_aborted', 'conversation_failed') AND ce.event_data->>'stageId' = s.id ${reasonFilter})`;
        break;
      }
      case 'action_fire': {
        const actionsJson = this.escapeParam(JSON.stringify([step.params.actionName]));
        eventCondition = `ce.event_type = 'execution_plan' AND ce.event_data->'actions' @> '${actionsJson}'::jsonb`;
        break;
      }
      case 'variable_changed': {
        const varName = this.escapeParam(step.params.variableName);
        const varNameJson = this.escapeParam(JSON.stringify(step.params.variableName));
        const valueFilter = step.params.value !== undefined
          ? `AND ce.event_data->'variables'->>'${varName}' = '${this.escapeParam(step.params.value)}'`
          : '';
        eventCondition = `ce.event_type = 'variables_updated' AND ce.event_data->'changedVariableNames' @> '${varNameJson}'::jsonb ${valueFilter}`;
        break;
      }
      case 'user_profile_changed': {
        const profileName = this.escapeParam(step.params.profileName);
        const profileNameJson = this.escapeParam(JSON.stringify(step.params.profileName));
        const valueFilter = step.params.value !== undefined
          ? `AND ce.event_data->'profile'->>'${profileName}' = '${this.escapeParam(step.params.value)}'`
          : '';
        eventCondition = `ce.event_type = 'user_profile_updated' AND ce.event_data->'changedProfileNames' @> '${profileNameJson}'::jsonb ${valueFilter}`;
        break;
      }
      case 'tool_response': {
        const toolName = this.escapeParam(step.params.toolName);
        const value = this.escapeParam(step.params.value);
        eventCondition = `ce.event_type = 'tool_call' AND ce.event_data->>'toolName' = '${toolName}' AND ce.event_data->'result'->0->>'text' = '${value}'`;
        break;
      }
    }

    const query = `
      SELECT DISTINCT c.user_id
      FROM conversation_events ce
      JOIN conversations c ON c.project_id = ce.project_id AND c.id = ce.conversation_id
      ${stageJoin}
      WHERE ce.project_id = '${p}'
        AND ce.timestamp >= '${ws}'
        AND ce.timestamp <= '${we}'
        ${cascadeFilter}
        AND (${eventCondition})
    `;

    const result = await db.execute(sql.raw(query));
    return result.rows.map((row: any) => row.user_id as string);
  }

  private async getUsersForSessionStarted(projectId: string, params: Record<string, string>, windowStart: Date, windowEnd: Date, previousUsers: string[] | null): Promise<string[]> {
    const p = this.escapeParam(projectId);
    const ws = windowStart.toISOString();
    const we = windowEnd.toISOString();
    const minSessions = parseInt(params.minSessions, 10);
    const cascadeFilter = previousUsers !== null
      ? `AND user_id = ANY(ARRAY[${previousUsers.map((u) => `'${this.escapeParam(u)}'`).join(',')}])`
      : '';

    const query = `
      SELECT user_id
      FROM conversations
      WHERE project_id = '${p}'
        AND created_at >= '${ws}'
        AND created_at <= '${we}'
        ${cascadeFilter}
      GROUP BY user_id
      HAVING COUNT(DISTINCT session_id) >= ${minSessions}
    `;

    const result = await db.execute(sql.raw(query));
    return result.rows.map((row: any) => row.user_id as string);
  }

  private buildCascadeFilter(previousUsers: string[] | null): string {
    if (previousUsers === null) return '';
    return `AND c.user_id = ANY(ARRAY[${previousUsers.map((u) => `'${this.escapeParam(u)}'`).join(',')}])`;
  }

  private validateTimeRange(input: FunnelQueryRequest): void {
    const hasRelativeTime = input.relativeTime !== undefined;
    const hasFrom = input.from !== undefined;
    const hasTo = input.to !== undefined;

    if (!hasRelativeTime && !hasFrom && !hasTo) {
      throw new InvalidOperationError('A time range is required. Provide relativeTime or from/to.');
    }
    if (hasRelativeTime && (hasFrom || hasTo)) {
      throw new InvalidOperationError('Provide either relativeTime or from/to, not both');
    }
    if (hasFrom && hasTo && input.from! > input.to!) {
      throw new InvalidOperationError('from must be before to');
    }
  }

  private validateSteps(steps: FunnelStep[]): void {
    if (steps.length < 2) {
      throw new InvalidOperationError('At least 2 funnel steps are required');
    }
    if (steps.length > 15) {
      throw new InvalidOperationError('Funnel steps must not exceed 15');
    }
    steps.forEach((step, i) => {
      const n = i + 1;
      const { eventType, params } = step;
      switch (eventType) {
        case 'enter_stage':
        case 'end_stage':
          if (!params.stageName) throw new InvalidOperationError(`Step ${n}: missing required param 'stageName' for event type '${eventType}'`);
          break;
        case 'action_fire':
          if (!params.actionName) throw new InvalidOperationError(`Step ${n}: missing required param 'actionName' for event type 'action_fire'`);
          break;
        case 'variable_changed':
          if (!params.variableName) throw new InvalidOperationError(`Step ${n}: missing required param 'variableName' for event type 'variable_changed'`);
          break;
        case 'user_profile_changed':
          if (!params.profileName) throw new InvalidOperationError(`Step ${n}: missing required param 'profileName' for event type 'user_profile_changed'`);
          break;
        case 'session_started': {
          if (!params.minSessions) throw new InvalidOperationError(`Step ${n}: missing required param 'minSessions' for event type 'session_started'`);
          const val = Number(params.minSessions);
          if (!Number.isInteger(val) || val < 1) throw new InvalidOperationError(`Step ${n}: minSessions must be a positive integer`);
          break;
        }
        case 'tool_response':
          if (!params.toolName) throw new InvalidOperationError(`Step ${n}: missing required param 'toolName' for event type 'tool_response'`);
          if (!params.value) throw new InvalidOperationError(`Step ${n}: missing required param 'value' for event type 'tool_response'`);
          break;
      }
    });
  }

  private validateTimeWindow(windowStart: Date, windowEnd: Date): void {
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    if (windowEnd.getTime() - windowStart.getTime() > oneYearMs) {
      throw new InvalidOperationError('Time range cannot exceed 1 year');
    }
  }

  private resolveTimeRange(input: FunnelQueryRequest): { windowStart: Date; windowEnd: Date } {
    if (input.relativeTime) {
      const windowEnd = new Date();
      const windowStart = new Date(windowEnd);
      const { amount, unit } = input.relativeTime;
      switch (unit) {
        case 'hours': windowStart.setHours(windowStart.getHours() - amount); break;
        case 'days': windowStart.setDate(windowStart.getDate() - amount); break;
        case 'weeks': windowStart.setDate(windowStart.getDate() - amount * 7); break;
        case 'months': windowStart.setMonth(windowStart.getMonth() - amount); break;
      }
      return { windowStart, windowEnd };
    }
    return { windowStart: input.from!, windowEnd: input.to ?? new Date() };
  }

  private generateLabel(step: FunnelStep): string {
    const { eventType, params } = step;
    switch (eventType) {
      case 'enter_stage': return `Enter Stage: ${params.stageName}`;
      case 'end_stage': return params.reason ? `End Stage: ${params.stageName} (${params.reason})` : `End Stage: ${params.stageName}`;
      case 'action_fire': return `Action: ${params.actionName}`;
      case 'variable_changed': return params.value !== undefined ? `Variable: ${params.variableName} = ${params.value}` : `Variable: ${params.variableName}`;
      case 'user_profile_changed': return params.value !== undefined ? `Profile: ${params.profileName} = ${params.value}` : `Profile: ${params.profileName}`;
      case 'session_started': return `Sessions \u2265 ${params.minSessions}`;
      case 'tool_response': return `Tool: ${params.toolName}`;
      default: return eventType;
    }
  }

  private escapeParam(value: string): string {
    return value.replace(/'/g, "''");
  }

  private round(value: number): number {
    return Math.round(value * 10) / 10;
  }
}
