import Database from "better-sqlite3";
import * as path from "path";

const dbPath = path.resolve(__dirname, "../../data/state.db");
const db = new Database(dbPath, { readonly: true });

const signals = db.prepare(`SELECT * FROM advisory_signals ORDER BY id ASC`).all();
console.log(`Total advisory signals: ${signals.length}`);

for (const s of signals) {
  const d = new Date(s.timestamp);
  const ist = d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  console.log(`[Signal #${s.id}] ${ist} | Type: ${s.type} | Tier: ${s.tier} | Strike: ${s.strike_price} | Entry: ${s.entry_price} | SL: ${s.stop_loss_price?.toFixed(2)} | T1: ${s.target_price1?.toFixed(2)} | T2: ${s.target_price2?.toFixed(2)}`);
  console.log(`   Reason: ${s.reasoning}`);
}

db.close();
