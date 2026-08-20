import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, "../../.env") });

import { TelegramService } from "../services/telegramService";

async function run() {
  console.log("=== Testing Real-Time Telegram Trade Alert ===");
  console.log("Configured:", TelegramService.isConfigured());
  console.log("Bot Token:", process.env.TELEGRAM_BOT_TOKEN ? "PRESENT (hidden)" : "MISSING");
  console.log("Chat ID:", process.env.TELEGRAM_CHAT_ID || "MISSING");

  if (!TelegramService.isConfigured()) {
    console.log("\n[Notice] Please add TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID to .env to receive trade alerts.");
    return;
  }

  const ok = await TelegramService.sendSignalAlert({
    type: "CALL_BUY",
    tier: "SNIPER",
    strikePrice: 24250,
    entryPrice: 120.50,
    stopLossPrice: 112.00,
    targetPrice1: 135.00,
    targetPrice2: 155.00,
    timestamp: Date.now(),
    reasoning: "Bullish ORB Breakout above 24212.75 with VWAP & Heavyweight confirmation.",
    scoreCard: {
      totalScore: 92,
      qualityLabel: "VERY_HIGH_QUALITY"
    }
  });

  console.log("Telegram Dispatch Result:", ok ? "DELIVERED TO YOUR TELEGRAM! 🚀" : "FAILED (Check credentials)");
}

run().catch(console.error);
