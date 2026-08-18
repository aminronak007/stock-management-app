export interface CompactTick {
  symbol: string;
  ltp: number;
  netChangePercent: number;
  volume: number;
  bidPrice: number;
  askPrice: number;
  timestamp: number;
}

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OptionChainItem {
  strikePrice: number;
  expiryDate: string;
  underlyingSymbol: string;
  call: {
    symbol: string;
    ltp: number;
    openInterest: number;
    changeOpenInterest: number;
    volume: number;
    impliedVolatility: number;
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
  };
  put: {
    symbol: string;
    ltp: number;
    openInterest: number;
    changeOpenInterest: number;
    volume: number;
    impliedVolatility: number;
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
  };
}

export interface IBrokerAdapter {
  initialize(): Promise<boolean>;
  getAccessToken(): string | null;
  
  // Market Data Ingestion
  subscribeTicks(symbols: string[]): void;
  onTick(callback: (tick: CompactTick) => void): void;
  unsubscribeTicks(symbols: string[]): void;
  
  // Historical data & Option chains
  getHistoricalCandles(
    symbol: string,
    resolution: string,
    fromDate: string,
    toDate: string
  ): Promise<Candle[]>;
  
  getOptionChain(underlying: string): Promise<OptionChainItem[]>;

  placeOptionOrder(
    symbol: string,
    qty: number,
    direction: "BUY" | "SELL",
    type: "LIMIT" | "MARKET",
    price?: number
  ): Promise<string>;

  generateSessionFromAuthCode?(authCode: string): Promise<boolean>;
}
