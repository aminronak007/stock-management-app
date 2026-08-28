import Database from "better-sqlite3";
import * as path from "path";

const dbPath = path.resolve(__dirname, "../../data/state.db");
const db = new Database(dbPath, { readonly: true });

console.log("================== PAPER TRADES SUMMARY ==================");
const dateCounts = db.prepare(`
  SELECT substr(datetime, 1, 10) as date_str, COUNT(*) as total_records,
         SUM(CASE WHEN type LIKE '%BUY%' THEN 1 ELSE 0 END) as total_entries,
         SUM(CASE WHEN type NOT LIKE '%BUY%' THEN 1 ELSE 0 END) as total_exits,
         SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_exits,
         SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losing_exits,
         ROUND(SUM(pnl), 2) as sum_pnl,
         ROUND(SUM(net_pnl), 2) as sum_net_pnl
  FROM paper_trades
  GROUP BY date_str
  ORDER BY date_str DESC
`).all();
console.table(dateCounts);

console.log("\n================== DETAILED TRADES (25th to 27th Aug) ==================");
const detailedTrades = db.prepare(`
  SELECT id, datetime, type, tier, symbol, strike, qty, price, stop_loss, target1, target2,
         invested_capital, pnl, pnl_percent, fees, net_pnl, market_regime, confluence_score,
         status, entry_spot, peak_premium, reasoning
  FROM paper_trades
  WHERE datetime >= '2026-08-25' OR datetime >= '25' OR timestamp > 1787000000000
  ORDER BY id ASC
`).all();

console.log(`Total records found: ${detailedTrades.length}`);
for (const t of detailedTrades) {
  console.log(`[#${t.id}] ${t.datetime} | Tier: ${t.tier} | Type: ${t.type} | Symbol: ${t.symbol} | Strike: ${t.strike} | Price: ${t.price} | SL: ${t.stop_loss?.toFixed?.(2) ?? t.stop_loss} | T1: ${t.target1?.toFixed?.(2) ?? t.target1} | PnL: ${t.pnl} | NetPnL: ${t.net_pnl} | Regime: ${t.market_regime} | Conf: ${t.confluence_score}`);
  console.log(`     Reason: ${t.reasoning}`);
}

console.log("\n================== ALL CLOSED EXIT TRADES WITH PNL ==================");
const exitTrades = db.prepare(`
  SELECT id, datetime, type, tier, symbol, price, pnl, pnl_percent, fees, net_pnl, reasoning
  FROM paper_trades
  WHERE type NOT LIKE '%BUY%'
  ORDER BY id ASC
`).all();
console.table(exitTrades);

console.log("\n================== ADVISORY SIGNALS BREAKDOWN ==================");
const signals = db.prepare(`
  SELECT id, datetime(timestamp/1000, 'unixepoch', '+5 hours', '30 minutes') as ist_time,
         type, tier, strike_price, entry_price, stop_loss_price, target_price1, target_price2, reasoning
  FROM advisory_signals
  ORDER BY id ASC
`).all();
console.table(signals);

db.close();
