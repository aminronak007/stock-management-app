import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, "../../.env") });

import { GoogleSheetsService } from "../services/googleSheetsService";

async function test() {
  console.log("Testing Google Sheets dynamic logging via Webhook...");
  console.log("Webhook URL:", process.env.GOOGLE_SHEETS_WEBHOOK_URL);

  const res = await GoogleSheetsService.logTradeToGoogleSheets({
    type: "CALL_BUY",
    tier: "SNIPER",
    symbol: "NSE:NIFTY26AUG24250CE",
    strike: 24250,
    qty: 25,
    price: 120.50,
    sl: 112.00,
    t1: 135.00,
    t2: 155.00,
    investedCapital: 3012.50,
    grossPnl: 350.00,
    fees: 54.62,
    netPnl: 295.38,
    reasoning: "[SNIPER TIER] Bullish ORB Breakout above 24212.75. Score: 90/100."
  });

  console.log("Result:", res ? "SUCCESS! Check your Google Drive now!" : "FAILED");
}

test().catch(console.error);
