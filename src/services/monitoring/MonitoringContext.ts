import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Business context made readable from async call sites that do not receive it
 * as a parameter (provider bases, channel send paths). Set by ConversationRunner
 * and channel hosts via `MonitoringContext.run(ctx, fn)`; read by instrumentation
 * (P1-03) via `MonitoringContext.current()`.
 *
 * Propagates across `await` boundaries automatically (AsyncLocalStorage).
 */
export interface MonitoringContextData {
  projectId?: string;
  conversationId?: string;
  stageId?: string;
  /** Call operation override (e.g. 'llm.generate') for code paths without an explicit one. */
  operation?: string;
}

export class MonitoringContext {
  private static readonly storage = new AsyncLocalStorage<MonitoringContextData>();

  /**
   * Runs `fn` with `ctx` merged over the current monitoring context: inner
   * fields override outer ones, fields not set in `ctx` are inherited from
   * the enclosing `run()`. This lets per-operation wrappers (e.g.
   * `run({ operation: 'llm.filler' })`) nest inside a turn-level context
   * without re-declaring projectId/conversationId.
   */
  static run<T>(ctx: MonitoringContextData, fn: () => T): T {
    const outer = MonitoringContext.current();
    const merged: MonitoringContextData = outer ? { ...outer, ...ctx } : { ...ctx };
    return MonitoringContext.storage.run(merged, fn);
  }

  /** The context of the current async execution, or undefined outside a `run()`. */
  static current(): MonitoringContextData | undefined {
    return MonitoringContext.storage.getStore();
  }
}
