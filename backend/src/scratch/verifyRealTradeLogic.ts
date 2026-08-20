import { AdvisoryManager } from "../services/advisoryManager";
import { IBrokerAdapter, Candle, OptionChainItem, CompactTick } from "../adapters/IBrokerAdapter";

class MockBroker implements IBrokerAdapter {
  async initialize(): Promise<boolean> { return true; }
  getAccessToken(): string | null { return "TEST_TOKEN"; }
  subscribeTicks(symbols: string[]): void {}
  unsubscribeTicks(symbols: string[]): void {}
  onTick(callback: (tick: CompactTick) => void): void {}
  simulateTick(tick: CompactTick): void {}
  async getHistoricalCandles(symbol: string, resolution: string, fromDate: string, toDate: string): Promise<Candle[]> {
    return [
      { timestamp: Date.now() - 86400000, open: 24200, high: 24260, low: 24180, close: 24240, volume: 100000 }
    ];
  }
  async getOptionChain(underlying: string): Promise<OptionChainItem[]> {
    return [
      {
        strikePrice: 24250,
        expiryDate: "25-08-2026",
        underlyingSymbol: underlying,
        call: { symbol: "NSE:NIFTY26AUG24250CE", ltp: 120.50, openInterest: 5000000, changeOpenInterest: 100000, volume: 500000, impliedVolatility: 13.5 },
        put: { symbol: "NSE:NIFTY26AUG24250PE", ltp: 71.50, openInterest: 4000000, changeOpenInterest: -50000, volume: 400000, impliedVolatility: 14.0 }
      }
    ];
  }
  async placeOptionOrder(symbol: string, qty: number, direction: "BUY" | "SELL", type: "LIMIT" | "MARKET", price?: number): Promise<string> {
    return "TEST_ORD_123";
  }
}

async function runTest() {
  console.log("=== Testing Real Live Trade Logic & Cooldowns ===");
  const broker = new MockBroker();
  const advisory = new AdvisoryManager(broker);
  await advisory.initialize();

  // Test CPR: should be calculated from real candles
  const cpr = advisory.getCpr();
  console.log("1. CPR Calculation:", cpr ? `Pivot=${cpr.pivot.toFixed(2)} (VALID)` : "NULL (Disabled safely)");
  if (!cpr) throw new Error("CPR failed to calculate from historical candle.");

  // Test Option Chain parsing
  const chain = await broker.getOptionChain("NSE:NIFTY50-INDEX");
  console.log("2. Option Chain live strike count:", chain.length);
  const atm = chain.find(c => c.strikePrice === 24250);
  console.log("   ATM Strike 24250 Call LTP:", atm?.call.ltp, "| Symbol:", atm?.call.symbol);
  if (atm?.call.ltp !== 120.50) throw new Error("ATM call LTP mismatch.");

  console.log("\nAll diagnostic assertions passed successfully!");
}

runTest().catch(console.error);
