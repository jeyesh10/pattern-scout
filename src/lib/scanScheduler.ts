import {
  rankScanResultsByRisk,
  runUniverseScan,
  type RiskRankedSymbol,
  type ScanOptions,
  type ScanResult,
  type ScanTarget,
} from "./scanEngine";
import { INDIA_SUPPORTED_SYMBOLS } from "./indiaMarketData";
import type { Timeframe } from "./binance";

export interface SchedulerConfig {
  timeframe: Timeframe;
  intervalMs: number;
  symbols?: string[];
  persistSignals?: boolean;
  persistOutlooks?: boolean;
  signalLimit?: number;
  onTickComplete?: (payload: SchedulerTickResult) => void;
  onTickError?: (error: unknown) => void;
}

export interface SchedulerTickResult {
  startedAt: string;
  completedAt: string;
  targets: ScanTarget[];
  scanResults: ScanResult[];
  riskRanking: RiskRankedSymbol[];
}

export interface ScanScheduler {
  stop: () => void;
  isRunning: () => boolean;
  runNow: () => Promise<SchedulerTickResult>;
}

export function buildIndiaUniverseTargets(timeframe: Timeframe, symbols?: string[]): ScanTarget[] {
  const source = symbols && symbols.length > 0 ? symbols : [...INDIA_SUPPORTED_SYMBOLS];
  return source.map((symbol) => ({ symbol, timeframe }));
}

export function createScanScheduler(config: SchedulerConfig): ScanScheduler {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const runNow = async (): Promise<SchedulerTickResult> => {
    const startedAt = new Date().toISOString();
    const targets = buildIndiaUniverseTargets(config.timeframe, config.symbols);
    const options: ScanOptions = {
      persistSignals: config.persistSignals,
      persistOutlooks: config.persistOutlooks,
      signalLimit: config.signalLimit,
    };
    const scanResults = await runUniverseScan(targets, options);
    const riskRanking = rankScanResultsByRisk(scanResults);
    return {
      startedAt,
      completedAt: new Date().toISOString(),
      targets,
      scanResults,
      riskRanking,
    };
  };

  const onTick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runNow();
      config.onTickComplete?.(result);
    } catch (error) {
      config.onTickError?.(error);
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => {
    onTick().catch(config.onTickError);
  }, config.intervalMs);

  return {
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    isRunning: () => running,
    runNow,
  };
}
