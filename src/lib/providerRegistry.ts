import type { MarketDataProvider } from "./marketData";
import { binanceMarketDataProvider } from "./binance";
import { indiaMarketDataProvider, isIndiaSymbol } from "./indiaMarketData";

export function resolveProviderForSymbol(symbol: string): MarketDataProvider {
  if (isIndiaSymbol(symbol) || symbol.includes(":") || symbol.endsWith(".NS") || symbol.endsWith(".BO")) {
    return indiaMarketDataProvider;
  }
  return binanceMarketDataProvider;
}

export const AVAILABLE_PROVIDERS: readonly MarketDataProvider[] = [
  binanceMarketDataProvider,
  indiaMarketDataProvider,
];
