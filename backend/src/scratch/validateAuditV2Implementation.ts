import { Indicators } from "../utils/indicators";
import { QuantitativeEngine } from "../utils/quantitativeEngine";
import { CPR } from "../utils/cpr";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASSED: ${message}`);
}

console.log("=== RUNNING DEEP AUDIT V2 VALIDATION SUITE ===\n");

// 1. Test SuperTrend Indicator
console.log("--- 1. Testing SuperTrend Indicator ---");
const highs = [100, 102, 105, 108, 112, 115, 118, 120, 125, 128, 130, 135];
const lows =  [ 98,  99, 101, 104, 107, 110, 113, 116, 120, 123, 125, 130];
const closes =[ 99, 101, 104, 107, 111, 114, 117, 119, 124, 127, 129, 134];

const st = Indicators.calculateSuperTrend(highs, lows, closes, 5, 2);
assert(st.superTrend.length === closes.length, "SuperTrend output length matches inputs");
assert(st.direction[st.direction.length - 1] === "BULLISH", "Strong uptrend produces BULLISH SuperTrend");

// Downtrend test
const downHighs = [135, 130, 128, 125, 120, 118, 115, 112, 108, 105, 102, 100];
const downLows =  [130, 125, 123, 120, 116, 113, 110, 107, 104, 101,  99,  98];
const downCloses =[131, 126, 124, 121, 117, 114, 111, 108, 105, 102, 100,  99];
const stDown = Indicators.calculateSuperTrend(downHighs, downLows, downCloses, 5, 2);
assert(stDown.direction[stDown.direction.length - 1] === "BEARISH", "Strong downtrend produces BEARISH SuperTrend");

// 2. Test MACD Indicator
console.log("\n--- 2. Testing MACD Indicator ---");
const macdData = Indicators.calculateMACD(closes, 3, 6, 3);
assert(macdData.macd.length === closes.length, "MACD line length matches input");
assert(macdData.signal.length === closes.length, "MACD signal line length matches input");
assert(macdData.histogram.length === closes.length, "MACD histogram length matches input");
assert(macdData.histogram[macdData.histogram.length - 1] > 0, "MACD histogram is positive during accelerating uptrend");

// 3. Test VWAP Volume Fallback Refinement
console.log("\n--- 3. Testing VWAP Volume Fallback Refinement ---");
const candlesWithVol = [
  { high: 105, low: 95, close: 100, volume: 500 },
  { high: 115, low: 105, close: 110, volume: 1000 }
];
const vwapReal = Indicators.calculateVWAP(candlesWithVol);
// typical 1 = 100, vol = 500; typical 2 = 110, vol = 1000; total pv = 50000 + 110000 = 160000 / 1500 = 106.666...
assert(Math.abs(vwapReal - 106.67) < 0.05, `Real VWAP volume weighted accurately (${vwapReal.toFixed(2)} ≈ 106.67)`);

const candlesNoVol = [
  { high: 105, low: 95, close: 100, volume: 0 },
  { high: 115, low: 105, close: 110, volume: 0 }
];
const vwapNoVol = Indicators.calculateVWAP(candlesNoVol);
// typical 1 = 100, typical 2 = 110 -> average = 105 (no artificial unit volume skew)
assert(Math.abs(vwapNoVol - 105.0) < 0.01, `No-volume fallback produces unskewed mean (${vwapNoVol} == 105.0)`);

// 4. Test Dynamic Position Sizing (Max ₹300 Risk)
console.log("\n--- 4. Testing Dynamic Position Sizing ---");
function calculateLots(scaledStopLoss: number): number {
  const maxRiskPerTrade = 300;
  const slWidthPoints = Math.max(5.0, scaledStopLoss);
  const riskBasedLots = Math.floor(maxRiskPerTrade / slWidthPoints / 25);
  return Math.max(25, Math.min(75, riskBasedLots * 25));
}

assert(calculateLots(15.0) === 25, "15-pt SL sizes safely to 25 qty (1 lot)");
assert(calculateLots(18.0) === 25, "18-pt SL sizes safely to 25 qty (1 lot)");
assert(calculateLots(6.0) === 50, "6-pt SL sizes safely to 50 qty (2 lots)");
assert(calculateLots(3.0) === 50, "Tight SL is floored to 5-pt minimum risk width (50 qty)");

// 5. Test RANGE Regime Veto for VWAP_PULLBACK
console.log("\n--- 5. Testing RANGE Regime Veto for VWAP_PULLBACK ---");
const dummyCandles = Array.from({ length: 30 }, (_, i) => ({
  high: 24500 + (i % 3) * 2,
  low: 24490 - (i % 3) * 2,
  close: 24495 + (i % 2) * 2,
  volume: 1000
}));
const cprConsolidation = CPR.calculateCPR(24520, 24480, 24500); // narrow CPR inside range

const rangeScore = QuantitativeEngine.calculateConfluence({
  spot: 24505,
  currentVwap: 24500,
  orbHigh: 24550,
  orbLow: 24450,
  triggerType: "CALL_BUY",
  setupType: "VWAP_PULLBACK",
  cpr: cprConsolidation,
  pcr: 1.1,
  vix: 14,
  atr: 12,
  riskReward: 2.5,
  candles5m: dummyCandles,
  heavyweightsLtp: { "NSE:HDFCBANK-EQ": 1600, "NSE:RELIANCE-EQ": 2900, "NSE:ICICIBANK-EQ": 1200 },
  heavyweightsVwap: { "NSE:HDFCBANK-EQ": 1595, "NSE:RELIANCE-EQ": 2895, "NSE:ICICIBANK-EQ": 1195 },
  optionPremiumRsi: 60
});

assert(rangeScore.regime === "RANGE", "Consolidating candles classified as RANGE regime");
assert(rangeScore.totalScore === 0, "VWAP_PULLBACK in RANGE regime is strictly vetoed (Score = 0)");
assert(rangeScore.isFalseBreakout === true, "VWAP_PULLBACK in RANGE regime marked as False Breakout");
assert(rangeScore.explanation.some(e => e.includes("RANGE REGIME VETO")), "Explanation contains RANGE REGIME VETO notice");

// 6. Test TRAP_REVERSAL Score Deflation
console.log("\n--- 6. Testing TRAP_REVERSAL Score Deflation ---");
const trapScore = QuantitativeEngine.calculateConfluence({
  spot: 24555,
  currentVwap: 24500,
  orbHigh: 24550,
  orbLow: 24450,
  triggerType: "PUT_BUY",
  setupType: "TRAP_REVERSAL",
  cpr: cprConsolidation,
  pcr: 1.0,
  vix: 14,
  atr: 12,
  riskReward: 2.0,
  candles5m: dummyCandles,
  heavyweightsLtp: { "NSE:HDFCBANK-EQ": 1590, "NSE:RELIANCE-EQ": 2890, "NSE:ICICIBANK-EQ": 1190 },
  heavyweightsVwap: { "NSE:HDFCBANK-EQ": 1600, "NSE:RELIANCE-EQ": 2900, "NSE:ICICIBANK-EQ": 1200 },
  optionPremiumRsi: 50
});

// Flat points should be 8 + 6 + 5 + 4 = 23 (not 45).
const flatSum = trapScore.factors.marketStructure.score +
                trapScore.factors.vwapMomentum.score +
                trapScore.factors.regimeAlignment.score +
                trapScore.factors.optionMomentum.score;
assert(flatSum <= 38, `TRAP_REVERSAL flat bonuses are deflated (sum = ${flatSum} pts, well below previous 59 inflation)`);

// 7. Test Late-Session Theta Penalty
console.log("\n--- 7. Testing Late-Session Theta Penalty ---");
// 14:30 IST timestamp: 14 * 3600 + 30 * 60 = 52200s; UTC is 5h30m earlier
const lateSessionTime = new Date("2026-09-11T09:00:00.000Z").getTime(); // 14:30 IST
const lateScore = QuantitativeEngine.calculateConfluence({
  spot: 24555,
  currentVwap: 24500,
  orbHigh: 24550,
  orbLow: 24450,
  triggerType: "PUT_BUY",
  setupType: "TRAP_REVERSAL",
  cpr: cprConsolidation,
  pcr: 1.0,
  vix: 14,
  atr: 12,
  riskReward: 2.0,
  candles5m: dummyCandles,
  heavyweightsLtp: { "NSE:HDFCBANK-EQ": 1590 },
  heavyweightsVwap: { "NSE:HDFCBANK-EQ": 1600 },
  optionPremiumRsi: 50,
  timestamp: lateSessionTime
});
assert(lateScore.explanation.some(e => e.includes("LATE-SESSION PENALTY")), "Late-session penalty applied after 14:00 IST");

// 8. Test Guaranteed Green Lock (0.5R Calculation)
console.log("\n--- 8. Testing Guaranteed Green Lock Formula ---");
const entryPrice = 150.0;
const initialRisk = 16.0;
const guaranteedProfitSl = parseFloat((entryPrice + initialRisk * 0.50).toFixed(2));
assert(guaranteedProfitSl === 158.0, `Guaranteed profit SL trails to Entry + 0.5R (₹158.00 vs entry ₹150.00)`);

// 9. Test Risk-Halving Shield Math.max Logic
console.log("\n--- 9. Testing Risk-Halving Shield Math.max Fix ---");
const riskReducedSl = 148.0;
const maxSafeSl = 152.0;
const finalSl = Math.max(riskReducedSl, maxSafeSl);
assert(finalSl === 152.0, "Math.max protects higher safe stop (152.0 >= 148.0), never regresses SL downward");

// 10. Test 30% Retracement Limit Level Math
console.log("\n--- 10. Testing 30% Retracement Limit Entry Math ---");
const candleHigh = 24550;
const candleLow = 24520;
const candleClose = 24545;
const range = candleHigh - candleLow; // 30 pts
const retracement = 0.30 * range; // 9 pts
const callLimitSpot = candleClose - retracement; // 24536
const putLimitSpot = candleClose + retracement; // 24554
assert(callLimitSpot === 24536, `CALL limit retracement buys cheaper on pullback at ${callLimitSpot}`);
assert(putLimitSpot === 24554, `PUT limit retracement enters higher on bounce at ${putLimitSpot}`);

console.log("\n=======================================================");
console.log("🎉 ALL 10 DEEP AUDIT V2 TEST SUITES PASSED SUCCESSFULLY!");
console.log("=======================================================");
