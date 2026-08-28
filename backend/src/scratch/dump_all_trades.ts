import Database from "better-sqlite3";
import * as path from "path";

const dbPath = path.resolve(__dirname, "../../data/state.db");
const db = new Database(dbPath, { readonly: true });

const rows = db.prepare(`SELECT * FROM paper_trades ORDER BY id ASC`).all();
console.log(`Total paper_trades in DB: ${rows.length}`);

for (const r of rows) {
  const d = new Date(r.timestamp);
  const ist = d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  console.log(`ID: ${r.id} | Timestamp: ${r.timestamp} (${ist}) | stored dt: "${r.datetime}" | Type: ${r.type} | Tier: ${r.tier} | Strike: ${r.strike} | Price: ${r.price} | SL: ${r.stop_loss} | T1: ${r.target1} | PnL: ${r.pnl} | NetPnL: ${r.net_pnl} | Fees: ${r.fees} | Status: ${r.status}`);
  console.log(`   Reason: ${r.reasoning}`);
}

db.close();
