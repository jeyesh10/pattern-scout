import type { Timeframe } from "./binance";
import { runAnalysisOnce, persistAnalysisDecision, type PersistedAnalysisResult } from "./analysisEngine";
import { buildLongTermOutlook, type LongTermOutlook } from "./longTermOutlook";
import { resolveProviderForSymbol } from "./providerRegistry";
import { supabase } from "@/integrations/supabase/client";

export interface ScanTarget {
  symbol: string;
  timeframe: Timeframe;
}

export interface ScanOptions {
  persistSignals?: boolean;
  persistOutlooks?: boolean;
  signalLimit?: number;
}

export interface ScanResult {
  target: ScanTarget;
  provider: string;
  signalResult: PersistedAnalysisResult | null;
  outlook: LongTermOutlook | null;
  error: string | null;
}

export interface RiskRankedSymbol {
  symbol: string;
  timeframe: Timeframe;
  riskScore: number;
  riskBand: "low" | "medium" | "high";
  opportunityScore: number;
  notes: string;
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

async function persistLongTermOutlook(outlook: LongTermOutlook): Promise<string | null> {
  const payload = {
    symbol: outlook.symbol,
    market: outlook.market,
    provider: outlook.provider,
    direction: outlook.direction,
    confidence: outlook.confidence,
    growth_probability_3m: outlook.growthProbability3m,
    growth_probability_6m: outlook.growthProbability6m,
    growth_probability_12m: outlook.growthProbability12m,
    score: outlook.score,
    factors: outlook.factors,
    rationale: outlook.rationale,
    generated_at: outlook.generatedAt,
  };

  const db = supabase as unknown as {
    from: (table: string) => {
      upsert: (value: Record<string, unknown>, options?: { onConflict?: string }) => {
        select: () => { single: () => Promise<{ data: { id: string } | null; error: unknown }> };
      };
    };
  };

  const { data, error } = await db
    .from("long_term_outlooks")
    .upsert(payload, { onConflict: "symbol" })
    .select()
    .single();

  if (error || !data) return null;
  return data.id;
}

export async function runSymbolScan(target: ScanTarget, options: ScanOptions = {}): Promise<ScanResult> {
  const provider = resolveProviderForSymbol(target.symbol);
  try {
    const analysis = await runAnalysisOnce(
      provider,
      target.symbol,
      target.timeframe,
      options.signalLimit ?? 500,
    );
    const signalResult = options.persistSignals === false ? null : await persistAnalysisDecision(analysis);

    const outlook = await buildLongTermOutlook(provider, target.symbol);
    if (options.persistOutlooks) {
      await persistLongTermOutlook(outlook);
    }

    return {
      target,
      provider: provider.name,
      signalResult,
      outlook,
      error: null,
    };
  } catch (error) {
    return {
      target,
      provider: provider.name,
      signalResult: null,
      outlook: null,
      error: error instanceof Error ? error.message : "Unknown scan failure",
    };
  }
}

export async function runUniverseScan(
  targets: ScanTarget[],
  options: ScanOptions = {},
): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  for (const target of targets) {
    const result = await runSymbolScan(target, options);
    results.push(result);
  }
  return results;
}

export function rankScanResultsByRisk(results: ScanResult[]): RiskRankedSymbol[] {
  return results
    .filter((r) => !r.error && r.outlook)
    .map((r) => {
      const outlook = r.outlook!;
      const signal = r.signalResult?.signal ?? null;

      const longTermRisk = 100 - outlook.growthProbability12m;
      const confidenceBuffer = 100 - outlook.confidence;
      const directionPenalty = outlook.direction === "fall" ? 20 : outlook.direction === "neutral" ? 10 : 0;
      const tacticalRisk = signal ? clamp(50 - signal.confidence / 2 + (signal.volatilityPct ?? 0) * 1.2) : 35;
      const riskScore = clamp(
        0.45 * longTermRisk + 0.25 * confidenceBuffer + 0.2 * tacticalRisk + 0.1 * directionPenalty,
      );

      const opportunityFromLongTerm =
        0.5 * outlook.growthProbability12m + 0.3 * outlook.growthProbability6m + 0.2 * outlook.growthProbability3m;
      const tacticalBoost = signal ? clamp(signal.confidence + signal.riskReward * 10) : 35;
      const opportunityScore = clamp(0.7 * opportunityFromLongTerm + 0.3 * tacticalBoost - 0.25 * riskScore);

      const riskBand = riskScore >= 67 ? "high" : riskScore >= 40 ? "medium" : "low";
      const notes = [
        `direction=${outlook.direction}`,
        `12mGrow=${outlook.growthProbability12m.toFixed(1)}%`,
        `confidence=${outlook.confidence.toFixed(1)}%`,
        `signal=${signal ? `${signal.side}/${signal.confidence.toFixed(1)}%` : "none"}`,
      ].join(" | ");

      return {
        symbol: r.target.symbol,
        timeframe: r.target.timeframe,
        riskScore,
        riskBand,
        opportunityScore,
        notes,
      };
    })
    .sort((a, b) => a.riskScore - b.riskScore);
}
