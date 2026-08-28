import Database from "better-sqlite3";
import * as path from "path";

const dbPath = path.resolve(__dirname, "../../data/state.db");
const db = new Database(dbPath);

console.log("=== REMOVING MOCK TEST ROWS ===");

const delSignals = db.prepare(`
  DELETE FROM advisory_signals 
  WHERE id IN (63, 64) 
     OR (reasoning LIKE '%24035.0%' AND timestamp BETWEEN 1787889900000 AND 1787890000000)
`).run();
console.log(`Deleted ${delSignals.changes} mock test rows from advisory_signals.`);

const delTrades = db.prepare(`
  DELETE FROM paper_trades 
  WHERE id IN (84, 85) 
     OR (symbol = 'NSE:NIFTY2690124050PE' AND entry_spot = 24035)
`).run();
console.log(`Deleted ${delTrades.changes} mock test rows from paper_trades.`);

console.log("\nAll today's advisory signals:");
const signals = db.prepare("SELECT * FROM advisory_signals ORDER BY id DESC LIMIT 10").all();
console.table(signals);

console.log("\nAll today's paper trades:");
const trades = db.prepare("SELECT * FROM paper_trades ORDER BY id DESC LIMIT 10").all();
console.table(trades);

db.close();
