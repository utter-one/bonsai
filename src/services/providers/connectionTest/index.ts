import type { ConnectionTestStrategy } from './types';

/**
 * Strategy registry wiring for provider connection tests (TPC-01).
 *
 * ProviderConnectionTester builds its dispatch table from here. New provider
 * types plug in by adding one line — without touching the tester or the HTTP
 * contract: TPC-02 'llm' · TPC-03 'asr' · TPC-04 'tts' · TPC-05 'storage' ·
 * TPC-08 'channel'. Phase-1 strategies land as their specs ship; until then
 * the table is empty and every provider type is an InvalidOperationError.
 */
export function buildConnectionTestStrategies(): Map<string, ConnectionTestStrategy> {
  const strategies = new Map<string, ConnectionTestStrategy>();
  return strategies;
}
