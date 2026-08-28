import Database from "better-sqlite3";
import * as path from "path";

const dbPath = path.resolve(__dirname, "../../data/state.db");
const db = new Database(dbPath, { readonly: true });

console.log("=== TODAY (28th AUG) MARKET QUOTES ===");
try {
  const quotes = db.prepare("SELECT * FROM market_quotes").all();
  console.table(quotes);
} catch (e) {
  console.error("Error fetching market_quotes:", e);
}

console.log("\n=== TODAY (28th AUG) SIGNALS ===");
try {
  const signals = db.prepare(`
    SELECT * FROM advisory_signals
    WHERE datetime(timestamp/1000, 'unixepoch', '+5 hours', '30 minutes') LIKE '2026-08-28%'
       OR timestamp > 1787880000000
    ORDER BY id ASC
  `).all();
  console.table(signals);
} catch (e) {
  console.error("Error fetching advisory signals:", e);
}

console.log("\n=== TODAY (28th AUG) PAPER TRADES ===");
try {
  const trades = db.prepare(`
    SELECT * FROM paper_trades
    WHERE datetime LIKE '28%' OR datetime LIKE '%28/08%' OR datetime LIKE '%28-08%' OR timestamp > 1787880000000
    ORDER BY id ASC
  `).all();
  console.table(trades);
} catch (e) {
  console.error("Error fetching paper trades:", e);
}

db.close();
