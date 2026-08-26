import { buildAsrConnectionTestStrategy } from './strategies/asr';
import { buildLlmConnectionTestStrategy } from './strategies/llm';
import { buildStorageConnectionTestStrategy } from './strategies/storage';
import { buildTtsConnectionTestStrategy } from './strategies/tts';
import type { ConnectionTestStrategy } from './types';

/**
 * Strategy registry wiring for provider connection tests (TPC-01).
 *
 * ProviderConnectionTester builds its dispatch table from here. New provider
 * types plug in by adding one line — without touching the tester or the HTTP
 * contract: TPC-02 'llm' · TPC-03 'asr' · TPC-04 'tts' · TPC-05 'storage' ·
 * TPC-08 'channel'.
 */
export function buildConnectionTestStrategies(): Map<string, ConnectionTestStrategy> {
  const strategies: ConnectionTestStrategy[] = [
    buildLlmConnectionTestStrategy(),
    buildAsrConnectionTestStrategy(),
    buildTtsConnectionTestStrategy(),
    buildStorageConnectionTestStrategy(),
  ];
  return new Map(strategies.map((strategy) => [strategy.providerType, strategy]));
}
