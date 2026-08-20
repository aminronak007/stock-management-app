import * as https from "https";
import { AdvisorySignal } from "./advisoryManager";

export class TelegramService {
  /**
   * Checks if Telegram Bot Token and Chat ID are configured in .env
   */
  public static isConfigured(): boolean {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    return !!(token && chatId);
  }

  /**
   * Dispatches a raw text/HTML message to Telegram via IPv4 HTTPS socket
   */
  public static async sendCustomMessage(message: string): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    return new Promise((resolve) => {
      const payload = JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        disable_notification: false // Loud sound notification
      });

      const options: https.RequestOptions = {
        hostname: "api.telegram.org",
        port: 443,
        path: `/bot${token}/sendMessage`,
        method: "POST",
        family: 4, // Force IPv4 to eliminate Windows socket delays
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        }
      };

      const req = https.request(options, (res) => {
        let responseData = "";
        res.on("data", (chunk) => { responseData += chunk; });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(responseData);
            if (parsed.ok) {
              console.log(`[TelegramService] ✅ Alert delivered to Telegram chat ${chatId}!`);
              resolve(true);
            } else {
              console.error("[TelegramService] Telegram API error:", parsed.description);
              resolve(false);
            }
          } catch (err: any) {
            console.error("[TelegramService] Response parse error:", err.message);
            resolve(false);
          }
        });
      });

      req.on("error", (err) => {
        console.error("[TelegramService] HTTP request error:", err.message);
        resolve(false);
      });

      req.setTimeout(8000, () => {
        req.destroy();
        console.error("[TelegramService] Request timed out.");
        resolve(false);
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Formats and dispatches a structured trade signal alert to Telegram
   */
  public static async sendSignalAlert(signal: AdvisorySignal): Promise<boolean> {
    if (!this.isConfigured()) return false;

    // Only send Telegram alerts for SNIPER Tier
    if (signal.tier !== "SNIPER") return false;

    const timeStr = new Date(signal.timestamp).toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });

    let msg = "";

    const escapeHtml = (str?: string) => {
      if (!str) return "";
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    };

    if (signal.type === "CALL_BUY" || signal.type === "PUT_BUY") {
      const actionEmoji = signal.type === "CALL_BUY" ? "🟢 <b>BUY CALL (CE)</b>" : "🔴 <b>BUY PUT (PE)</b>";
      const strikeName = signal.type === "CALL_BUY" ? `${signal.strikePrice} CE` : `${signal.strikePrice} PE`;
      const riskPerLot = signal.entryPrice && signal.stopLossPrice
        ? ((signal.entryPrice - signal.stopLossPrice) * 25).toFixed(2)
        : "N/A";
      const score = signal.scoreCard?.totalScore || 85;
      const quality = signal.scoreCard?.qualityLabel?.replace(/_/g, " ") || "HIGH QUALITY";

      msg = `🎯 <b>NIFTY 50 TRADE SIGNAL [SNIPER]</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `⚡ <b>Action:</b> ${actionEmoji}\n` +
            `📊 <b>Strike:</b> <code>${strikeName}</code>\n` +
            `💰 <b>Entry Price:</b> ₹${signal.entryPrice?.toFixed(2)}\n` +
            `🛑 <b>Stop Loss:</b> ₹${signal.stopLossPrice?.toFixed(2)}\n` +
            `🎯 <b>Target 1:</b> ₹${signal.targetPrice1?.toFixed(2)}\n` +
            `🚀 <b>Target 2:</b> ₹${signal.targetPrice2?.toFixed(2)}\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🛡️ <b>Max Risk / Lot:</b> ₹${riskPerLot} (1 Lot = 25 Qty)\n` +
            `⭐ <b>Confluence:</b> ${score}/100 [${quality}]\n` +
            `🕒 <b>Time:</b> ${timeStr}\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `<i>Automated by Nifty 50 Quant Terminal</i>`;

    } else if (signal.type === "HOLD") {
      // Risk / Trailing SL adjustments
      msg = `🔒 <b>POSITION UPDATE [SNIPER]</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `📊 <b>Strike:</b> <code>${signal.strikePrice}</code>\n` +
            `🛡️ <b>Status:</b> ${escapeHtml(signal.reasoning)}\n` +
            `🛑 <b>New Stop Loss:</b> ₹${signal.stopLossPrice?.toFixed(2)}\n` +
            `🕒 <b>Time:</b> ${timeStr}\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `<i>Risk is protected.</i>`;

    } else if (signal.type.startsWith("EXIT_") || signal.type === "THETA_EXIT" || signal.type === "SQUARE_OFF") {
      let exitHeadline = "🛑 <b>TRADE EXIT [SNIPER]</b>";
      if (signal.type === "EXIT_PROFIT") exitHeadline = "💰 <b>PROFIT TARGET ACHIEVED [SNIPER]</b>";
      if (signal.type === "EXIT_STOP_LOSS") exitHeadline = "⚠️ <b>STOP LOSS EXECUTED [SNIPER]</b>";
      if (signal.type === "THETA_EXIT") exitHeadline = "⏳ <b>THETA TIME-EXIT [SNIPER]</b>";
      if (signal.type === "SQUARE_OFF") exitHeadline = "⏰ <b>3:15 PM MANDATORY SQUARE-OFF</b>";

      msg = `${exitHeadline}\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `📊 <b>Strike:</b> <code>${signal.strikePrice}</code>\n` +
            `💵 <b>Exit Price:</b> ₹${signal.entryPrice?.toFixed(2)}\n` +
            `📝 <b>Reason:</b> ${escapeHtml(signal.reasoning)}\n` +
            `🕒 <b>Time:</b> ${timeStr}\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `<i>Net Realized P&L logged to Google Sheets.</i>`;
    }

    if (msg) {
      return await this.sendCustomMessage(msg);
    }
    return false;
  }
}
