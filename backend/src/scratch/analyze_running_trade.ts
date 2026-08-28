import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, "../../.env") });

import Database from "better-sqlite3";
import { BrokerFactory } from "../adapters/BrokerFactory";
import { FyersAdapter } from "../adapters/FyersAdapter";

const dbPath = path.resolve(__dirname, "../../data/state.db");
const db = new Database(dbPath, { readonly: true });

async function analyzeTrade() {
  const trade = db.prepare("SELECT * FROM paper_trades WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1").get() as any;
  const quotes = db.prepare("SELECT * FROM market_quotes").all() as any[];

  console.log("=== CURRENT ACTIVE PAPER TRADE ===");
  console.log(trade);

  const adapter = BrokerFactory.getAdapter() as FyersAdapter;
  await adapter.initialize();

  const niftyQuote = quotes.find(q => q.symbol === "NSE:NIFTY50-INDEX");
  const bankNiftyQuote = quotes.find(q => q.symbol === "NSE:NIFTYBANK-INDEX");
  const relianceQuote = quotes.find(q => q.symbol === "NSE:RELIANCE-EQ");
  const hdfcQuote = quotes.find(q => q.symbol === "NSE:HDFCBANK-EQ");
  const iciciQuote = quotes.find(q => q.symbol === "NSE:ICICIBANK-EQ");

  console.log("\n=== MARKET UNDERLYING METRICS ===");
  console.log(`NIFTY 50 Spot: ${niftyQuote?.ltp} (${niftyQuote?.net_change_percent}%)`);
  console.log(`BANK NIFTY:    ${bankNiftyQuote?.ltp} (${bankNiftyQuote?.net_change_percent}%)`);
  console.log(`RELIANCE:      ${relianceQuote?.ltp} (${relianceQuote?.net_change_percent}%)`);
  console.log(`HDFC BANK:     ${hdfcQuote?.ltp} (${hdfcQuote?.net_change_percent}%)`);
  console.log(`ICICI BANK:    ${iciciQuote?.ltp} (${iciciQuote?.net_change_percent}%)`);

  db.close();
}

analyzeTrade().catch(console.error);
