import type { Candle, Timeframe } from "./binance";
import type { CandleStream, MarketDataProvider, MarketStatus } from "./marketData";

type Exchange = "NSE" | "BSE";

interface IndiaSymbol {
  code: string;
  exchange: Exchange;
}

const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

export const INDIA_SUPPORTED_SYMBOLS = [
  "RELIANCE:NSE",
  "TCS:NSE",
  "INFY:NSE",
  "HDFCBANK:NSE",
  "ICICIBANK:NSE",
  "SBIN:NSE",
  "LT:NSE",
  "BAJFINANCE:NSE",
  "ITC:NSE",
  "KOTAKBANK:NSE",
  "SUNPHARMA:NSE",
  "MARUTI:NSE",
  "HINDUNILVR:NSE",
  "AXISBANK:NSE",
  "TITAN:NSE",
  "RELIANCE:BSE",
  "TCS:BSE",
  "INFY:BSE",
  "HDFCBANK:BSE",
  "ICICIBANK:BSE",
] as const;

export const INDIA_SUPPORTED_TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h"];

function parseIndiaSymbol(input: string): IndiaSymbol {
  const cleaned = input.trim().toUpperCase();
  if (!cleaned) {
    throw new Error("Empty symbol");
  }

  if (cleaned.includes(":")) {
    const [codeRaw, exchangeRaw] = cleaned.split(":");
    const exchange = exchangeRaw === "BSE" ? "BSE" : "NSE";
    return { code: codeRaw, exchange };
  }

  if (cleaned.endsWith(".NS")) {
    return { code: cleaned.slice(0, -3), exchange: "NSE" };
  }

  if (cleaned.endsWith(".BO")) {
    return { code: cleaned.slice(0, -3), exchange: "BSE" };
  }

  return { code: cleaned, exchange: "NSE" };
}

function toYahooTicker(symbol: string): string {
  const parsed = parseIndiaSymbol(symbol);
  return `${parsed.code}.${parsed.exchange === "NSE" ? "NS" : "BO"}`;
}

function normalizeSymbol(symbol: string): string {
  const parsed = parseIndiaSymbol(symbol);
  return `${parsed.code}:${parsed.exchange}`;
}

function timeframeToInterval(tf: Timeframe): string {
  return tf;
}

function timeframeToRange(tf: Timeframe, limit: number): string {
  const candlesPerDay: Record<Timeframe, number> = {
    "1m": 375,
    "5m": 75,
    "15m": 25,
    "1h": 7,
  };

  const neededDays = Math.max(1, Math.ceil(limit / candlesPerDay[tf]));
  if (neededDays <= 7) return `${neededDays}d`;
  if (neededDays <= 30) return "1mo";
  if (neededDays <= 90) return "3mo";
  if (neededDays <= 180) return "6mo";
  return "1y";
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

async function fetchYahooCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
  const ticker = toYahooTicker(symbol);
  const interval = timeframeToInterval(timeframe);
  const range = timeframeToRange(timeframe, limit);

  const url = `${YAHOO_CHART_BASE}/${ticker}?interval=${interval}&range=${range}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`India data REST ${response.status}`);
  }

  const payload = (await response.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: Array<number | null>;
            high?: Array<number | null>;
            low?: Array<number | null>;
            close?: Array<number | null>;
            volume?: Array<number | null>;
          }>;
        };
      }>;
      error?: { description?: string };
    };
  };

  const chart = payload.chart;
  if (!chart || chart.error || !chart.result?.[0]) {
    throw new Error(chart?.error?.description ?? "India data payload missing chart result");
  }

  const result = chart.result[0];
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0];
  if (!quote) return [];

  const opens = quote.open ?? [];
  const highs = quote.high ?? [];
  const lows = quote.low ?? [];
  const closes = quote.close ?? [];
  const volumes = quote.volume ?? [];

  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = toNumber(timestamps[i]);
    const o = toNumber(opens[i]);
    const h = toNumber(highs[i]);
    const l = toNumber(lows[i]);
    const c = toNumber(closes[i]);
    const v = toNumber(volumes[i]) ?? 0;
    if (ts === null || o === null || h === null || l === null || c === null) continue;
    candles.push({
      time: ts * 1000,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: v,
      closed: true,
    });
  }

  if (candles.length <= limit) return candles;
  return candles.slice(candles.length - limit);
}

function timeframeMs(tf: Timeframe): number {
  switch (tf) {
    case "1m":
      return 60_000;
    case "5m":
      return 300_000;
    case "15m":
      return 900_000;
    case "1h":
      return 3_600_000;
    default:
      return 60_000;
  }
}

function subscribeIndiaCandles(
  symbol: string,
  timeframe: Timeframe,
  onCandle: (candle: Candle) => void,
  onStatus?: (status: MarketStatus) => void,
): CandleStream {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastTime = 0;

  const poll = async () => {
    if (closed) return;
    onStatus?.("connecting");
    try {
      const candles = await fetchYahooCandles(symbol, timeframe, 3);
      const latest = candles[candles.length - 1];
      if (latest && latest.time >= lastTime) {
        lastTime = latest.time;
        onCandle(latest);
      }
      onStatus?.("open");
    } catch {
      onStatus?.("error");
    } finally {
      if (!closed) {
        timer = setTimeout(poll, Math.max(15_000, Math.floor(timeframeMs(timeframe) / 2)));
      }
    }
  };

  poll().catch(() => onStatus?.("error"));

  return {
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      onStatus?.("closed");
    },
  };
}

export const indiaMarketDataProvider: MarketDataProvider = {
  name: "yahoo-india",
  normalizeSymbol,
  fetchHistoricalCandles: (symbol, timeframe, limit = 500) =>
    fetchYahooCandles(symbol, timeframe, limit),
  subscribeCandles: subscribeIndiaCandles,
  supportedSymbols: INDIA_SUPPORTED_SYMBOLS,
  supportedTimeframes: INDIA_SUPPORTED_TIMEFRAMES,
};

export function isIndiaSymbol(symbol: string): boolean {
  try {
    const normalized = normalizeSymbol(symbol);
    return normalized.endsWith(":NSE") || normalized.endsWith(":BSE");
  } catch {
    return false;
  }
}
