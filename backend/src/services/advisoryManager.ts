import { IBrokerAdapter, Candle, OptionChainItem, CompactTick } from "../adapters/IBrokerAdapter";
import { Indicators } from "../utils/indicators";
import { Greeks } from "../utils/greeks";
import { CPR, CPRValues } from "../utils/cpr";
import { ExcelLogger } from "../utils/excelLogger";
import { QuantitativeEngine, StrategySetup } from "../utils/quantitativeEngine";
import { DatabaseService, SignalTier } from "../utils/database";
import { TelegramService } from "./telegramService";
import {
  getIntradayEmaTrend,
  isClosedBarVolumeExpanded,
  orbConfirmationBuffer
} from "../utils/niftyOptionsSetup";

export interface AdvisorySignal {
  type: "CALL_BUY" | "PUT_BUY" | "HOLD" | "EXIT_PROFIT" | "EXIT_STOP_LOSS" | "THETA_EXIT" | "SQUARE_OFF";
  tier?: SignalTier;
  strikePrice?: number;
  entryPrice?: number;
  stopLossPrice?: number;
  targetPrice1?: number;
  targetPrice2?: number;
  reasoning: string;
  timestamp: number;
  scoreCard?: any;
  regime?: string;
}

export interface ActivePositionInfo {
  tier: SignalTier;
  symbol: string;
  strike: number | string;
  type: string;
  qty: number;
  entryPrice: number;
  currentLtp: number;
  pnl: number;
  pnlPercent: number;
  stopLoss: number;
  target1?: number;
  target2?: number;
  isBreakevenLocked: boolean;
  isTarget1Locked: boolean;
  entryTime: number;
  entrySpot?: number;
  currentSpot?: number;
  openTradeId?: number | null;
}

interface TierPositionState {
  activeSignal: AdvisorySignal | null;
  entrySpot: number;
  liveOptionLtp?: number | null;
  peakPremiumLtp: number;
  isBreakevenLocked: boolean;
  isTarget1Locked: boolean;
  entryTime: number;
  activeOptionSymbol?: string | null;
  activeOrderId?: string | null;
  openTradeId?: number | null;
  dailyTradesCount: number;
  dailyLossesCount: number;
  dailyProfitLoss: number;
  stoppedCooldownUntil: number;
}

export class AdvisoryManager {
  private broker: IBrokerAdapter;
  private cpr: CPRValues | null = null;
  private indexSpotPrice: number = 0;
  private indiaVixValue: number = 15; // default placeholder
  
  // Tickers tracking
  private heavyweightLtp: { [symbol: string]: number } = {
    "NSE:NIFTYBANK-INDEX": 0,
    "NSE:FINNIFTY-INDEX": 0,
    "NSE:RELIANCE-EQ": 0,
    "NSE:HDFCBANK-EQ": 0,
    "NSE:ICICIBANK-EQ": 0
  };
  private heavyweightVwap: { [symbol: string]: number } = {
    "NSE:NIFTYBANK-INDEX": 0,
    "NSE:FINNIFTY-INDEX": 0,
    "NSE:RELIANCE-EQ": 0,
    "NSE:HDFCBANK-EQ": 0,
    "NSE:ICICIBANK-EQ": 0
  };

  // Nifty price candles for calculations
  private indexCandles: Candle[] = [];
  private current3MinVolume: number = 0;
  private prev3MinVolumeMA: number = 0;
  private currentVwap: number = 0;

  // ORB parameters
  private activeTradingDateKey: string = "";
  private isOrbActive: boolean = false;
  private orbHigh: number = 0;
  private orbLow: number = 0;
  private dayHigh: number = 0;
  private dayLow: number = Infinity;
  private isSignalGeneratedToday: boolean = false;
  private lastBreakoutEvalAt: number = 0;
  private breakoutEvalInflight: boolean = false;
  private lastSignalBlockReason: string = "";
  private lastTriggeredBreakoutLevel: {
    CALL_BUY: number;
    PUT_BUY: number;
  } = {
    CALL_BUY: 0,
    PUT_BUY: 0
  };
  private sampleActiveTiers: Set<SignalTier> = new Set<SignalTier>();
  private sessionRealizedPnl: number = 0;

  // 3-Tier Independent Position State Machines:
  // 1. SNIPER (Score >= 75%) -> Official Alert & Optional Real Execution
  // 2. BALANCED (Score 60% - 74%) -> Moderate Paper Trading (Tracked silently in DB/CSV)
  // 3. EXPLORATORY (Score < 60%) -> Aggressive Paper Trading (Tracked silently in DB/CSV)
  private tierPositions: { [key in SignalTier]: TierPositionState } = {
    SNIPER: {
      activeSignal: null,
      entrySpot: 0,
      liveOptionLtp: null,
      peakPremiumLtp: 0,
      isBreakevenLocked: false,
      isTarget1Locked: false,
      entryTime: 0,
      activeOptionSymbol: null,
      activeOrderId: null,
      openTradeId: null,
      dailyTradesCount: 0,
      dailyLossesCount: 0,
      dailyProfitLoss: 0,
      stoppedCooldownUntil: 0
    },
    BALANCED: {
      activeSignal: null,
      entrySpot: 0,
      liveOptionLtp: null,
      peakPremiumLtp: 0,
      isBreakevenLocked: false,
      isTarget1Locked: false,
      entryTime: 0,
      activeOptionSymbol: null,
      activeOrderId: null,
      openTradeId: null,
      dailyTradesCount: 0,
      dailyLossesCount: 0,
      dailyProfitLoss: 0,
      stoppedCooldownUntil: 0
    },
    EXPLORATORY: {
      activeSignal: null,
      entrySpot: 0,
      liveOptionLtp: null,
      peakPremiumLtp: 0,
      isBreakevenLocked: false,
      isTarget1Locked: false,
      entryTime: 0,
      activeOptionSymbol: null,
      activeOrderId: null,
      openTradeId: null,
      dailyTradesCount: 0,
      dailyLossesCount: 0,
      dailyProfitLoss: 0,
      stoppedCooldownUntil: 0
    }
  };

  // Public getter for UI: SNIPER first, then live BALANCED advisory so a valid breakdown is visible
  public get activeSignal(): AdvisorySignal | null {
    const sniper = this.tierPositions.SNIPER.activeSignal;
    if (sniper) return sniper;
    const balanced = this.tierPositions.BALANCED.activeSignal;
    if (balanced && balanced.type.includes("BUY")) return balanced;
    return null;
  }

  // Risk parameters
  private dailyLossLimit: number = -2.0; // max -2R daily drawdown
  private dailyMaxTrades: number = 3; // max 3 trades per tier per day to prevent fee accumulation

  // Delta OI and Delta VIX tracking for Institutional Acceleration Guard
  private prevTotalCallOi: number = 0;
  private prevTotalPutOi: number = 0;
  private prevVix: number = 0;

  // Callback to alert Electron/Web UI (only for SNIPER Tier)
  private onSignalCallback: (signal: AdvisorySignal) => void = () => {};

  constructor(broker: IBrokerAdapter) {
    this.broker = broker;
  }

  public registerSignalCallback(callback: (signal: AdvisorySignal) => void) {
    this.onSignalCallback = callback;
  }

  /**
   * Initializes the strategy engine. Fetches previous day data to calculate CPR and base parameters.
   */
  public async initialize(): Promise<void> {
    console.log("[AdvisoryManager] Initializing advisory manager...");
    
    // Fetch historical candles for Nifty 50 Index (e.g. past 1 day to calculate CPR)
    const todayStr = new Date().toISOString().split("T")[0];
    const prevDate = new Date();
    prevDate.setDate(prevDate.getDate() - 5); // Go back 5 days to ensure we get a trading day
    const prevDateStr = prevDate.toISOString().split("T")[0];

    try {
      const candles = await this.broker.getHistoricalCandles(
        "NSE:NIFTY50-INDEX",
        "D",
        prevDateStr,
        todayStr
      );

      if (candles.length > 0) {
        const lastDay = candles[candles.length - 1];
        this.cpr = CPR.calculateCPR(lastDay.high, lastDay.low, lastDay.close);
        console.log(`[AdvisoryManager] Daily CPR calculated: Pivot=${this.cpr.pivot.toFixed(2)}, Range=[${this.cpr.bottomRange.toFixed(2)} - ${this.cpr.topRange.toFixed(2)}]`);
      } else {
        console.warn("[AdvisoryManager] Could not fetch real daily candles from broker. CPR filter disabled.");
        this.cpr = null;
      }
    } catch (e) {
      console.warn("[AdvisoryManager] Failed to fetch CPR parameters from broker. CPR filter disabled.", e);
      this.cpr = null;
    }

    // Fetch Nifty 5-minute historical candles for indicator calculations
    try {
      const historical5m = await this.broker.getHistoricalCandles(
        "NSE:NIFTY50-INDEX",
        "5",
        prevDateStr,
        todayStr
      );
      if (historical5m && historical5m.length > 0) {
        this.indexCandles = historical5m;
        console.log(`[AdvisoryManager] Initialized ${this.indexCandles.length} Nifty 5-minute historical candles.`);
        this.hydrateOrbFromHistory();
        this.refreshSessionVwap();
        if (this.currentVwap > 0) {
          console.log(`[AdvisoryManager] Session VWAP (today 9:15 IST+): ${this.currentVwap.toFixed(2)}`);
        }
      }
    } catch (e) {
      console.warn("[AdvisoryManager] Failed to load 5-minute Nifty history. Starting fresh.", e);
    }

    this.hydrateOrFlattenOpenPositions();
  }

