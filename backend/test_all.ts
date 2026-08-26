import { QuantitativeEngine } from "./src/utils/quantitativeEngine";
import { Indicators } from "./src/utils/indicators";
import { DatabaseService } from "./src/utils/database";
import { ExcelLogger } from "./src/utils/excelLogger";
import { AdvisoryManager } from "./src/services/advisoryManager";
import { CompactTick, Candle, OptionChainItem, IBrokerAdapter } from "./src/adapters/IBrokerAdapter";

class MockBroker implements IBrokerAdapter {
  private ticksCallback: ((tick: CompactTick) => void) | null = null;
  public subscribed: string[] = [];

  async initialize(): Promise<boolean> {
    return true;
  }
  getAccessToken(): string | null {
    return "MOCK_TOKEN";
  }
  onTick(callback: (tick: CompactTick) => void): void {
    this.ticksCallback = callback;
  }
  subscribeTicks(symbols: string[]): void {
    this.subscribed.push(...symbols);
  }
  unsubscribeTicks(symbols: string[]): void {
    this.subscribed = this.subscribed.filter(s => !symbols.includes(s));
  }
  async getOptionChain(underlying: string): Promise<OptionChainItem[]> {
    return [
      {
        strikePrice: 24150,
        expiryDate: "2026-08-27",
        underlyingSymbol: underlying,
        call: { symbol: "NSE:NIFTY26AUG24150CE", ltp: 80, openInterest: 50000, changeOpenInterest: 1000, volume: 20000, impliedVolatility: 14, delta: 0.52 },
        put: { symbol: "NSE:NIFTY26AUG24150PE", ltp: 75, openInterest: 45000, changeOpenInterest: 800, volume: 18000, impliedVolatility: 14, delta: -0.48 }
      }
    ];
  }
  async placeOptionOrder(symbol: string, qty: number, direction: "BUY" | "SELL", type: "LIMIT" | "MARKET" = "MARKET", price?: number): Promise<string> {
    return `MOCK_ORDER_${Date.now()}`;
  }
  async getHistoricalCandles(symbol: string, resolution: string, fromDate: string, toDate: string): Promise<Candle[]> {
    const candles: Candle[] = [];
    let price = 24100;
    const baseTime = Date.now() - 30 * 60 * 1000;
    for (let i = 0; i < 30; i++) {
      price += Math.sin(i) * 5;
      candles.push({
        timestamp: baseTime + i * 60 * 1000,
        open: price,
        high: price + 3,
        low: price - 3,
        close: price + 1,
        volume: 1000
      });
    }
    return candles;
  }
  emitTick(symbol: string, ltp: number, netChangePercent: number = 0.5) {
    if (this.ticksCallback) {
      this.ticksCallback({
        symbol,
        ltp,
        netChangePercent,
        volume: 5000,
        bidPrice: ltp - 0.1,
        askPrice: ltp + 0.1,
        timestamp: Date.now()
      });
    }
  }
}

