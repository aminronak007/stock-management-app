import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, "../../.env") });

import { BrokerFactory } from "../adapters/BrokerFactory";
import { FyersAdapter } from "../adapters/FyersAdapter";
import { QuantitativeEngine } from "../utils/quantitativeEngine";
import { CPR } from "../utils/cpr";
import { Indicators } from "../utils/indicators";
import { getIntradayEmaTrend } from "../utils/niftyOptionsSetup";

async function checkLiveConfluence() {
  const adapter = BrokerFactory.getAdapter() as FyersAdapter;
  await adapter.initialize();

  const todayStr = new Date().toISOString().split("T")[0];
  const prevDate = new Date();
  prevDate.setDate(prevDate.getDate() - 5);
  const prevDateStr = prevDate.toISOString().split("T")[0];

  const dailyCandles = await adapter.getHistoricalCandles("NSE:NIFTY50-INDEX", "D", prevDateStr, todayStr);
  const lastDay = dailyCandles[dailyCandles.length - 1];
  const cpr = CPR.calculateCPR(lastDay.high, lastDay.low, lastDay.close);

  const candles5m = await adapter.getHistoricalCandles("NSE:NIFTY50-INDEX", "5", prevDateStr, todayStr);
  console.log(`Loaded ${candles5m.length} 5m candles.`);
  console.log("Last 5 candles:", candles5m.slice(-5));

  const spot = 24170.1;
  const currentVwap = Indicators.calculateVWAP(candles5m.filter(c => {
    const d = new Date(c.timestamp);
    return d.toISOString().split("T")[0] === todayStr || true;
  }));

  const closes = candles5m.map(c => c.close);
  const highs = candles5m.map(c => c.high);
  const lows = candles5m.map(c => c.low);
  const atrList = Indicators.calculateATR(highs, lows, closes, 14);
  const atr = atrList[atrList.length - 1] || 10;
  const vix = 10.8;

  const regime = QuantitativeEngine.classifyRegime(spot, cpr, vix, candles5m, atr);
  console.log(`Regime classified: ${regime}`);

  const heavyLtp = {
    "NSE:NIFTYBANK-INDEX": 57526.55,
    "NSE:FINNIFTY-INDEX": 26295.6,
    "NSE:RELIANCE-EQ": 1288,
    "NSE:HDFCBANK-EQ": 714.7,
    "NSE:ICICIBANK-EQ": 1432.4
  };
  const heavyVwap = {
    "NSE:NIFTYBANK-INDEX": 57520,
    "NSE:FINNIFTY-INDEX": 26290,
    "NSE:RELIANCE-EQ": 1285,
    "NSE:HDFCBANK-EQ": 713,
    "NSE:ICICIBANK-EQ": 1440 // ICICI Bank is below VWAP!
  };

  const isFalse = QuantitativeEngine.detectFalseBreakout(
    spot,
    24158.25,
    24106.55,
    "CALL_BUY",
    heavyLtp,
    heavyVwap,
    50000,
    40000,
    candles5m[candles5m.length - 1] as any
  );
  console.log(`detectFalseBreakout result: ${isFalse}`);

  const scoreCard = QuantitativeEngine.calculateConfluence({
    spot,
    currentVwap,
    orbHigh: 24158.25,
    orbLow: 24106.55,
    triggerType: "CALL_BUY",
    setupType: "ORB_BREAKOUT",
    cpr,
    pcr: 1.0,
    vix,
    atr,
    riskReward: 1.8,
    candles5m,
    heavyweightsLtp: heavyLtp,
    heavyweightsVwap: heavyVwap,
    optionPremiumRsi: 55
  });

  console.log("\n=== FULL SCORE CARD BREAKDOWN ===");
  console.log(`Total Score: ${scoreCard.totalScore}/100`);
  console.log(`Quality Label: ${scoreCard.qualityLabel}`);
  console.log(`Is False Breakout: ${scoreCard.isFalseBreakout}`);
  console.log(`Factors:`, JSON.stringify(scoreCard.factors, null, 2));
  console.log(`Explanations:`);
  scoreCard.explanation.forEach(e => console.log(`  - ${e}`));
}

checkLiveConfluence().catch(console.error);
