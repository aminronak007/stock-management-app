import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";

export interface PaperTradeRecord {
  id: number;
  timestamp: number;
  datetime: string;
  type: string;
  symbol: string;
  strike?: string;
  qty: number;
  price: number;
  stop_loss?: number;
  target1?: number;
  target2?: number;
  invested_capital: number;
  pnl?: number;
  pnl_percent?: number;
  reasoning: string;
  market_regime?: string;
  confluence_score?: number;
  status: string;
}

export interface TradeAnalytics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRatePercent: number;
  totalPnl: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  target1HitRate: number;
  target2HitRate: number;
  callWinRate: number;
  putWinRate: number;
  suggestedTargetMultiplier: number;
  suggestedScoreBias: number;
}

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

    // 4. Paper Trading Trades Table (comprehensive trade ledger)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS paper_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        datetime TEXT NOT NULL,
        type TEXT NOT NULL,
        symbol TEXT NOT NULL,
        strike TEXT,
        qty INTEGER NOT NULL,
        price REAL NOT NULL,
        stop_loss REAL,
        target1 REAL,
        target2 REAL,
        invested_capital REAL NOT NULL,
        pnl REAL,
        pnl_percent REAL,
        reasoning TEXT,
        market_regime TEXT,
        confluence_score REAL,
        status TEXT DEFAULT 'CLOSED'
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

  public static logPaperTrade(data: {
    type: string;
    symbol: string;
    strike?: number | string;
    qty: number;
    price: number;
    stopLoss?: number;
    target1?: number;
    target2?: number;
    pnl?: number;
    reasoning: string;
    marketRegime?: string;
    confluenceScore?: number;
  }): void {
    const db = this.initialize();
    const timestamp = Date.now();
    const datetime = new Date().toLocaleString("en-IN");
    const investedCapital = data.price * data.qty;
    
    // Calculate PnL percentage if PnL is present
    let pnlPercent: number | null = null;
    if (data.pnl !== undefined && investedCapital > 0) {
      pnlPercent = (data.pnl / investedCapital) * 100;
    }

    const stmt = db.prepare(`
      INSERT INTO paper_trades (
        timestamp, datetime, type, symbol, strike, qty, price,
        stop_loss, target1, target2, invested_capital, pnl, pnl_percent,
        reasoning, market_regime, confluence_score, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      timestamp,
      datetime,
      data.type,
      data.symbol,
      data.strike ? String(data.strike) : null,
      data.qty,
      data.price,
      data.stopLoss ?? null,
      data.target1 ?? null,
      data.target2 ?? null,
      investedCapital,
      data.pnl !== undefined ? data.pnl : null,
      pnlPercent,
      data.reasoning,
      data.marketRegime ?? null,
      data.confluenceScore ?? null,
      data.type.includes("BUY") ? "OPEN" : "CLOSED"
    );
  }

  public static getPaperTrades(limit: number = 100): PaperTradeRecord[] {
    const db = this.initialize();
    return db.prepare("SELECT * FROM paper_trades ORDER BY id DESC LIMIT ?").all(limit) as PaperTradeRecord[];
  }

  /**
   * Evaluates historical paper trade statistics to feed back into QuantitativeEngine
   * for adaptive target scaling and higher probability accuracy.
   */
  public static getTradeAnalytics(): TradeAnalytics {
    const db = this.initialize();
    const trades = db.prepare("SELECT * FROM paper_trades WHERE pnl IS NOT NULL").all() as PaperTradeRecord[];

    let totalPnl = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let breakevenTrades = 0;
    let grossWins = 0;
    let grossLosses = 0;
    let largestWin = 0;
    let largestLoss = 0;

    let target1Hits = 0;
    let target2Hits = 0;
    let callWins = 0;
    let callTrades = 0;
    let putWins = 0;
    let putTrades = 0;

    trades.forEach((t) => {
      const pnl = t.pnl || 0;
      totalPnl += pnl;

      if (pnl > 0) {
        winningTrades++;
        grossWins += pnl;
        largestWin = Math.max(largestWin, pnl);
      } else if (pnl < 0) {
        losingTrades++;
        grossLosses += Math.abs(pnl);
        largestLoss = Math.min(largestLoss, pnl);
      } else {
        breakevenTrades++;
      }

      if (t.reasoning && t.reasoning.includes("Target 1")) target1Hits++;
      if (t.reasoning && (t.reasoning.includes("Target 2") || t.type === "EXIT_PROFIT")) target2Hits++;

      if (t.type.includes("CALL") || (t.symbol && t.symbol.includes("CE"))) {
        callTrades++;
        if (pnl > 0) callWins++;
      } else if (t.type.includes("PUT") || (t.symbol && t.symbol.includes("PE"))) {
        putTrades++;
        if (pnl > 0) putWins++;
      }
    });

    const totalCount = trades.length;
    const winRatePercent = totalCount > 0 ? (winningTrades / totalCount) * 100 : 0;
    const profitFactor = grossLosses > 0 ? (grossWins / grossLosses) : (grossWins > 0 ? 3.0 : 1.0);
    const avgWin = winningTrades > 0 ? (grossWins / winningTrades) : 0;
    const avgLoss = losingTrades > 0 ? (grossLosses / losingTrades) : 0;
    const target1HitRate = totalCount > 0 ? (target1Hits / totalCount) * 100 : 0;
    const target2HitRate = totalCount > 0 ? (target2Hits / totalCount) * 100 : 0;
    const callWinRate = callTrades > 0 ? (callWins / callTrades) * 100 : 50;
    const putWinRate = putTrades > 0 ? (putWins / putTrades) * 100 : 50;

    // Adaptive Machine Learning calibration:
    // If win rate is > 65%, expand target multiplier slightly to capture bigger runners (e.g. 1.1x).
    // If win rate is lower (< 45%), contract targets to lock in conservative profits faster (e.g. 0.85x).
    let suggestedTargetMultiplier = 1.0;
    let suggestedScoreBias = 0;

    if (totalCount >= 5) {
      if (winRatePercent >= 65) {
        suggestedTargetMultiplier = 1.15;
        suggestedScoreBias = 5; // boost score
      } else if (winRatePercent < 45) {
        suggestedTargetMultiplier = 0.85; // take quicker conservative target
        suggestedScoreBias = -5; // require higher confluence
      }
    }

    return {
      totalTrades: totalCount,
      winningTrades,
      losingTrades,
      breakevenTrades,
      winRatePercent,
      totalPnl,
      profitFactor,
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      target1HitRate,
      target2HitRate,
      callWinRate,
      putWinRate,
      suggestedTargetMultiplier,
      suggestedScoreBias
    };
  }
}
