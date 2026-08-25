import { FyersAdapter } from "../adapters/FyersAdapter";

async function analyzeToday() {
  const fyers = new FyersAdapter();
  await fyers.initialize();

  // Get today's 5m candles
  const candles = await fyers.getHistory("NSE:NIFTY50-INDEX", "5", 1);
  console.log(`Fetched ${candles.length} candles for today`);

  // First 3 candles = 09:15 - 09:30 ORB
  const orbCandles = candles.slice(0, 3);
  let orbHigh = 0;
  let orbLow = Infinity;
  orbCandles.forEach(c => {
    orbHigh = Math.max(orbHigh, c.high);
    orbLow = Math.min(orbLow, c.low);
  });

  const buffer = orbHigh * 0.00025; // ~6 pts
  const callTriggerThreshold = orbHigh + buffer;
  const putTriggerThreshold = orbLow - buffer;

  console.log("=== TODAY (AUG 25, 2026) MARKET STRUCTURE ANALYSIS ===");
  console.log(`ORB High (09:15 - 09:30 AM): ${orbHigh.toFixed(2)}`);
  console.log(`ORB Low  (09:15 - 09:30 AM): ${orbLow.toFixed(2)}`);
  console.log(`CALL Breakout Level Required: > ${callTriggerThreshold.toFixed(2)}`);
  console.log(`PUT Breakdown Level Required: < ${putTriggerThreshold.toFixed(2)}`);

  console.log("\n=== POST 09:30 AM CANDLE EXTREMES ===");
  const postOrbCandles = candles.slice(3);
  let dayHighPostOrb = 0;
  let dayLowPostOrb = Infinity;

  postOrbCandles.forEach(c => {
    dayHighPostOrb = Math.max(dayHighPostOrb, c.high);
    dayLowPostOrb = Math.min(dayLowPostOrb, c.low);
  });

  console.log(`Max High Reached Post-09:30 AM: ${dayHighPostOrb.toFixed(2)}`);
  console.log(`Min Low Reached Post-09:30 AM:  ${dayLowPostOrb.toFixed(2)}`);

  const callBreakoutOccurred = dayHighPostOrb > callTriggerThreshold;
  const putBreakdownOccurred = dayLowPostOrb < putTriggerThreshold;

  console.log(`\nDid CALL Breakout trigger (> ${callTriggerThreshold.toFixed(2)})? ${callBreakoutOccurred ? "YES" : "NO"}`);
  console.log(`Did PUT Breakdown trigger (< ${putTriggerThreshold.toFixed(2)})? ${putBreakdownOccurred ? "YES" : "NO"}`);

  if (!callBreakoutOccurred && !putBreakdownOccurred) {
    console.log("\n💡 DIAGNOSIS: Today was a 100% RANGE-BOUND CHOP DAY.");
    console.log("Nifty remained completely stuck inside the 9:15-9:30 AM Opening Range all day.");
    console.log("The ORB filter correctly PROTECTED your capital by NOT taking any false breakouts!");
  }
}

analyzeToday().catch(console.error);
