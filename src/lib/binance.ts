// Binance public market data engine.
// - REST fallback to load historical candles
// - WebSocket kline stream for live candles + reconnection w/ exponential backoff
// All endpoints are public — no API key required.

export type Timeframe = "1m" | "5m" | "15m" | "1h";

export interface Candle {
  time: number; // open time ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
}

const REST_BASE = "https://api.binance.com";

export async function fetchHistoricalCandles(
  symbol: string,
  interval: Timeframe,
  limit = 500,
): Promise<Candle[]> {
  const url = `${REST_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance REST ${res.status}`);
  const raw = (await res.json()) as unknown[][];
  return raw.map((r) => ({
    time: r[0] as number,
    open: parseFloat(r[1] as string),
    high: parseFloat(r[2] as string),
    low: parseFloat(r[3] as string),
    close: parseFloat(r[4] as string),
    volume: parseFloat(r[5] as string),
    closed: true,
  }));
}

export interface KlineStream {
  close: () => void;
}

/**
 * Subscribe to Binance kline (candle) WebSocket stream.
 * Calls `onCandle` for every update. The last candle's `closed` flag indicates
 * whether the candle is final or still forming.
 */
export function subscribeKlines(
  symbol: string,
  interval: Timeframe,
  onCandle: (c: Candle) => void,
  onStatus?: (s: "connecting" | "open" | "closed" | "error") => void,
): KlineStream {
  let ws: WebSocket | null = null;
  let closedByUser = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const stream = `${symbol.toLowerCase()}@kline_${interval}`;
  const url = `wss://stream.binance.com:9443/ws/${stream}`;

  const connect = () => {
    onStatus?.("connecting");
    try {
      ws = new WebSocket(url);
    } catch (e) {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      attempt = 0;
      onStatus?.("open");
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as {
          k: {
            t: number;
            o: string;
            h: string;
            l: string;
            c: string;
            v: string;
            x: boolean;
          };
        };
        const k = msg.k;
        onCandle({
          time: k.t,
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
          closed: k.x,
        });
      } catch {
        /* swallow malformed frames */
      }
    };

    ws.onerror = () => {
      onStatus?.("error");
    };

    ws.onclose = () => {
      onStatus?.("closed");
      if (!closedByUser) scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (closedByUser) return;
    const delay = Math.min(30_000, 500 * Math.pow(2, attempt));
    attempt += 1;
    reconnectTimer = setTimeout(connect, delay);
  };

  connect();

  return {
    close: () => {
      closedByUser = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}

/**
 * Merge a streaming candle into a candle array (replace last if same open time,
 * or append if newer). Returns a NEW array (immutability for React).
 */
export function mergeCandle(candles: Candle[], next: Candle): Candle[] {
  if (candles.length === 0) return [next];
  const last = candles[candles.length - 1];
  if (next.time === last.time) {
    const copy = candles.slice();
    copy[copy.length - 1] = next;
    return copy;
  }
  if (next.time > last.time) {
    const copy = candles.slice();
    // ensure prior candle marked closed
    if (!last.closed) copy[copy.length - 1] = { ...last, closed: true };
    copy.push(next);
    // cap memory
    if (copy.length > 1000) copy.splice(0, copy.length - 1000);
    return copy;
  }
  return candles;
}

export const SUPPORTED_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "AVAXUSDT",
] as const;

export const SUPPORTED_TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h"];
