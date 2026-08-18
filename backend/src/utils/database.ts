import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";

export class DatabaseService {
  private static db: Database.Database | null = null;

  public static initialize(): Database.Database {
    if (this.db) return this.db;

    const dbDir = path.join(__dirname, "../../data");
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const dbPath = path.join(dbDir, "state.db");
    console.log(`[Database] Initializing SQLite database at: ${dbPath}`);

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL"); // Write-Ahead Logging for high concurrency

    this.createTables();

    return this.db;
  }

  private static createTables(): void {
    if (!this.db) return;

    // 1. Settings Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // 2. Broker Sessions Table (caches tokens valid for 24 hours)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        provider TEXT PRIMARY KEY,
        access_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);

    // 3. Advisory Signals Table (log trace)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS advisory_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        strike_price REAL,
        entry_price REAL,
        stop_loss_price REAL,
        target_price1 REAL,
        target_price2 REAL,
        reasoning TEXT
      )
    `);

    console.log("[Database] Database tables verified/created successfully.");
  }

  public static saveSession(provider: string, token: string, expiresAt: number): void {
    const db = this.initialize();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO sessions (provider, access_token, expires_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(provider, token, expiresAt);
  }

  public static getSession(provider: string): { access_token: string, expires_at: number } | null {
    const db = this.initialize();
    const stmt = db.prepare(`
      SELECT access_token, expires_at FROM sessions WHERE provider = ?
    `);
    const row = stmt.get(provider) as { access_token: string, expires_at: number } | undefined;
    return row || null;
  }

  public static clearSession(provider: string): void {
    const db = this.initialize();
    db.prepare("DELETE FROM sessions WHERE provider = ?").run(provider);
  }

  public static logSignal(
    type: string,
    strike: number | undefined,
    entry: number | undefined,
    sl: number | undefined,
    t1: number | undefined,
    t2: number | undefined,
    reasoning: string
  ): void {
    const db = this.initialize();
    const stmt = db.prepare(`
      INSERT INTO advisory_signals (timestamp, type, strike_price, entry_price, stop_loss_price, target_price1, target_price2, reasoning)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(Date.now(), type, strike ?? null, entry ?? null, sl ?? null, t1 ?? null, t2 ?? null, reasoning);
  }
}
