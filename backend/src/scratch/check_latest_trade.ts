import Database from "better-sqlite3";
import * as path from "path";

const dbPath = path.resolve(__dirname, "../../data/state.db");
const db = new Database(dbPath, { readonly: true });

console.log("=== LATEST ADVISORY SIGNAL FIRED ===");
const signal = db.prepare("SELECT * FROM advisory_signals ORDER BY id DESC LIMIT 1").get();
console.log(signal);

console.log("\n=== LATEST OPEN PAPER TRADE ===");
const trade = db.prepare("SELECT * FROM paper_trades WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1").get();
console.log(trade);

db.close();
