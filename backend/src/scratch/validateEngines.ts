import { QuantitativeEngine } from "../utils/quantitativeEngine";
import { CPR } from "../utils/cpr";

function runVerification() {
  console.log("=== RUNNING QUANTITATIVE & INSTITUTIONAL ENGINE VERIFICATION ===");

  const dummyCandles = [
    { close: 23600, high: 23610, low: 23590, volume: 10000, open: 23595 },
    { close: 23610, high: 23620, low: 23600, volume: 12000, open: 23605 },
    { close: 23625, high: 23630, low: 23610, volume: 15000, open: 23610 },
    { close: 23635, high: 23640, low: 23620, volume: 14000, open: 23625 },
    { close: 23645, high: 23650, low: 23630, volume: 18000, open: 23635 },
    { close: 23650, high: 23655, low: 23640, volume: 20000, open: 23645 }
  ];

  const dummyCpr = CPR.calculateCPR(23700, 23500, 23600);

  // Test 1: Heavyweight Opposing Breakout Gate (2/3 opposing: Reliance & HDFC below VWAP)
  const resultCallOpposed = QuantitativeEngine.calculateConfluence({
    spot: 23650,
    currentVwap: 23640,
    orbHigh: 23660,
    orbLow: 23550,
    triggerType: "CALL_BUY",
    setupType: "ORB_BREAKOUT",
    cpr: dummyCpr,
    pcr: 1.1,
    vix: 14,
    atr: 25,
    riskReward: 2.5,
    candles5m: dummyCandles,
    heavyweightsLtp: {
      "NSE:RELIANCE-EQ": 2980, // below VWAP 3000 -> opposing CALL
      "NSE:HDFCBANK-EQ": 1640, // below VWAP 1650 -> opposing CALL
      "NSE:ICICIBANK-EQ": 1210  // above VWAP 1200 -> supporting CALL
    },
    heavyweightsVwap: {
      "NSE:RELIANCE-EQ": 3000,
      "NSE:HDFCBANK-EQ": 1650,
      "NSE:ICICIBANK-EQ": 1200
    },
    optionPremiumRsi: 55
  });

  console.log(`Test 1 (2/3 Heavyweights Oppose CALL): Total Score = ${resultCallOpposed.totalScore}, FalseBreakout = ${resultCallOpposed.isFalseBreakout}`);
  console.log("Explanations:", resultCallOpposed.explanation);
  if (resultCallOpposed.isFalseBreakout && resultCallOpposed.totalScore === 0) {
    console.log("✓ Test 1 PASSED: Big-3 Institutional Gate correctly blocked false breakout.");
  } else {
    console.error("✕ Test 1 FAILED:", resultCallOpposed);
    process.exit(1);
  }

  // Test 2: Heavyweight Supporting Pullback Setup (All 3 above VWAP)
  const resultCallSupported = QuantitativeEngine.calculateConfluence({
    spot: 23650,
    currentVwap: 23640,
    orbHigh: 23660,
    orbLow: 23550,
    triggerType: "CALL_BUY",
    setupType: "VWAP_PULLBACK",
    cpr: dummyCpr,
    pcr: 1.1,
    vix: 14,
    atr: 25,
    riskReward: 2.5,
    candles5m: dummyCandles,
    heavyweightsLtp: {
      "NSE:RELIANCE-EQ": 3010, // above VWAP 3000 -> supporting
      "NSE:HDFCBANK-EQ": 1655, // above VWAP 1650 -> supporting
      "NSE:ICICIBANK-EQ": 1210  // above VWAP 1200 -> supporting
    },
    heavyweightsVwap: {
      "NSE:RELIANCE-EQ": 3000,
      "NSE:HDFCBANK-EQ": 1650,
      "NSE:ICICIBANK-EQ": 1200
    },
    optionPremiumRsi: 55
  });

  console.log(`Test 2 (3/3 Heavyweights Support Pullback): Total Score = ${resultCallSupported.totalScore}, FalseBreakout = ${resultCallSupported.isFalseBreakout}`);
  if (!resultCallSupported.isFalseBreakout && resultCallSupported.totalScore >= 60) {
    console.log("✓ Test 2 PASSED: High-conviction Pullback correctly approved with high score.");
  } else {
    console.error("✕ Test 2 FAILED:", resultCallSupported);
    process.exit(1);
  }

  console.log("\n=======================================================");
  console.log("=== ALL UNIT TESTS PASSED SUCCESSFULLY (100% GREEN) ===");
  console.log("=======================================================");
}

runVerification();
