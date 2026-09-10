import { DatabaseService } from "../utils/database";

function inspectEngine() {
  const db = DatabaseService.getInstance();
  const trades = db.getAllTrades();
  console.log("Total trades in DB:", trades.length);
  const todayTrades = trades.filter(t => t.entry_time && t.entry_time.startsWith("2026-09-10"));
  console.log("Today's trades count:", todayTrades.length);
  if (todayTrades.length > 0) {
    console.log("Today trades:", todayTrades);
  }
}

inspectEngine();