  /**
   * Resets all intraday levels and counters when a new calendar trading day begins
   */
  public async resetDailySession(newDateKey: string): Promise<void> {
    this.activeTradingDateKey = newDateKey;
    this.orbHigh = 0;
    this.orbLow = 0;
    this.dayHigh = 0;
    this.dayLow = Infinity;
    this.isOrbActive = false;
    this.lastBreakoutEvalAt = 0;
    this.lastSignalBlockReason = "";
    this.lastTriggeredBreakoutLevel = { CALL_BUY: 0, PUT_BUY: 0 };
    this.isSignalGeneratedToday = false;
    this.currentVwap = 0;

    const allTiers: SignalTier[] = ["SNIPER", "BALANCED", "EXPLORATORY"];
    for (const t of allTiers) {
      const pos = this.tierPositions[t];
      pos.activeSignal = null;
      pos.entrySpot = 0;
      pos.liveOptionLtp = null;
      pos.peakPremiumLtp = 0;
      pos.isBreakevenLocked = false;
      pos.isTarget1Locked = false;
      pos.entryTime = 0;
      pos.activeOptionSymbol = null;
      pos.activeOrderId = null;
      pos.openTradeId = null;
      pos.dailyTradesCount = 0;
      pos.dailyLossesCount = 0;
      pos.dailyProfitLoss = 0;
      pos.stoppedCooldownUntil = 0;
    }

    console.log(`[AdvisoryManager] 🌅 Daily rollover: Session state reset for ${newDateKey}. Re-initializing CPR & historical bars...`);
    await this.initialize();
  }

  /**
   * Rebuilds today's 9:15–9:30 IST opening range from loaded 5-minute bars so a mid-session
   * restart still has ORB high/low instead of treating them as 0.
   */
  private hydrateOrbFromHistory(): void {
    if (this.indexCandles.length === 0) return;

    const todayIst = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());

