// Signal generation: pattern + price + volume confirmation.

import type { Candle } from "./binance";
import { BULLISH, type DetectedPattern, PATTERN_LABEL } from "./patterns";

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
}

const VOL_LOOKBACK = 20;
const VOL_BREAKOUT_MULT = 1.5;

function avg(arr: number[]) {
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
  if (volMult < VOL_BREAKOUT_MULT) return null;

  // Entry just beyond breakout
  const slip = isBull ? 1.0005 : 0.9995;
  const entry = last.close * slip;

  // Stop loss: pattern structure
  const recent = candles.slice(pattern.startIdx, n);
  const swingLow = Math.min(...recent.map((c) => c.low));
  const swingHigh = Math.max(...recent.map((c) => c.high));
  const stopLoss = isBull ? swingLow : swingHigh;

  const height = pattern.patternHeight || Math.abs(entry - stopLoss);
  const tp1 = isBull ? entry + height : entry - height;
  const tp2 = isBull ? entry + 1.618 * height : entry - 1.618 * height;

  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(tp1 - entry);
  const rr = risk === 0 ? 0 : reward / risk;

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
  };
}

export function patternDisplayName(p: DetectedPattern) {
  return PATTERN_LABEL[p.kind];
}
