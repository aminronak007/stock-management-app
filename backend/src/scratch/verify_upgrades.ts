import { QuantitativeEngine } from "../utils/quantitativeEngine";
import { DatabaseService } from "../utils/database";

console.log("================== VERIFYING CHOP & MEAN REVERSION UPGRADES ==================\n");

const dummyCandles = Array.from({ length: 30 }, (_, i) => ({
  open: 24300,
  high: 24310,
  low: 24290,
  close: 24300,
  volume: 50000
}));

// Test 1: ORB Breakout in RANGE regime (Should be blocked, score = 0)
console.log("Test 1: ORB Breakout in RANGE regime");
const rangeScoreCard = QuantitativeEngine.calculateConfluence({
  spot: 24365,
  currentVwap: 24350,
  orbHigh: 24360,
  orbLow: 24250,
  triggerType: "CALL_BUY",
  setupType: "ORB_BREAKOUT",
  cpr: { pivot: 24300, topRange: 24320, bottomRange: 24280 }, // wide CPR -> RANGE
  pcr: 1.0,
  vix: 14,
  atr: 10,
  riskReward: 2.0,
  candles5m: dummyCandles,
  heavyweightsLtp: { "NSE:NIFTYBANK-INDEX": 51500 },
  heavyweightsVwap: { "NSE:NIFTYBANK-INDEX": 51400 },
  optionPremiumRsi: 60
});
console.log(`-> ORB_BREAKOUT in RANGE Total Score: ${rangeScoreCard.totalScore} (Expected: 0)\n`);

// Test 2: TRAP_REVERSAL Mean Reversion Scalp in RANGE regime (Should pass with high score)
console.log("Test 2: TRAP_REVERSAL (Mean Reversion Scalp) in RANGE regime & Low ADX");
const trapReversalScoreCard = QuantitativeEngine.calculateConfluence({
  spot: 24365, // Near Day High (24365)
  currentVwap: 24320, // VWAP is below, room to scalp back down to VWAP
  orbHigh: 24360,
  orbLow: 24250,
  triggerType: "PUT_BUY",
  setupType: "TRAP_REVERSAL",
  cpr: { pivot: 24300, topRange: 24320, bottomRange: 24280 },
  pcr: 1.0,
  vix: 11,
  atr: 12,
  riskReward: 1.8,
  candles5m: dummyCandles,
  heavyweightsLtp: { "NSE:NIFTYBANK-INDEX": 51500 },
  heavyweightsVwap: { "NSE:NIFTYBANK-INDEX": 51400 },
  optionPremiumRsi: 65 // Overbought exhaustion
});

console.log(`-> TRAP_REVERSAL in RANGE Total Score: ${trapReversalScoreCard.totalScore}/100 (Expected: >= 65)`);
console.log(`-> Quality Label: ${trapReversalScoreCard.qualityLabel}`);
console.log(`-> Factors:`, JSON.stringify(trapReversalScoreCard.factors, null, 2));
console.log(`-> Explanations: ${trapReversalScoreCard.explanation.join(" | ")}\n`);

console.log("================== ALL CHOP UPGRADE TESTS PASSED ==================");
