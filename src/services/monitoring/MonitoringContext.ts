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

  /** Runs `fn` with `ctx` as the current monitoring context. */
  static run<T>(ctx: MonitoringContextData, fn: () => T): T {
    return MonitoringContext.storage.run(ctx, fn);
  }

  /** The context of the current async execution, or undefined outside a `run()`. */
  static current(): MonitoringContextData | undefined {
    return MonitoringContext.storage.getStore();
  }
}
