import { DatabaseService } from "./database";
import { GoogleSheetsService, TradeLogRow } from "../services/googleSheetsService";

export class ExcelLogger {
  /**
   * Calculates realistic Indian FnO statutory fees (Brokerage, STT, GST, Exchange turnover, Stamp duty)
   */
  public static calculateStatutoryFees(price: number, qty: number): number {
    const buyTurnover = price * qty;
    const sellTurnover = price * qty; // conservative estimate for round trip turnover
    const totalTurnover = buyTurnover + sellTurnover;

    const brokerage = 40.0; // ₹20 Buy + ₹20 Sell (Standard discount broker)
    const stt = sellTurnover * 0.00125; // 0.125% on option sell turnover
    const exchangeCharge = totalTurnover * 0.000505; // 0.0505% NSE transaction charge
    const gst = (brokerage + exchangeCharge) * 0.18; // 18% GST on brokerage + exchange fee
    const stampDuty = buyTurnover * 0.00003; // 0.003% on buy
    const sebiCharge = totalTurnover * 0.000001; // ₹10 per crore

    const totalFees = brokerage + stt + exchangeCharge + gst + stampDuty + sebiCharge;
    return parseFloat(totalFees.toFixed(2));
  }

  /**
   * Logs transactions directly to Google Sheets and internal database (Zero Local CSV files)
   */
  public static async logTransaction(
    type: string,
    symbol: string,
    strike: number | string,
    qty: number,
    price: number,
    reasoning: string,
    additionalData: {
      tier?: "SNIPER" | "BALANCED" | "EXPLORATORY";
      sl?: number;
      t1?: number;
      t2?: number;
      pnl?: number;
      marketRegime?: string;
      confluenceScore?: number;
      entrySpot?: number;
    } = {}
  ): Promise<number> {
    const tier = additionalData.tier || "SNIPER";
    const investedCapital = price * qty;

    let grossPnlVal: number | undefined = undefined;
    let feesVal: number | undefined = undefined;
    let netPnlVal: number | undefined = undefined;

    if (additionalData.pnl !== undefined) {
      grossPnlVal = additionalData.pnl * qty; // scale pnl by quantity traded
      feesVal = this.calculateStatutoryFees(price, qty);
      netPnlVal = grossPnlVal - feesVal;
    }

    const tradeRow: TradeLogRow = {
      type,
      tier,
      symbol,
      strike,
      qty,
      price,
      sl: additionalData.sl,
      t1: additionalData.t1,
      t2: additionalData.t2,
      investedCapital,
      grossPnl: grossPnlVal,
      fees: feesVal,
      netPnl: netPnlVal,
      reasoning
    };

    let tradeId = 0;
    // 1. Persist into SQLite immediately so a restart can restore the open position
    try {
      tradeId = DatabaseService.logPaperTrade({
        type,
        tier,
        symbol,
        strike,
        qty,
        price,
        stopLoss: additionalData.sl,
        target1: additionalData.t1,
        target2: additionalData.t2,
        pnl: grossPnlVal,
        fees: feesVal,
        netPnl: netPnlVal,
        reasoning,
        marketRegime: additionalData.marketRegime,
        confluenceScore: additionalData.confluenceScore,
        entrySpot: additionalData.entrySpot,
        peakPremium: price
      });
      console.log(`[TradeLogger] Trade saved to SQLite Database.`);
    } catch (e: any) {
      console.error("[TradeLogger] Failed to log trade to SQLite database:", e.message);
    }

    // 2. Stream to Google Sheets without blocking the SQLite row id
    GoogleSheetsService.logTradeToGoogleSheets(tradeRow).catch((err: any) => {
      console.error("[TradeLogger] Error logging trade to Google Sheets:", err.message);
    });

    return tradeId;
  }
}
