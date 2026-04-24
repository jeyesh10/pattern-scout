import type { Candle, Timeframe } from "../src/lib/binance";
import { detectAllPatterns } from "../src/lib/patterns";
import { confirmPattern } from "../src/lib/signals";
import { resolveProviderForSymbol } from "../src/lib/providerRegistry";
import type { SignalFilterConfig } from "../src/lib/strategyConfig";

type Target = { symbol: string; timeframe: Timeframe };
type Outcome = "win" | "loss" | "open";

const TARGETS: Target[] = [
  { symbol: "RELIANCE:NSE", timeframe: "15m" },
  { symbol: "TCS:NSE", timeframe: "15m" },
  { symbol: "INFY:NSE", timeframe: "15m" },
  { symbol: "HDFCBANK:NSE", timeframe: "15m" },
  { symbol: "ICICIBANK:NSE", timeframe: "15m" },
];

const LOOKBACK_CANDLES = 700;
const MIN_WARMUP = 120;
const FORWARD_BARS = 24;
const MIN_RESOLVED_FOR_KEEP = 8;
const MIN_ACCURACY_FOR_KEEP = 52;

const GRID: SignalFilterConfig[] = [];
for (const minBreakoutVolumeMultiple of [1.5, 1.8, 2.0, 2.2]) {
  for (const minConfidence of [50, 55, 60]) {
    for (const minRiskReward of [0, 1.0, 1.2, 1.4]) {
      for (const maxVolatilityPct of [8, 10, 12]) {
        for (const requireTrendAlignment of [false, true]) {
          GRID.push({
            minBreakoutVolumeMultiple,
            minConfidence,
            minRiskReward,
            maxVolatilityPct,
            requireTrendAlignment,
          });
        }
      }
    }
  }
}

function evaluateSignal(side: "buy" | "sell", stopLoss: number, tp1: number, future: Candle[]): Outcome {
  for (const c of future) {
    if (side === "buy") {
      if (c.low <= stopLoss) return "loss";
      if (c.high >= tp1) return "win";
    } else {
      if (c.high >= stopLoss) return "loss";
      if (c.low <= tp1) return "win";
    }
  }
  return "open";
}

async function fetchCandles(target: Target): Promise<Candle[]> {
  const provider = resolveProviderForSymbol(target.symbol);
  return provider.fetchHistoricalCandles(target.symbol, target.timeframe, LOOKBACK_CANDLES);
}

function testConfig(candles: Candle[], target: Target, config: SignalFilterConfig) {
  let wins = 0;
  let losses = 0;
  let open = 0;
  let signals = 0;
  const seen = new Set<string>();

  for (let i = MIN_WARMUP; i < candles.length - FORWARD_BARS; i++) {
    const uptoNow = candles.slice(0, i + 1);
    const detected = detectAllPatterns(uptoNow);
    const top = detected[0];
    if (!top) continue;
    const signal = confirmPattern(top, uptoNow, target.symbol, target.timeframe, config);
    if (!signal) continue;

    const dedupe = `${signal.side}|${signal.pattern.kind}|${signal.patternEndTs}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    signals += 1;
    const outcome = evaluateSignal(signal.side, signal.stopLoss, signal.tp1, candles.slice(i + 1, i + 1 + FORWARD_BARS));
    if (outcome === "win") wins += 1;
    else if (outcome === "loss") losses += 1;
    else open += 1;
  }

  const resolved = wins + losses;
  const accuracy = resolved === 0 ? 0 : (wins / resolved) * 100;
  return { wins, losses, open, signals, resolved, accuracy };
}

function score(resolved: number, accuracy: number, signals: number): number {
  if (resolved < 6) return -1e6 + resolved;
  return accuracy * 1500 + resolved * 4 + signals;
}

async function main() {
  const candlesByTarget = new Map<string, Candle[]>();
  for (const target of TARGETS) {
    candlesByTarget.set(`${target.symbol}|${target.timeframe}`, await fetchCandles(target));
  }

  const defaultCfg: SignalFilterConfig = {
    minBreakoutVolumeMultiple: 1.5,
    minConfidence: 50,
    minRiskReward: 0,
    maxVolatilityPct: 12,
    requireTrendAlignment: false,
  };

  const bestOverrides: Record<string, Partial<SignalFilterConfig>> = {
    "*|*": {
      minBreakoutVolumeMultiple: 1.8,
      minConfidence: 50,
      minRiskReward: 0,
      maxVolatilityPct: 10,
      requireTrendAlignment: false,
    },
  };

  let totalResolved = 0;
  let totalWins = 0;
  let kept = 0;
  const candidates: Array<{ key: string; acc: number; resolved: number }> = [];

  for (const target of TARGETS) {
    const key = `${target.symbol}|${target.timeframe}`;
    const candles = candlesByTarget.get(key)!;
    let best = GRID[0];
    let bestStats = testConfig(candles, target, best);
    let bestScore = score(bestStats.resolved, bestStats.accuracy, bestStats.signals);

    for (let i = 1; i < GRID.length; i++) {
      const cfg = GRID[i];
      const stats = testConfig(candles, target, cfg);
      const s = score(stats.resolved, stats.accuracy, stats.signals);
      if (s > bestScore) {
        best = cfg;
        bestStats = stats;
        bestScore = s;
      }
    }

    const keep = bestStats.resolved >= MIN_RESOLVED_FOR_KEEP && bestStats.accuracy >= MIN_ACCURACY_FOR_KEEP;
    if (keep) {
      kept += 1;
      bestOverrides[key] = best;
      totalResolved += bestStats.resolved;
      totalWins += bestStats.wins;
      candidates.push({ key, acc: bestStats.accuracy, resolved: bestStats.resolved });
    } else {
      bestOverrides[key] = defaultCfg;
    }

    console.log(
      `${target.symbol} ${target.timeframe} => acc=${bestStats.accuracy.toFixed(2)}% resolved=${bestStats.resolved} signals=${bestStats.signals} keep=${keep} cfg=${JSON.stringify(bestOverrides[key])}`,
    );
  }

  // Fallback: keep top 2 candidates by accuracy if none passed threshold.
  if (kept === 0) {
    const evaluated = TARGETS.map((target) => {
      const key = `${target.symbol}|${target.timeframe}`;
      const candles = candlesByTarget.get(key)!;
      const stats = testConfig(candles, target, defaultCfg);
      return { key, target, stats };
    })
      .filter((x) => x.stats.resolved >= 6)
      .sort((a, b) => b.stats.accuracy - a.stats.accuracy)
      .slice(0, 2);

    for (const row of evaluated) {
      bestOverrides[row.key] = {
        minBreakoutVolumeMultiple: 1.8,
        minConfidence: 50,
        minRiskReward: 0,
        maxVolatilityPct: 8,
        requireTrendAlignment: false,
      };
    }
  }

  const portfolioAcc = totalResolved === 0 ? 0 : (totalWins / totalResolved) * 100;
  console.log(`PORTFOLIO precision-first resolved=${totalResolved} accuracy=${portfolioAcc.toFixed(2)}%`);

  const lines = [
    "const overrides = " + JSON.stringify(bestOverrides, null, 2) + ";",
    "",
    "export default overrides;",
    "",
  ];

  const fs = await import("node:fs/promises");
  await fs.writeFile("src/lib/strategy-overrides.generated.ts", lines.join("\n"), "utf8");
  console.log("Wrote src/lib/strategy-overrides.generated.ts");
}

main().catch((error) => {
  console.error("Precision optimizer failed", error);
  process.exit(1);
});
