import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";

export type SignalTier = "SNIPER" | "BALANCED" | "EXPLORATORY";

export interface PaperTradeRecord {
  id: number;
  timestamp: number;
  datetime: string;
  type: string;
  tier?: SignalTier;
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
  fees?: number;
  net_pnl?: number;
  reasoning: string;
  market_regime?: string;
  confluence_score?: number;
  status: string;
  entry_spot?: number;
  peak_premium?: number;
  is_breakeven_locked?: number;
  is_target1_locked?: number;
  parent_trade_id?: number;
  entry_price?: number;
  is_runner?: number;
  partial_exit_price?: number;
  initial_stop_loss?: number;
}

export interface PostExitRecord {
  id?: number;
  trade_id: number;
  symbol: string;
  exit_price: number;
  exit_timestamp: number;
  exit_datetime: string;
  tier?: string;
  mfe_price?: number;
  mfe_percent?: number;
  price_5m?: number;
  price_15m?: number;
  price_30m?: number;
  price_60m?: number;
  eod_price?: number;
  updated_at?: number;
}

export interface MarketQuoteRecord {
  symbol: string;
  ltp: number;
  prev_close: number;
  net_change: number;
  net_change_percent: number;
  volume?: number;
  updated_at: number;
}

export interface SessionRiskSnapshot {
  dailyTradesCount: number;
  dailyLossesCount: number;
  dailyProfitLoss: number;
  stoppedCooldownUntil: number;
}

export interface TradeAnalytics {
  tier?: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRatePercent: number;
  totalPnl: number;
  totalGrossPnl?: number;
  totalFees?: number;
  totalNetPnl?: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  target1HitRate: number;
  target2HitRate: number;
  stopLossHitRate?: number;
  trailingStopHitRate?: number;
  avgTradeDurationMinutes?: number;
  dailyDrawdownLimit?: number;
  dailyLossLimitReached?: boolean;
  consecutiveLosses?: number;
  callWinRate: number;
  putWinRate: number;
  suggestedTargetMultiplier: number;
  suggestedScoreBias: number;
}

export class DatabaseService {
  private static db: Database.Database | null = null;
  private static dbPath: string = path.resolve(process.cwd(), "data/state.db");

  public static initialize(): Database.Database {
    if (this.db) return this.db;

    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    console.log(`[Database] Initializing SQLite database at: ${this.dbPath}`);
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("temp_store = MEMORY");
    this.db.pragma("busy_timeout = 10000"); // 10s wait for locks on Linux/servers to prevent SQLITE_BUSY
    this.db.pragma("cache_size = -64000"); // 64MB fast RAM cache
    this.db.pragma("mmap_size = 268435456"); // 256MB Memory-Mapped I/O for instant reads

    this.createTables();

    return this.db;
  }

