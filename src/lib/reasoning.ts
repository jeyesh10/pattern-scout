// Natural-language reasoning trace for a generated signal.

import { BULLISH, PATTERN_LABEL } from "./patterns";
import type { Signal } from "./signals";

export function buildReasoningTrace(s: Signal): string {
  const isBull = BULLISH.includes(s.pattern.kind);
  const dir = isBull ? "BULLISH" : "BEARISH";
  const arrow = isBull ? "📈" : "📉";
  const sl = s.stopLoss;
  const signedMovePct = (target: number) => {
    if (s.entry === 0) return 0;
    const raw = ((target - s.entry) / s.entry) * 100;
    return isBull ? raw : -raw;
  };
  const slPct = signedMovePct(s.stopLoss);
  const tp1Pct = signedMovePct(s.tp1);
  const tp2Pct = signedMovePct(s.tp2);

  const observations = s.pattern.details.map((d) => `   - ${d}`).join("\n");

  const bullCase = isBull
    ? "Classic bullish setup. Pattern structure confirmed with breakout volume above the neckline. Multi-timeframe alignment would strengthen this signal — check higher timeframes for trend confluence."
    : "Classic bearish setup. Pattern structure confirmed with breakdown volume below the neckline. Pair with lower-high structure on higher timeframe for highest-conviction entry.";

  const bearCase = isBull
    ? "False breakouts are common — price may revisit the neckline before continuing. Crypto correlation with macro risk-off events can override technical patterns. News-driven moves are not modelled."
    : "Bear traps occur near key support — a sharp recovery candle that closes back above the neckline invalidates this signal. Short squeezes from positive macro news are an outsized risk in crypto.";

  return `${arrow} PATTERN DETECTED: ${PATTERN_LABEL[s.pattern.kind]} on ${s.symbol} ${s.timeframe} chart
CONFIDENCE: ${s.confidence.toFixed(0)}%   DIRECTION: ${dir}

WHAT I SEE:
${observations}
   - Breakout candle close ${isBull ? "above" : "below"} neckline at ${(s.pattern.neckline ?? 0).toFixed(2)} ✅
   - Breakout volume ${s.breakoutVolumeMultiple.toFixed(2)}× the 20-candle average ✅
   - 10-candle momentum ${s.momentumPct >= 0 ? "+" : ""}${s.momentumPct.toFixed(2)}%, recent volatility ${s.volatilityPct.toFixed(2)}%

AI ANALYST VERDICT:
   - Primary action: ${isBull ? "BUY breakout strength" : "SELL breakdown weakness"}
   - Trigger quality: ${s.breakoutVolumeMultiple >= 2 ? "very strong" : s.breakoutVolumeMultiple >= 1.5 ? "acceptable" : "weak"}
   - Invalidation: immediate close ${isBull ? "below" : "above"} ${sl.toFixed(2)}

ENTRY:        ${s.entry.toFixed(2)}
STOP LOSS:    ${sl.toFixed(2)}   (${slPct >= 0 ? "+" : ""}${slPct.toFixed(2)}%)
TAKE PROFIT 1: ${s.tp1.toFixed(2)}   (${tp1Pct >= 0 ? "+" : ""}${tp1Pct.toFixed(2)}%)   [1.000× pattern height]
TAKE PROFIT 2: ${s.tp2.toFixed(2)}   (${tp2Pct >= 0 ? "+" : ""}${tp2Pct.toFixed(2)}%)   [1.618× pattern height]
RISK : REWARD = 1 : ${s.riskReward.toFixed(2)}

${isBull ? "BULL" : "BEAR"} CASE: ${bullCase}
${isBull ? "BEAR" : "BULL"} CASE: ${bearCase}

⚠️ DISCLAIMER: Pattern recognition is probabilistic, not deterministic. Approximately 55-65% of well-formed ${PATTERN_LABEL[s.pattern.kind].toLowerCase()}s reach their measured target in ideal conditions. Real market conditions include slippage, exchange fees, sudden news events, and correlation risks not modeled here. This is educational output — not financial advice.`;
}
