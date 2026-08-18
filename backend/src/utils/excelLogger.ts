import * as fs from "fs";
import * as path from "path";

export class ExcelLogger {
  private static getLogDirectory(): string {
    const today = new Date();
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayName = days[today.getDay()];
    const dateStr = today.toISOString().split("T")[0]; // YYYY-MM-DD
    
    // Path: workspace_root/Stock Mock/Day_YYYY-MM-DD (outside backend folder)
    const rootPath = "d:/Web Development/My Projects/stock-management-app";
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

    try {
      if (isNew) {
        fs.writeFileSync(filePath, headers + row, "utf8");
      } else {
        fs.appendFileSync(filePath, row, "utf8");
      }
      console.log(`[ExcelLogger] Trade logs logged successfully to: ${filePath}`);
    } catch (e: any) {
      console.error("[ExcelLogger] Failed to write trade log to excel ledger:", e.message);
    }
  }
}
