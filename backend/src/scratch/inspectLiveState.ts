import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, "../../.env") });

import { BrokerFactory } from "../adapters/BrokerFactory";

async function check() {
  const broker = BrokerFactory.getAdapter();
  await broker.initialize();
  if (broker.getQuotes) {
    const quotes = await broker.getQuotes([
      "NSE:NIFTY50-INDEX",
      "NSE:NIFTYBANK-INDEX",
      "NSE:RELIANCE-EQ",
      "NSE:HDFCBANK-EQ",
      "NSE:ICICIBANK-EQ",
      "NSE:INDIAVIX-INDEX"
    ]);
    console.log("=== LIVE BROKER QUOTES AT 09:32 AM ===");
    for (const [sym, q] of Object.entries(quotes)) {
      console.log(`${sym}: LTP=${q.ltp}, NetChange=${q.netChange} (${q.netChangePercent}%), PrevClose=${q.prevClose}`);
    }
  }
}

check().catch(console.error);