  private static createTables(): void {
    if (!this.db) return;

    // 1. Settings Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
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

    // 3. Dynamic Market Quotes & Prev Closes Cache (Persistent across sessions/restarts)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS market_quotes (
        symbol TEXT PRIMARY KEY,
        ltp REAL NOT NULL,
        prev_close REAL NOT NULL,
        net_change REAL NOT NULL,
        net_change_percent REAL NOT NULL,
        volume INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL
      )
    `);

    // 4. Advisory Signals Table (log trace)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS advisory_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        tier TEXT DEFAULT 'SNIPER',
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
        tier TEXT DEFAULT 'SNIPER',
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
        fees REAL DEFAULT 0.0,
        net_pnl REAL,
        reasoning TEXT,
        market_regime TEXT,
        confluence_score REAL,
        status TEXT DEFAULT 'CLOSED'
      )
    `);

    // Column migrations for existing tables
    try {
      this.db.exec("ALTER TABLE paper_trades ADD COLUMN tier TEXT DEFAULT 'SNIPER'");
    } catch {}
    try {
      this.db.exec("ALTER TABLE paper_trades ADD COLUMN fees REAL DEFAULT 0.0");
    } catch {}
    try {
      this.db.exec("ALTER TABLE paper_trades ADD COLUMN net_pnl REAL");
    } catch {}
    try {
      this.db.exec("ALTER TABLE advisory_signals ADD COLUMN tier TEXT DEFAULT 'SNIPER'");
    } catch {}
    try {
      this.db.exec("ALTER TABLE paper_trades ADD COLUMN entry_spot REAL");
    } catch {}
    try {
      this.db.exec("ALTER TABLE paper_trades ADD COLUMN peak_premium REAL");
    } catch {}
    try {
      this.db.exec("ALTER TABLE paper_trades ADD COLUMN is_breakeven_locked INTEGER DEFAULT 0");
    } catch {}
    try {
      this.db.exec("ALTER TABLE paper_trades ADD COLUMN is_target1_locked INTEGER DEFAULT 0");
    } catch {}
    try {
      this.db.exec("ALTER TABLE paper_trades ADD COLUMN parent_trade_id INTEGER");
    } catch {}
    try {
      this.db.exec("ALTER TABLE paper_trades ADD COLUMN entry_price REAL");
    } catch {}
    try {
      this.db.exec("ALTER TABLE paper_trades ADD COLUMN is_runner INTEGER DEFAULT 0");
    } catch {}
    try {
      this.db.exec("ALTER TABLE paper_trades ADD COLUMN partial_exit_price REAL");
    } catch {}
    try {
      this.db.exec("ALTER TABLE paper_trades ADD COLUMN initial_stop_loss REAL");
    } catch {}

    // Post-Exit Analytics Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS post_exit_analytics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id INTEGER,
        symbol TEXT NOT NULL,
        exit_price REAL NOT NULL,
        exit_timestamp INTEGER NOT NULL,
        exit_datetime TEXT NOT NULL,
        tier TEXT,
        mfe_price REAL,
        mfe_percent REAL,
        price_5m REAL,
        price_15m REAL,
        price_30m REAL,
        price_60m REAL,
        eod_price REAL,
        updated_at INTEGER
      )
    `);

    try {
      this.db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_trades_one_open_per_tier
        ON paper_trades(tier)
        WHERE status = 'OPEN' AND type LIKE '%BUY%'
      `);
    } catch (e) {
      console.warn("[Database] Could not create one-open-per-tier index:", e);
    }

    console.log("[Database] Database tables and tier schema verified/created successfully.");
  }

  public static isBuyType(type: string): boolean {
    return type.includes("BUY");
  }

  public static isExitType(type: string): boolean {
    return type === "EXIT_PROFIT"
      || type === "EXIT_STOP_LOSS"
      || type === "THETA_EXIT"
      || type === "SQUARE_OFF";
  }

  public static getIstDateKey(timestamp: number = Date.now()): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date(timestamp));
  }

  public static saveSession(provider: string, token: string, expiresAt: number): void {
    const db = this.initialize();
    const stmt = db.prepare(`
      INSERT INTO sessions (provider, access_token, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET
        access_token = excluded.access_token,
        expires_at = excluded.expires_at
    `);
    stmt.run(provider, token, expiresAt);
  }

  public static getSession(provider: string): { access_token: string; expires_at: number; accessToken: string; expiresAt: number } | null {
    const db = this.initialize();
    const row = db.prepare("SELECT access_token as access_token, expires_at as expires_at FROM sessions WHERE provider = ?").get(provider) as
      | { access_token: string; expires_at: number }
      | undefined;
    if (!row) return null;
    return {
      access_token: row.access_token,
      expires_at: row.expires_at,
      accessToken: row.access_token,
      expiresAt: row.expires_at
    };
  }

  public static clearSession(provider: string): void {
    const db = this.initialize();
    db.prepare("DELETE FROM sessions WHERE provider = ?").run(provider);
  }

  public static upsertMarketQuote(quote: {
    symbol: string;
    ltp: number;
    prevClose: number;
    netChange: number;
    netChangePercent: number;
    volume?: number;
    updatedAt?: number;
  }): void {
    const db = this.initialize();
    const stmt = db.prepare(`
      INSERT INTO market_quotes (symbol, ltp, prev_close, net_change, net_change_percent, volume, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        ltp = excluded.ltp,
        prev_close = excluded.prev_close,
        net_change = excluded.net_change,
        net_change_percent = excluded.net_change_percent,
        volume = excluded.volume,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      quote.symbol,
      quote.ltp,
      quote.prevClose,
      quote.netChange,
      quote.netChangePercent,
      quote.volume || 0,
      quote.updatedAt || Date.now()
    );
  }

  public static getMarketQuote(symbol: string): MarketQuoteRecord | null {
    const db = this.initialize();
    const row = db.prepare("SELECT * FROM market_quotes WHERE symbol = ?").get(symbol) as MarketQuoteRecord | undefined;
    return row || null;
  }

  public static getAllMarketQuotes(): { [symbol: string]: MarketQuoteRecord } {
    const db = this.initialize();
    const rows = db.prepare("SELECT * FROM market_quotes").all() as MarketQuoteRecord[];
    const map: { [symbol: string]: MarketQuoteRecord } = {};
    for (const r of rows) {
      map[r.symbol] = r;
    }
    return map;
  }

  public static logSignal(
    type: string,
    strike: number | undefined,
    entry: number | undefined,
    sl: number | undefined,
    t1: number | undefined,
    t2: number | undefined,
    reasoning: string,
    tier: SignalTier = "SNIPER"
  ): void {
    const db = this.initialize();
    const stmt = db.prepare(`
      INSERT INTO advisory_signals (
        timestamp, type, tier, strike_price, entry_price, stop_loss_price, target_price1, target_price2, reasoning
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(Date.now(), type, tier, strike ?? null, entry ?? null, sl ?? null, t1 ?? null, t2 ?? null, reasoning);
  }

  public static logPaperTrade(data: {
    type: string;
    tier?: SignalTier;
    symbol: string;
    strike?: number | string;
    qty: number;
    price: number;
    stopLoss?: number;
    target1?: number;
    target2?: number;
    pnl?: number;
    fees?: number;
    netPnl?: number;
    reasoning: string;
    marketRegime?: string;
    confluenceScore?: number;
    entrySpot?: number;
    peakPremium?: number;
    parentTradeId?: number;
    entryPrice?: number;
    isRunner?: boolean;
    partialExitPrice?: number;
    initialStopLoss?: number;
  }): number {
    const db = this.initialize();
    const timestamp = Date.now();
    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = now.getFullYear();
    const time = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
    const datetime = `${day}-${month}-${year}, ${time}`;
    const investedCapital = data.price * data.qty;
    const tier = data.tier || "SNIPER";
    
    // Calculate PnL percentage if PnL is present
    let pnlPercent: number | null = null;
    if (data.netPnl !== undefined && investedCapital > 0) {
      pnlPercent = (data.netPnl / investedCapital) * 100;
    } else if (data.pnl !== undefined && investedCapital > 0) {
      pnlPercent = (data.pnl / investedCapital) * 100;
    }

    const stmt = db.prepare(`
      INSERT INTO paper_trades (
        timestamp, datetime, type, tier, symbol, strike, qty, price,
        stop_loss, target1, target2, invested_capital, pnl, pnl_percent,
        fees, net_pnl, reasoning, market_regime, confluence_score, status,
        entry_spot, peak_premium, is_breakeven_locked, is_target1_locked,
        parent_trade_id, entry_price, is_runner, partial_exit_price, initial_stop_loss
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      timestamp,
      datetime,
      data.type,
      tier,
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
      data.fees ?? 0.0,
      data.netPnl !== undefined ? data.netPnl : null,
      data.reasoning,
      data.marketRegime ?? null,
      data.confluenceScore ?? null,
      this.isBuyType(data.type) ? "OPEN" : "CLOSED",
      data.entrySpot ?? null,
      data.peakPremium ?? data.price,
      0,
      0,
      data.parentTradeId ?? null,
      data.entryPrice ?? null,
      data.isRunner ? 1 : 0,
      data.partialExitPrice ?? null,
      data.initialStopLoss ?? (data.stopLoss ?? null)
    );
    return Number(result.lastInsertRowid);
  }

  public static updateOpenPaperTradeState(
    id: number,
    data: {
      stopLoss?: number;
      peakPremium?: number;
      isBreakevenLocked?: boolean;
      isTarget1Locked?: boolean;
      isRunner?: boolean;
      partialExitPrice?: number;
    }
  ): void {
    const db = this.initialize();
    db.prepare(`
      UPDATE paper_trades
      SET stop_loss = COALESCE(?, stop_loss),
          peak_premium = COALESCE(?, peak_premium),
          is_breakeven_locked = COALESCE(?, is_breakeven_locked),
          is_target1_locked = COALESCE(?, is_target1_locked),
          is_runner = COALESCE(?, is_runner),
          partial_exit_price = COALESCE(?, partial_exit_price)
      WHERE id = ? AND status = 'OPEN'
    `).run(
      data.stopLoss ?? null,
      data.peakPremium ?? null,
      data.isBreakevenLocked === undefined ? null : (data.isBreakevenLocked ? 1 : 0),
      data.isTarget1Locked === undefined ? null : (data.isTarget1Locked ? 1 : 0),
      data.isRunner === undefined ? null : (data.isRunner ? 1 : 0),
      data.partialExitPrice ?? null,
      id
    );
  }

  public static getSessionRiskByTier(now: number = Date.now()): { [tier in SignalTier]: SessionRiskSnapshot } {
    const empty = (): SessionRiskSnapshot => ({
      dailyTradesCount: 0,
      dailyLossesCount: 0,
      dailyProfitLoss: 0,
      stoppedCooldownUntil: 0
    });
    const snapshots: { [tier in SignalTier]: SessionRiskSnapshot } = {
      SNIPER: empty(),
      BALANCED: empty(),
      EXPLORATORY: empty()
    };

    const db = this.initialize();
    const today = this.getIstDateKey(now);
    const trades = db.prepare("SELECT * FROM paper_trades ORDER BY id ASC").all() as PaperTradeRecord[];

    for (const trade of trades) {
      if (this.getIstDateKey(trade.timestamp) !== today) continue;
      if (!this.isExitType(trade.type)) continue;
      const tier = (trade.tier as SignalTier) || "SNIPER";
      if (!snapshots[tier]) continue;
      const snap = snapshots[tier];
      snap.dailyTradesCount++;
      if (trade.type === "EXIT_STOP_LOSS") {
        snap.dailyLossesCount++;
        snap.dailyProfitLoss -= 1.0;
        snap.stoppedCooldownUntil = Math.max(snap.stoppedCooldownUntil, trade.timestamp + 15 * 60 * 1000);
      } else if (trade.type === "EXIT_PROFIT") {
        snap.dailyProfitLoss += 1.5;
        snap.stoppedCooldownUntil = Math.max(snap.stoppedCooldownUntil, trade.timestamp + 5 * 60 * 1000);
      } else {
        snap.stoppedCooldownUntil = Math.max(snap.stoppedCooldownUntil, trade.timestamp + 5 * 60 * 1000);
      }
    }

    return snapshots;
  }

  public static getDailyEntriesCountByDirection(
    tier: SignalTier,
    direction: "CALL_BUY" | "PUT_BUY",
    now: number = Date.now()
  ): number {
    const db = this.initialize();
    const today = this.getIstDateKey(now);
    const trades = db.prepare(
      "SELECT timestamp FROM paper_trades WHERE tier = ? AND type = ?"
    ).all(tier, direction) as { timestamp: number }[];

    return trades.filter(t => this.getIstDateKey(t.timestamp) === today).length;
  }

  public static getTodayRealizedPnl(now: number = Date.now(), tier?: string): number {
    const db = this.initialize();
    const today = this.getIstDateKey(now);
    let query = "SELECT * FROM paper_trades WHERE status = 'CLOSED'";
    const params: any[] = [];
    if (tier && tier !== "ALL") {
      query += " AND tier = ?";
      params.push(tier);
    }
    const trades = db.prepare(query).all(...params) as PaperTradeRecord[];
    let total = 0;
    for (const trade of trades) {
      if (!this.isExitType(trade.type)) continue; // Filter out entry BUY rows to prevent double counting
      if (this.getIstDateKey(trade.timestamp) === today) {
        if (trade.net_pnl !== undefined && trade.net_pnl !== null) {
          total += trade.net_pnl;
        } else if (trade.pnl !== undefined && trade.pnl !== null) {
          total += trade.pnl;
        }
      }
    }
    return parseFloat(total.toFixed(2));
  }

  public static getConsecutiveLossesCountByTier(
    tier: SignalTier,
    now: number = Date.now()
  ): number {
    const db = this.initialize();
    const today = this.getIstDateKey(now);
    const trades = db.prepare(
      "SELECT type, pnl, net_pnl, timestamp FROM paper_trades WHERE tier = ? ORDER BY id DESC"
    ).all(tier) as PaperTradeRecord[];

    let consecutiveLosses = 0;
    for (const t of trades) {
      if (this.getIstDateKey(t.timestamp) !== today) break;
      if (!this.isExitType(t.type)) continue;

      const pnlVal = t.net_pnl !== undefined && t.net_pnl !== null ? t.net_pnl : (t.pnl || 0);
      if (pnlVal < 0) {
        consecutiveLosses++;
      } else if (pnlVal > 0) {
        break; // Stop counting on first winning trade
      }
    }
    return consecutiveLosses;
  }

  /**
   * Returns total completed/realized distinct market setups across the session for the day
   */
  public static getDailyGlobalExitsCount(now: number = Date.now()): number {
    const db = this.initialize();
    const today = this.getIstDateKey(now);
    // Count distinct trade setups across all tiers globally
    const trades = db.prepare(
      "SELECT type, timestamp FROM paper_trades ORDER BY id ASC"
    ).all() as PaperTradeRecord[];

    let count = 0;
    for (const t of trades) {
      if (this.getIstDateKey(t.timestamp) === today && this.isExitType(t.type)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Returns consecutive trade setup losses across the session for the day globally across all tiers
   */
  public static getDailyGlobalConsecutiveLossesCount(now: number = Date.now()): number {
    const db = this.initialize();
    const today = this.getIstDateKey(now);
    const trades = db.prepare(
      "SELECT type, pnl, net_pnl, timestamp FROM paper_trades ORDER BY id DESC"
    ).all() as PaperTradeRecord[];

    let consecutiveLosses = 0;
    for (const t of trades) {
      if (this.getIstDateKey(t.timestamp) !== today) break;
      if (!this.isExitType(t.type)) continue;

      const pnlVal = t.net_pnl !== undefined && t.net_pnl !== null ? t.net_pnl : (t.pnl || 0);
      if (pnlVal < 0) {
        consecutiveLosses++;
      } else if (pnlVal > 0) {
        break; // Stop counting on first winning trade
      }
    }
    return consecutiveLosses;
  }

  /**
   * Evaluates if account-level daily trading limit (Max 5 trades) or 2-loss circuit breaker is engaged
   */
  public static isGlobalDailyTradingLocked(now: number = Date.now(), maxDailyTrades: number = 5): { locked: boolean; reason: string } {
    const exitsCount = this.getDailyGlobalExitsCount(now);
    if (exitsCount >= maxDailyTrades) {
      return {
        locked: true,
        reason: `Global Daily Trade Cap reached (${exitsCount}/${maxDailyTrades} completed trades). Trading locked to protect capital and prevent fee bleed.`
      };
    }

    const globalLosses = this.getDailyGlobalConsecutiveLossesCount(now);
    if (globalLosses >= 2) {
      return {
        locked: true,
        reason: "Global 2-Consecutive-Loss Circuit Breaker engaged. Trading locked for the remainder of the session."
      };
    }

    return { locked: false, reason: "" };
  }

  /**
   * Returns total cumulative net profit realized across all closed paper trades
   */
  public static getCumulativeNetProfit(): number {
    try {
      const db = this.initialize();
      const row = db.prepare(`
        SELECT COALESCE(SUM(CASE WHEN net_pnl IS NOT NULL THEN net_pnl ELSE pnl END), 0) as totalNet
        FROM paper_trades
        WHERE status = 'CLOSED' AND (type LIKE 'EXIT_%' OR type = 'SQUARE_OFF' OR type = 'THETA_EXIT')
      `).get() as { totalNet: number };
      return row ? row.totalNet : 0;
    } catch {
      return 0;
    }
  }

  public static markPaperTradeClosed(
    id: number,
    data: { pnl: number; fees?: number; netPnl?: number }
  ): void {
    const db = this.initialize();
    const row = db.prepare("SELECT invested_capital FROM paper_trades WHERE id = ?").get(id) as
      | { invested_capital: number }
      | undefined;
    const investedCapital = row?.invested_capital || 0;
    const netPnl = data.netPnl !== undefined ? data.netPnl : data.pnl;
    const pnlPercent = investedCapital > 0 ? (netPnl / investedCapital) * 100 : null;
    db.prepare(`
      UPDATE paper_trades
      SET status = 'CLOSED', pnl = ?, fees = ?, net_pnl = ?, pnl_percent = ?
      WHERE id = ?
    `).run(data.pnl, data.fees ?? 0.0, netPnl, pnlPercent, id);
  }

  public static getOpenBuyTrades(tier?: string): PaperTradeRecord[] {
    const db = this.initialize();
    if (tier && tier !== "ALL") {
      return db.prepare(
        "SELECT * FROM paper_trades WHERE status = 'OPEN' AND type LIKE '%BUY%' AND tier = ? ORDER BY id ASC"
      ).all(tier) as PaperTradeRecord[];
    }
    return db.prepare(
      "SELECT * FROM paper_trades WHERE status = 'OPEN' AND type LIKE '%BUY%' ORDER BY id ASC"
    ).all() as PaperTradeRecord[];
  }

  public static tierHasOpenBuy(tier: string): boolean {
    const db = this.initialize();
    const row = db.prepare(
      "SELECT id FROM paper_trades WHERE status = 'OPEN' AND type LIKE '%BUY%' AND tier = ? LIMIT 1"
    ).get(tier) as { id: number } | undefined;
    return !!row;
  }

  public static hasAnyOpenBuyTrade(): boolean {
    const db = this.initialize();
    const row = db.prepare(
      "SELECT id FROM paper_trades WHERE status = 'OPEN' AND type LIKE '%BUY%' LIMIT 1"
    ).get() as { id: number } | undefined;
    return !!row;
  }

  /**
   * BUY rows that never received a matching exit. Uses LIFO per tier so an exit
   * closes the current in-memory position (the latest buy), which is how the
   * engine actually behaves across restarts.
   */
  public static getUnmatchedBuyTrades(): PaperTradeRecord[] {
    const db = this.initialize();
    const trades = db.prepare("SELECT * FROM paper_trades ORDER BY id ASC").all() as PaperTradeRecord[];
    const stacks: { [tier: string]: PaperTradeRecord[] } = {};

    for (const trade of trades) {
      const tier = trade.tier || "SNIPER";
      if (!stacks[tier]) stacks[tier] = [];
      if (this.isBuyType(trade.type)) {
        stacks[tier].push(trade);
      } else if (this.isExitType(trade.type) && stacks[tier].length > 0) {
        stacks[tier].pop();
      }
    }

    return Object.values(stacks).flat().filter(t => t.status === "OPEN");
  }

  public static getPaperTrades(limit: number = 150, tier?: string): PaperTradeRecord[] {
    const db = this.initialize();
    if (tier && tier !== "ALL") {
      return db.prepare("SELECT * FROM paper_trades WHERE tier = ? ORDER BY id DESC LIMIT ?").all(tier, limit) as PaperTradeRecord[];
    }
    return db.prepare("SELECT * FROM paper_trades ORDER BY id DESC LIMIT ?").all(limit) as PaperTradeRecord[];
  }

  /**
   * Evaluates historical paper trade statistics to feed back into QuantitativeEngine
   * for adaptive target scaling and higher probability accuracy.
   */
  public static getTradeAnalytics(tier?: string): TradeAnalytics {
    const db = this.initialize();
    // Count realized closes only. BUY rows are entries; including them double-counts PnL.
    const trades = (tier && tier !== "ALL")
      ? (db.prepare("SELECT * FROM paper_trades WHERE pnl IS NOT NULL AND type NOT LIKE '%BUY%' AND tier = ?").all(tier) as PaperTradeRecord[])
      : (db.prepare("SELECT * FROM paper_trades WHERE pnl IS NOT NULL AND type NOT LIKE '%BUY%'").all() as PaperTradeRecord[]);

    let totalGrossPnl = 0;
    let totalFees = 0;
    let totalNetPnl = 0;
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
      const grossPnl = t.pnl || 0;
      const fees = t.fees || 0;
      const netPnl = t.net_pnl !== undefined && t.net_pnl !== null ? t.net_pnl : (grossPnl - fees);

      totalGrossPnl += grossPnl;
      totalFees += fees;
      totalNetPnl += netPnl;

      if (netPnl > 0) {
        winningTrades++;
        grossWins += netPnl;
        largestWin = Math.max(largestWin, netPnl);
      } else if (netPnl < 0) {
        losingTrades++;
        grossLosses += Math.abs(netPnl);
        largestLoss = Math.min(largestLoss, netPnl);
      } else {
        breakevenTrades++;
      }

      if (t.reasoning && t.reasoning.includes("Target 1")) target1Hits++;
      if (t.reasoning && (t.reasoning.includes("Target 2") || t.type === "EXIT_PROFIT")) target2Hits++;

      if (t.type.includes("CALL") || (t.symbol && t.symbol.includes("CE"))) {
        callTrades++;
        if (netPnl > 0) callWins++;
      } else if (t.type.includes("PUT") || (t.symbol && t.symbol.includes("PE"))) {
        putTrades++;
        if (netPnl > 0) putWins++;
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

    // Adaptive Machine Learning & Streak Calibration:
    let suggestedTargetMultiplier = 1.0;
    let suggestedScoreBias = 0;

    // Check recent consecutive wins in the last 3 closed trades
    const recentTrades = trades.slice(-3);
    const recentWins = recentTrades.filter(t => (t.net_pnl !== undefined && t.net_pnl !== null ? t.net_pnl : (t.pnl || 0)) > 0).length;

    if (recentWins >= 2) {
      suggestedTargetMultiplier = 1.20; // Compound runners during active win streaks
      suggestedScoreBias = 5;
    } else if (totalCount >= 5) {
      if (winRatePercent >= 65) {
        suggestedTargetMultiplier = 1.15;
        suggestedScoreBias = 5;
      } else if (winRatePercent < 45) {
        suggestedTargetMultiplier = 0.85;
        suggestedScoreBias = -5;
      }
    }

    return {
      tier: tier || "ALL",
      totalTrades: totalCount,
      winningTrades,
      losingTrades,
      breakevenTrades,
      winRatePercent,
      totalPnl: totalNetPnl,
      totalGrossPnl,
      totalFees,
      totalNetPnl,
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

  public static getTierOverviewAnalytics(): {
    overall: TradeAnalytics;
    sniper: TradeAnalytics;
    balanced: TradeAnalytics;
    exploratory: TradeAnalytics;
  } {
    return {
      overall: this.getTradeAnalytics("ALL"),
      sniper: this.getTradeAnalytics("SNIPER"),
      balanced: this.getTradeAnalytics("BALANCED"),
      exploratory: this.getTradeAnalytics("EXPLORATORY")
    };
  }

  /**
   * Database-level Paginated Paper Trades
   */
  public static getPaginatedPaperTrades(params: {
    page?: number;
    limit?: number;
    tier?: string;
    date?: string;
    filterType?: string;
    search?: string;
  }): {
    items: PaperTradeRecord[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } {
    const db = this.initialize();
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.max(1, Number(params.limit) || 10);
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const values: any[] = [];

    // 1. Tier filter
    if (params.tier && params.tier !== "ALL") {
      conditions.push("tier = ?");
      values.push(params.tier);
    }

    // 2. Date filter (IST)
    if (params.date && params.date !== "ALL") {
      const [year, month, day] = params.date.split("-").map(Number);
      const startMs = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - (5.5 * 3600 * 1000)).getTime();
      const endMs = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) - (5.5 * 3600 * 1000)).getTime();
      
      const istDate1 = `${day}/${month}/${year}`;
      const istDate2 = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
      
      conditions.push("((timestamp >= ? AND timestamp <= ?) OR datetime LIKE ? OR datetime LIKE ?)");
      values.push(startMs, endMs, `%${istDate1}%`, `%${istDate2}%`);
    }

    // 3. Filter Type
    if (params.filterType === "PROFIT") {
      conditions.push("pnl > 0");
    } else if (params.filterType === "LOSS") {
      conditions.push("pnl < 0");
    } else if (params.filterType === "BUY") {
      conditions.push("type LIKE '%BUY%'");
    } else if (params.filterType === "EXIT") {
      conditions.push("(type LIKE '%EXIT%' OR type = 'SQUARE_OFF')");
    } else if (params.filterType === "CALL") {
      conditions.push("(type LIKE '%CALL%' OR symbol LIKE '%CE%')");
    } else if (params.filterType === "PUT") {
      conditions.push("(type LIKE '%PUT%' OR symbol LIKE '%PE%')");
    }

    // 4. Search query
    if (params.search && params.search.trim()) {
      const q = `%${params.search.trim().replace(/^#/, "")}%`;
      conditions.push("(symbol LIKE ? OR strike LIKE ? OR reasoning LIKE ? OR type LIKE ? OR tier LIKE ? OR CAST(id AS TEXT) LIKE ?)");
      values.push(q, q, q, q, q, q);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const totalRow = db.prepare(`SELECT COUNT(*) as total FROM paper_trades ${whereClause}`).get(...values) as { total: number };
    const total = totalRow?.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const items = db.prepare(`SELECT * FROM paper_trades ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...values, limit, offset) as PaperTradeRecord[];

    return {
      items,
      total,
      page,
      limit,
      totalPages
    };
  }

  /**
   * Database-level Paginated Advisory Signals
   */
  public static getPaginatedSignals(params: {
    page?: number;
    limit?: number;
    tier?: string;
    date?: string;
    filterType?: string;
    search?: string;
  }): {
    items: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } {
    const db = this.initialize();
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.max(1, Number(params.limit) || 10);
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const values: any[] = [];

    if (params.tier && params.tier !== "ALL") {
      conditions.push("tier = ?");
      values.push(params.tier);
    }

    if (params.date && params.date !== "ALL") {
      const [year, month, day] = params.date.split("-").map(Number);
      const startMs = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - (5.5 * 3600 * 1000)).getTime();
      const endMs = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) - (5.5 * 3600 * 1000)).getTime();
      conditions.push("timestamp >= ? AND timestamp <= ?");
      values.push(startMs, endMs);
    }

    if (params.filterType === "BUY") {
      conditions.push("type LIKE '%BUY%'");
    } else if (params.filterType === "EXIT") {
      conditions.push("type LIKE '%EXIT%'");
    }

    if (params.search && params.search.trim()) {
      const q = `%${params.search.trim().replace(/^#/, "")}%`;
      conditions.push("(reasoning LIKE ? OR type LIKE ? OR CAST(strike_price AS TEXT) LIKE ? OR tier LIKE ? OR CAST(id AS TEXT) LIKE ?)");
      values.push(q, q, q, q, q);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const totalRow = db.prepare(`SELECT COUNT(*) as total FROM advisory_signals ${whereClause}`).get(...values) as { total: number };
    const total = totalRow?.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const items = db.prepare(`SELECT * FROM advisory_signals ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...values, limit, offset);

    return {
      items,
      total,
      page,
      limit,
      totalPages
    };
  }

  /**
   * Database-level Paginated Sessions
   */
  public static getPaginatedSessions(page: number = 1, limit: number = 10): {
    items: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } {
    const db = this.initialize();
    const p = Math.max(1, Number(page) || 1);
    const lim = Math.max(1, Number(limit) || 10);
    const offset = (p - 1) * lim;

    const totalRow = db.prepare("SELECT COUNT(*) as total FROM sessions").get() as { total: number };
    const total = totalRow?.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / lim));

    const items = db.prepare("SELECT * FROM sessions ORDER BY expires_at DESC LIMIT ? OFFSET ?").all(lim, offset);

    return {
      items,
      total,
      page: p,
      limit: lim,
      totalPages
    };
  }

  /**
   * Database-level Paginated Settings
   */
  public static getPaginatedSettings(page: number = 1, limit: number = 10): {
    items: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } {
    const db = this.initialize();
    const p = Math.max(1, Number(page) || 1);
    const lim = Math.max(1, Number(limit) || 10);
    const offset = (p - 1) * lim;

    const totalRow = db.prepare("SELECT COUNT(*) as total FROM settings").get() as { total: number };
    const total = totalRow?.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / lim));

    const items = db.prepare("SELECT * FROM settings ORDER BY key ASC LIMIT ? OFFSET ?").all(lim, offset);

    return {
      items,
      total,
      page: p,
      limit: lim,
      totalPages
    };
  }

  /**
   * Delete specific paper trade(s) by ID(s)
   */
  public static deletePaperTrades(ids: number[]): number {
    if (!ids || ids.length === 0) return 0;
    const db = this.initialize();
    const placeholders = ids.map(() => "?").join(",");
    const res = db.prepare(`DELETE FROM paper_trades WHERE id IN (${placeholders})`).run(...ids);
    return res.changes;
  }

  /**
   * Record initial exit event into post_exit_analytics
   */
  public static recordPostExit(record: Omit<PostExitRecord, "id">): number {
    const db = this.initialize();
    const stmt = db.prepare(`
      INSERT INTO post_exit_analytics (
        trade_id, symbol, exit_price, exit_timestamp, exit_datetime,
        tier, mfe_price, mfe_percent, price_5m, price_15m, price_30m, price_60m, eod_price, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(
      record.trade_id,
      record.symbol,
      record.exit_price,
      record.exit_timestamp,
      record.exit_datetime,
      record.tier ?? "SNIPER",
      record.mfe_price ?? record.exit_price,
      record.mfe_percent ?? 0,
      record.price_5m ?? null,
      record.price_15m ?? null,
      record.price_30m ?? null,
      record.price_60m ?? null,
      record.eod_price ?? null,
      record.updated_at ?? Date.now()
    );
    return Number(res.lastInsertRowid);
  }

  /**
   * Update post-exit metrics (MFE, multi-interval high/LTP)
   */
  public static updatePostExitAnalytics(
    tradeId: number,
    data: {
      mfe_price?: number;
      mfe_percent?: number;
      price_5m?: number;
      price_15m?: number;
      price_30m?: number;
      price_60m?: number;
      eod_price?: number;
    }
  ): void {
    const db = this.initialize();
    db.prepare(`
      UPDATE post_exit_analytics
      SET mfe_price = COALESCE(?, mfe_price),
          mfe_percent = COALESCE(?, mfe_percent),
          price_5m = COALESCE(?, price_5m),
          price_15m = COALESCE(?, price_15m),
          price_30m = COALESCE(?, price_30m),
          price_60m = COALESCE(?, price_60m),
          eod_price = COALESCE(?, eod_price),
          updated_at = ?
      WHERE trade_id = ?
    `).run(
      data.mfe_price ?? null,
      data.mfe_percent ?? null,
      data.price_5m ?? null,
      data.price_15m ?? null,
      data.price_30m ?? null,
      data.price_60m ?? null,
      data.eod_price ?? null,
      Date.now(),
      tradeId
    );
  }

  /**
   * Fetch recent post-exit tracking records
   */
  public static getPostExitAnalytics(limit: number = 50): PostExitRecord[] {
    const db = this.initialize();
    return db.prepare("SELECT * FROM post_exit_analytics ORDER BY id DESC LIMIT ?").all(limit) as PostExitRecord[];
  }

  /**
   * Fetch a single post-exit record by trade ID
   */
  public static getPostExitRecordByTradeId(tradeId: number): PostExitRecord | null {
    const db = this.initialize();
    const row = db.prepare("SELECT * FROM post_exit_analytics WHERE trade_id = ?").get(tradeId) as PostExitRecord | undefined;
    return row || null;
  }
}
