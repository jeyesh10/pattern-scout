import { useMemo } from "react";
import Plot from "react-plotly.js";
import type { Candle } from "@/lib/binance";
import type { DetectedPattern } from "@/lib/patterns";
import { PATTERN_LABEL, BULLISH } from "@/lib/patterns";
import type { Signal } from "@/lib/signals";

interface Props {
  candles: Candle[];
  patterns: DetectedPattern[];
  signal: Signal | null;
}

export function CandleChart({ candles, patterns, signal }: Props) {
  const data = useMemo(() => {
    const x = candles.map((c) => new Date(c.time));
    return [
      {
        x,
        open: candles.map((c) => c.open),
        high: candles.map((c) => c.high),
        low: candles.map((c) => c.low),
        close: candles.map((c) => c.close),
        type: "candlestick" as const,
        name: "price",
        increasing: { line: { color: "#34d399" }, fillcolor: "#34d399" },
        decreasing: { line: { color: "#f87171" }, fillcolor: "#f87171" },
        xaxis: "x",
        yaxis: "y",
        showlegend: false,
      },
      {
        x,
        y: candles.map((c) => c.volume),
        type: "bar" as const,
        name: "volume",
        marker: {
          color: candles.map((c) => (c.close >= c.open ? "rgba(52,211,153,0.45)" : "rgba(248,113,113,0.45)")),
        },
        xaxis: "x",
        yaxis: "y2",
        showlegend: false,
      },
    ];
  }, [candles]);

  const shapes = useMemo(() => {
    const out: Partial<Plotly.Shape>[] = [];
    const annotations: Partial<Plotly.Annotations>[] = [];
    for (const p of patterns.slice(0, 3)) {
      const x0 = candles[p.startIdx]?.time;
      const x1 = candles[Math.min(p.endIdx, candles.length - 1)]?.time;
      if (x0 == null || x1 == null) continue;
      const isBull = BULLISH.includes(p.kind);
      const color = isBull ? "rgba(52,211,153,0.9)" : "rgba(248,113,113,0.9)";
      // Neckline
      if (p.neckline != null) {
        out.push({
          type: "line",
          xref: "x",
          yref: "y",
          x0: new Date(x0) as unknown as number,
          x1: new Date(x1) as unknown as number,
          y0: p.neckline,
          y1: p.neckline,
          line: { color, width: 1.5, dash: "dash" },
        });
      }
      // Pivots
      for (const idx of p.pivots) {
        const c = candles[idx];
        if (!c) continue;
        out.push({
          type: "circle",
          xref: "x",
          yref: "y",
          x0: new Date(c.time - 60_000) as unknown as number,
          x1: new Date(c.time + 60_000) as unknown as number,
          y0: (c.high + c.low) / 2 - (c.high - c.low) * 0.2,
          y1: (c.high + c.low) / 2 + (c.high - c.low) * 0.2,
          line: { color, width: 1 },
        });
      }
      // Trendlines
      const drawTL = (tl?: { m: number; b: number }) => {
        if (!tl) return;
        const i0 = p.startIdx;
        const i1 = Math.min(p.endIdx, candles.length - 1);
        out.push({
          type: "line",
          xref: "x",
          yref: "y",
          x0: new Date(candles[i0].time) as unknown as number,
          x1: new Date(candles[i1].time) as unknown as number,
          y0: tl.m * i0 + tl.b,
          y1: tl.m * i1 + tl.b,
          line: { color, width: 1 },
        });
      };
      drawTL(p.trendlineUpper);
      drawTL(p.trendlineLower);
      annotations.push({
        x: new Date(x1) as unknown as number,
        y: p.neckline ?? candles[Math.min(p.endIdx, candles.length - 1)].close,
        xref: "x",
        yref: "y",
        text: `${PATTERN_LABEL[p.kind]} · ${p.confidence.toFixed(0)}%`,
        showarrow: false,
        font: { color: isBull ? "#34d399" : "#f87171", size: 11 },
        bgcolor: "rgba(0,0,0,0.5)",
        borderpad: 2,
        xanchor: "right",
        yanchor: "bottom",
      });
    }
    if (signal) {
      const xLast = candles[candles.length - 1]?.time;
      if (xLast != null) {
        const lvls: { y: number; label: string; color: string }[] = [
          { y: signal.entry, label: "ENTRY", color: "#fbbf24" },
          { y: signal.stopLoss, label: "STOP", color: "#f87171" },
          { y: signal.tp1, label: "TP1", color: "#34d399" },
          { y: signal.tp2, label: "TP2", color: "#34d399" },
        ];
        for (const l of lvls) {
          out.push({
            type: "line",
            xref: "x",
            yref: "y",
            x0: new Date(candles[Math.max(0, candles.length - 30)].time) as unknown as number,
            x1: new Date(xLast) as unknown as number,
            y0: l.y,
            y1: l.y,
            line: { color: l.color, width: 1, dash: "dot" },
          });
          annotations.push({
            x: new Date(xLast) as unknown as number,
            y: l.y,
            xref: "x",
            yref: "y",
            text: ` ${l.label} ${l.y.toFixed(2)} `,
            showarrow: false,
            font: { color: l.color, size: 10 },
            bgcolor: "rgba(0,0,0,0.6)",
            xanchor: "left",
          });
        }
      }
    }
    return { shapes: out, annotations };
  }, [candles, patterns, signal]);

  return (
    <Plot
      data={data as unknown as Plotly.Data[]}
      layout={{
        autosize: true,
        height: 560,
        margin: { l: 50, r: 60, t: 10, b: 30 },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        font: { color: "#cbd5e1", family: "ui-sans-serif, system-ui" },
        dragmode: "pan",
        xaxis: {
          rangeslider: { visible: false },
          gridcolor: "rgba(148,163,184,0.12)",
          zeroline: false,
          domain: [0, 1],
        },
        yaxis: {
          gridcolor: "rgba(148,163,184,0.12)",
          zeroline: false,
          domain: [0.28, 1],
          side: "right",
        },
        yaxis2: {
          gridcolor: "rgba(148,163,184,0.05)",
          zeroline: false,
          domain: [0, 0.22],
          side: "right",
        },
        shapes: shapes.shapes,
        annotations: shapes.annotations,
        showlegend: false,
      }}
      config={{ displayModeBar: false, responsive: true }}
      style={{ width: "100%", height: "560px" }}
      useResizeHandler
    />
  );
}
