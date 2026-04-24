import type { Candle, Timeframe } from "./binance";

export type MarketStatus = "connecting" | "open" | "closed" | "error";

export interface CandleStream {
  close: () => void;
}

export interface MarketDataProvider {
  readonly name: string;
  normalizeSymbol: (symbol: string) => string;
  fetchHistoricalCandles: (
    symbol: string,
    timeframe: Timeframe,
    limit?: number,
  ) => Promise<Candle[]>;
  subscribeCandles: (
    symbol: string,
    timeframe: Timeframe,
    onCandle: (candle: Candle) => void,
    onStatus?: (status: MarketStatus) => void,
  ) => CandleStream;
  supportedSymbols: readonly string[];
  supportedTimeframes: readonly Timeframe[];
}
