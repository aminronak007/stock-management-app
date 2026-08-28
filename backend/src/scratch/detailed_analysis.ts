import Database from "better-sqlite3";
import * as path from "path";

const dbPath = path.resolve(__dirname, "../../data/state.db");
const db = new Database(dbPath, { readonly: true });

const paperTrades = db.prepare(`SELECT * FROM paper_trades ORDER BY id ASC`).all();
const signals = db.prepare(`SELECT * FROM advisory_signals ORDER BY id ASC`).all();

console.log("=== COMPREHENSIVE TRADE AUDIT: 25th - 27th AUG ===");

const targetDays = ["25/8/2026", "26/8/2026", "27/8/2026", "27-08-2026", "2026-08-25", "2026-08-26", "2026-08-27"];

const relevantTrades = paperTrades.filter(t => {
  const d = new Date(t.timestamp);
  const istStr = d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  return istStr.includes("25/8") || istStr.includes("26/8") || istStr.includes("27/8") ||
         istStr.includes("25/08") || istStr.includes("26/08") || istStr.includes("27/08");
});

console.log(`Found ${relevantTrades.length} paper trade records across 25th - 27th Aug.`);

// Group into trade pairs (Entry -> Exit)
const entries = relevantTrades.filter(t => t.type.includes("BUY"));
const exits = relevantTrades.filter(t => !t.type.includes("BUY"));

console.log("\n--- TRADE PAIR BREAKDOWN ---");
for (const entry of entries) {
  const matchingExit = exits.find(e => e.parent_trade_id === entry.id || (e.tier === entry.tier && Math.abs(e.timestamp - entry.timestamp) < 3600000 && e.timestamp >= entry.timestamp));
  const entryDate = new Date(entry.timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const exitDate = matchingExit ? new Date(matchingExit.timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "OPEN / NONE";
  const durationMin = matchingExit ? ((matchingExit.timestamp - entry.timestamp) / 60000).toFixed(1) : "N/A";
  
  console.log(`\nTRADE #${entry.id}: [${entry.tier}] ${entry.type} (${entry.symbol})`);
  console.log(`  Entry: ${entryDate} @ ₹${entry.price} (Qty: ${entry.qty}, Invested: ₹${entry.invested_capital})`);
  console.log(`  SL: ₹${entry.stop_loss} | T1: ₹${entry.target1} | T2: ₹${entry.target2}`);
  console.log(`  Regime: ${entry.market_regime} | Confluence Score: ${entry.confluence_score}/100`);
  console.log(`  Reason: ${entry.reasoning}`);
  if (matchingExit) {
    console.log(`  Exit: ${exitDate} (${matchingExit.type}) @ ₹${matchingExit.price} [Duration: ${durationMin} mins]`);
    console.log(`  Gross P&L: ₹${matchingExit.pnl?.toFixed(2)} | Fees: ₹${matchingExit.fees?.toFixed(2)} | Net P&L: ₹${matchingExit.net_pnl?.toFixed(2)} (${matchingExit.pnl_percent?.toFixed(2)}%)`);
    console.log(`  Exit Reason: ${matchingExit.reasoning}`);
  } else {
    console.log(`  Exit: No matching exit found in DB.`);
  }
}

db.close();