async function runUnitTests() {
  console.log("=================================================");
  console.log("🧪 RUNNING SYSTEM-WIDE COMPREHENSIVE UNIT TESTS");
  console.log("=================================================\n");

  let passedTests = 0;
  let failedTests = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      failedTests++;
    }
  }

  // TEST SUITE 1: Technical Indicators
  console.log("--- 1. Technical Indicators Unit Tests ---");
  const highs = Array.from({ length: 30 }, (_, i) => 100 + i + Math.sin(i) * 2);
  const lows = Array.from({ length: 30 }, (_, i) => 98 + i - Math.sin(i) * 2);
  const closes = Array.from({ length: 30 }, (_, i) => 99 + i + Math.cos(i) * 2);

  const adxList = Indicators.calculateADX(highs, lows, closes, 14);
  assert(Array.isArray(adxList) && adxList.length > 0, "ADX returns valid array");
  assert(adxList[adxList.length - 1] > 0, "ADX value is positive number");

  const ema9 = Indicators.calculateEMA(closes, 9);
  assert(ema9.length > 0 && ema9.length <= closes.length, "EMA calculation returns valid output array");

  const rsiList = Indicators.calculateRSI(closes, 14);
  assert(Array.isArray(rsiList) && rsiList.length > 0, "RSI calculation returns array");
  const rsiVal = rsiList[rsiList.length - 1];
  assert(rsiVal >= 0 && rsiVal <= 100, "RSI is bounded between 0 and 100");

  // TEST SUITE 2: Quantitative Engine & Confluence Penalties
  console.log("\n--- 2. Quantitative Engine & Trap Eliminator Tests ---");
  
  // Test false breakout detection
  const isFalse = QuantitativeEngine.detectFalseBreakout(
    24100, 24150, 24050, "CALL_BUY",
    { "NSE:RELIANCE-EQ": 2950, "NSE:HDFCBANK-EQ": 1590 },
    { "NSE:RELIANCE-EQ": 3000, "NSE:HDFCBANK-EQ": 1620 },
    500, 1000
  );
  assert(isFalse === true, "Heavyweight Trap Eliminator flags false breakout on divergence");

  // Test Range Regime Penalty
  const candles30 = Array.from({ length: 30 }, (_, i) => ({
    timestamp: Date.now() - (30 - i) * 60000,
    open: 24100 + Math.sin(i) * 2,
    high: 24105,
    low: 24095,
    close: 24100 + Math.cos(i) * 2,
    volume: 500
  }));

  const scorecard = QuantitativeEngine.calculateConfluence({
    spot: 24100,
    currentVwap: 24100,
    orbHigh: 24150,
    orbLow: 24050,
    triggerType: "CALL_BUY",
    cpr: null,
    pcr: 1.1,
    vix: 14,
    atr: 25,
    riskReward: 1.8,
    candles5m: candles30,
    heavyweightsLtp: { "NSE:RELIANCE-EQ": 3000 },
    heavyweightsVwap: { "NSE:RELIANCE-EQ": 3000 },
    optionPremiumRsi: 55
  });
  assert(scorecard.totalScore >= 0 && scorecard.totalScore <= 100, "Confluence scorecard returns valid totalScore");
  assert(scorecard.explanation.some((e: string) => e.includes("RANGE") || e.includes("PENALTY")), "Scorecard logs regime penalties");

  // TEST SUITE 3: Database Service
  console.log("\n--- 3. Database Service Tests ---");
  DatabaseService.initialize();
  const testTradeId = DatabaseService.logPaperTrade({
    type: "CALL_BUY",
    tier: "SNIPER",
    symbol: "NSE:NIFTY26AUG24150CE",
    strike: "24150",
    qty: 50,
    price: 80.00,
    stopLoss: 65.00,
    target1: 95.00,
    target2: 110.00,
    pnl: 0,
    fees: 0,
    netPnl: 0,
    entrySpot: 24150,
    confluenceScore: 88,
    marketRegime: "TREND_UP",
    reasoning: "Test trade entry"
  });
  assert(testTradeId > 0, "Database logs paper trade successfully and returns ID");

  const openBuys = DatabaseService.getOpenBuyTrades("SNIPER");
  const createdTrade = openBuys.find(t => t.id === testTradeId);
  assert(createdTrade !== undefined && createdTrade.qty === 50, "Database retrieves open trade with exact 50 (2-lot) quantity");

  DatabaseService.markPaperTradeClosed(testTradeId, { pnl: 250, fees: 50, netPnl: 200 });
  const openBuysAfterClose = DatabaseService.getOpenBuyTrades("SNIPER");
  assert(!openBuysAfterClose.some(t => t.id === testTradeId), "Database marks paper trade closed");

  // Clean up test trade row from DB so unit tests never pollute production ledger
  const db = DatabaseService.initialize();
  db.prepare("DELETE FROM paper_trades WHERE id = ?").run(testTradeId);

  // TEST SUITE 4: Excel Statutory Fee Calculation
  console.log("\n--- 4. Excel & Statutory Fee Calculation Tests ---");
  const fees = ExcelLogger.calculateStatutoryFees(100, 25);
  assert(fees > 0, "Statutory fees calculated properly (> ₹0)");

  // TEST SUITE 5: Advisory Manager & Live Positions
  console.log("\n--- 5. Advisory Manager & Live Positions Tests ---");
  const mockBroker = new MockBroker();
  const advisory = new AdvisoryManager(mockBroker);
  await advisory.initialize();

  // Simulate tick for Nifty index spot
  mockBroker.emitTick("NSE:NIFTY50-INDEX", 24200);
  assert(advisory.getEngineStatus() !== undefined, "Advisory Engine initializes and returns engine status");

  // Simulate active position check
  const positionsBefore = advisory.getActivePositions();
  assert(Array.isArray(positionsBefore), "getActivePositions returns valid array");

  console.log("\n=================================================");
  console.log(`📊 UNIT TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log("=================================================");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runUnitTests().catch(err => {
  console.error("Test runner threw uncaught error:", err);
  process.exit(1);
});
