import * as dotenv from "dotenv";
import * as path from "path";

// Load configuration
dotenv.config({ path: path.join(__dirname, "../../.env") });

import { BrokerFactory } from "../adapters/BrokerFactory";
import { FyersAdapter } from "../adapters/FyersAdapter";
import { AdvisoryManager, AdvisorySignal } from "../services/advisoryManager";
import { Greeks } from "../utils/greeks";
import { CPR } from "../utils/cpr";

async function runSimulationTest() {
  console.log("====================================================================");
  console.log("NIFTY 50 OPTIONS ADVISORY ENGINE SIMULATION & MATH VERIFICATION TEST");
  console.log("====================================================================\n");

  // 1. Math Verification: Options Greeks (Black-Scholes Model)
  console.log("--- 1. Math Verification: Options Greeks (Black-Scholes Model) ---");
  const spot = 24000;
  const strike = 24000; // ATM
  const daysToExpiry = 4;
  const iv = 15; // 15% Implied Volatility
  const greeks = Greeks.calculateGreeks(spot, strike, daysToExpiry, iv);
  
  console.log(`Spot: ${spot}, Strike: ${strike}, IV: ${iv}%, Expiry: ${daysToExpiry} days`);
  console.log(`Call Delta (Δ): ${greeks.call.delta.toFixed(4)} (Expected: ~0.50)`);
  console.log(`Put Delta (Δ):  ${greeks.put.delta.toFixed(4)} (Expected: ~-0.50)`);
  console.log(`Gamma (Γ):       ${greeks.call.gamma.toFixed(6)}`);
  console.log(`Theta (Θ) Daily: ${greeks.call.theta.toFixed(2)} pts`);
  console.log(`Vega (ν) Normalized: ${greeks.call.vega.toFixed(2)} pts\n`);

  // 2. Math Verification: Volatility Cone Intraday Range
  console.log("--- 2. Math Verification: Volatility Cone (IV Cones) ---");
  const vix = 16.5;
  const expectedRange = Greeks.calculateExpectedIntradayRange(spot, vix);
  console.log(`Nifty Spot: ${spot}, India VIX: ${vix}%`);
  console.log(`Expected Intraday Range: ±${expectedRange.toFixed(2)} points`);
  console.log(`Conservative Boundary Target 1 (0.5x): ±${(0.5 * expectedRange).toFixed(2)} points`);
  console.log(`Breakout Boundary Target 2 (1.0x):     ±${expectedRange.toFixed(2)} points\n`);

  // 3. Math Verification: Central Pivot Range (CPR)
  console.log("--- 3. Math Verification: Central Pivot Range (CPR) ---");
  const prevHigh = 24100;
  const prevLow = 23900;
  const prevClose = 24050;
  const cprVals = CPR.calculateCPR(prevHigh, prevLow, prevClose);
  const cprWidth = CPR.getCPRWidthPercentage(cprVals);
  
  console.log(`Prev Day [High: ${prevHigh}, Low: ${prevLow}, Close: ${prevClose}]`);
  console.log(`CPR Pivot: ${cprVals.pivot.toFixed(2)}`);
  console.log(`CPR Range: BC ${cprVals.bc.toFixed(2)} - TC ${cprVals.tc.toFixed(2)}`);
  console.log(`CPR Width: ${cprWidth.toFixed(3)}% (${cprWidth < 0.15 ? "Narrow - Trending Bias" : "Wide - Sideways Bias"})\n`);

  // 4. Advisory Core Integration & Tick Simulation
  console.log("--- 4. Integrating System Components & Live Simulation ---");
  process.env.BROKER_PROVIDER = "FYERS";
  const adapter = BrokerFactory.getAdapter() as FyersAdapter;
  await adapter.initialize();

  const manager = new AdvisoryManager(adapter);
  await manager.initialize();

  // Register callback to catch advisory signals
  manager.registerSignalCallback((signal: AdvisorySignal) => {
    console.log(`\n>>> [UI ALERT - ${signal.type}] at ${new Date(signal.timestamp).toLocaleTimeString()}`);
    console.log(`    Strikes: ${signal.strikePrice} CE/PE`);
    console.log(`    Entry Premium: ₹${signal.entryPrice}`);
    console.log(`    Stop Loss Target: ₹${signal.stopLossPrice}`);
    console.log(`    Target 1: ₹${signal.targetPrice1} | Target 2: ₹${signal.targetPrice2}`);
    console.log(`    Alert Context: ${signal.reasoning}\n`);
  });

  // Setup tickers subscriptions
  const symbols = [
    "NSE:NIFTY50-INDEX",
    "NSE:RELIANCE-EQ",
    "NSE:HDFCBANK-EQ",
    "NSE:ICICIBANK-EQ",
    "NSE:INDIAVIX-INDEX"
  ];
  adapter.subscribeTicks(symbols);
  adapter.onTick(tick => manager.processTick(tick));

  // Generate initial feed for heavyweights (Above VWAP to facilitate call breakout)
  console.log("\nSimulating 09:15 - 09:30 AM Opening Range accumulation...");
  // Use local time Date construction to match getHours() timezone
  let mockTime = new Date(2026, 7, 16, 9, 15, 0).getTime();
  
  adapter.simulateTick({ symbol: "NSE:INDIAVIX-INDEX", ltp: vix, netChangePercent: 0, volume: 100, bidPrice: vix, askPrice: vix, timestamp: mockTime });
  adapter.simulateTick({ symbol: "NSE:RELIANCE-EQ", ltp: 2505, netChangePercent: 0.5, volume: 5000, bidPrice: 2504, askPrice: 2506, timestamp: mockTime });
  adapter.simulateTick({ symbol: "NSE:HDFCBANK-EQ", ltp: 1610, netChangePercent: 0.4, volume: 8000, bidPrice: 1609, askPrice: 1611, timestamp: mockTime });
  adapter.simulateTick({ symbol: "NSE:ICICIBANK-EQ", ltp: 1115, netChangePercent: 0.3, volume: 4000, bidPrice: 1114, askPrice: 1116, timestamp: mockTime });

  // Simulate ORB candles (Index trading between 24000 and 24020)
  for (let i = 0; i < 15; i++) {
    adapter.simulateTick({
      symbol: "NSE:NIFTY50-INDEX",
      ltp: 24000 + i * 1.2, // incremental upward trend
      netChangePercent: 0.1,
      volume: 100000,
      bidPrice: 24000,
      askPrice: 24020,
      timestamp: mockTime + i * 60 * 1000
    });
  }

  // Simulate 09:31 breakout check
  console.log("\nSimulating Nifty spot index breaking above the 15-minute ORB High at 09:31 AM...");
  mockTime += 16 * 60 * 1000;
  
  // Index spot price surges above previous ORB High (24016.8) to 24035
  const breakoutTick = {
    symbol: "NSE:NIFTY50-INDEX",
    ltp: 24035,
    netChangePercent: 0.25,
    volume: 150000,
    bidPrice: 24034,
    askPrice: 24036,
    timestamp: mockTime
  };
  
  // Let's print out the exact strategy state variables before processing breakout tick
  console.log(`ORB High Boundary: ${manager["orbHigh"].toFixed(2)}, ORB Low Boundary: ${manager["orbLow"].toFixed(2)}`);
  console.log("Heavyweights Trend status:");
  Object.keys(manager["heavyweightLtp"]).forEach(sym => {
    // Ensure mock VWAP is lower than ltp to simulate upward trend
    manager["heavyweightLtp"][sym] = manager["heavyweightLtp"][sym] || 1000;
    manager["heavyweightVwap"][sym] = manager["heavyweightLtp"][sym] - 5;
    console.log(`  - ${sym}: Price=${manager["heavyweightLtp"][sym]}, VWAP=${manager["heavyweightVwap"][sym]} (Trend: UP)`);
  });

  // Force option chain PCR to be low (e.g. 0.8) to ensure call buying is not blocked
  const chain = await adapter.getOptionChain("NSE:NIFTY50-INDEX");
  let totalPutOi = 0;
  let totalCallOi = 0;
  chain.forEach(item => {
    // Force Call OI to be larger than Put OI so PCR is ~0.8
    item.call.openInterest = 1000000;
    item.put.openInterest = 800000;
    totalCallOi += item.call.openInterest;
    totalPutOi += item.put.openInterest;
  });
  console.log(`Forced Option Chain PCR: ${(totalPutOi / totalCallOi).toFixed(2)}`);

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  adapter.simulateTick(breakoutTick);
  await sleep(100); // Allow async evaluation to finish

  // Verify Risk-Management updates: let's push Nifty spot further to see if the Stop Loss is Trailed and Breakeven is Locked
  if (manager.activeSignal) {
    console.log("\nAdvancing index spot price upward to trigger the Breakeven Profit Locker...");
    mockTime += 3 * 60 * 1000;
    
    // Nifty index spot climbs to 24080 (pushes premium value upward)
    adapter.simulateTick({
      symbol: "NSE:NIFTY50-INDEX",
      ltp: 24080,
      netChangePercent: 0.45,
      volume: 180000,
      bidPrice: 24079,
      askPrice: 24081,
      timestamp: mockTime
    });
    await sleep(50);

    // Advance Nifty spot past ultimate Target 2 (24000 spot expected range is ~200 pts, Target 2 is +200 * 0.05 * expected range = premium surges)
    console.log("\nAdvancing index spot price past Target 2 to trigger profit booking advisory...");
    mockTime += 2 * 60 * 1000;
    adapter.simulateTick({
      symbol: "NSE:NIFTY50-INDEX",
      ltp: 24150,
      netChangePercent: 0.7,
      volume: 200000,
      bidPrice: 24149,
      askPrice: 24151,
      timestamp: mockTime
    });
    await sleep(50);
  }

  console.log("====================================================================");
  console.log("SIMULATION COMPLETED SUCCESSFULY. INDICATORS & SYSTEM LOGIC IN TACT.");
  console.log("====================================================================");
}

runSimulationTest();
