import type { Candle } from "./binance";
import type { MarketDataProvider } from "./marketData";

export type LongTermDirection = "grow" | "neutral" | "fall";

export interface LongTermOutlook {
  symbol: string;
  market: "india" | "global";
  provider: string;
  direction: LongTermDirection;
  confidence: number;
  growthProbability3m: number;
  growthProbability6m: number;
  growthProbability12m: number;
  score: number;
  factors: {
    trendScore: number;
    momentumScore: number;
    stabilityScore: number;
    participationScore: number;
  };
  rationale: string;
  generatedAt: string;
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function sma(values: number[], len: number): number {
  const start = Math.max(0, values.length - len);
  const window = values.slice(start);
  if (window.length === 0) return 0;
  return window.reduce((s, n) => s + n, 0) / window.length;
}

function std(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, n) => s + n, 0) / values.length;
  const variance = values.reduce((s, n) => s + (n - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function marketFromSymbol(symbol: string): "india" | "global" {
  return symbol.includes(":") || symbol.endsWith(".NS") || symbol.endsWith(".BO") ? "india" : "global";
}

function computeOutlookFromCandles(symbol: string, providerName: string, candles: Candle[]): LongTermOutlook {
  if (candles.length < 120) {
    throw new Error(`Need at least 120 candles for long-term outlook (${symbol})`);
  }

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const last = closes[closes.length - 1];
  const sma50 = sma(closes, 50);
  const sma120 = sma(closes, 120);
  const sma20 = sma(closes, 20);
  const volSma50 = sma(volumes, 50);
  const returns = closes.slice(1).map((c, i) => (closes[i] === 0 ? 0 : (c - closes[i]) / closes[i]));
  const volRealized = std(returns) * Math.sqrt(252) * 100;

  const trendRaw = sma120 === 0 ? 0 : ((sma50 - sma120) / sma120) * 100;
  const momentumRaw = sma50 === 0 ? 0 : ((last - sma20) / sma50) * 100;
  const stabilityRaw = 30 - Math.min(30, volRealized);
  const participationRaw = volSma50 === 0 ? 0 : ((volumes[volumes.length - 1] - volSma50) / volSma50) * 100;

  const trendScore = clamp(50 + trendRaw * 4);
  const momentumScore = clamp(50 + momentumRaw * 5);
  const stabilityScore = clamp(50 + stabilityRaw * 1.5);
  const participationScore = clamp(50 + participationRaw * 1.2);

  const score = clamp(
    0.4 * trendScore + 0.25 * momentumScore + 0.2 * stabilityScore + 0.15 * participationScore,
  );
  const growthProbability12m = clamp(score);
  const growthProbability6m = clamp(0.6 * growthProbability12m + 0.4 * momentumScore);
  const growthProbability3m = clamp(0.5 * growthProbability6m + 0.5 * momentumScore);

  let direction: LongTermDirection = "neutral";
  if (growthProbability12m >= 62) direction = "grow";
  if (growthProbability12m <= 42) direction = "fall";

  const rationale = [
    `Trend regime: SMA50 ${sma50.toFixed(2)} vs SMA120 ${sma120.toFixed(2)} (${trendRaw >= 0 ? "+" : ""}${trendRaw.toFixed(2)}%).`,
    `Momentum: last close ${last.toFixed(2)} vs SMA20 ${sma20.toFixed(2)}.`,
    `Risk profile: annualized realized volatility ${volRealized.toFixed(2)}%.`,
    `Participation: latest volume vs 50-candle average ${participationRaw >= 0 ? "+" : ""}${participationRaw.toFixed(2)}%.`,
  ].join(" ");

  return {
    symbol,
    market: marketFromSymbol(symbol),
    provider: providerName,
    direction,
    confidence: clamp(Math.abs(growthProbability12m - 50) * 2),
    growthProbability3m,
    growthProbability6m,
    growthProbability12m,
    score,
    factors: {
      trendScore,
      momentumScore,
      stabilityScore,
      participationScore,
    },
    rationale,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildLongTermOutlook(
  provider: MarketDataProvider,
  symbol: string,
  historyLimit = 700,
): Promise<LongTermOutlook> {
  const normalized = provider.normalizeSymbol(symbol);
  const candles = await provider.fetchHistoricalCandles(normalized, "1h", historyLimit);
  return computeOutlookFromCandles(normalized, provider.name, candles);
}
