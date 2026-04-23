// Chart pattern recognition engine.
// Pure computational geometry over candle arrays.

import type { Candle } from "./binance";

export type PatternKind =
  | "double_bottom"
  | "inverse_head_shoulders"
  | "bullish_flag"
  | "ascending_triangle"
  | "cup_handle"
  | "falling_wedge"
  | "double_top"
  | "head_shoulders"
  | "bearish_flag"
  | "descending_triangle"
  | "rising_wedge";

export const PATTERN_LABEL: Record<PatternKind, string> = {
  double_bottom: "Double Bottom",
  inverse_head_shoulders: "Inverse Head & Shoulders",
  bullish_flag: "Bullish Flag",
  ascending_triangle: "Ascending Triangle",
  cup_handle: "Cup and Handle",
  falling_wedge: "Falling Wedge",
  double_top: "Double Top",
  head_shoulders: "Head & Shoulders",
  bearish_flag: "Bearish Flag",
  descending_triangle: "Descending Triangle",
  rising_wedge: "Rising Wedge",
};

export const BULLISH: PatternKind[] = [
  "double_bottom",
  "inverse_head_shoulders",
  "bullish_flag",
  "ascending_triangle",
  "cup_handle",
  "falling_wedge",
];

export interface DetectedPattern {
  kind: PatternKind;
  side: "buy" | "sell";
  confidence: number; // 0..100
  startIdx: number;
  endIdx: number;
  // Geometric anchors used for drawing + signal generation
  neckline?: number; // horizontal breakout level
  trendlineUpper?: { m: number; b: number };
  trendlineLower?: { m: number; b: number };
  pivots: number[]; // candle indexes used
  patternHeight: number; // for projection
  details: string[]; // human-readable bullet observations
}

// ---------- Pivot detection ----------

export interface Pivot {
  idx: number;
  price: number;
  kind: "high" | "low";
}

export function findPivots(candles: Candle[], window = 3): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = window; i < candles.length - window; i++) {
    const slice = candles.slice(i - window, i + window + 1);
    const highs = slice.map((c) => c.high);
    const lows = slice.map((c) => c.low);
    if (candles[i].high === Math.max(...highs))
      pivots.push({ idx: i, price: candles[i].high, kind: "high" });
    if (candles[i].low === Math.min(...lows))
      pivots.push({ idx: i, price: candles[i].low, kind: "low" });
  }
  return pivots;
}

// ---------- Linear regression ----------

