import Database from "better-sqlite3";
import * as path from "path";

const dbPath = path.resolve(__dirname, "../../data/state.db");
const db = new Database(dbPath, { readonly: true });

console.log("================== PAPER TRADES (2026-08-25 to 2026-08-28) ==================");
const trades = db.prepare(`
  SELECT id, timestamp, datetime, type, tier, symbol, strike, qty, price, stop_loss, target1, target2,
         invested_capital, pnl, pnl_percent, fees, net_pnl, reasoning, market_regime, confluence_score,
         status, entry_spot, peak_premium, is_breakeven_locked, is_target1_locked, parent_trade_id, entry_price
  FROM paper_trades
  WHERE datetime >= '2026-08-25'
  ORDER BY id ASC
`).all();

console.log(JSON.stringify(trades, null, 2));

console.log("\n================== DETAILED SUMMARY BY DAY ==================");
for (const day of ['2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28']) {
  const dayTrades = db.prepare(`
    SELECT * FROM paper_trades WHERE datetime LIKE '${day}%' ORDER BY id ASC
  `).all();
  console.log(`\n--- Day: ${day} (Total Records: ${dayTrades.length}) ---`);
  for (const t of dayTrades) {
    console.log(`ID ${t.id} | ${t.datetime} | Tier: ${t.tier} | Type: ${t.type} | Strike: ${t.strike} | Price: ${t.price} | SL: ${t.stop_loss} | T1: ${t.target1} | PnL: ${t.pnl} | NetPnL: ${t.net_pnl} | Status: ${t.status} | PeakPrem: ${t.peak_premium}`);
    console.log(`   Reasoning: ${t.reasoning}`);
  }
}

db.close();
