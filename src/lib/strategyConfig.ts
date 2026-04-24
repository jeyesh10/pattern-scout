import type { Timeframe } from "./binance";
import overrides from "./strategy-overrides.generated";

export interface SignalFilterConfig {
  minBreakoutVolumeMultiple: number;
  minConfidence: number;
  minRiskReward: number;
  maxVolatilityPct: number;
  requireTrendAlignment: boolean;
}

export const DEFAULT_SIGNAL_FILTER_CONFIG: SignalFilterConfig = {
  minBreakoutVolumeMultiple: 1.5,
  minConfidence: 50,
  minRiskReward: 0,
  maxVolatilityPct: 12,
  requireTrendAlignment: false,
};

type OverrideMap = Record<string, Partial<SignalFilterConfig>>;

const map = overrides as OverrideMap;

function key(symbol: string, timeframe: Timeframe | "*"): string {
  return `${symbol.toUpperCase()}|${timeframe}`;
}

export function resolveStrategyConfig(symbol: string, timeframe: Timeframe): SignalFilterConfig {
  const normalized = symbol.toUpperCase();
  const merged: SignalFilterConfig = { ...DEFAULT_SIGNAL_FILTER_CONFIG };
  const layers: Array<Partial<SignalFilterConfig> | undefined> = [
    map[key("*", "*")],
    map[key("*", timeframe)],
    map[key(normalized, "*")],
    map[key(normalized, timeframe)],
  ];
  for (const layer of layers) {
    if (!layer) continue;
    Object.assign(merged, layer);
  }
  return merged;
}