export function linreg(points: { x: number; y: number }[]): {
  m: number;
  b: number;
  r2: number;
} {
  const n = points.length;
  if (n < 2) return { m: 0, b: points[0]?.y ?? 0, r2: 0 };
  const sx = points.reduce((s, p) => s + p.x, 0);
  const sy = points.reduce((s, p) => s + p.y, 0);
  const sxy = points.reduce((s, p) => s + p.x * p.y, 0);
  const sxx = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sxx - sx * sx;
  const m = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const b = (sy - m * sx) / n;
  const meanY = sy / n;
  const ssTot = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
  const ssRes = points.reduce((s, p) => s + (p.y - (m * p.x + b)) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { m, b, r2 };
}

// ---------- Helpers ----------

const MIN_BARS = 20;

function pct(a: number, b: number) {
  return Math.abs(a - b) / ((a + b) / 2);
}

function avg(arr: number[]) {
  return arr.reduce((s, n) => s + n, 0) / arr.length;
}

function vol(candles: Candle[], from: number, to: number) {
  const slice = candles.slice(from, to + 1);
  return avg(slice.map((c) => c.volume));
}

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

// ============================================================
// PATTERN DETECTORS
// Each returns a DetectedPattern or null. They look at the END of the
// candle window (most recent ~80 bars) to find a forming pattern.
// ============================================================

const LOOKBACK = 80;

function recent(candles: Candle[]) {
  const start = Math.max(0, candles.length - LOOKBACK);
  return { start, slice: candles.slice(start) };
}

// ---------- Double Bottom / Top ----------

function detectDouble(
  candles: Candle[],
  kind: "bottom" | "top",
): DetectedPattern | null {
  if (candles.length < MIN_BARS) return null;
  const { start } = recent(candles);
  const pivots = findPivots(candles, 3).filter((p) => p.idx >= start);
  const target = pivots.filter((p) => p.kind === (kind === "bottom" ? "low" : "high"));
  if (target.length < 2) return null;

  // last two extremes
  const p2 = target[target.length - 1];
  const p1 = target[target.length - 2];
  if (p2.idx - p1.idx < 5) return null;
  if (pct(p1.price, p2.price) > 0.025) return null; // within 2.5%

  // intervening peak/trough (neckline)
  const between = candles.slice(p1.idx + 1, p2.idx);
  if (between.length === 0) return null;
  const neckline =
    kind === "bottom"
      ? Math.max(...between.map((c) => c.high))
      : Math.min(...between.map((c) => c.low));
  const height = Math.abs(neckline - (p1.price + p2.price) / 2);
  if (height / neckline < 0.005) return null;

  // Confidence: similarity of two extremes + height + spacing
  const sim = 1 - pct(p1.price, p2.price) / 0.025;
  const spacing = Math.min(1, (p2.idx - p1.idx) / 30);
  const heightScore = Math.min(1, (height / neckline) / 0.04);
  const confidence = clamp(40 + 60 * (0.5 * sim + 0.25 * spacing + 0.25 * heightScore));

  return {
    kind: kind === "bottom" ? "double_bottom" : "double_top",
    side: kind === "bottom" ? "buy" : "sell",
    confidence,
    startIdx: p1.idx,
    endIdx: candles.length - 1,
    neckline,
    pivots: [p1.idx, p2.idx],
    patternHeight: height,
    details: [
      `Two ${kind === "bottom" ? "lows" : "highs"} at ${p1.price.toFixed(2)} and ${p2.price.toFixed(2)} (within ${(pct(p1.price, p2.price) * 100).toFixed(2)}%)`,
      `Neckline at ${neckline.toFixed(2)}, pattern height ${height.toFixed(2)} (${((height / neckline) * 100).toFixed(2)}%)`,
      `Spacing of ${p2.idx - p1.idx} candles between the two extremes`,
    ],
  };
}

// ---------- Head and Shoulders / Inverse ----------

function detectHeadShoulders(
  candles: Candle[],
  inverse: boolean,
): DetectedPattern | null {
  if (candles.length < MIN_BARS + 5) return null;
  const { start } = recent(candles);
  const pivots = findPivots(candles, 3).filter((p) => p.idx >= start);
  const target = pivots.filter((p) => p.kind === (inverse ? "low" : "high"));
  if (target.length < 3) return null;

  const [s1, head, s2] = target.slice(-3);
  if (s2.idx - s1.idx < 8) return null;

  // Head must be the extreme
  if (inverse) {
    if (!(head.price < s1.price && head.price < s2.price)) return null;
  } else {
    if (!(head.price > s1.price && head.price > s2.price)) return null;
  }
  // Shoulders roughly symmetric in price (within 3%)
  if (pct(s1.price, s2.price) > 0.03) return null;

  // Neckline = average of intervening counter-extremes
  const innerA = candles.slice(s1.idx + 1, head.idx);
  const innerB = candles.slice(head.idx + 1, s2.idx);
  if (innerA.length === 0 || innerB.length === 0) return null;
  const neckA = inverse
    ? Math.max(...innerA.map((c) => c.high))
    : Math.min(...innerA.map((c) => c.low));
  const neckB = inverse
    ? Math.max(...innerB.map((c) => c.high))
    : Math.min(...innerB.map((c) => c.low));
  const neckline = (neckA + neckB) / 2;
  const necklineFlat = pct(neckA, neckB) < 0.02;
  const height = Math.abs(neckline - head.price);

  // Volume should decline across formation (textbook)
  const v1 = vol(candles, s1.idx - 2, s1.idx + 2);
  const v3 = vol(candles, s2.idx - 2, s2.idx + 2);
  const volDecl = v3 < v1;

  const sym = 1 - pct(s1.price, s2.price) / 0.03;
  const flatScore = necklineFlat ? 1 : 0.4;
  const volScore = volDecl ? 1 : 0.5;
  const confidence = clamp(35 + 65 * (0.45 * sym + 0.3 * flatScore + 0.25 * volScore));

  return {
    kind: inverse ? "inverse_head_shoulders" : "head_shoulders",
    side: inverse ? "buy" : "sell",
    confidence,
    startIdx: s1.idx,
    endIdx: candles.length - 1,
    neckline,
    pivots: [s1.idx, head.idx, s2.idx],
    patternHeight: height,
    details: [
      `Left shoulder ${s1.price.toFixed(2)}, head ${head.price.toFixed(2)}, right shoulder ${s2.price.toFixed(2)}`,
      `Shoulders symmetric within ${(pct(s1.price, s2.price) * 100).toFixed(2)}%`,
      `Neckline ~${neckline.toFixed(2)} (${necklineFlat ? "roughly horizontal" : "sloping"})`,
      `Volume across pattern: ${volDecl ? "declining ✓" : "not declining"}`,
    ],
  };
}

// ---------- Flags / Pennants ----------

function detectFlag(candles: Candle[], bullish: boolean): DetectedPattern | null {
  if (candles.length < MIN_BARS) return null;
  const n = candles.length;
  // Pole: strong move over ~5-12 candles
  for (let poleLen = 5; poleLen <= 14; poleLen++) {
    const consolMin = 4;
    const consolMax = 18;
    for (let consolLen = consolMin; consolLen <= consolMax; consolLen++) {
      const consolEnd = n - 1;
      const consolStart = consolEnd - consolLen + 1;
      const poleEnd = consolStart - 1;
      const poleStart = poleEnd - poleLen + 1;
      if (poleStart < 0) continue;
      const poleOpen = candles[poleStart].open;
      const poleClose = candles[poleEnd].close;
      const poleMove = (poleClose - poleOpen) / poleOpen;
      if (bullish && poleMove < 0.02) continue;
      if (!bullish && poleMove > -0.02) continue;

      // Volume on pole should be elevated
      const poleVol = vol(candles, poleStart, poleEnd);
      const priorVol = vol(candles, Math.max(0, poleStart - 20), poleStart - 1);
      if (priorVol > 0 && poleVol < priorVol * 1.2) continue;

      // Consolidation: parallel channel sloping AGAINST trend
      const consolHighs = candles
        .slice(consolStart, consolEnd + 1)
        .map((c, i) => ({ x: i, y: c.high }));
      const consolLows = candles
        .slice(consolStart, consolEnd + 1)
        .map((c, i) => ({ x: i, y: c.low }));
      const upper = linreg(consolHighs);
      const lower = linreg(consolLows);
      // Parallel-ish: slopes within 30% of each other
      const slopeDiff = Math.abs(upper.m - lower.m) / (Math.abs(upper.m) + Math.abs(lower.m) + 1e-9);
      if (slopeDiff > 0.4) continue;
      if (bullish && upper.m >= 0) continue; // should slope down
      if (!bullish && upper.m <= 0) continue; // should slope up

      // Volume declining in consolidation
      const consolVol = vol(candles, consolStart, consolEnd);
      const volDecl = consolVol < poleVol * 0.8;

      const channelWidth = avg(consolHighs.map((p) => p.y)) - avg(consolLows.map((p) => p.y));
      const poleHeight = Math.abs(poleClose - poleOpen);
      if (poleHeight === 0) continue;

      const moveScore = Math.min(1, Math.abs(poleMove) / 0.05);
      const fitScore = (upper.r2 + lower.r2) / 2;
      const volScore = volDecl ? 1 : 0.5;
      const confidence = clamp(40 + 60 * (0.4 * moveScore + 0.35 * fitScore + 0.25 * volScore));

      const necklineY = bullish
        ? upper.b + upper.m * (consolEnd - consolStart) // upper trendline at end
        : lower.b + lower.m * (consolEnd - consolStart);

      return {
        kind: bullish ? "bullish_flag" : "bearish_flag",
        side: bullish ? "buy" : "sell",
        confidence,
        startIdx: poleStart,
        endIdx: n - 1,
        neckline: necklineY,
        trendlineUpper: { m: upper.m, b: upper.b },
        trendlineLower: { m: lower.m, b: lower.b },
        pivots: [poleStart, poleEnd, consolEnd],
        patternHeight: poleHeight,
        details: [
          `${bullish ? "Upward" : "Downward"} pole of ${(poleMove * 100).toFixed(2)}% over ${poleLen} candles, volume ${(poleVol / Math.max(priorVol, 1e-9)).toFixed(2)}× prior`,
          `${consolLen}-candle consolidation in a ${bullish ? "downward" : "upward"} parallel channel`,
          `Channel width ${channelWidth.toFixed(2)}, volume ${volDecl ? "declining ✓" : "not declining clearly"}`,
        ],
      };
    }
  }
  return null;
}

// ---------- Triangles ----------

function detectTriangle(
  candles: Candle[],
  kind: "ascending" | "descending",
): DetectedPattern | null {
  if (candles.length < MIN_BARS) return null;
  const { start } = recent(candles);
  const pivots = findPivots(candles, 3).filter((p) => p.idx >= start);
  const highs = pivots.filter((p) => p.kind === "high").slice(-4);
  const lows = pivots.filter((p) => p.kind === "low").slice(-4);
  if (highs.length < 2 || lows.length < 2) return null;

  const upper = linreg(highs.map((p) => ({ x: p.idx, y: p.price })));
  const lower = linreg(lows.map((p) => ({ x: p.idx, y: p.price })));

  if (kind === "ascending") {
    // Flat resistance, rising support
    if (Math.abs(upper.m) > 0.0005 * (upper.b || 1)) return null;
    if (lower.m <= 0) return null;
  } else {
    // Flat support, falling resistance
    if (Math.abs(lower.m) > 0.0005 * (lower.b || 1)) return null;
    if (upper.m >= 0) return null;
  }

  const neckline = kind === "ascending" ? upper.b : lower.b;
  const lastPrice = candles[candles.length - 1].close;
  const height = Math.abs(highs[0].price - lows[0].price);

  const fit = (upper.r2 + lower.r2) / 2;
  const confidence = clamp(40 + 60 * (0.6 * fit + 0.4 * Math.min(1, (highs.length + lows.length) / 8)));

  return {
    kind: kind === "ascending" ? "ascending_triangle" : "descending_triangle",
    side: kind === "ascending" ? "buy" : "sell",
    confidence,
    startIdx: Math.min(highs[0].idx, lows[0].idx),
    endIdx: candles.length - 1,
    neckline,
    trendlineUpper: { m: upper.m, b: upper.b },
    trendlineLower: { m: lower.m, b: lower.b },
    pivots: [...highs.map((p) => p.idx), ...lows.map((p) => p.idx)],
    patternHeight: height,
    details: [
      `${kind === "ascending" ? "Flat resistance" : "Flat support"} at ~${neckline.toFixed(2)}`,
      `${kind === "ascending" ? "Rising" : "Falling"} ${kind === "ascending" ? "support" : "resistance"} trendline (slope ${(kind === "ascending" ? lower.m : upper.m).toExponential(2)})`,
      `Trendline fit R² = ${fit.toFixed(2)}, last close ${lastPrice.toFixed(2)}`,
    ],
  };
}

// ---------- Wedges ----------

function detectWedge(
  candles: Candle[],
  kind: "rising" | "falling",
): DetectedPattern | null {
  if (candles.length < MIN_BARS) return null;
  const { start } = recent(candles);
  const pivots = findPivots(candles, 3).filter((p) => p.idx >= start);
  const highs = pivots.filter((p) => p.kind === "high").slice(-4);
  const lows = pivots.filter((p) => p.kind === "low").slice(-4);
  if (highs.length < 2 || lows.length < 2) return null;

  const upper = linreg(highs.map((p) => ({ x: p.idx, y: p.price })));
  const lower = linreg(lows.map((p) => ({ x: p.idx, y: p.price })));

  if (kind === "rising") {
    // Both lines rising, lower steeper than upper (converging up)
    if (upper.m <= 0 || lower.m <= 0) return null;
    if (lower.m <= upper.m) return null;
  } else {
    // Both lines falling, upper steeper than lower (converging down)
    if (upper.m >= 0 || lower.m >= 0) return null;
    if (upper.m >= lower.m) return null;
  }

  const idxNow = candles.length - 1;
  const upperNow = upper.m * idxNow + upper.b;
  const lowerNow = lower.m * idxNow + lower.b;
  const height = Math.abs(upperNow - lowerNow);

  const fit = (upper.r2 + lower.r2) / 2;
  const confidence = clamp(35 + 65 * (0.6 * fit + 0.4 * Math.min(1, (highs.length + lows.length) / 8)));

  return {
    kind: kind === "rising" ? "rising_wedge" : "falling_wedge",
    side: kind === "rising" ? "sell" : "buy",
    confidence,
    startIdx: Math.min(highs[0].idx, lows[0].idx),
    endIdx: idxNow,
    // Wedge breakouts are typically against trend → break of opposite trendline
    neckline: kind === "rising" ? lowerNow : upperNow,
    trendlineUpper: { m: upper.m, b: upper.b },
    trendlineLower: { m: lower.m, b: lower.b },
    pivots: [...highs.map((p) => p.idx), ...lows.map((p) => p.idx)],
    patternHeight: height,
    details: [
      `Both trendlines ${kind === "rising" ? "rising" : "falling"} with ${kind === "rising" ? "lower" : "upper"} steeper (converging ${kind === "rising" ? "up" : "down"})`,
      `Trendline fit R² = ${fit.toFixed(2)}`,
      `Current channel width ${height.toFixed(2)} (${((height / lowerNow) * 100).toFixed(2)}%)`,
      `Expected breakout direction: ${kind === "rising" ? "down (bearish)" : "up (bullish)"}`,
    ],
  };
}

// ---------- Cup and Handle ----------

function detectCupHandle(candles: Candle[]): DetectedPattern | null {
  if (candles.length < 40) return null;
  const n = candles.length;
  // Look for U-shape over last 30-60 bars + small pullback (handle)
  for (let cupLen = 30; cupLen <= Math.min(60, n - 5); cupLen += 5) {
    const handleLen = 5;
    const handleEnd = n - 1;
    const handleStart = handleEnd - handleLen + 1;
    const cupEnd = handleStart - 1;
    const cupStart = cupEnd - cupLen + 1;
    if (cupStart < 0) continue;

    const cup = candles.slice(cupStart, cupEnd + 1);
    const leftRim = cup[0].high;
    const rightRim = cup[cup.length - 1].high;
    if (pct(leftRim, rightRim) > 0.03) continue;
    const cupBottom = Math.min(...cup.map((c) => c.low));
    const depth = ((leftRim + rightRim) / 2 - cupBottom) / ((leftRim + rightRim) / 2);
    if (depth < 0.05 || depth > 0.4) continue;

    // Bottom should be roughly in the middle (U shape, not V)
    const bottomIdx = cup.findIndex((c) => c.low === cupBottom);
    const middleness = 1 - Math.abs(bottomIdx / cup.length - 0.5) * 2;
    if (middleness < 0.3) continue;

    // Handle: small downward drift
    const handle = candles.slice(handleStart, handleEnd + 1);
    const handleLow = Math.min(...handle.map((c) => c.low));
    const handleDrop = (rightRim - handleLow) / rightRim;
    if (handleDrop < 0.005 || handleDrop > 0.15) continue;

    const neckline = (leftRim + rightRim) / 2;
    const height = neckline - cupBottom;
    const confidence = clamp(35 + 65 * (0.5 * middleness + 0.3 * (1 - pct(leftRim, rightRim) / 0.03) + 0.2));

    return {
      kind: "cup_handle",
      side: "buy",
      confidence,
      startIdx: cupStart,
      endIdx: n - 1,
      neckline,
      pivots: [cupStart, cupStart + bottomIdx, cupEnd, handleEnd],
      patternHeight: height,
      details: [
        `Cup spans ${cupLen} candles, depth ${(depth * 100).toFixed(2)}% (U-shape score ${(middleness * 100).toFixed(0)}%)`,
        `Left rim ${leftRim.toFixed(2)} ≈ right rim ${rightRim.toFixed(2)} (within ${(pct(leftRim, rightRim) * 100).toFixed(2)}%)`,
        `Handle pullback ${(handleDrop * 100).toFixed(2)}% over ${handleLen} candles`,
      ],
    };
  }
  return null;
}

// ============================================================
// MAIN ENTRY
// ============================================================

export function detectAllPatterns(candles: Candle[]): DetectedPattern[] {
  if (candles.length < MIN_BARS) return [];
  const out: DetectedPattern[] = [];
  const push = (p: DetectedPattern | null) => {
    if (p && p.confidence >= 50) out.push(p);
  };
  push(detectDouble(candles, "bottom"));
  push(detectDouble(candles, "top"));
  push(detectHeadShoulders(candles, false));
  push(detectHeadShoulders(candles, true));
  push(detectFlag(candles, true));
  push(detectFlag(candles, false));
  push(detectTriangle(candles, "ascending"));
  push(detectTriangle(candles, "descending"));
  push(detectWedge(candles, "rising"));
  push(detectWedge(candles, "falling"));
  push(detectCupHandle(candles));
  // Sort by confidence desc
  out.sort((a, b) => b.confidence - a.confidence);
  return out;
}
