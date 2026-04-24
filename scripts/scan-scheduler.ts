import { createScanScheduler } from "../src/lib/scanScheduler";

const timeframe = (process.env.SCAN_TIMEFRAME as "1m" | "5m" | "15m" | "1h") ?? "15m";
const intervalMs = Number(process.env.SCAN_INTERVAL_MS ?? 15 * 60_000);
const symbols = process.env.SCAN_SYMBOLS
  ? process.env.SCAN_SYMBOLS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : undefined;

const scheduler = createScanScheduler({
  timeframe,
  intervalMs,
  symbols,
  persistSignals: process.env.SCAN_PERSIST_SIGNALS !== "false",
  persistOutlooks: process.env.SCAN_PERSIST_OUTLOOKS !== "false",
  signalLimit: Number(process.env.SCAN_SIGNAL_LIMIT ?? 500),
  onTickComplete: (tick) => {
    const top = tick.riskRanking[0];
    console.log(
      `[scan] ${tick.completedAt} targets=${tick.targets.length} ranked=${tick.riskRanking.length} best=${top?.symbol ?? "n/a"} risk=${top?.riskScore.toFixed(1) ?? "n/a"}`,
    );
  },
  onTickError: (error) => {
    console.error("[scan] tick error", error);
  },
});

console.log(
  `[scan] scheduler started timeframe=${timeframe} intervalMs=${intervalMs} symbols=${symbols?.length ?? "default"}`,
);

scheduler
  .runNow()
  .then((tick) => {
    const top3 = tick.riskRanking.slice(0, 3);
    for (const row of top3) {
      console.log(
        `[scan] top symbol=${row.symbol} risk=${row.riskScore.toFixed(1)} opp=${row.opportunityScore.toFixed(1)} band=${row.riskBand}`,
      );
    }
  })
  .catch((error) => console.error("[scan] initial run failed", error));

process.on("SIGINT", () => {
  scheduler.stop();
  console.log("[scan] scheduler stopped (SIGINT)");
  process.exit(0);
});

process.on("SIGTERM", () => {
  scheduler.stop();
  console.log("[scan] scheduler stopped (SIGTERM)");
  process.exit(0);
});
