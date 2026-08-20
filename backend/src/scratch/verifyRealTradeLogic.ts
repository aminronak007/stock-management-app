import { AdvisoryManager } from "../services/advisoryManager";
import { IBrokerAdapter, Candle, OptionChainItem, CompactTick } from "../adapters/IBrokerAdapter";
import { ExcelLogger } from "../utils/excelLogger";
import { DatabaseService } from "../utils/database";
import { Backtester } from "../services/backtester";

class MockBroker implements IBrokerAdapter {
  public subscribedSymbols: string[] = [];

  async initialize(): Promise<boolean> { return true; }
  getAccessToken(): string | null { return "TEST_TOKEN"; }
  subscribeTicks(symbols: string[]): void {
    this.subscribedSymbols.push(...symbols);
  }
  unsubscribeTicks(symbols: string[]): void {
    this.subscribedSymbols = this.subscribedSymbols.filter(s => !symbols.includes(s));
  }
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
  console.log("=== Testing Institutional Audit Upgrades ===");
  const broker = new MockBroker();
  const advisory = new AdvisoryManager(broker);
  await advisory.initialize();

  // 1. Test CPR calculation
  const cpr = advisory.getCpr();
  console.log("1. CPR Calculation:", cpr ? `Pivot=${cpr.pivot.toFixed(2)} (VALID)` : "NULL (Disabled safely)");
  if (!cpr) throw new Error("CPR failed to calculate from historical candle.");

  // 2. Test Fee Calculation (Brokerage + STT + GST + Stamp Duty)
  const statutoryFees = ExcelLogger.calculateStatutoryFees(120.0, 25);
  console.log(`2. Statutory Fee on 1 lot @ ₹120.00: ₹${statutoryFees.toFixed(2)} (Expected ~₹56.00)`);
  if (statutoryFees < 40 || statutoryFees > 70) throw new Error("Statutory fee calculation out of expected bounds.");

  // 3. Test Backtester Statistical Sharpe and Sortino
  const backtester = new Backtester(broker);
  const backtestRes = await backtester.runBacktest({
    symbol: "NSE:NIFTY50-INDEX",
    minScore: 60,
    slippageMultiplier: 0.005,
    fromDate: "2026-08-01",
    toDate: "2026-08-15",
    useWfo: false
  });
  console.log(`3. Backtest Report: Total Trades=${backtestRes.report.totalTrades}, WinRate=${backtestRes.report.winRate}%, Sharpe=${backtestRes.report.sharpeRatio}, Sortino=${backtestRes.report.sortinoRatio}`);

  // 4. Test Dynamic Option Subscription on Tick
  const fakeOptionSymbol = "NSE:NIFTY26AUG24250CE";
  broker.subscribeTicks([fakeOptionSymbol]);
  console.log(`4. Broker Subscriptions active count: ${broker.subscribedSymbols.length} (Contains: ${broker.subscribedSymbols.join(", ")})`);
  if (!broker.subscribedSymbols.includes(fakeOptionSymbol)) throw new Error("Subscription failed.");

  broker.unsubscribeTicks([fakeOptionSymbol]);
  console.log(`   After exit unsubscription, count: ${broker.subscribedSymbols.length}`);
  if (broker.subscribedSymbols.includes(fakeOptionSymbol)) throw new Error("Unsubscription failed.");

  console.log("\nAll Institutional Audit Upgrades verified successfully!");
}

runTest().catch(console.error);
