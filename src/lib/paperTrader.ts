// Paper trading simulator. Resolves open trades against new candles.

import type { Candle } from "./binance";
import { supabase } from "@/integrations/supabase/client";
import type { Signal } from "./signals";

export interface PaperTrade {
  id: string;
  signal_id: string | null;
  symbol: string;
  timeframe: string;
  pattern: string;
  side: "buy" | "sell";
  confidence: number;
  entry: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  status: "open" | "tp1" | "tp2" | "stop" | "closed";
  exit_price: number | null;
  pnl_pct: number | null;
  opened_at: string;
  closed_at: string | null;
}

export async function openPaperTradeFromSignal(signal: Signal, signalId: string) {
  const { data, error } = await supabase
    .from("paper_trades")
    .insert({
      signal_id: signalId,
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      pattern: signal.pattern.kind,
      side: signal.side,
      confidence: signal.confidence,
      entry: signal.entry,
      stop_loss: signal.stopLoss,
      tp1: signal.tp1,
      tp2: signal.tp2,
      status: "open",
    })
    .select()
    .single();
  if (error) throw error;
  return data as PaperTrade;
}

/**
 * Walk through new candles, mark TP1/TP2/Stop hits.
 * Closes trade at first level touched.
 */
export async function resolveOpenTrades(symbol: string, candles: Candle[]) {
  if (candles.length === 0) return;
  const { data: trades, error } = await supabase
    .from("paper_trades")
    .select("*")
    .eq("symbol", symbol)
    .eq("status", "open");
  if (error || !trades) return;

  for (const t of trades as PaperTrade[]) {
    const openedTs = new Date(t.opened_at).getTime();
    const relevant = candles.filter((c) => c.time >= openedTs);
    let resolved: { status: PaperTrade["status"]; exit: number } | null = null;
    for (const c of relevant) {
      if (t.side === "buy") {
        if (c.low <= t.stop_loss) {
          resolved = { status: "stop", exit: t.stop_loss };
          break;
        }
        if (c.high >= t.tp2) {
          resolved = { status: "tp2", exit: t.tp2 };
          break;
        }
        if (c.high >= t.tp1) {
          resolved = { status: "tp1", exit: t.tp1 };
          break;
        }
      } else {
        if (c.high >= t.stop_loss) {
          resolved = { status: "stop", exit: t.stop_loss };
          break;
        }
        if (c.low <= t.tp2) {
          resolved = { status: "tp2", exit: t.tp2 };
          break;
        }
        if (c.low <= t.tp1) {
          resolved = { status: "tp1", exit: t.tp1 };
          break;
        }
      }
    }
    if (resolved) {
      const pnl =
        t.side === "buy"
          ? ((resolved.exit - t.entry) / t.entry) * 100
          : ((t.entry - resolved.exit) / t.entry) * 100;
      await supabase
        .from("paper_trades")
        .update({
          status: resolved.status,
          exit_price: resolved.exit,
          pnl_pct: pnl,
          closed_at: new Date().toISOString(),
        })
        .eq("id", t.id);
    }
  }
}

export interface PortfolioMetrics {
  total: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpe: number;
}

export function computeMetrics(trades: PaperTrade[]): PortfolioMetrics {
  const closed = trades.filter((t) => t.status !== "open" && t.pnl_pct !== null);
  const wins = closed.filter((t) => (t.pnl_pct ?? 0) > 0);
  const losses = closed.filter((t) => (t.pnl_pct ?? 0) <= 0);
  const winRate = closed.length === 0 ? 0 : (wins.length / closed.length) * 100;
  const avgWin =
    wins.length === 0 ? 0 : wins.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / wins.length;
  const avgLoss =
    losses.length === 0 ? 0 : losses.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / losses.length;
  const grossWin = wins.reduce((s, t) => s + (t.pnl_pct ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl_pct ?? 0), 0));
  const profitFactor = grossLoss === 0 ? grossWin : grossWin / grossLoss;

  // Equity curve in % (cumulative sum)
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  const returns: number[] = [];
  for (const t of closed) {
    const r = t.pnl_pct ?? 0;
    returns.push(r);
    equity += r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  const meanR = returns.length === 0 ? 0 : returns.reduce((s, n) => s + n, 0) / returns.length;
  const variance =
    returns.length === 0
      ? 0
      : returns.reduce((s, n) => s + (n - meanR) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  const sharpe = std === 0 ? 0 : (meanR / std) * Math.sqrt(252);

  return {
    total: trades.length,
    open: trades.filter((t) => t.status === "open").length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgWin,
    avgLoss,
    profitFactor,
    maxDrawdown: maxDd,
    sharpe,
  };
}

export function tradesToCsv(trades: PaperTrade[]): string {
  const headers = [
    "id",
    "symbol",
    "timeframe",
    "pattern",
    "side",
    "confidence",
    "entry",
    "stop_loss",
    "tp1",
    "tp2",
    "status",
    "exit_price",
    "pnl_pct",
    "opened_at",
    "closed_at",
  ];
  const rows = trades.map((t) =>
    headers.map((h) => JSON.stringify((t as unknown as Record<string, unknown>)[h] ?? "")).join(","),
  );
  return [headers.join(","), ...rows].join("\n");
}
