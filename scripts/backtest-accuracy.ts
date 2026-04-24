import type { Candle, Timeframe } from "../src/lib/binance";
import { detectAllPatterns } from "../src/lib/patterns";
import { confirmPattern } from "../src/lib/signals";
import { resolveProviderForSymbol } from "../src/lib/providerRegistry";
import { resolveStrategyConfig } from "../src/lib/strategyConfig";

type BacktestTarget = {
  symbol: string;
  timeframe: Timeframe;
};

type Outcome = "win" | "loss" | "open";

interface TradeEval {
  outcome: Outcome;
  barsHeld: number;
}

interface SymbolReport {
  symbol: string;
  timeframe: Timeframe;
  signals: number;
  wins: number;
  losses: number;
  open: number;
  accuracy: number;
}

const TARGETS: BacktestTarget[] = [
  { symbol: "RELIANCE:NSE", timeframe: "15m" },
  { symbol: "TCS:NSE", timeframe: "15m" },
  { symbol: "INFY:NSE", timeframe: "15m" },
  { symbol: "HDFCBANK:NSE", timeframe: "15m" },
  { symbol: "ICICIBANK:NSE", timeframe: "15m" },
];

const LOOKBACK_CANDLES = 700;
const MIN_WARMUP = 120;
const FORWARD_BARS = 24;

function evaluateSignal(side: "buy" | "sell", stopLoss: number, tp1: number, future: Candle[]): TradeEval {
  for (let i = 0; i < future.length; i++) {
    const c = future[i];
    if (side === "buy") {
      if (c.low <= stopLoss) return { outcome: "loss", barsHeld: i + 1 };
      if (c.high >= tp1) return { outcome: "win", barsHeld: i + 1 };
    } else {
      if (c.high >= stopLoss) return { outcome: "loss", barsHeld: i + 1 };
      if (c.low <= tp1) return { outcome: "win", barsHeld: i + 1 };
    }
  }
  return { outcome: "open", barsHeld: future.length };
}

function pct(n: number): string {
  return `${n.toFixed(2)}%`;
}

async function runForTarget(target: BacktestTarget): Promise<SymbolReport> {
  const provider = resolveProviderForSymbol(target.symbol);
  const strategy = resolveStrategyConfig(target.symbol, target.timeframe);
  const candles = await provider.fetchHistoricalCandles(target.symbol, target.timeframe, LOOKBACK_CANDLES);
  const seen = new Set<string>();

  let wins = 0;
  let losses = 0;
  let open = 0;
  let signals = 0;

  for (let i = MIN_WARMUP; i < candles.length - FORWARD_BARS; i++) {
    const uptoNow = candles.slice(0, i + 1);
    const detected = detectAllPatterns(uptoNow);
    const top = detected[0];
    if (!top) continue;

    const signal = confirmPattern(top, uptoNow, target.symbol, target.timeframe, strategy);
    if (!signal) continue;

    const dedupe = `${signal.side}|${signal.pattern.kind}|${signal.patternEndTs}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    signals += 1;
    const future = candles.slice(i + 1, i + 1 + FORWARD_BARS);
    const result = evaluateSignal(signal.side, signal.stopLoss, signal.tp1, future);
    if (result.outcome === "win") wins += 1;
    else if (result.outcome === "loss") losses += 1;
    else open += 1;
  }

  const resolved = wins + losses;
  const accuracy = resolved === 0 ? 0 : (wins / resolved) * 100;
  return {
    symbol: target.symbol,
    timeframe: target.timeframe,
    signals,
    wins,
    losses,
    open,
    accuracy,
  };
}

async function main() {
  console.log("Running historical accuracy backtest...");
  const reports: SymbolReport[] = [];
  for (const target of TARGETS) {
    try {
      const report = await runForTarget(target);
      reports.push(report);
      console.log(
        `${report.symbol} ${report.timeframe} | signals=${report.signals} wins=${report.wins} losses=${report.losses} open=${report.open} accuracy=${pct(report.accuracy)}`,
      );
    } catch (error) {
      console.log(`${target.symbol} ${target.timeframe} | failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  const totals = reports.reduce(
    (acc, r) => {
      acc.signals += r.signals;
      acc.wins += r.wins;
      acc.losses += r.losses;
      acc.open += r.open;
      return acc;
    },
    { signals: 0, wins: 0, losses: 0, open: 0 },
  );
  const resolved = totals.wins + totals.losses;
  const accuracy = resolved === 0 ? 0 : (totals.wins / resolved) * 100;
  console.log(
    `TOTAL | signals=${totals.signals} wins=${totals.wins} losses=${totals.losses} open=${totals.open} resolved=${resolved} accuracy=${pct(accuracy)}`,
  );
}

main().catch((error) => {
  console.error("Backtest crashed:", error);
  process.exit(1);
});
