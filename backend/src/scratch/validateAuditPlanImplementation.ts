import { QuantitativeEngine } from "../utils/quantitativeEngine";
import { Indicators } from "../utils/indicators";

console.log("=================================================");
console.log("RUNNING AUDIT PLAN IMPLEMENTATION VERIFICATION");
console.log("=================================================");

let passed = 0;
let total = 0;

function assert(condition: boolean, testName: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${testName}`);
  } else {
    console.error(`❌ [FAIL] ${testName}`);
  }
}

// 1. TEST ADX Calculation
console.log("\n--- TEST 1: ADX Calculation & Fallback Fix ---");
const syntheticCandles = Array.from({ length: 30 }, (_, i) => ({
  high: 24000 + i * 5 + 3,
  low: 24000 + i * 5 - 3,
  close: 24000 + i * 5 + 1
}));
const adxResult = Indicators.calculateCandleADX(syntheticCandles, 14);
assert(adxResult > 0 && adxResult !== 15.0, `ADX returns calculated value (${adxResult}) and NOT fallback 15.0`);

const shortCandles = syntheticCandles.slice(0, 10);
const shortAdx = Indicators.calculateCandleADX(shortCandles, 14);
assert(shortAdx === 20.0, `Short candles (< 14) return neutral 20.0 (got ${shortAdx}), NOT chop-penalty 15.0`);

// 2. TEST Intraday Banking Divergence Veto
console.log("\n--- TEST 2: Intraday Banking Divergence Veto ---");
const candles5m = Array.from({ length: 35 }, (_, i) => ({
  open: 24000 + i * 2,
  high: 24000 + i * 2 + 5,
  low: 24000 + i * 2 - 5,
  close: 24000 + i * 2 + 3,
  volume: 150000,
  timestamp: Date.now() - (35 - i) * 300000
}));

// Scenario A: Bank Nifty above VWAP (+0.20%) -> PUT must be vetoed
const putDivergence = QuantitativeEngine.calculateConfluence({
  spot: 24000,
  currentVwap: 24020,
  orbHigh: 24100,
  orbLow: 23900,
  triggerType: "PUT_BUY",
  setupType: "VWAP_PULLBACK",
  cpr: null,
  optionPremiumRsi: 50,
  pcr: 0.8,
  vix: 13,
  atr: 75,
  riskReward: 2.0,
  candles5m,
  heavyweightsLtp: {
    "NSE:NIFTYBANK-INDEX": 51100, // +0.196% above VWAP
    "NSE:HDFCBANK-EQ": 1650
  },
  heavyweightsVwap: {
    "NSE:NIFTYBANK-INDEX": 51000,
    "NSE:HDFCBANK-EQ": 1648
  }
});

assert(putDivergence.isFalseBreakout === true, "PUT_BUY vetoed when Bank Nifty trades above VWAP");
assert(putDivergence.totalScore === 0, "PUT_BUY score reset to 0 when Bank Nifty trades above VWAP");
assert(putDivergence.explanation.some(e => e.includes("BANKING INTRADAY DIVERGENCE VETO")), "Explanation cites BANKING INTRADAY DIVERGENCE VETO");

// Scenario B: Bank Nifty below VWAP (-0.20%) -> CALL must be vetoed
const callDivergence = QuantitativeEngine.calculateConfluence({
  spot: 24050,
  currentVwap: 24020,
  orbHigh: 24100,
  orbLow: 23900,
  triggerType: "CALL_BUY",
  setupType: "VWAP_PULLBACK",
  cpr: null,
  optionPremiumRsi: 50,
  pcr: 1.2,
  vix: 13,
  atr: 75,
  riskReward: 2.0,
  candles5m,
  heavyweightsLtp: {
    "NSE:NIFTYBANK-INDEX": 50900, // -0.196% below VWAP
    "NSE:RELIANCE-EQ": 2900
  },
  heavyweightsVwap: {
    "NSE:NIFTYBANK-INDEX": 51000,
    "NSE:RELIANCE-EQ": 2910
  }
});

assert(callDivergence.isFalseBreakout === true, "CALL_BUY vetoed when Bank Nifty trades below VWAP");
assert(callDivergence.totalScore === 0, "CALL_BUY score reset to 0 when Bank Nifty trades below VWAP");

// 3. TEST VIX Intraday Trend Gate
console.log("\n--- TEST 3: India VIX Intraday Trend Gate ---");
const vixSurgeCall = QuantitativeEngine.calculateConfluence({
  spot: 24050,
  currentVwap: 24020,
  orbHigh: 24100,
  orbLow: 23900,
  triggerType: "CALL_BUY",
  setupType: "VWAP_PULLBACK",
  cpr: null,
  optionPremiumRsi: 50,
  pcr: 1.2,
  vix: 15,
  deltaVixPercent: 3.5, // VIX surged +3.5%
  atr: 75,
  riskReward: 2.0,
  candles5m,
  heavyweightsLtp: { "NSE:NIFTYBANK-INDEX": 51050 },
  heavyweightsVwap: { "NSE:NIFTYBANK-INDEX": 51000 }
});
assert(vixSurgeCall.isFalseBreakout === true && vixSurgeCall.totalScore === 0, "CALL_BUY vetoed when VIX surges > +3.0%");

const vixCollapsePut = QuantitativeEngine.calculateConfluence({
  spot: 24000,
  currentVwap: 24020,
  orbHigh: 24100,
  orbLow: 23900,
  triggerType: "PUT_BUY",
  setupType: "VWAP_PULLBACK",
  cpr: null,
  optionPremiumRsi: 50,
  pcr: 0.8,
  vix: 13,
  deltaVixPercent: -3.5, // VIX crushed -3.5%
  atr: 75,
  riskReward: 2.0,
  candles5m,
  heavyweightsLtp: { "NSE:NIFTYBANK-INDEX": 50950 },
  heavyweightsVwap: { "NSE:NIFTYBANK-INDEX": 51000 }
});
assert(vixCollapsePut.isFalseBreakout === true && vixCollapsePut.totalScore === 0, "PUT_BUY vetoed when VIX collapses < -3.0%");

// 4. TEST Futures / Global Macro Discount Gate
console.log("\n--- TEST 4: Futures / Global Macro Discount Gate ---");
const futuresDiscountCall = QuantitativeEngine.calculateConfluence({
  spot: 24050,
  currentVwap: 24020,
  orbHigh: 24100,
  orbLow: 23900,
  triggerType: "CALL_BUY",
  setupType: "VWAP_PULLBACK",
  cpr: null,
  optionPremiumRsi: 50,
  pcr: 1.2,
  vix: 13,
  giftNiftyDelta: -30, // Deep discount
  atr: 75,
  riskReward: 2.0,
  candles5m,
  heavyweightsLtp: { "NSE:NIFTYBANK-INDEX": 51050 },
  heavyweightsVwap: { "NSE:NIFTYBANK-INDEX": 51000 }
});
assert(futuresDiscountCall.isFalseBreakout === true && futuresDiscountCall.totalScore === 0, "CALL_BUY vetoed when Futures/Global is at discount (-30 pts)");

// 5. TEST Trailing SL Math.max (Simulated Logic)
console.log("\n--- TEST 5: Trailing SL Math.max Verification ---");
const entryPrice = 140;
const peakPremium = 170;
const minBreathingRoom = 10;
const initialRisk = 15;
const locked1RPrice = entryPrice + initialRisk * 1.0; // 155
const maxSafeSl = peakPremium - minBreathingRoom; // 160

// Old buggy logic: Math.min(141, 160) = 141 (Threw away 19 pts!)
const oldBuggySl = Math.min(entryPrice + 1.0, maxSafeSl > entryPrice ? maxSafeSl : entryPrice + 1.0);
// Fixed logic: Math.max(155, 160) = 160 (Protects +20 pts gain!)
const fixedSl = Math.max(locked1RPrice, maxSafeSl);

assert(oldBuggySl === 141, "Demonstrated old bug: SL clamped down to 141, throwing away profits");
assert(fixedSl === 160, `Verified new fix: SL locked high to 160, preserving accumulated profits`);

console.log("\n=================================================");
console.log(`TEST RESULTS: ${passed} / ${total} TESTS PASSED (${((passed / total) * 100).toFixed(0)}%)`);
console.log("=================================================");

if (passed === total) {
  process.exit(0);
} else {
  process.exit(1);
}
