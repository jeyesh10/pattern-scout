// Signal generation: pattern + price + volume confirmation.

import type { Candle } from "./binance";
import { BULLISH, type DetectedPattern, PATTERN_LABEL } from "./patterns";
import type { SignalFilterConfig } from "./strategyConfig";

export interface Signal {
  pattern: DetectedPattern;
  symbol: string;
  timeframe: string;
  side: "buy" | "sell";
  confidence: number;
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  riskReward: number;
  breakoutVolumeMultiple: number;
  patternStartTs: number;
  patternEndTs: number;
  detectedAt: number;
  momentumPct: number;
  volatilityPct: number;
}

const VOL_LOOKBACK = 20;
const VOL_BREAKOUT_MULT = 1.5;

function avg(arr: number[]) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, n) => s + n, 0) / arr.length;
}

/**
 * Try to confirm a detected pattern using the LAST CLOSED candle.
 * Returns null if confirmation rules aren't met.
 */
export function confirmPattern(
  pattern: DetectedPattern,
  candles: Candle[],
  symbol: string,
  timeframe: string,
  config?: SignalFilterConfig,
): Signal | null {
  const n = candles.length;
  if (n < VOL_LOOKBACK + 2) return null;
  // Need a CLOSED candle (Binance marks the last one with closed=false while forming)
  const last = candles[n - 1].closed ? candles[n - 1] : candles[n - 2];
  if (!last) return null;

  const isBull = BULLISH.includes(pattern.kind);
  const neckline = pattern.neckline;
  if (neckline === undefined) return null;

  // PRICE CONFIRMATION: close beyond neckline
  if (isBull && last.close <= neckline) return null;
  if (!isBull && last.close >= neckline) return null;

  // VOLUME CONFIRMATION
  const volWindow = candles.slice(Math.max(0, n - 1 - VOL_LOOKBACK), n - 1);
  const avgVol = avg(volWindow.map((c) => c.volume));
  if (avgVol === 0) return null;
  const volMult = last.volume / avgVol;
  const minVolMult = config?.minBreakoutVolumeMultiple ?? VOL_BREAKOUT_MULT;
  if (volMult < minVolMult) return null;

  // Entry just beyond breakout
  const slip = isBull ? 1.0005 : 0.9995;
  const entry = last.close * slip;

  // Stop loss: pattern structure
  const recent = candles.slice(pattern.startIdx, n);
  const swingLow = Math.min(...recent.map((c) => c.low));
  const swingHigh = Math.max(...recent.map((c) => c.high));
  let stopLoss = isBull ? swingLow : swingHigh;
  // Hard safety guard for malformed geometry:
  // stop must stay on the opposite side of entry.
  if (isBull && stopLoss >= entry) stopLoss = entry * 0.995;
  if (!isBull && stopLoss <= entry) stopLoss = entry * 1.005;

  const height = pattern.patternHeight || Math.abs(entry - stopLoss);
  const tp1 = isBull ? entry + height : entry - height;
  const tp2 = isBull ? entry + 1.618 * height : entry - 1.618 * height;

  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(tp1 - entry);
  const rr = risk === 0 ? 0 : reward / risk;
  const lookback = candles.slice(Math.max(0, n - 20), n);
  const highs = lookback.map((c) => c.high);
  const lows = lookback.map((c) => c.low);
  const volatilityPct = entry === 0 ? 0 : ((Math.max(...highs) - Math.min(...lows)) / entry) * 100;
  const baseline = candles[Math.max(0, n - 11)]?.close ?? entry;
  const momentumPct = baseline === 0 ? 0 : ((entry - baseline) / baseline) * 100;

  if (pattern.confidence < (config?.minConfidence ?? 50)) return null;
  if (rr < (config?.minRiskReward ?? 0)) return null;
  if (volatilityPct > (config?.maxVolatilityPct ?? Number.POSITIVE_INFINITY)) return null;

  if (config?.requireTrendAlignment) {
    const closes = candles.slice(Math.max(0, n - 60), n).map((c) => c.close);
    const sma = (len: number) => {
      const w = closes.slice(Math.max(0, closes.length - len));
      return w.length === 0 ? 0 : w.reduce((s, x) => s + x, 0) / w.length;
    };
    const sma20 = sma(20);
    const sma50 = sma(50);
    if (isBull && sma20 < sma50) return null;
    if (!isBull && sma20 > sma50) return null;
  }

  return {
    pattern,
    symbol,
    timeframe,
    side: isBull ? "buy" : "sell",
    confidence: pattern.confidence,
    entry,
    stopLoss,
    tp1,
    tp2,
    riskReward: rr,
    breakoutVolumeMultiple: volMult,
    patternStartTs: candles[pattern.startIdx].time,
    patternEndTs: candles[Math.min(pattern.endIdx, n - 1)].time,
    detectedAt: Date.now(),
    momentumPct,
    volatilityPct,
  };
}

export function patternDisplayName(p: DetectedPattern) {
  return PATTERN_LABEL[p.kind];
}
