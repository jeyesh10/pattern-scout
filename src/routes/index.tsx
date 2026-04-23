import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Header } from "@/components/Header";
import { Disclaimer } from "@/components/Disclaimer";
import { CandleChart } from "@/components/CandleChart";
import { SignalsPanel, type SignalRow } from "@/components/SignalsPanel";
import { ReasoningPanel } from "@/components/ReasoningPanel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  fetchHistoricalCandles,
  mergeCandle,
  subscribeKlines,
  SUPPORTED_SYMBOLS,
  SUPPORTED_TIMEFRAMES,
  type Candle,
  type Timeframe,
} from "@/lib/binance";
import { detectAllPatterns, type DetectedPattern } from "@/lib/patterns";
import { confirmPattern, type Signal } from "@/lib/signals";
import { buildReasoningTrace } from "@/lib/reasoning";
import { supabase } from "@/integrations/supabase/client";
import { openPaperTradeFromSignal, resolveOpenTrades } from "@/lib/paperTrader";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PatternScope — Live Crypto Chart Pattern Recognition" },
      {
        name: "description",
        content:
          "Educational dashboard streaming Binance market data and detecting 11 classic chart patterns in real time.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const [symbol, setSymbol] = useState<string>("BTCUSDT");
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "error">("connecting");
  const [patterns, setPatterns] = useState<DetectedPattern[]>([]);
  const [activeSignal, setActiveSignal] = useState<Signal | null>(null);
  const [signalsList, setSignalsList] = useState<SignalRow[]>([]);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [selectedReasoning, setSelectedReasoning] = useState<string | null>(null);

  // Track which patterns have already produced a signal (prevent dup writes)
  const lastSignalKey = useRef<string | null>(null);
  // Track last closed candle time we processed (so detection only runs on new closes)
  const lastClosedTime = useRef<number>(0);

  // Reset + load history whenever symbol/timeframe changes
  useEffect(() => {
    let cancelled = false;
    setCandles([]);
    setPatterns([]);
    setActiveSignal(null);
    lastSignalKey.current = null;
    lastClosedTime.current = 0;

    fetchHistoricalCandles(symbol, timeframe, 500)
      .then((hist) => {
        if (cancelled) return;
        setCandles(hist);
        if (hist.length) lastClosedTime.current = hist[hist.length - 1].time;
      })
      .catch((e) => console.error("history load failed", e));

    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe]);

  // Live websocket
  useEffect(() => {
    const stream = subscribeKlines(
      symbol,
      timeframe,
      (c) => setCandles((prev) => mergeCandle(prev, c)),
      setStatus,
    );
    return () => stream.close();
  }, [symbol, timeframe]);

  // Run detection whenever a NEW candle closes
  useEffect(() => {
    if (candles.length < 30) return;
    const lastClosed = [...candles].reverse().find((c) => c.closed);
    if (!lastClosed) return;
    if (lastClosed.time <= lastClosedTime.current && patterns.length > 0) return;
    lastClosedTime.current = lastClosed.time;

    const detected = detectAllPatterns(candles);
    setPatterns(detected);

    // Try to confirm the top pattern
    const top = detected[0];
    if (top) {
      const sig = confirmPattern(top, candles, symbol, timeframe);
      if (sig) {
        setActiveSignal(sig);
        const key = `${symbol}|${timeframe}|${top.kind}|${lastClosed.time}`;
        if (lastSignalKey.current !== key) {
          lastSignalKey.current = key;
          persistSignal(sig).catch((e) => console.error("persist signal", e));
        }
      }
    }

    // Resolve open paper trades for this symbol against latest candles
    resolveOpenTrades(symbol, candles).catch(() => {});
  }, [candles, symbol, timeframe, patterns.length]);

  // Persist a confirmed signal + open paper trade
  async function persistSignal(s: Signal) {
    const reasoning = buildReasoningTrace(s);
    const { data, error } = await supabase
      .from("signals")
      .insert({
        symbol: s.symbol,
        timeframe: s.timeframe,
        pattern: s.pattern.kind,
        side: s.side,
        confidence: s.confidence,
        entry: s.entry,
        stop_loss: s.stopLoss,
        tp1: s.tp1,
        tp2: s.tp2,
        risk_reward: s.riskReward,
        reasoning,
        pattern_start_ts: s.patternStartTs,
        pattern_end_ts: s.patternEndTs,
      })
      .select()
      .single();
    if (error) {
      console.error("signal insert error", error);
      return;
    }
    if (data) {
      try {
        await openPaperTradeFromSignal(s, data.id);
      } catch (e) {
        console.error("paper trade open", e);
      }
    }
  }

  // Load recent signals (last 7 days) and subscribe to realtime
  useEffect(() => {
    const loadSignals = async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("signals")
        .select("id,symbol,timeframe,pattern,side,confidence,entry,tp1,detected_at")
        .gte("detected_at", since)
        .order("detected_at", { ascending: false })
        .limit(50);
      if (data) setSignalsList(data as SignalRow[]);
    };
    loadSignals();

    const channel = supabase
      .channel("signals-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "signals" },
        (payload) => {
          const row = payload.new as SignalRow;
          setSignalsList((prev) => [row, ...prev].slice(0, 50));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // When user selects a signal, load full reasoning
  useEffect(() => {
    if (!selectedSignalId) {
      // Default: show active signal's reasoning if any
      setSelectedReasoning(activeSignal ? buildReasoningTrace(activeSignal) : null);
      return;
    }
    supabase
      .from("signals")
      .select("reasoning")
      .eq("id", selectedSignalId)
      .single()
      .then(({ data }) => setSelectedReasoning(data?.reasoning ?? null));
  }, [selectedSignalId, activeSignal]);

  const lastPrice = candles.length ? candles[candles.length - 1].close : null;
  const statusColor =
    status === "open"
      ? "text-bull"
      : status === "connecting"
      ? "text-warning"
      : "text-bear";

  const visibleCandles = useMemo(() => candles.slice(-200), [candles]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="max-w-[1600px] mx-auto px-4 py-4 space-y-4">
        <Disclaimer />

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 bg-card border border-border rounded-lg px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Symbol</span>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="w-[140px] bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_SYMBOLS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Timeframe</span>
            <Select value={timeframe} onValueChange={(v) => setTimeframe(v as Timeframe)}>
              <SelectTrigger className="w-[100px] bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_TIMEFRAMES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {lastPrice != null && (
              <span className="font-mono text-sm">
                {symbol} <span className="text-foreground font-semibold">{lastPrice.toFixed(2)}</span>
              </span>
            )}
            <Badge variant="outline" className={`text-[10px] ${statusColor}`}>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-current mr-1.5" />
              {status}
            </Badge>
          </div>
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-lg p-2">
              {visibleCandles.length === 0 ? (
                <div className="h-[560px] flex items-center justify-center text-muted-foreground text-sm">
                  Loading market data…
                </div>
              ) : (
                <CandleChart
                  candles={visibleCandles}
                  patterns={patterns.map((p) => ({
                    ...p,
                    startIdx: p.startIdx - (candles.length - visibleCandles.length),
                    endIdx: p.endIdx - (candles.length - visibleCandles.length),
                    pivots: p.pivots.map((i) => i - (candles.length - visibleCandles.length)),
                  })).filter((p) => p.startIdx >= 0)}
                  signal={activeSignal}
                />
              )}
            </div>
            <ReasoningPanel reasoning={selectedReasoning} />
          </div>
          <div className="lg:h-[calc(100vh-200px)] lg:sticky lg:top-[72px]">
            <SignalsPanel
              signals={signalsList}
              selectedId={selectedSignalId}
              onSelect={(id) =>
                setSelectedSignalId((prev) => (prev === id ? null : id))
              }
            />
          </div>
        </div>
      </main>
    </div>
  );
}
