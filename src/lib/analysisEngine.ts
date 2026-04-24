import { detectAllPatterns, type DetectedPattern } from "./patterns";
import { confirmPattern, type Signal } from "./signals";
import { buildReasoningTrace } from "./reasoning";
import type { Candle, Timeframe } from "./binance";
import type { MarketDataProvider } from "./marketData";
import { openPaperTradeFromSignal, resolveOpenTrades } from "./paperTrader";
import { supabase } from "@/integrations/supabase/client";
import { resolveStrategyConfig } from "./strategyConfig";

export interface AnalysisDecision {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  patterns: DetectedPattern[];
  signal: Signal | null;
  reasoning: string | null;
}

export interface PersistedAnalysisResult extends AnalysisDecision {
  signalId: string | null;
  paperTradeId: string | null;
}

export async function runAnalysisOnce(
  provider: MarketDataProvider,
  symbol: string,
  timeframe: Timeframe,
  limit = 500,
): Promise<AnalysisDecision> {
  const normalizedSymbol = provider.normalizeSymbol(symbol);
  const candles = await provider.fetchHistoricalCandles(normalizedSymbol, timeframe, limit);
  const patterns = detectAllPatterns(candles);
  const top = patterns[0];
  const config = resolveStrategyConfig(normalizedSymbol, timeframe);
  const signal = top ? confirmPattern(top, candles, normalizedSymbol, timeframe, config) : null;
  const reasoning = signal ? buildReasoningTrace(signal) : null;

  return {
    symbol: normalizedSymbol,
    timeframe,
    candles,
    patterns,
    signal,
    reasoning,
  };
}

export async function persistAnalysisDecision(
  analysis: AnalysisDecision,
): Promise<PersistedAnalysisResult> {
  let signalId: string | null = null;
  let paperTradeId: string | null = null;

  if (analysis.signal && analysis.reasoning) {
    const s = analysis.signal;
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
        reasoning: analysis.reasoning,
        pattern_start_ts: s.patternStartTs,
        pattern_end_ts: s.patternEndTs,
        pattern_meta: {
          breakoutVolumeMultiple: s.breakoutVolumeMultiple,
          momentumPct: s.momentumPct,
          volatilityPct: s.volatilityPct,
        },
      })
      .select()
      .single();

    if (!error && data) {
      signalId = data.id;
      try {
        const trade = await openPaperTradeFromSignal(s, data.id);
        paperTradeId = trade.id;
      } catch {
        // Non-fatal: signal persisted but paper trade could fail independently.
      }
    }
  }

  await resolveOpenTrades(analysis.symbol, analysis.candles);

  return {
    ...analysis,
    signalId,
    paperTradeId,
  };
}

export async function runAndPersistAnalysis(
  provider: MarketDataProvider,
  symbol: string,
  timeframe: Timeframe,
  limit = 500,
): Promise<PersistedAnalysisResult> {
  const analysis = await runAnalysisOnce(provider, symbol, timeframe, limit);
  return persistAnalysisDecision(analysis);
}
