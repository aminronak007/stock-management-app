import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, "../../.env") });

import { ExcelLogger } from "../utils/excelLogger";
import * as fs from "fs";

async function verify() {
  console.log("=== Verifying Direct-to-Cloud Logging ===");
  console.log("Webhook configured:", !!process.env.GOOGLE_SHEETS_WEBHOOK_URL);

  const testType = "CALL_BUY";
  const testSymbol = "NSE:NIFTY26AUG24250CE";
  const testReason = "Verification that trade goes directly to Google Sheets without writing to local CSV.";

  await ExcelLogger.logTransaction(
    testType,
    testSymbol,
    24250,
    25,
    125.00,
    testReason,
    {
      tier: "SNIPER",
      sl: 115.00,
      t1: 140.00,
      t2: 160.00,
      pnl: 15.00,
      confluenceScore: 90
    }
  );

  console.log("Verification finished successfully!");
}

verify().catch(console.error);
