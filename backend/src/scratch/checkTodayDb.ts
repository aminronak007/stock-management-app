import { DatabaseService } from "../utils/database";

const db = DatabaseService.initialize();
console.log("=== DB Tables ===");
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log(tables);

console.log("\n=== All Paper Trades ===");
const paperTrades = db.prepare("SELECT * FROM paper_trades").all();
console.log(paperTrades);

console.log("\n=== Session Risk ===");
const risk = db.prepare("SELECT * FROM session_risk").all();
console.log(risk);