    const orbCandles = this.indexCandles.filter((candle) => {
      const istDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date(candle.timestamp));
      if (istDate !== todayIst) return false;

      const istTime = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(new Date(candle.timestamp));
      const [hStr, mStr] = istTime.split(":");
      const hours = parseInt(hStr, 10);
      const minutes = parseInt(mStr, 10);
      const orbEndMinute = (this.indiaVixValue > 18) ? 20 : 30;
      return hours === 9 && minutes >= 15 && minutes < orbEndMinute;
    });

    if (orbCandles.length === 0) return;

    this.orbHigh = Math.max(...orbCandles.map((c) => c.high));
    this.orbLow = Math.min(...orbCandles.map((c) => c.low));
    this.isOrbActive = false;
    this.lastTriggeredBreakoutLevel = { CALL_BUY: 0, PUT_BUY: 0 };
    console.log(
      `[AdvisoryManager] ORB hydrated from history (${orbCandles.length} bars): High=${this.orbHigh.toFixed(2)}, Low=${this.orbLow.toFixed(2)}`
    );
  }

  /**
   * Today's NSE cash session bars only (9:15 AM IST onward). Session VWAP must not include prior days.
   */
  private getTodaySessionCandles(now: number = Date.now()): Candle[] {
    const todayIst = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date(now));

    return this.indexCandles.filter((candle) => {
      const istDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date(candle.timestamp));
      if (istDate !== todayIst) return false;

      const istTime = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(new Date(candle.timestamp));
      const [hStr, mStr] = istTime.split(":");
      const hours = parseInt(hStr, 10);
      const minutes = parseInt(mStr, 10);
      const totalMinutes = hours * 60 + minutes;
      return totalMinutes >= 9 * 60 + 15 && totalMinutes < 15 * 60 + 30;
    });
  }

  private isIntradaySquareOffWindow(timestamp: number = Date.now()): boolean {
    const istTimeStr = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(timestamp));
    const [hoursStr, minutesStr] = istTimeStr.split(":");
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);
    return hours > 15 || (hours === 15 && minutes >= 15);
  }

  private isPreOpenSession(timestamp: number = Date.now()): boolean {
    const istTimeStr = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(timestamp));
    const [hoursStr, minutesStr] = istTimeStr.split(":");
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);
    return hours < 9 || (hours === 9 && minutes < 15);
  }

  /**
   * After a restart the RAM position is empty, but paper_trades may still have
   * unmatched BUY rows. Restore them during market hours, or flatten them once
   * the 3:15 IST square-off window has started.
   */
  private hydrateOrFlattenOpenPositions(): void {
    const now = Date.now();
    if (this.isIntradaySquareOffWindow(now) || this.isPreOpenSession(now)) {
      this.enforceMandatorySquareOff(now);
      return;
    }
    this.hydrateDailyRiskFromDb();
    this.hydrateOpenPositionsFromDb();
  }

  private hydrateDailyRiskFromDb(): void {
    this.sessionRealizedPnl = DatabaseService.getTodayRealizedPnl();
    const snapshots = DatabaseService.getSessionRiskByTier();
    (["SNIPER", "BALANCED", "EXPLORATORY"] as SignalTier[]).forEach((tier) => {
      const snap = snapshots[tier];
      const pos = this.tierPositions[tier];
      pos.dailyTradesCount = snap.dailyTradesCount;
      pos.dailyLossesCount = snap.dailyLossesCount;
      pos.dailyProfitLoss = snap.dailyProfitLoss;
      pos.stoppedCooldownUntil = snap.stoppedCooldownUntil;
    });
  }

  private hydrateOpenPositionsFromDb(): void {
    const openBuys = DatabaseService.getOpenBuyTrades();
    if (openBuys.length === 0) return;

    const allTiers: SignalTier[] = ["SNIPER", "BALANCED", "EXPLORATORY"];
    for (const tier of allTiers) {
      const tierBuys = openBuys.filter(t => (t.tier || "SNIPER") === tier);
      if (tierBuys.length === 0) continue;

      // Keep latest open buy for live RAM state monitoring
      const trade = tierBuys[tierBuys.length - 1];
      const pos = this.tierPositions[tier];
      if (pos.activeSignal) continue;

      const buyType = trade.type === "CALL_BUY" || trade.type === "PUT_BUY" ? trade.type : null;
      if (!buyType) continue;

      pos.activeSignal = {
        type: buyType,
        tier,
        strikePrice: trade.strike ? Number(trade.strike) : undefined,
        entryPrice: trade.price,
        stopLossPrice: trade.stop_loss,
        targetPrice1: trade.target1,
        targetPrice2: trade.target2,
        reasoning: trade.reasoning,
        timestamp: trade.timestamp,
        regime: trade.market_regime
      };
      pos.entrySpot = trade.entry_spot && trade.entry_spot > 0 ? trade.entry_spot : 0;
      pos.peakPremiumLtp = trade.peak_premium && trade.peak_premium > 0 ? trade.peak_premium : trade.price;
      pos.isBreakevenLocked = !!trade.is_breakeven_locked;
      pos.isTarget1Locked = !!trade.is_target1_locked;
      pos.entryTime = trade.timestamp;
      pos.activeOptionSymbol = trade.symbol;
      pos.liveOptionLtp = null; // intentionally null — force delta model until real live tick arrives
      pos.openTradeId = trade.id;

      if (trade.symbol) {
        console.log(
          `[AdvisoryManager] [${tier}] Restored open paper position #${trade.id} ${trade.symbol} @ ₹${trade.price} from SQLite`
        );
        this.broker.subscribeTicks([trade.symbol]);
      }

      // Flatten any older orphaned open trades in DB to prevent duplicate state
      if (tierBuys.length > 1) {
        const orphans = tierBuys.slice(0, -1);
        console.warn(`[AdvisoryManager] [${tier}] Flattening ${orphans.length} orphaned open trade(s) from previous server sessions.`);
        for (const orphan of orphans) {
          DatabaseService.markPaperTradeClosed(orphan.id, { pnl: 0, fees: 0, netPnl: 0 });
        }
      }
    }
  }

  /**
   * Flatten every live tier plus any leftover unmatched BUY rows in SQLite.
   * Idempotent: a second call is a no-op once the ledger is paired.
   */
  public enforceMandatorySquareOff(timestamp: number = Date.now()): void {
    if (!this.isIntradaySquareOffWindow(timestamp) && !this.isPreOpenSession(timestamp)) {
      return;
    }
    const allTiers: SignalTier[] = ["SNIPER", "BALANCED", "EXPLORATORY"];
    for (const t of allTiers) {
      if (this.tierPositions[t].activeSignal) {
        this.triggerTierExit(
          t,
          "SQUARE_OFF",
          "Universal 3:15 PM Square-off Alert. Terminate open positions.",
          timestamp
        );
      }
    }
    this.squareOffUnmatchedFromDb();
  }

  private squareOffUnmatchedFromDb(): void {
    const unmatched = DatabaseService.getUnmatchedBuyTrades();
    if (unmatched.length === 0) return;

    console.log(`[AdvisoryManager] Found ${unmatched.length} unmatched BUY row(s) with no square-off. Flattening ledger.`);
    for (const buy of unmatched) {
      const tier = (buy.tier as SignalTier) || "SNIPER";
      const qty = buy.qty || 25;
      const perUnitPnl = buy.pnl != null && qty > 0 ? buy.pnl / qty : 0;
      const grossPnl = perUnitPnl * qty;
      const exitPrice = parseFloat((buy.price + perUnitPnl).toFixed(2));
      const fees = ExcelLogger.calculateStatutoryFees(exitPrice, qty);

      // Only mark the original BUY record as CLOSED — do NOT create a duplicate exit row
      DatabaseService.markPaperTradeClosed(buy.id, {
        pnl: grossPnl,
        fees,
        netPnl: grossPnl - fees
      });
      console.log(`[AdvisoryManager] [${tier}] Catch-up flattened orphaned BUY #${buy.id} (${buy.symbol}).`);
    }
  }

  private refreshSessionVwap(now: number = Date.now(), fallbackSpot?: number): void {
    const sessionCandles = this.getTodaySessionCandles(now);
    if (sessionCandles.length > 0) {
      this.currentVwap = Indicators.calculateVWAP(sessionCandles);
      return;
    }
    if (fallbackSpot && fallbackSpot > 0) {
      this.currentVwap = fallbackSpot;
    }
  }

  /**
   * Main entry point to process streaming real-time ticks
   */
  public async processTick(tick: CompactTick): Promise<void> {
    const timestamp = tick.timestamp || Date.now();
    const allTiers: SignalTier[] = ["SNIPER", "BALANCED", "EXPLORATORY"];

    // 1. Time & Date Check in IST (Indian Standard Time, UTC+5:30)
    const istTimeStr = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(timestamp));
    const [hoursStr, minutesStr] = istTimeStr.split(":");
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);

    // Automatic Session Rollover: Detect change of trading day
    const currentDateKey = DatabaseService.getIstDateKey(timestamp);
    if (this.activeTradingDateKey && this.activeTradingDateKey !== currentDateKey) {
      this.resetDailySession(currentDateKey).catch(err => {
        console.error("[AdvisoryManager] Day rollover reset failed:", err);
      });
    } else if (!this.activeTradingDateKey) {
      this.activeTradingDateKey = currentDateKey;
    }

    // Universal Hard Square-Off at 15:15 IST across all tiers (and any tick after that)
    if (this.isIntradaySquareOffWindow(timestamp)) {
      this.enforceMandatorySquareOff(timestamp);
      return;
    }

    // 1b. Track India VIX updates for dynamic strategy adaptation
    if (tick.symbol.includes("VIX") || tick.symbol.includes("INDIAVIX")) {
      this.indiaVixValue = tick.ltp;
    }

    // 2. Track Nifty Spot Index price
    if (tick.symbol === "NSE:NIFTY50-INDEX") {
      this.indexSpotPrice = tick.ltp;

      // Build or update 5-minute candles dynamically from ticks
      const candleIntervalMs = 5 * 60 * 1000;
      const barStartTime = Math.floor(timestamp / candleIntervalMs) * candleIntervalMs;

      if (this.indexCandles.length === 0) {
        this.indexCandles.push({
          timestamp: barStartTime,
          open: tick.ltp,
          high: tick.ltp,
          low: tick.ltp,
          close: tick.ltp,
          volume: tick.volume || 0
        });
      } else {
        const lastCandle = this.indexCandles[this.indexCandles.length - 1];
        if (barStartTime > lastCandle.timestamp) {
          this.indexCandles.push({
            timestamp: barStartTime,
            open: tick.ltp,
            high: tick.ltp,
            low: tick.ltp,
            close: tick.ltp,
            volume: tick.volume || 0
          });
          if (this.indexCandles.length > 350) {
            this.indexCandles.shift();
          }
        } else {
          lastCandle.close = tick.ltp;
          lastCandle.high = Math.max(lastCandle.high, tick.ltp);
          lastCandle.low = Math.min(lastCandle.low, tick.ltp);
          // Accumulate volume inside the active 5m bar
          lastCandle.volume += (tick.volume || 0);
        }
      }
      
      // Session VWAP: today's 9:15 AM IST bars only (not prior-day history)
      this.refreshSessionVwap(timestamp, tick.ltp);

      // Track Intraday Extremes (Day High & Day Low) for Trap Reversals
      if (this.dayHigh === 0) this.dayHigh = tick.ltp;
      if (this.dayLow === Infinity) this.dayLow = tick.ltp;
      this.dayHigh = Math.max(this.dayHigh, tick.ltp);
      this.dayLow = Math.min(this.dayLow, tick.ltp);
      
      // Dynamic Adaptive ORB calculation window (5m for VIX > 18, 15m for normal VIX)
      const orbEndMinute = (this.indiaVixValue > 18) ? 20 : 30;

      if (hours === 9 && minutes >= 15 && minutes < orbEndMinute) {
        if (!this.isOrbActive) {
          if (this.orbHigh <= 0 || this.orbLow <= 0) {
            this.orbHigh = tick.ltp;
            this.orbLow = tick.ltp;
          }
          this.isOrbActive = true;
          console.log(`[AdvisoryManager] 9:15 AM ORB range active (${orbEndMinute - 15}m window, VIX: ${this.indiaVixValue > 0 ? this.indiaVixValue.toFixed(2) : "Default"}). Tracking boundaries.`);
        }
        this.orbHigh = Math.max(this.orbHigh, tick.ltp);
        this.orbLow = Math.min(this.orbLow, tick.ltp);
      }

      // Check breakout triggers post ORB formation (post 9:20 AM for VIX>18, post 9:30 AM for normal VIX)
      if ((hours === 9 && minutes >= orbEndMinute) || (hours >= 10 && hours < 15) || (hours === 15 && minutes < 15)) {
        this.isOrbActive = false; // ORB creation range completed
        // One evaluation at a time, at most once per second — never stampede Fyers on every tick
        if (!this.breakoutEvalInflight && timestamp - this.lastBreakoutEvalAt >= 1000) {
          this.lastBreakoutEvalAt = timestamp;
          this.breakoutEvalInflight = true;
          this.evaluateBreakoutSignals(tick.ltp, timestamp)
            .catch((err) => {
              console.error("[AdvisoryManager] Breakout evaluation failed:", err);
            })
            .finally(() => {
              this.breakoutEvalInflight = false;
            });
        }
      }

      // Monitor active position risk parameters across all 3 tiers independently
      for (const t of allTiers) {
        if (this.tierPositions[t].activeSignal && this.tierPositions[t].activeSignal!.type.includes("BUY")) {
          this.monitorTierRiskState(t, tick.ltp, timestamp);
        }
      }
    }

    // 3. Track Heavyweights & calculate continuous intraday VWAP baseline
    if (tick.symbol in this.heavyweightLtp && tick.ltp > 0) {
      this.heavyweightLtp[tick.symbol] = tick.ltp;
      if (!this.heavyweightVwap[tick.symbol] || this.heavyweightVwap[tick.symbol] === 0) {
        this.heavyweightVwap[tick.symbol] = tick.ltp;
      } else {
        this.heavyweightVwap[tick.symbol] = this.heavyweightVwap[tick.symbol] * 0.98 + tick.ltp * 0.02;
      }
    }

    // 4. Track VIX
    if (tick.symbol === "NSE:INDIAVIX-INDEX" && tick.ltp > 0) {
      this.indiaVixValue = tick.ltp;
    }

    // 5. Track live option ticks for any active tier position
    for (const t of allTiers) {
      const p = this.tierPositions[t];
      if (p.activeSignal && tick.ltp > 0) {
        const optionSym = p.activeOptionSymbol;
        const matchesExact = !!(optionSym && tick.symbol === optionSym);
        const matchesSuffix = !!(optionSym && (
          tick.symbol.endsWith(optionSym.replace("NSE:", "")) ||
          optionSym.endsWith(tick.symbol.replace("NSE:", ""))
        ));
        const matchesStrike = !!(p.activeSignal.strikePrice &&
          tick.symbol.includes(String(p.activeSignal.strikePrice)) &&
          tick.symbol.endsWith(p.activeSignal.type.includes("CALL") ? "CE" : "PE"));

        if (matchesExact || matchesSuffix || matchesStrike) {
          p.liveOptionLtp = tick.ltp;
        }
      }
    }
  }

  /**
   * Evaluates if a high-probability breakout direction occurred and routes to appropriate tier
   */
  private async evaluateBreakoutSignals(spot: number, timestamp: number): Promise<void> {
    // Account-Level Anti-Overtrading Guard: Global Daily Trade Cap (3 trades) & 2-Loss Circuit Breaker
    const globalLock = DatabaseService.isGlobalDailyTradingLocked(timestamp, 3);
    if (globalLock.locked) {
      this.lastSignalBlockReason = globalLock.reason;
      return;
    }

    // Track whether current bar is inside midday lunch hour (11:30 AM to 1:30 PM IST)
    const istStr = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(timestamp));
    const [hStr, mStr] = istStr.split(":");
    const istH = parseInt(hStr, 10);
    const istM = parseInt(mStr, 10);
    const istTotalMinutes = istH * 60 + istM;
    const isLunchHour = istTotalMinutes >= 690 && istTotalMinutes <= 810;

    // CPR Filter Check: If price opened or is sitting inside CPR, trade with caution
    if (this.cpr && CPR.isPriceInsideCPR(spot, this.cpr)) {
      return;
    }

    // Without a captured ORB, do not evaluate (and do not hit the option-chain API)
    if (this.orbHigh <= 0 || this.orbLow <= 0) {
      return;
    }

    const isAboveVwap = spot > this.currentVwap;
    const buffer = orbConfirmationBuffer(spot);
    const closePrices = this.indexCandles.map(c => c.close);
    const { trendBullish: isTrendBullish, trendBearish: isTrendBearish } = getIntradayEmaTrend(closePrices, spot);

    // VWAP Pullback / Extension Filter for late session signals (> 10:00 AM IST)
    const vwapDistance = Math.abs(spot - this.currentVwap);
    if (istTotalMinutes >= 600 && vwapDistance > 60) {
      this.lastSignalBlockReason = `Price is over-extended (${vwapDistance.toFixed(1)} pts from session VWAP). Waiting for VWAP pullback confirmation.`;
      return;
    }

    let candidate: "CALL_BUY" | "PUT_BUY" | null = null;
    let setupType: StrategySetup = "ORB_BREAKOUT";
    let reasoning = "";

    // -------------------------------------------------------------
    // STRATEGY 1: TRAP REVERSAL (Priority 1: Fading Failed Breakouts)
    // -------------------------------------------------------------
    if (this.dayHigh > this.orbHigh + 2 && spot <= this.orbHigh && !isAboveVwap) {
      candidate = "PUT_BUY";
      setupType = "TRAP_REVERSAL";
      reasoning = `[TRAP REVERSAL] Bull Trap: Failed breakout above Day High (${this.dayHigh.toFixed(2)}) with sharp rejection below ORB High and VWAP (${this.currentVwap.toFixed(1)}).`;
    } else if (this.dayLow < this.orbLow - 2 && spot >= this.orbLow && isAboveVwap) {
      candidate = "CALL_BUY";
      setupType = "TRAP_REVERSAL";
      reasoning = `[TRAP REVERSAL] Bear Trap: Failed breakdown below Day Low (${this.dayLow.toFixed(2)}) with aggressive recovery above ORB Low and VWAP (${this.currentVwap.toFixed(1)}).`;
    }

    // -------------------------------------------------------------
    // STRATEGY 2: VWAP & 9/21 EMA PULLBACK (Priority 2: Trend Continuation)
    // -------------------------------------------------------------
    else if (spot > this.orbHigh && isAboveVwap && Math.abs(spot - this.currentVwap) <= 15 && (isTrendBullish || spot > this.orbHigh + 10)) {
      candidate = "CALL_BUY";
      setupType = "VWAP_PULLBACK";
      reasoning = `[VWAP PULLBACK] Bullish Trend Pullback: Retracement to session VWAP (${this.currentVwap.toFixed(1)}) with continuation bounce.`;
    } else if (spot < this.orbLow && !isAboveVwap && Math.abs(spot - this.currentVwap) <= 15 && (isTrendBearish || spot < this.orbLow - 10)) {
      candidate = "PUT_BUY";
      setupType = "VWAP_PULLBACK";
      reasoning = `[VWAP PULLBACK] Bearish Trend Pullback: Retracement to session VWAP (${this.currentVwap.toFixed(1)}) with continuation rejection.`;
    }

    // -------------------------------------------------------------
    // STRATEGY 3: ORB BREAKOUT / BREAKDOWN (Priority 3: Range Break)
    // -------------------------------------------------------------
    else if (spot > this.orbHigh + buffer && isAboveVwap) {
      candidate = "CALL_BUY";
      setupType = "ORB_BREAKOUT";
      reasoning = `Bullish ORB breakout above ${this.orbHigh.toFixed(2)} with session VWAP alignment.`;
    } else if (spot < this.orbLow - buffer && !isAboveVwap) {
      candidate = "PUT_BUY";
      setupType = "ORB_BREAKOUT";
      reasoning = `Bearish ORB breakdown below ${this.orbLow.toFixed(2)} with session VWAP alignment.`;
    }

    if (!candidate) {
      this.lastSignalBlockReason = "";
      return;
    }

    // Breakout Candle Confirmation / Anti-Trap Filter (for ORB_BREAKOUT only)
    if (setupType === "ORB_BREAKOUT") {
      const hasClosedBreakoutCandle = this.indexCandles.slice(-3).some(c => 
        candidate === "CALL_BUY" ? c.close > this.orbHigh : c.close < this.orbLow
      );
      const hasStrongBuffer = candidate === "CALL_BUY" 
        ? spot > this.orbHigh + (buffer * 1.3)
        : spot < this.orbLow - (buffer * 1.3);

      if (!hasClosedBreakoutCandle && !hasStrongBuffer) {
        this.lastSignalBlockReason = `Waiting for 5m candle close confirmation beyond ${candidate === "CALL_BUY" ? this.orbHigh.toFixed(2) : this.orbLow.toFixed(2)} to filter out wick traps.`;
        return;
      }
    }

    // Reset anti-churn watermark level if price has retraced back inside ORB range
    if (spot <= this.orbHigh) {
      this.lastTriggeredBreakoutLevel.CALL_BUY = 0;
    }
    if (spot >= this.orbLow) {
      this.lastTriggeredBreakoutLevel.PUT_BUY = 0;
    }

    // Fresh Swing Breakout & Anti-Churn Watermark check
    const minBreakoutStep = 5; // Reduced step from 10 to 5 points to keep ORB gates tight
    if (this.lastTriggeredBreakoutLevel[candidate] > 0) {
      if (candidate === "CALL_BUY" && spot <= this.lastTriggeredBreakoutLevel.CALL_BUY + minBreakoutStep) {
        this.lastSignalBlockReason = `Waiting for fresh swing high breakout above ${(this.lastTriggeredBreakoutLevel.CALL_BUY + minBreakoutStep).toFixed(1)} to prevent re-entry churn.`;
        return;
      }
      if (candidate === "PUT_BUY" && spot >= this.lastTriggeredBreakoutLevel.PUT_BUY - minBreakoutStep) {
        this.lastSignalBlockReason = `Waiting for fresh swing low breakdown below ${(this.lastTriggeredBreakoutLevel.PUT_BUY - minBreakoutStep).toFixed(1)} to prevent re-entry churn.`;
        return;
      }
    }

    const chain = await this.broker.getOptionChain("NSE:NIFTY50-INDEX");
    if (chain.length === 0) {
      this.lastSignalBlockReason = "Breakdown is valid, but the Fyers option chain is empty so strike premiums cannot be priced.";
      console.warn(`[AdvisoryManager] ${this.lastSignalBlockReason}`);
      return;
    }

    let totalPutOi = 0;
    let totalCallOi = 0;
    let maxCallOi = 0;
    let maxCallOiStrike = 0;
    let maxPutOi = 0;
    let maxPutOiStrike = 0;

    chain.forEach(item => {
      totalPutOi += item.put.openInterest;
      totalCallOi += item.call.openInterest;
      if (item.call.openInterest > maxCallOi) {
        maxCallOi = item.call.openInterest;
        maxCallOiStrike = item.strikePrice;
      }
      if (item.put.openInterest > maxPutOi) {
        maxPutOi = item.put.openInterest;
        maxPutOiStrike = item.strikePrice;
      }
    });

    const deltaCallOi = this.prevTotalCallOi > 0 ? totalCallOi - this.prevTotalCallOi : 0;
    const deltaPutOi = this.prevTotalPutOi > 0 ? totalPutOi - this.prevTotalPutOi : 0;
    const deltaVixPercent = (this.prevVix > 0 && this.indiaVixValue > 0) ? ((this.indiaVixValue - this.prevVix) / this.prevVix) * 100 : 0;

    this.prevTotalCallOi = totalCallOi;
    this.prevTotalPutOi = totalPutOi;
    this.prevVix = this.indiaVixValue;

    const pcr = totalCallOi > 0 ? totalPutOi / totalCallOi : 1.0;
    const triggerType = candidate;
    const strikeInterval = 50;
    const atmStrike = Math.round(spot / strikeInterval) * strikeInterval;
    let selectedStrike = atmStrike;

    // Enhancement 2: Dynamic Strike Selection (Delta-Calibrated based on VIX)
    // Low VIX (<12): Option premiums move slowly due to low IV. We pick slightly In-The-Money (ITM) strike
    // (-50 pts for CALL_BUY, +50 pts for PUT_BUY) with Delta ~0.62 to ensure faster premium acceleration.
    // Normal/High VIX (>=12): We stick to At-The-Money (ATM) strike (Delta ~0.50).
    if (this.indiaVixValue > 0 && this.indiaVixValue < 12) {
      if (candidate === "CALL_BUY") {
        selectedStrike = atmStrike - 50;
      } else if (candidate === "PUT_BUY") {
        selectedStrike = atmStrike + 50;
      }
      console.log(`[AdvisoryManager] Low VIX (${this.indiaVixValue.toFixed(2)}) detected. Selected ITM Strike ${selectedStrike} (ATM: ${atmStrike}) for higher Delta (~0.62).`);
    }

    const legFor = (strike: number) => {
      const row = chain.find(item => item.strikePrice === strike);
      return triggerType === "CALL_BUY" ? row?.call : row?.put;
    };

    let atmChain = chain.find(item => item.strikePrice === selectedStrike);
    let optionLeg = legFor(selectedStrike);
    if (!optionLeg?.ltp || optionLeg.ltp <= 0) {
      const nearest = [...chain].sort((a, b) => Math.abs(a.strikePrice - spot) - Math.abs(b.strikePrice - spot));
      for (const row of nearest) {
        const leg = triggerType === "CALL_BUY" ? row.call : row.put;
        if (leg?.ltp && leg.ltp > 0) {
          selectedStrike = row.strikePrice;
          atmChain = row;
          optionLeg = leg;
          break;
        }
      }
    }
    const optionLtp = optionLeg?.ltp && optionLeg.ltp > 0 ? optionLeg.ltp : 0;

    if (!optionLtp) {
      this.lastSignalBlockReason = `Breakdown is valid, but ATM ${triggerType === "PUT_BUY" ? "PE" : "CE"} premium is missing on the option chain.`;
      console.warn(`[AdvisoryManager] ${this.lastSignalBlockReason}`);
      return;
    }

      // Calculate dynamic expiry days from actual chain data
      const getDaysToExpiry = (expiryDateStr?: string): number => {
        if (expiryDateStr) {
          try {
            let expDate: Date | null = null;
            if (/^\d{2}-\d{2}-\d{4}$/.test(expiryDateStr)) {
              const [d, m, y] = expiryDateStr.split("-").map(Number);
              expDate = new Date(y, m - 1, d, 15, 30, 0);
            } else if (/^\d{4}-\d{2}-\d{2}$/.test(expiryDateStr)) {
              expDate = new Date(`${expiryDateStr}T15:30:00`);
            } else if (!isNaN(Number(expiryDateStr))) {
              expDate = new Date(Number(expiryDateStr) * (Number(expiryDateStr) < 1e11 ? 1000 : 1));
            }
            if (expDate && !isNaN(expDate.getTime())) {
              const diffMs = expDate.getTime() - timestamp;
              const daysRemaining = diffMs / (1000 * 60 * 60 * 24);
              if (daysRemaining > 0) return Math.max(0.1, parseFloat(daysRemaining.toFixed(2)));
            }
          } catch {}
        }
        // Fallback calendar calculation
        const today = new Date(timestamp);
        const dayOfWeek = today.getDay(); // 0 = Sun, 1 = Mon, ..., 4 = Thu
        let days = (4 - dayOfWeek + 7) % 7;
        if (days === 0) {
          const hours = today.getHours();
          const minutes = today.getMinutes();
          if (hours > 15 || (hours === 15 && minutes >= 30)) {
            days = 7;
          } else {
            days = 0.25; // 0DTE intraday expiry fraction
          }
        }
        return Math.max(0.1, days);
      };

      const expiryDateStr = atmChain?.expiryDate || chain[0]?.expiryDate;
      const expiryDays = getDaysToExpiry(expiryDateStr);
      let greeksResult = Greeks.calculateGreeks(spot, selectedStrike, expiryDays, this.indiaVixValue);
      let delta = triggerType === "CALL_BUY" ? greeksResult.call.delta : Math.abs(greeksResult.put.delta);

      // Low-VIX Delta Protection: If candidate strike Delta is sluggish (< 0.46), shift 1 strike ITM for responsive momentum
      if (delta < 0.46) {
        const itmStrike = triggerType === "CALL_BUY" ? selectedStrike - strikeInterval : selectedStrike + strikeInterval;
        const itmLeg = legFor(itmStrike);
        if (itmLeg?.ltp && itmLeg.ltp > 0) {
          const itmGreeks = Greeks.calculateGreeks(spot, itmStrike, expiryDays, this.indiaVixValue);
          const itmDelta = triggerType === "CALL_BUY" ? itmGreeks.call.delta : Math.abs(itmGreeks.put.delta);
          if (itmDelta >= 0.46 && itmDelta <= 0.65) {
            selectedStrike = itmStrike;
            atmChain = chain.find(item => item.strikePrice === selectedStrike) || atmChain;
            optionLeg = itmLeg;
            greeksResult = itmGreeks;
            delta = itmDelta;
          }
        }
      }
      
      let targetMultiplier = 1.0;
      try {
        const analytics = DatabaseService.getTradeAnalytics();
        if (analytics && analytics.suggestedTargetMultiplier) {
          targetMultiplier = analytics.suggestedTargetMultiplier;
        }
      } catch (e) {}

      const entryPrice = optionLeg?.ltp && optionLeg.ltp > 0 ? optionLeg.ltp : optionLtp;
      const highsList = this.indexCandles.map(c => c.high);
      const lowsList = this.indexCandles.map(c => c.low);
      const atrList = Indicators.calculateATR(highsList, lowsList, closePrices, 14);
      const atrValue = atrList.length > 0 ? atrList[atrList.length - 1] : 12; 
      
      // Calculate true dynamic RSI from market prices
      const rsiList = Indicators.calculateRSI(closePrices, 14);
      const marketRsi = rsiList.length > 0 ? rsiList[rsiList.length - 1] : 50;

      // Realistic Risk & Scalp Geometry:
      // Initial stop-loss: 1.2 * ATR * delta (bounded to 6 to 14 option points)
      const scaledStopLoss = Math.max(6.0, Math.min(14.0, 1.2 * atrValue * delta));
      const initialRisk = scaledStopLoss;

      // Realistic Targets based on Intraday Option Mechanics:
      // Target 1 = +1.25R (+15% to +25% option scalp, ~8 to 12 points)
      // Target 2 = +2.50R (+35% to +50% option runner, ~18 to 25 points)
      const scaledTarget1 = parseFloat((initialRisk * 1.25 * targetMultiplier).toFixed(2));
      const scaledTarget2 = parseFloat((initialRisk * 2.50 * targetMultiplier).toFixed(2));

      const stopLossPrice = parseFloat(Math.max(0.50, entryPrice - scaledStopLoss).toFixed(2));
      const targetPrice1 = parseFloat((entryPrice + scaledTarget1).toFixed(2));
      const targetPrice2 = parseFloat((entryPrice + scaledTarget2).toFixed(2));

      // Quantitative Score Confluence calculation
      const riskReward = scaledTarget2 / Math.max(1, scaledStopLoss);
      const scoreCard = QuantitativeEngine.calculateConfluence({
        spot,
        currentVwap: this.currentVwap,
        orbHigh: this.orbHigh,
        orbLow: this.orbLow,
        triggerType,
        setupType,
        cpr: this.cpr,
        pcr,
        vix: this.indiaVixValue,
        atr: atrValue,
        riskReward,
        candles5m: this.indexCandles,
        heavyweightsLtp: this.heavyweightLtp,
        heavyweightsVwap: this.heavyweightVwap,
        optionPremiumRsi: marketRsi,
        maxCallOiStrike,
        maxPutOiStrike,
        deltaCallOi,
        deltaPutOi,
        deltaVixPercent
      });

      // Strict rejection: zero trade on detected false breakout or score < 45
      if (scoreCard.isFalseBreakout || scoreCard.totalScore < 45) {
        this.lastSignalBlockReason = scoreCard.isFalseBreakout
          ? "Breakdown printed, then price returned inside the opening range (false breakout)."
          : `Breakdown is valid, but confluence is ${scoreCard.totalScore}/100 (need at least 45).`;
        console.warn(`[AdvisoryManager] ${this.lastSignalBlockReason}`);
        return;
      }

      // Lunch Hour Trend Quality Check:
      // Block signals during 11:30 AM - 1:30 PM unless scoreCard indicates a high-conviction trend setup (score >= 70)
      if (isLunchHour && scoreCard.totalScore < 70) {
        this.lastSignalBlockReason = `Lunch hour consolidation (11:30 AM - 1:30 PM): score ${scoreCard.totalScore}/100 is below high-conviction threshold (70) to prevent midday theta decay.`;
        console.log(`[AdvisoryManager] ${this.lastSignalBlockReason}`);
        return;
      }

      const envScore = process.env.MIN_SIGNAL_SCORE;
      let minSignalScore = envScore !== undefined ? parseInt(envScore, 10) : 75;
      if (isNaN(minSignalScore)) minSignalScore = 75;

      try {
        const db = DatabaseService.initialize();
        const row = db.prepare("SELECT value FROM settings WHERE key = 'MIN_SIGNAL_SCORE'").get() as { value: string } | undefined;
        if (row) {
          const parsed = parseInt(row.value, 10);
          if (!isNaN(parsed)) minSignalScore = parsed;
        }
      } catch (e) {}

      // Classify into 3-Tier Multi-Track Strategy:
      // Tier 1: SNIPER (>= 75% or MIN_SIGNAL_SCORE) -> Official Signals & UI Audio Alerts
      // Tier 2: BALANCED (60% - 74%) -> Moderate Paper Trading in background
      // Tier 3: EXPLORATORY (45% - 59%) -> Aggressive Paper Trading in background (only if verified)
      let tier: SignalTier = "EXPLORATORY";
      if (scoreCard.totalScore >= minSignalScore) {
        tier = "SNIPER";
      } else if (scoreCard.totalScore >= 60) {
        tier = "BALANCED";
      } else {
        tier = "EXPLORATORY";
      }

      const targetPos = this.tierPositions[tier];

      // Check if this specific tier already has an active position or reached daily limits
      if (targetPos.activeSignal || DatabaseService.tierHasOpenBuy(tier)) {
        this.lastSignalBlockReason = `A ${tier} position is already open. New entries on this tier are paused.`;
        return;
      }
      if (targetPos.dailyTradesCount >= this.dailyMaxTrades) {
        this.lastSignalBlockReason = `${tier} daily trade cap (${this.dailyMaxTrades}) reached.`;
        return;
      }
      if (targetPos.dailyProfitLoss <= this.dailyLossLimit) {
        this.lastSignalBlockReason = `${tier} daily loss limit reached.`;
        return;
      }

      // 2-Consecutive-Loss Circuit Breaker
      const consecutiveLosses = DatabaseService.getConsecutiveLossesCountByTier(tier, timestamp);
      if (consecutiveLosses >= 2 || targetPos.dailyLossesCount >= 2) {
        this.lastSignalBlockReason = `${tier} 2-Consecutive-Loss Circuit Breaker active. Trading halted for session.`;
        return;
      }

      // Max entries per direction cap (max 2 entries per CALL/PUT direction per day)
      const directionEntries = DatabaseService.getDailyEntriesCountByDirection(tier, triggerType, timestamp);
      if (directionEntries >= 2) {
        this.lastSignalBlockReason = `${tier} reached max limit (2) for ${triggerType} entries today.`;
        return;
      }

      if (timestamp < targetPos.stoppedCooldownUntil) {
        const remainingMins = Math.ceil((targetPos.stoppedCooldownUntil - timestamp) / 60000);
        this.lastSignalBlockReason = `${tier} is in cooldown after exit (${remainingMins}m remaining).`;
        return;
      }

      const formattedReasoning = `[${tier} TIER] ${reasoning} Score: ${scoreCard.totalScore}/100. [Greeks Delta: ${delta.toFixed(2)}, SL=${scaledStopLoss.toFixed(1)}, T1=+${scaledTarget1.toFixed(1)}, T2=+${scaledTarget2.toFixed(1)}]`;

      const signalObj: AdvisorySignal = {
        type: triggerType,
        tier,
        strikePrice: selectedStrike,
        entryPrice: parseFloat(entryPrice.toFixed(2)),
        stopLossPrice: parseFloat(stopLossPrice.toFixed(2)),
        targetPrice1: parseFloat(targetPrice1.toFixed(2)),
        targetPrice2: parseFloat(targetPrice2.toFixed(2)),
        reasoning: formattedReasoning,
        timestamp,
        scoreCard,
        regime: scoreCard.regime
      };

      const optionSymbol = atmChain 
        ? (triggerType === "CALL_BUY" ? atmChain.call.symbol : atmChain.put.symbol)
        : this.formatFyersOptionSymbol(selectedStrike, triggerType, timestamp);

      // Persist the BUY to SQLite first. RAM is only a cache of that row.
      const baseQty = parseInt(process.env.ORDER_QTY || "25", 10) || 25;
      let logQty = baseQty;

      // Upgrade 2: Dynamic High-Conviction Sizing (Money Multiplier)
      // Standard setup (Score 75-84): 1 Lot (25 Qty)
      // SUPER-SNIPER setup (Score >= 85): Double Lot Size (2 Lots = 50 Qty)
      if (scoreCard.totalScore >= 85) {
        logQty = baseQty * 2;
        console.log(`[AdvisoryManager] 🚀 [SUPER-SNIPER] High Confluence Score (${scoreCard.totalScore}/100) detected! Dynamic Lot Scaling ACTIVE: Executing 2 Lots (${logQty} Qty).`);
      }

      const openTradeId = await ExcelLogger.logTransaction(
        triggerType,
        optionSymbol,
        selectedStrike,
        logQty,
        entryPrice,
        formattedReasoning,
        {
          tier,
          sl: stopLossPrice,
          t1: targetPrice1,
          t2: targetPrice2,
          marketRegime: scoreCard.regime,
          confluenceScore: scoreCard.totalScore,
          entrySpot: spot
        }
      );
      if (!openTradeId) {
        this.lastSignalBlockReason = `Could not persist the ${tier} BUY to SQLite. Entry aborted.`;
        console.error(`[AdvisoryManager] [${tier}] Refusing to hold an in-memory-only position.`);
        return;
      }

      targetPos.activeSignal = signalObj;
      targetPos.entrySpot = spot;
      targetPos.peakPremiumLtp = entryPrice;
      targetPos.isBreakevenLocked = false;
      targetPos.isTarget1Locked = false;
      targetPos.entryTime = timestamp;
      targetPos.activeOptionSymbol = optionSymbol;
      targetPos.liveOptionLtp = entryPrice;
      targetPos.openTradeId = openTradeId;
      this.lastTriggeredBreakoutLevel[triggerType] = spot;
      this.isSignalGeneratedToday = true;
      this.lastSignalBlockReason = "";

      if (optionSymbol) {
        console.log(`[AdvisoryManager] [${tier}] Subscribing live WebSocket to active option contract: ${optionSymbol}`);
        this.broker.subscribeTicks([optionSymbol]);
      }
      
      // Auto Execution placement only for SNIPER Tier
      if (tier === "SNIPER" && process.env.AUTO_ORDER_EXECUTION === "true") {
        console.log(`[AdvisoryManager] [SNIPER] AUTO-EXECUTION ACTIVE. Placing BUY option order: ${logQty}x ${optionSymbol}`);
        this.broker.placeOptionOrder(optionSymbol, logQty, "BUY", "MARKET")
          .then(orderId => {
            targetPos.activeOrderId = orderId;
            console.log(`[AdvisoryManager] AUTO BUY ORDER FILLED. Order ID: ${orderId}`);
            if (targetPos.activeSignal) {
              targetPos.activeSignal.reasoning += ` | Fyers Order Fill ID: ${orderId}`;
              this.onSignalCallback(targetPos.activeSignal);
            }
          })
          .catch(err => {
            console.error(`[AdvisoryManager] AUTO ORDER EXECUTION FAILED:`, err.message);
          });
      }

      // Log signal into SQLite database
      DatabaseService.logSignal(
        triggerType,
        selectedStrike,
        entryPrice,
        stopLossPrice,
        targetPrice1,
        targetPrice2,
        formattedReasoning,
        tier
      );

      // SNIPER: official alert + optional live routing. BALANCED: show on the advisory UI.
      if (tier === "SNIPER" || tier === "BALANCED") {
        this.onSignalCallback(signalObj);
        if (tier === "SNIPER") {
          TelegramService.sendSignalAlert(signalObj).catch(err => {
            console.warn("[AdvisoryManager] Failed to send Telegram signal alert:", err?.message || err);
          });
          console.log(`[AdvisoryManager] 🎯 [SNIPER TIER] OFFICIAL TRADE SIGNAL: ${triggerType} @ Strike ${selectedStrike}. Confluence: ${scoreCard.totalScore}/100.`);
        } else {
          console.log(`[AdvisoryManager] 📊 [BALANCED TIER] Advisory signal published: ${triggerType} @ Strike ${selectedStrike}. Score: ${scoreCard.totalScore}/100.`);
        }
      } else {
        console.log(`[AdvisoryManager] 📊 [${tier} TIER] Paper Trade initiated in background: ${triggerType} @ Strike ${selectedStrike}. Score: ${scoreCard.totalScore}/100.`);
      }
  }

  /**
   * Monitors active options position targets, stop-losses, and time exits for a specific tier
   */
  private monitorTierRiskState(tier: SignalTier, spot: number, timestamp: number): void {
    const pos = this.tierPositions[tier];
    if (!pos.activeSignal || !pos.activeSignal.entryPrice || !pos.activeSignal.stopLossPrice) return;

    const deltaMultiplier = 0.50;
    const entrySpotVal = pos.entrySpot > 0 ? pos.entrySpot : spot;
    const spotMovementGain = pos.activeSignal.type === "CALL_BUY"
      ? (spot - entrySpotVal)
      : (entrySpotVal - spot);

    // Intraday Theta Decay model: ~2.5% premium erosion per hour held during sideways consolidation
    const elapsed = timestamp - pos.entryTime;
    const elapsedMinutes = Math.max(0, elapsed / (60 * 1000));
    const thetaDecayPoints = (elapsedMinutes / 60) * (pos.activeSignal.entryPrice * 0.025);

    // Prioritize true live streaming option tick LTP if available, fallback seamlessly to delta model
    let currentPremiumLtp: number;
    if (pos.liveOptionLtp && pos.liveOptionLtp > 0) {
      currentPremiumLtp = pos.liveOptionLtp;
    } else {
      currentPremiumLtp = parseFloat(Math.max(0.05, pos.activeSignal.entryPrice + spotMovementGain * deltaMultiplier - thetaDecayPoints).toFixed(2));
    }

    pos.peakPremiumLtp = Math.max(pos.peakPremiumLtp, currentPremiumLtp);

    // Dynamic Breakeven & Fee Cover Profit Locker: if gain reaches 1:1 risk-reward target
    const initialRisk = pos.activeSignal.entryPrice - pos.activeSignal.stopLossPrice;
    const feeCoverBuffer = 2.50; // ₹2.50 per unit covers statutory fees (~₹54.60/lot)
    if (!pos.isBreakevenLocked && currentPremiumLtp >= pos.activeSignal.entryPrice + initialRisk) {
      pos.isBreakevenLocked = true;
      // Set SL to Entry + Fee Cover Buffer so breakeven is NET PROFITABLE post-fees
      pos.activeSignal.stopLossPrice = pos.activeSignal.entryPrice + feeCoverBuffer;
      this.persistOpenPositionState(pos);
      console.log(`[AdvisoryManager] [${tier}] Breakeven Fee-Cover Locker engaged at ₹${pos.activeSignal.stopLossPrice.toFixed(2)} (Net Profitable Guard)`);
      
      if (tier === "SNIPER") {
        const holdSignal: AdvisorySignal = {
          ...pos.activeSignal,
          type: "HOLD",
          reasoning: `Target 1 (1:1 RR) approaching. Stop loss locked at breakeven + fee buffer (₹${pos.activeSignal.stopLossPrice.toFixed(2)}) to guarantee a net positive trade.`
        };
        this.onSignalCallback(holdSignal);
        TelegramService.sendSignalAlert(holdSignal).catch(() => {});
      }
    }

    // Dynamic Trailing Stop Loss: Once premium reaches Target 1 (+1.2R equivalent), trail SL to +0.6R
    if (pos.isBreakevenLocked && currentPremiumLtp >= pos.activeSignal.entryPrice + initialRisk * 1.5) {
      const trailedSl = pos.activeSignal.entryPrice + initialRisk * 0.6;
      if (trailedSl > pos.activeSignal.stopLossPrice) {
        pos.activeSignal.stopLossPrice = parseFloat(trailedSl.toFixed(2));
        this.persistOpenPositionState(pos);
        console.log(`[AdvisoryManager] [${tier}] Trailing Stop Loss raised to ₹${pos.activeSignal.stopLossPrice.toFixed(2)} (+0.6R locked)`);
      }
    }

    // Theta Exit check: position open too long in sideways chop.
    // Tier-dependent timeout: high-conviction SNIPER trades get more room to develop.
    // Skip when entrySpot is unknown (restored from DB after restart) to avoid a false chop exit.
    // Adaptive rule: Do NOT exit if spot is moving in the intended direction (spotMovementGain > 0).
    const thetaTimeoutMs = tier === "SNIPER" ? 25 * 60 * 1000
                         : tier === "BALANCED" ? 20 * 60 * 1000
                         : 18 * 60 * 1000;
    if (elapsed > thetaTimeoutMs && pos.entrySpot > 0) {
      const percentageChange = Math.abs(spotMovementGain / spot) * 100;
      if (percentageChange < 0.15 && spotMovementGain <= 0) {
        const timeoutMins = Math.round(thetaTimeoutMs / 60000);
        this.triggerTierExit(tier, "THETA_EXIT", `Option premium decay warning. Sideways chop > ${timeoutMins} minutes without directional progress.`, timestamp, currentPremiumLtp);
        return;
      }
    }

    // Hard Stop Loss check
    if (currentPremiumLtp <= pos.activeSignal.stopLossPrice) {
      this.triggerTierExit(tier, "EXIT_STOP_LOSS", "Stop loss threshold crossed.", timestamp, currentPremiumLtp);
      return;
    }

    // Full Profit Target 2 check
    if (pos.activeSignal.targetPrice2 && currentPremiumLtp >= pos.activeSignal.targetPrice2) {
      this.triggerTierExit(tier, "EXIT_PROFIT", "Target 2 achieved. Full profit booked.", timestamp, currentPremiumLtp);
      return;
    }
    
    // Target 1 Trail Step-up & Multi-Lot Partial Profit Booking (50% Lot Exit)
    if (pos.activeSignal.targetPrice1 && currentPremiumLtp >= pos.activeSignal.targetPrice1 && !pos.isTarget1Locked) {
      pos.isTarget1Locked = true;
      const profitLockPrice = pos.activeSignal.entryPrice + 2.50;
      pos.activeSignal.stopLossPrice = parseFloat(profitLockPrice.toFixed(2));
      this.persistOpenPositionState(pos);

      // Perform Partial Profit Booking on 50% lot if position is multi-lot (>25 qty)
      if (pos.openTradeId) {
        try {
          const db = DatabaseService.initialize();
          const tradeRecord = db.prepare("SELECT * FROM paper_trades WHERE id = ?").get(pos.openTradeId) as any;
          if (tradeRecord && tradeRecord.qty > 25) {
            const partialQty = Math.floor(tradeRecord.qty / 2);
            const remainingQty = tradeRecord.qty - partialQty;
            const entryPx = tradeRecord.entry_price || pos.activeSignal.entryPrice;
            const grossPnl = partialQty * (currentPremiumLtp - entryPx);
            const fees = ExcelLogger.calculateStatutoryFees(currentPremiumLtp, partialQty);
            const netPnl = grossPnl - fees;

            ExcelLogger.logTransaction(
              "EXIT_PROFIT",
              pos.activeOptionSymbol || "NIFTY_OPTION",
              pos.activeSignal?.strikePrice || "",
              partialQty,
              currentPremiumLtp,
              `[${tier} TIER] Target 1 (+1.25R) Hit! Partial profit booked on 50% lot (${partialQty} qty). Remaining ${remainingQty} qty runner active with SL locked at breakeven.`,
              {
                tier,
                pnl: grossPnl,
                parentTradeId: pos.openTradeId,
                entryPrice: entryPx,
                marketRegime: pos.activeSignal?.regime,
                confluenceScore: pos.activeSignal?.scoreCard?.totalScore
              }
            ).catch(() => {});

            db.prepare("UPDATE paper_trades SET qty = ? WHERE id = ?").run(remainingQty, pos.openTradeId);
            console.log(`[AdvisoryManager] [${tier}] Multi-Lot Partial Profit Booked: ${partialQty} qty @ ₹${currentPremiumLtp.toFixed(2)} (Net PnL: ₹${netPnl.toFixed(2)}). Remaining ${remainingQty} qty runner active.`);
          }
        } catch (e) {
          console.error(`[AdvisoryManager] Error performing partial profit booking:`, e);
        }
      }

      console.log(`[AdvisoryManager] [${tier}] Target 1 crossed! Trailing stop stepped up to ₹${profitLockPrice.toFixed(2)}`);
      
      if (tier === "SNIPER") {
        const targetLockSignal: AdvisorySignal = {
          ...pos.activeSignal,
          type: "HOLD",
          reasoning: `Target 1 (+1.25R) achieved! 50% partial profit booked. Trailing stop locked at breakeven (₹${profitLockPrice.toFixed(2)}) for remaining 50% runner.`
        };
        this.onSignalCallback(targetLockSignal);
        TelegramService.sendSignalAlert(targetLockSignal).catch(() => {});
      }
    }
  }

  private triggerTierExit(tier: SignalTier, type: AdvisorySignal["type"], reasoning: string, timestamp: number, exitPrice?: number): void {
    const pos = this.tierPositions[tier];
    if (!pos.activeSignal) return;

    pos.dailyTradesCount++;
    const optionSymbol = pos.activeOptionSymbol;
    let formattedReasoning = `[${tier} TIER] ${reasoning}`;
    const entry = pos.activeSignal.entryPrice || 0;
    const exit = exitPrice || entry;
    const pnl = entry > 0 ? (exit - entry) : 0;

    // Unsubscribe option contract from broker WebSocket stream upon exit
    if (optionSymbol) {
      console.log(`[AdvisoryManager] [${tier}] Unsubscribing WebSocket from closed option contract: ${optionSymbol}`);
      this.broker.unsubscribeTicks([optionSymbol]);
    }

    if (type === "EXIT_STOP_LOSS") {
      pos.dailyLossesCount++;
      pos.dailyProfitLoss -= 1.0;
      pos.stoppedCooldownUntil = timestamp + 15 * 60 * 1000;
      console.log(`[Risk Engine] [${tier}] Stop-loss hit. Cooldown until ${new Date(pos.stoppedCooldownUntil).toLocaleTimeString()}. Daily P&L: ${pos.dailyProfitLoss.toFixed(2)}R.`);
    } else if (type === "EXIT_PROFIT") {
      const initialRisk = entry - (pos.activeSignal.stopLossPrice || 0);
      const ratio = initialRisk > 0 ? (pnl / initialRisk) : 1.5;
      pos.dailyProfitLoss += ratio;
      pos.stoppedCooldownUntil = timestamp + 5 * 60 * 1000;
      console.log(`[Risk Engine] [${tier}] Take-profit achieved (+${ratio.toFixed(2)}R). Cooldown until ${new Date(pos.stoppedCooldownUntil).toLocaleTimeString()}. Daily P&L: ${pos.dailyProfitLoss.toFixed(2)}R.`);
    } else if (type === "THETA_EXIT" || type === "SQUARE_OFF") {
      const initialRisk = entry - (pos.activeSignal.stopLossPrice || 0);
      const ratio = initialRisk > 0 ? (pnl / initialRisk) : 0;
      pos.dailyProfitLoss += ratio;
      // 45 minute cooldown after Theta Exit to prevent continuous chop re-entry loop
      const cooldownMs = type === "THETA_EXIT" ? 45 * 60 * 1000 : 5 * 60 * 1000;
      pos.stoppedCooldownUntil = timestamp + cooldownMs;
      console.log(`[Risk Engine] [${tier}] ${type} triggered (${ratio >= 0 ? '+' : ''}${ratio.toFixed(2)}R). 45-minute chop quarantine active until ${new Date(pos.stoppedCooldownUntil).toLocaleTimeString()}.`);
    }
    // Retrieve the actual entry qty from the open SQLite record (critical for dynamic lot sizing)
    let openTradeId: number | undefined = pos.openTradeId ?? undefined;
    let qty = parseInt(process.env.ORDER_QTY || "25", 10) || 25; // fallback default
    if (!openTradeId) {
      const openBuys = DatabaseService.getOpenBuyTrades(tier);
      if (openBuys.length > 0) {
        openTradeId = openBuys[openBuys.length - 1].id;
        qty = openBuys[openBuys.length - 1].qty || qty;
      }
    } else {
      // Read actual qty from the persisted BUY record (may be 2x for SUPER-SNIPER trades)
      const openBuys = DatabaseService.getOpenBuyTrades(tier);
      const matchingTrade = openBuys.find(t => t.id === openTradeId);
      if (matchingTrade) {
        qty = matchingTrade.qty || qty;
      }
    }

    const grossPnl = pnl * qty;
    const fees = ExcelLogger.calculateStatutoryFees(exit, qty);
    const netPnl = grossPnl - fees;
    if (openTradeId) {
      DatabaseService.markPaperTradeClosed(openTradeId, { pnl: grossPnl, fees, netPnl });
    }

    // Auto Execution SELL exit only for SNIPER Tier
    if (tier === "SNIPER" && process.env.AUTO_ORDER_EXECUTION === "true" && optionSymbol) {
      console.log(`[AdvisoryManager] [SNIPER] AUTO-EXECUTION ACTIVE. Placing SELL exit order for ${qty}x ${optionSymbol}`);
      this.broker.placeOptionOrder(optionSymbol, qty, "SELL", "MARKET")
        .then(orderId => {
          console.log(`[AdvisoryManager] AUTO SELL EXIT ORDER FILLED. Order ID: ${orderId}`);
          ExcelLogger.logTransaction(
            type,
            optionSymbol,
            pos.activeSignal?.strikePrice || "",
            qty,
            exit,
            `${reasoning} | Fyers Order: ${orderId}`,
            {
              tier,
              pnl,
              parentTradeId: openTradeId,
              entryPrice: entry,
              marketRegime: pos.activeSignal?.regime,
              confluenceScore: pos.activeSignal?.scoreCard?.totalScore
            }
          );

          this.onSignalCallback({
            type,
            tier,
            strikePrice: pos.activeSignal?.strikePrice,
            entryPrice: pos.activeSignal?.entryPrice,
            reasoning: `${reasoning} | Fyers Exit Order: ${orderId}`,
            timestamp
          });
        })
        .catch(err => {
          console.error(`[AdvisoryManager] AUTO EXIT ORDER PLACEMENT FAILED:`, err.message);
        });
    } else {
      ExcelLogger.logTransaction(
        type,
        optionSymbol || "",
        pos.activeSignal.strikePrice || "",
        qty,
        exit,
        formattedReasoning,
        {
          tier,
          pnl,
          parentTradeId: openTradeId,
          entryPrice: entry,
          marketRegime: pos.activeSignal?.regime,
          confluenceScore: pos.activeSignal?.scoreCard?.totalScore
        }
      );
    }

    // Log EXIT signal into SQLite database
    DatabaseService.logSignal(
      type,
      pos.activeSignal.strikePrice,
      exit,
      pos.activeSignal.stopLossPrice,
      pos.activeSignal.targetPrice1,
      pos.activeSignal.targetPrice2,
      formattedReasoning,
      tier
    );

    const exitSignal: AdvisorySignal = {
      type,
      tier,
      strikePrice: pos.activeSignal.strikePrice,
      entryPrice: exit,
      reasoning: formattedReasoning,
      timestamp
    };

    console.log(`[AdvisoryManager] [${tier} TIER] EXIT TRIGGERED: ${type}. Reason: ${reasoning} | P&L: ₹${pnl.toFixed(2)}`);

    if (tier === "SNIPER") {
      this.onSignalCallback(exitSignal);
      TelegramService.sendSignalAlert(exitSignal).catch(() => {});
    }

    pos.activeSignal = null;
    pos.entrySpot = 0;
    pos.liveOptionLtp = 0;
    pos.activeOptionSymbol = "";
    pos.activeOrderId = "";
    pos.openTradeId = 0;
    pos.isBreakevenLocked = false;
    pos.isTarget1Locked = false;
    pos.peakPremiumLtp = 0;
    pos.entryTime = 0;
  }

  private persistOpenPositionState(pos: TierPositionState): void {
    if (!pos.openTradeId || !pos.activeSignal) return;
    DatabaseService.updateOpenPaperTradeState(pos.openTradeId, {
      stopLoss: pos.activeSignal.stopLossPrice,
      peakPremium: pos.peakPremiumLtp,
      isBreakevenLocked: pos.isBreakevenLocked,
      isTarget1Locked: pos.isTarget1Locked
    });
  }

  public getCpr(): CPRValues | null {
    return this.cpr;
  }

  public getIndexSpotPrice(): number {
    return this.indexSpotPrice;
  }

  public getIndiaVixValue(): number {
    return this.indiaVixValue;
  }

  public getEngineStatus(timestamp: number = Date.now()) {
    const ist = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(timestamp));
    const [hStr, mStr] = ist.split(":");
    const hours = parseInt(hStr, 10);
    const minutes = parseInt(mStr, 10);
    const totalMinutes = hours * 60 + minutes;

    const hasOrb = this.orbHigh > 0 && this.orbLow > 0;
    const spot = this.indexSpotPrice;
    this.refreshSessionVwap(timestamp, spot);
    const isLunchBlock = totalMinutes >= 690 && totalMinutes <= 810;
    const insideCpr = !!(this.cpr && spot > 0 && CPR.isPriceInsideCPR(spot, this.cpr));

    let sessionPhase = "CLOSED";
    if (hours === 9 && minutes >= 15 && minutes < 30) sessionPhase = "ORB";
    else if (hours === 9 && minutes >= 30) sessionPhase = "ACTIVE";
    else if (hours >= 10 && hours < 15 && !isLunchBlock) sessionPhase = "ACTIVE";
    else if (isLunchBlock) sessionPhase = "LUNCH";
    else if (hours === 15 && minutes < 15) sessionPhase = "ACTIVE";
    else if (hours === 15 && minutes >= 15) sessionPhase = "SQUARE_OFF";
    else if (hours < 9 || (hours === 9 && minutes < 15)) sessionPhase = "PRE_OPEN";

    const closePrices = this.indexCandles.map((c) => c.close);
    const { trendBullish, trendBearish } = getIntradayEmaTrend(closePrices, spot);
    const volumeHigh = isClosedBarVolumeExpanded(this.indexCandles.map((c) => c.volume));
    const aboveVwap = spot > this.currentVwap;
    const buffer = orbConfirmationBuffer(spot);

    const ptsToCall = hasOrb ? this.orbHigh - spot : 0;
    const ptsToPut = hasOrb ? spot - this.orbLow : 0;
    const insideOrb = hasOrb && spot <= this.orbHigh && spot >= this.orbLow;
    const brokeCall = hasOrb && spot > this.orbHigh + buffer;
    const brokePut = hasOrb && spot < this.orbLow - buffer;

    const dbOpenBuys = DatabaseService.getOpenBuyTrades();
    const openBuyTier = (["SNIPER", "BALANCED", "EXPLORATORY"] as const).find(
      (t) => this.tierPositions[t].activeSignal?.type.includes("BUY")
    ) || (dbOpenBuys[0]?.tier as SignalTier | undefined);

    let waitingReason = "Waiting for market data.";
    if (openBuyTier) {
      waitingReason = isLunchBlock
        ? `Open ${openBuyTier} trade is still managed through lunch (stop-loss, targets, theta). New entries stay blocked until 1:30 PM.`
        : `Active ${openBuyTier} signal is live. Targets are on the signal card.`;
    } else if (!hasOrb) {
      waitingReason = "Opening range is not captured yet. ORB is built from 9:15–9:30 AM IST.";
    } else if (sessionPhase === "PRE_OPEN") {
      waitingReason = "Session has not opened. Signals start after the 9:15–9:30 AM ORB window.";
    } else if (sessionPhase === "ORB") {
      waitingReason = `Building opening range. CALL above ${this.orbHigh.toFixed(2)}, PUT below ${this.orbLow.toFixed(2)}.`;
    } else if (sessionPhase === "LUNCH") {
      waitingReason = "Lunch dead zone (11:30 AM–1:30 PM IST). New entries are blocked. Open trades would still exit on stop-loss, targets, or theta.";
    } else if (sessionPhase === "SQUARE_OFF" || sessionPhase === "CLOSED") {
      waitingReason = "New entries are closed for the day (3:15 PM square-off).";
    } else if (insideCpr) {
      waitingReason = "Spot is inside CPR. Breakout entries are withheld until price leaves the pivot range.";
    } else if (insideOrb) {
      waitingReason = `Nifty is inside the opening range. CALL needs a break above ${this.orbHigh.toFixed(2)}; PUT needs a break below ${this.orbLow.toFixed(2)}.`;
    } else if (hasOrb && spot > this.orbHigh && !brokeCall) {
      waitingReason = `ORB high tagged. CALL needs a confirmed hold ${buffer.toFixed(1)} pts above ${this.orbHigh.toFixed(2)}.`;
    } else if (hasOrb && spot < this.orbLow && !brokePut) {
      waitingReason = `ORB low tagged. PUT needs a confirmed hold ${buffer.toFixed(1)} pts below ${this.orbLow.toFixed(2)}.`;
    } else if (brokeCall && !aboveVwap) {
      waitingReason = `ORB high is broken, but spot is still below session VWAP (${this.currentVwap.toFixed(2)}). CALL is blocked.`;
    } else if (brokeCall && !trendBullish) {
      waitingReason = "ORB high is broken, but 5-minute 9/21 EMA is not bullish. CALL is blocked.";
    } else if (brokePut && aboveVwap) {
      waitingReason = `ORB low is broken, but spot is still above session VWAP (${this.currentVwap.toFixed(2)}). PUT is blocked.`;
    } else if (brokePut && !trendBearish) {
      waitingReason = "ORB low is broken, but 5-minute 9/21 EMA is not bearish. PUT is blocked.";
    } else if (brokeCall || brokePut) {
      waitingReason = this.lastSignalBlockReason
        || "ORB is broken and local filters passed. Pricing the option chain for strike and targets.";
    }

    return {
      spot,
      vwap: this.currentVwap,
      vix: this.indiaVixValue,
      orbHigh: this.orbHigh,
      orbLow: this.orbLow,
      ptsToCall,
      ptsToPut,
      insideOrb,
      insideCpr,
      isLunchBlock,
      sessionPhase,
      waitingReason,
      hasActiveSignal: !!(
        this.tierPositions.SNIPER.activeSignal
        || this.tierPositions.BALANCED.activeSignal
        || this.tierPositions.EXPLORATORY.activeSignal
        || dbOpenBuys.length > 0
      ),
      filters: {
        hasOrb,
        aboveVwap,
        volumeHigh,
        trendBullish,
        trendBearish
      }
    };
  }

  public getTierPositions() {
    return this.tierPositions;
  }

  public getActivePositions(): ActivePositionInfo[] {
    const positions: ActivePositionInfo[] = [];
    const allTiers: SignalTier[] = ["SNIPER", "BALANCED", "EXPLORATORY"];
    const defaultQty = parseInt(process.env.ORDER_QTY || "25", 10) || 25;

    for (const t of allTiers) {
      let pos = this.tierPositions[t];
      if (!pos.activeSignal) {
        // Fallback: Check SQLite for any open trades for this tier
        const dbOpenTrades = DatabaseService.getOpenBuyTrades(t);
        if (dbOpenTrades.length > 0) {
          this.hydrateOpenPositionsFromDb();
          pos = this.tierPositions[t];
        }
      }

      if (pos.activeSignal && pos.activeSignal.type.includes("BUY") && pos.activeSignal.entryPrice) {
        const entry = pos.activeSignal.entryPrice;

        // Read actual qty from the persisted trade record (critical for dynamic 2x lot sizing)
        let qty = defaultQty;
        if (pos.openTradeId) {
          try {
            const openBuys = DatabaseService.getOpenBuyTrades(t);
            const matchingTrade = openBuys.find(tr => tr.id === pos.openTradeId);
            if (matchingTrade && matchingTrade.qty > 0) {
              qty = matchingTrade.qty;
            }
          } catch {}
        }

        // Priority 1: Live option tick from Fyers WebSocket (most accurate)
        // Priority 2: Delta model from Nifty spot movement (when option tick unavailable)
        // Priority 3: Entry price (last resort - should rarely happen)
        let currentLtp: number;
        if (pos.liveOptionLtp && pos.liveOptionLtp > 0) {
          currentLtp = pos.liveOptionLtp;
        } else if (this.indexSpotPrice > 0) {
          // Lock entrySpot on first tick after startup if it was missing/0
          if (pos.entrySpot <= 0) {
            pos.entrySpot = this.indexSpotPrice;
          }
          const deltaMultiplier = 0.50;
          const refSpot = pos.entrySpot;
          const spotMove = pos.activeSignal.type.includes("CALL")
            ? (this.indexSpotPrice - refSpot)
            : (refSpot - this.indexSpotPrice);
          currentLtp = parseFloat(Math.max(0.50, entry + (spotMove * deltaMultiplier)).toFixed(2));
        } else {
          currentLtp = entry;
        }
        const pnl = parseFloat(((currentLtp - entry) * qty).toFixed(2));
        const pnlPercent = parseFloat((((currentLtp - entry) / entry) * 100).toFixed(2));
        const strike = pos.activeSignal.strikePrice || (pos.activeOptionSymbol ? pos.activeOptionSymbol.replace(/[^0-9]/g, "") : "--");

        positions.push({
          tier: t,
          symbol: pos.activeOptionSymbol || `NSE:NIFTY_${strike}_${pos.activeSignal.type.includes("CALL") ? "CE" : "PE"}`,
          strike,
          type: pos.activeSignal.type,
          qty,
          entryPrice: entry,
          currentLtp,
          pnl,
          pnlPercent,
          stopLoss: pos.activeSignal.stopLossPrice || 0,
          target1: pos.activeSignal.targetPrice1,
          target2: pos.activeSignal.targetPrice2,
          isBreakevenLocked: pos.isBreakevenLocked,
          isTarget1Locked: pos.isTarget1Locked,
          entryTime: pos.entryTime,
          entrySpot: pos.entrySpot,
          currentSpot: this.indexSpotPrice,
          openTradeId: pos.openTradeId
        });
      }
    }

    return positions;
  }

  public getTodayRealizedPnl(tier?: string): number {
    return DatabaseService.getTodayRealizedPnl(Date.now(), tier);
  }

  public setSamplePositionsActive(active: boolean) {
    if (!active) {
      this.sampleActiveTiers.clear();
    } else {
      this.sampleActiveTiers = new Set(["SNIPER", "BALANCED", "EXPLORATORY"]);
    }
  }

  public manualExitPosition(tier: SignalTier, exitReason: string = "Manual user exit from Positions Dashboard"): boolean {
    this.sampleActiveTiers.delete(tier);
    const pos = this.tierPositions[tier];
    if (pos && pos.activeSignal) {
      const currentLtp = (pos.liveOptionLtp && pos.liveOptionLtp > 0) ? pos.liveOptionLtp : (pos.activeSignal.entryPrice || 0);
      this.triggerTierExit(
        tier,
        "EXIT_PROFIT",
        `[MANUAL EXIT] ${exitReason}`,
        Date.now(),
        currentLtp
      );
    }
    return true;
  }

  private formatFyersOptionSymbol(strike: number, type: "CALL_BUY" | "PUT_BUY", timestamp: number): string {
    const d = new Date(timestamp);
    const yearSuffix = d.getFullYear().toString().slice(-2);
    const month = d.getMonth() + 1;
    const monthCode = month === 10 ? "O" : month === 11 ? "N" : month === 12 ? "D" : month.toString();
    const dayOfWeek = d.getDay();
    const daysUntilThursday = (4 - dayOfWeek + 7) % 7;
    const expiryDate = new Date(d.getTime() + daysUntilThursday * 24 * 60 * 60 * 1000);
    const dayStr = expiryDate.getDate().toString().padStart(2, "0");
    const suffix = type === "CALL_BUY" ? "CE" : "PE";

    return `NSE:NIFTY${yearSuffix}${monthCode}${dayStr}${strike}${suffix}`;
  }
}
