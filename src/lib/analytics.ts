// Pattern performance analytics across closed trades.

import { PATTERN_LABEL, type PatternKind } from "./patterns";
import type { PaperTrade } from "./paperTrader";

export interface PatternStats {
  pattern: string;
  label: string;
  trades: number;
  wins: number;
  winRate: number;
  avgPnl: number;
}

export function statsByPattern(trades: PaperTrade[]): PatternStats[] {
  const groups = new Map<string, PaperTrade[]>();
  for (const t of trades) {
    if (t.status === "open") continue;
    const arr = groups.get(t.pattern) ?? [];
    arr.push(t);
    groups.set(t.pattern, arr);
  }
  return Array.from(groups.entries())
    .map(([pattern, ts]) => {
      const wins = ts.filter((t) => (t.pnl_pct ?? 0) > 0).length;
      return {
        pattern,
        label: PATTERN_LABEL[pattern as PatternKind] ?? pattern,
        trades: ts.length,
        wins,
        winRate: ts.length === 0 ? 0 : (wins / ts.length) * 100,
        avgPnl: ts.length === 0 ? 0 : ts.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / ts.length,
      };
    })
    .sort((a, b) => b.trades - a.trades);
}

export interface TimeframeStats {
  timeframe: string;
  trades: number;
  winRate: number;
  avgPnl: number;
}

export function statsByTimeframe(trades: PaperTrade[]): TimeframeStats[] {
  const groups = new Map<string, PaperTrade[]>();
  for (const t of trades) {
    if (t.status === "open") continue;
    const arr = groups.get(t.timeframe) ?? [];
    arr.push(t);
    groups.set(t.timeframe, arr);
  }
  return Array.from(groups.entries())
    .map(([timeframe, ts]) => {
      const wins = ts.filter((t) => (t.pnl_pct ?? 0) > 0).length;
      return {
        timeframe,
        trades: ts.length,
        winRate: ts.length === 0 ? 0 : (wins / ts.length) * 100,
        avgPnl: ts.length === 0 ? 0 : ts.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / ts.length,
      };
    })
    .sort((a, b) => b.trades - a.trades);
}

export interface CalibrationBucket {
  bucket: string;
  predicted: number; // mid of bucket
  actual: number; // actual win rate
  trades: number;
}

export function calibration(trades: PaperTrade[]): CalibrationBucket[] {
  const buckets: { lo: number; hi: number; label: string }[] = [
    { lo: 50, hi: 60, label: "50-60%" },
    { lo: 60, hi: 70, label: "60-70%" },
    { lo: 70, hi: 80, label: "70-80%" },
    { lo: 80, hi: 90, label: "80-90%" },
    { lo: 90, hi: 101, label: "90-100%" },
  ];
  return buckets.map((b) => {
    const ts = trades.filter(
      (t) => t.status !== "open" && t.confidence >= b.lo && t.confidence < b.hi,
    );
    const wins = ts.filter((t) => (t.pnl_pct ?? 0) > 0).length;
    return {
      bucket: b.label,
      predicted: (b.lo + Math.min(b.hi, 100)) / 2,
      actual: ts.length === 0 ? 0 : (wins / ts.length) * 100,
      trades: ts.length,
    };
  });
}

export interface SessionStats {
  hour: number; // UTC hour
  trades: number;
  winRate: number;
}

export function statsBySession(trades: PaperTrade[]): SessionStats[] {
  const buckets = new Map<number, PaperTrade[]>();
  for (const t of trades) {
    if (t.status === "open") continue;
    const h = new Date(t.opened_at).getUTCHours();
    const arr = buckets.get(h) ?? [];
    arr.push(t);
    buckets.set(h, arr);
  }
  const out: SessionStats[] = [];
  for (let h = 0; h < 24; h++) {
    const ts = buckets.get(h) ?? [];
    const wins = ts.filter((t) => (t.pnl_pct ?? 0) > 0).length;
    out.push({
      hour: h,
      trades: ts.length,
      winRate: ts.length === 0 ? 0 : (wins / ts.length) * 100,
    });
  }
  return out;
}
