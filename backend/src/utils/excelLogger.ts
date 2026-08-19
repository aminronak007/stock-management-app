import * as fs from "fs";
import * as path from "path";
import { DatabaseService } from "./database";

export class ExcelLogger {
  private static getLogDirectory(): string {
    const today = new Date();
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayName = days[today.getDay()];
    const dateStr = today.toISOString().split("T")[0]; // YYYY-MM-DD
    
    // Path: workspace_root/Stock Mock/Day_YYYY-MM-DD (outside backend folder)
    const rootPath = path.join(__dirname, "../../../");
    const dirPath = path.join(rootPath, "Stock Mock", `${dayName}_${dateStr}`);
    
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    return dirPath;
  }

  public static logTransaction(
    type: string,
    symbol: string,
    strike: number | string,
    qty: number,
    price: number,
    reasoning: string,
    additionalData: {
      sl?: number;
      t1?: number;
      t2?: number;
      pnl?: number;
      marketRegime?: string;
      confluenceScore?: number;
    } = {}
  ): void {
    const dir = this.getLogDirectory();
    const filePath = path.join(dir, "ledger.csv");
    const isNew = !fs.existsSync(filePath);

    // Standard CSV headers supporting Quantity and Invested Capital
    const headers = "Timestamp,Type,Symbol,Strike,Qty,Price,StopLoss,Target1,Target2,InvestedCapital,PnL,Reasoning\n";
    const timestamp = new Date().toLocaleString("en-IN");
    
    // Calculate Invested Capital (Premium Price * Lot Quantity)
    const investedCapital = price * qty;
    
    // Escape quotes for clean spreadsheet imports
    const escapedReasoning = reasoning.replace(/"/g, '""');
    const pnlVal = additionalData.pnl !== undefined ? (additionalData.pnl * qty) : undefined; // scale pnl by quantity traded
    const pnlStr = pnlVal !== undefined ? pnlVal.toFixed(2) : "";
    
    const row = `"${timestamp}","${type}","${symbol}","${strike}",${qty},${price.toFixed(2)},${additionalData.sl?.toFixed(2) || ""},${additionalData.t1?.toFixed(2) || ""},${additionalData.t2?.toFixed(2) || ""},${investedCapital.toFixed(2)},${pnlStr},"${escapedReasoning}"\n`;

    // 1. Write to Excel Ledger CSV File
    try {
      if (isNew) {
        fs.writeFileSync(filePath, headers + row, "utf8");
      } else {
        fs.appendFileSync(filePath, row, "utf8");
      }
      console.log(`[ExcelLogger] Trade logs logged successfully to CSV: ${filePath}`);
    } catch (e: any) {
      console.error("[ExcelLogger] Failed to write trade log to excel ledger:", e.message);
    }

    // 2. ALSO Persist simultaneously into SQLite Database (paper_trades table)
    try {
      DatabaseService.logPaperTrade({
        type,
        symbol,
        strike,
        qty,
        price,
        stopLoss: additionalData.sl,
        target1: additionalData.t1,
        target2: additionalData.t2,
        pnl: pnlVal,
        reasoning,
        marketRegime: additionalData.marketRegime,
        confluenceScore: additionalData.confluenceScore
      });
      console.log(`[ExcelLogger] Trade logged successfully into SQLite Database (paper_trades table).`);
    } catch (e: any) {
      console.error("[ExcelLogger] Failed to log paper trade to database:", e.message);
    }
  }
}
