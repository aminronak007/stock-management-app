import Database from "better-sqlite3";
import * as path from "path";

const dbPath = path.resolve(__dirname, "../../data/state.db");
const db = new Database(dbPath, { readonly: true });

const latestTrade = db.prepare("SELECT * FROM paper_trades ORDER BY id DESC LIMIT 1").get() as any;
console.log("=== LATEST TRADE STATUS ===");
console.log(latestTrade);

const latestSignal = db.prepare("SELECT * FROM advisory_signals ORDER BY id DESC LIMIT 1").get() as any;
console.log("\n=== LATEST SIGNAL ===");
console.log(latestSignal);

db.close();
