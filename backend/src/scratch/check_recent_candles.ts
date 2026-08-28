import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, "../../.env") });

import { BrokerFactory } from "../adapters/BrokerFactory";
import { FyersAdapter } from "../adapters/FyersAdapter";

async function checkLivePriceAndCandles() {
  const adapter = BrokerFactory.getAdapter() as FyersAdapter;
  await adapter.initialize();

  const todayStr = new Date().toISOString().split("T")[0];
  const prevDate = new Date();
  prevDate.setDate(prevDate.getDate() - 3);
  const prevDateStr = prevDate.toISOString().split("T")[0];

  const candles5m = await adapter.getHistoricalCandles("NSE:NIFTY50-INDEX", "5", prevDateStr, todayStr);
  console.log(`Total 5m candles: ${candles5m.length}`);
  console.log("Recent 5m candles (last 6):");
  candles5m.slice(-6).forEach(c => {
    const timeStr = new Date(c.timestamp).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" });
    console.log(`  ${timeStr}: Open=${c.open}, High=${c.high}, Low=${c.low}, Close=${c.close}, Vol=${c.volume}`);
  });
}

checkLivePriceAndCandles().catch(console.error);
