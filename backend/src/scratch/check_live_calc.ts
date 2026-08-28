import Database from "better-sqlite3";
import * as path from "path";
import { QuantitativeEngine } from "../utils/quantitativeEngine";
import { CPR } from "../utils/cpr";

const dbPath = path.resolve(__dirname, "../../data/state.db");
const db = new Database(dbPath, { readonly: true });

console.log("=== CHECKING LIVE QUOTES IN SQLITE ===");
const quotes = db.prepare("SELECT * FROM market_quotes").all();
console.table(quotes);

// Fetch recent settings or cache if available
const settings = db.prepare("SELECT * FROM settings").all();
console.table(settings);

db.close();
