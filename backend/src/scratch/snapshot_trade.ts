import Database from "better-sqlite3";
import * as path from "path";

const dbPath = path.resolve(__dirname, "../../data/state.db");
const db = new Database(dbPath, { readonly: true });

const trade = db.prepare("SELECT * FROM paper_trades WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1").get() as any;
const quotes = db.prepare("SELECT * FROM market_quotes").all() as any[];

console.log("=== LIVE TRADE SNAPSHOT ===");
console.log(trade);

const niftyQuote = quotes.find(q => q.symbol === "NSE:NIFTY50-INDEX");
console.log(`\nNIFTY 50 Spot: ${niftyQuote?.ltp} (${niftyQuote?.net_change_percent}%)`);

db.close();
