import Database from "better-sqlite3";
import * as path from "path";

const dbPath = path.resolve(__dirname, "../../data/state.db");
const db = new Database(dbPath, { readonly: true });

const ids = db.prepare(`SELECT id, timestamp, datetime, type, tier, symbol, price, pnl, net_pnl FROM paper_trades ORDER BY id ASC`).all();
console.table(ids);

db.close();
