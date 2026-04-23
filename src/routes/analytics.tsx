import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { Disclaimer } from "@/components/Disclaimer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  computeMetrics,
  tradesToCsv,
  type PaperTrade,
  type PortfolioMetrics,
} from "@/lib/paperTrader";
import {
  calibration,
  statsByPattern,
  statsBySession,
  statsByTimeframe,
  type CalibrationBucket,
  type PatternStats,
  type SessionStats,
  type TimeframeStats,
} from "@/lib/analytics";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — PatternScope" },
      {
        name: "description",
        content:
          "Per-pattern win rates, timeframe performance, calibration check, and session analysis from simulated trades.",
      },
    ],
  }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [metrics, setMetrics] = useState<PortfolioMetrics | null>(null);
  const [perPattern, setPerPattern] = useState<PatternStats[]>([]);
  const [perTimeframe, setPerTimeframe] = useState<TimeframeStats[]>([]);
  const [perSession, setPerSession] = useState<SessionStats[]>([]);
  const [calib, setCalib] = useState<CalibrationBucket[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("paper_trades")
        .select("*")
        .order("opened_at", { ascending: false })
        .limit(1000);
      const ts = (data ?? []) as PaperTrade[];
      setTrades(ts);
      setMetrics(computeMetrics(ts));
      setPerPattern(statsByPattern(ts));
      setPerTimeframe(statsByTimeframe(ts));
      setPerSession(statsBySession(ts));
      setCalib(calibration(ts));
    };
    load();
    const ch = supabase
      .channel("paper-trades-stream")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "paper_trades" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const downloadCsv = () => {
    const csv = tradesToCsv(trades);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `patternscope-trades-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const closedTrades = trades.filter((t) => t.status !== "open").length;
  const sufficient = closedTrades >= 50;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="max-w-[1600px] mx-auto px-4 py-4 space-y-4">
        <Disclaimer />

        {/* Headline metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <Metric label="Total trades" value={metrics?.total ?? 0} />
          <Metric label="Open" value={metrics?.open ?? 0} />
          <Metric
            label="Win rate"
            value={metrics ? `${metrics.winRate.toFixed(1)}%` : "—"}
            tone={metrics && metrics.winRate >= 50 ? "bull" : "bear"}
          />
          <Metric
            label="Avg win"
            value={metrics ? `${metrics.avgWin.toFixed(2)}%` : "—"}
            tone="bull"
          />
          <Metric
            label="Avg loss"
            value={metrics ? `${metrics.avgLoss.toFixed(2)}%` : "—"}
            tone="bear"
          />
          <Metric
            label="Profit factor"
            value={metrics ? metrics.profitFactor.toFixed(2) : "—"}
          />
          <Metric
            label="Max drawdown"
            value={metrics ? `${metrics.maxDrawdown.toFixed(2)}%` : "—"}
            tone="bear"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Per-pattern */}
          <Card className="bg-card border-border">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold">Win rate by pattern</h2>
              <Button size="sm" variant="outline" onClick={downloadCsv} className="h-7 text-xs gap-1.5">
                <Download className="h-3 w-3" /> Export CSV
              </Button>
            </div>
            <div className="p-4">
              {perPattern.length === 0 ? (
                <Empty />
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="py-1.5">Pattern</th>
                      <th className="text-right">Trades</th>
                      <th className="text-right">Wins</th>
                      <th className="text-right">Win rate</th>
                      <th className="text-right">Avg PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perPattern.map((p) => (
                      <tr key={p.pattern} className="border-t border-border">
                        <td className="py-1.5">{p.label}</td>
                        <td className="text-right">{p.trades}</td>
                        <td className="text-right">{p.wins}</td>
                        <td className={`text-right ${p.winRate >= 50 ? "text-bull" : "text-bear"}`}>
                          {p.winRate.toFixed(1)}%
                        </td>
                        <td className={`text-right ${p.avgPnl >= 0 ? "text-bull" : "text-bear"}`}>
                          {p.avgPnl >= 0 ? "+" : ""}
                          {p.avgPnl.toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>

          {/* Per-timeframe */}
          <Card className="bg-card border-border">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold">Win rate by timeframe</h2>
            </div>
            <div className="p-4">
              {perTimeframe.length === 0 ? (
                <Empty />
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="py-1.5">Timeframe</th>
                      <th className="text-right">Trades</th>
                      <th className="text-right">Win rate</th>
                      <th className="text-right">Avg PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perTimeframe.map((t) => (
                      <tr key={t.timeframe} className="border-t border-border">
                        <td className="py-1.5">{t.timeframe}</td>
                        <td className="text-right">{t.trades}</td>
                        <td className={`text-right ${t.winRate >= 50 ? "text-bull" : "text-bear"}`}>
                          {t.winRate.toFixed(1)}%
                        </td>
                        <td className={`text-right ${t.avgPnl >= 0 ? "text-bull" : "text-bear"}`}>
                          {t.avgPnl >= 0 ? "+" : ""}
                          {t.avgPnl.toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>

          {/* Calibration */}
          <Card className="bg-card border-border">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold">
                Confidence calibration
                {!sufficient && (
                  <span className="ml-2 text-xs text-muted-foreground font-normal">
                    (need {Math.max(0, 50 - closedTrades)} more closed trades for meaningful results)
                  </span>
                )}
              </h2>
            </div>
            <div className="p-4">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1.5">Confidence bucket</th>
                    <th className="text-right">Predicted</th>
                    <th className="text-right">Actual win rate</th>
                    <th className="text-right">Trades</th>
                  </tr>
                </thead>
                <tbody>
                  {calib.map((c) => (
                    <tr key={c.bucket} className="border-t border-border">
                      <td className="py-1.5">{c.bucket}</td>
                      <td className="text-right text-muted-foreground">{c.predicted.toFixed(0)}%</td>
                      <td className="text-right">{c.trades === 0 ? "—" : `${c.actual.toFixed(1)}%`}</td>
                      <td className="text-right text-muted-foreground">{c.trades}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Session */}
          <Card className="bg-card border-border">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold">Best session (UTC hour)</h2>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-12 gap-1">
                {perSession.map((s) => {
                  const intensity = Math.min(1, s.trades / 5);
                  const isBull = s.winRate >= 50;
                  return (
                    <div
                      key={s.hour}
                      className="aspect-square rounded text-[9px] flex flex-col items-center justify-center font-mono"
                      style={{
                        background: s.trades === 0
                          ? "var(--muted)"
                          : `color-mix(in oklab, var(--${isBull ? "bull" : "bear"}) ${intensity * 70}%, transparent)`,
                      }}
                      title={`${s.hour}:00 UTC · ${s.trades} trades · ${s.winRate.toFixed(0)}% wr`}
                    >
                      <span>{s.hour}</span>
                      {s.trades > 0 && <span className="opacity-80">{s.winRate.toFixed(0)}</span>}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Heatmap of UTC hour vs win rate (color) and volume (intensity).
              </p>
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "bull" | "bear";
}) {
  return (
    <Card className="bg-card border-border p-3">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div
        className={`text-lg font-semibold mt-0.5 ${
          tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : ""
        }`}
      >
        {value}
      </div>
    </Card>
  );
}

function Empty() {
  return (
    <p className="text-sm text-muted-foreground py-6 text-center">
      No closed trades yet. Open the dashboard and let signals accumulate.
    </p>
  );
}
