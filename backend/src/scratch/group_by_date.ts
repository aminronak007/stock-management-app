import Database from "better-sqlite3";
import * as path from "path";

const dbPath = path.resolve(__dirname, "../../data/state.db");
const db = new Database(dbPath, { readonly: true });

const rows = db.prepare(`SELECT * FROM paper_trades ORDER BY id ASC`).all();
console.log(`Total paper_trades in DB: ${rows.length}`);

// Group by Date in IST
const byDate: Record<string, any[]> = {};
for (const r of rows) {
  const d = new Date(r.timestamp);
  const istDate = d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
  if (!byDate[istDate]) byDate[istDate] = [];
  byDate[istDate].push(r);
}

for (const [date, trs] of Object.entries(byDate)) {
  console.log(`\n======================================================`);
  console.log(`DATE: ${date} (Total rows: ${trs.length})`);
  console.log(`======================================================`);
  const entries = trs.filter(t => t.type.includes("BUY"));
  const exits = trs.filter(t => !t.type.includes("BUY"));
  console.log(`Entries: ${entries.length}, Exits: ${exits.length}`);
  
  let dayGrossPnl = 0;
  let dayNetPnl = 0;
  let dayFees = 0;
  
  for (const ex of exits) {
    dayGrossPnl += ex.pnl || 0;
    dayNetPnl += ex.net_pnl || 0;
    dayFees += ex.fees || 0;
    const parent = entries.find(e => e.id === ex.parent_trade_id);
    const entryPrice = parent ? parent.price : ex.entry_price;
    const exitPrice = ex.price;
    const durationMins = parent ? ((ex.timestamp - parent.timestamp) / 60000).toFixed(1) : "?";
    
    console.log(`  -> EXIT [${ex.type}] | Tier: ${ex.tier} | Strike: ${ex.strike} | Entry: ${entryPrice} | Exit: ${exitPrice} | PnL: ${ex.pnl?.toFixed(2)} | Net: ${ex.net_pnl?.toFixed(2)} | Duration: ${durationMins}m | Reason: ${ex.reasoning}`);
  }
  
  console.log(`------------------------------------------------------`);
  console.log(`Day Gross PnL: ${dayGrossPnl.toFixed(2)} | Fees: ${dayFees.toFixed(2)} | Day Net PnL: ${dayNetPnl.toFixed(2)}`);
}

db.close();
