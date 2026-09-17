import { IBrokerAdapter, Candle, OptionChainItem, CompactTick } from "../adapters/IBrokerAdapter";
import { Indicators } from "../utils/indicators";
import { Greeks } from "../utils/greeks";
import { CPR, CPRValues } from "../utils/cpr";
import { ExcelLogger } from "../utils/excelLogger";
import { QuantitativeEngine, StrategySetup, SignalScoreCard } from "../utils/quantitativeEngine";
import { DatabaseService, SignalTier } from "../utils/database";
import { TelegramService } from "./telegramService";
import {
  getIntradayEmaTrend,
  isClosedBarVolumeExpanded,
  orbConfirmationBuffer
} from "../utils/niftyOptionsSetup";
import { GeminiRiskOfficer } from "./geminiRiskOfficer";
import { GiftNiftyService, GiftNiftyData } from "./giftNiftyService";
import { PostExitTracker } from "../utils/postExitTracker";

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

export interface PendingLimitEntry {
  type: "CALL_BUY" | "PUT_BUY";
  setupType: StrategySetup;
  strike: number;
  limitSpot: number;
  signalSpot?: number;
  optionLtpAtSignal: number;
  reasoning: string;
  expiresAt: number;
  scoreCard: SignalScoreCard;
  delta: number;
  scaledStopLoss: number;
  scaledTarget1: number;
  scaledTarget2: number;
  optionSymbol?: string;
}

interface TierPositionState {
  activeSignal: AdvisorySignal | null;
  entrySpot: number;
  entryDelta?: number;
  originalInitialRisk?: number;
  lastLossDirection?: "CALL_BUY" | "PUT_BUY";
  directionalCooldownUntil?: number;
  pendingEntry?: PendingLimitEntry | null;
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
  isExitInFlight?: boolean;
}

export class AdvisoryManager {
  private broker: IBrokerAdapter;
  private cpr: CPRValues | null = null;
  private indexSpotPrice: number = 0;
  private indiaVixValue: number = 15; // default placeholder
  
  // Tickers tracking
  private heavyweightLtp: { [symbol: string]: number } = {
    "NSE:NIFTYBANK-INDEX": 0,
    "NSE:NIFTYIT-INDEX": 0,
    "NSE:FINNIFTY-INDEX": 0,
    "NSE:RELIANCE-EQ": 0,
    "NSE:HDFCBANK-EQ": 0,
    "NSE:ICICIBANK-EQ": 0,
    "NSE:INFY-EQ": 0,
    "NSE:TCS-EQ": 0,
    "NSE:LT-EQ": 0,
    "NSE:AXISBANK-EQ": 0,
    "NSE:KOTAKBANK-EQ": 0
  };
  private heavyweightVwap: { [symbol: string]: number } = {
    "NSE:NIFTYBANK-INDEX": 0,
    "NSE:NIFTYIT-INDEX": 0,
    "NSE:FINNIFTY-INDEX": 0,
    "NSE:RELIANCE-EQ": 0,
    "NSE:HDFCBANK-EQ": 0,
    "NSE:ICICIBANK-EQ": 0,
    "NSE:INFY-EQ": 0,
    "NSE:TCS-EQ": 0,
    "NSE:LT-EQ": 0,
    "NSE:AXISBANK-EQ": 0,
    "NSE:KOTAKBANK-EQ": 0
  };
  private heavyweightNetChange: { [symbol: string]: number } = {
    "NSE:NIFTYBANK-INDEX": 0,
    "NSE:NIFTYIT-INDEX": 0,
    "NSE:FINNIFTY-INDEX": 0,
    "NSE:RELIANCE-EQ": 0,
    "NSE:HDFCBANK-EQ": 0,
    "NSE:ICICIBANK-EQ": 0,
    "NSE:INFY-EQ": 0,
    "NSE:TCS-EQ": 0,
    "NSE:LT-EQ": 0,
    "NSE:AXISBANK-EQ": 0,
    "NSE:KOTAKBANK-EQ": 0
  };
  private heavyweightVolumes: { [symbol: string]: { cumVol: number; cumPv: number } } = {};
  private latestGiftNifty: GiftNiftyData | null = null;

  // Nifty price candles for calculations
  private indexCandles: Candle[] = [];
  private currentVwap: number = 0;

  // ORB parameters
  private activeTradingDateKey: string = "";
  private isOrbActive: boolean = false;
  private isOrbLocked: boolean = false;
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
  private failedTrapLevels: { level: number; type: "HIGH" | "LOW"; expiredAt: number }[] = [];
  private prevDayClose: number = 0;
  private openingGapPoints: number = 0;
  private openingGapPercent: number = 0;
  private dailyAtr: number = 90;

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

  // Risk parameters for ₹10,000/day profitability blueprint
  private dailyLossLimit: number = -2.5; // max -2.5R daily drawdown
  private dailyMaxTrades: number = 3; // max 3 trades per day (Balanced High-Conviction)
  private maxDailyRupeeLoss: number = parseInt(process.env.MAX_DAILY_LOSS || "5000", 10) || 5000; // max ₹5,000 daily drawdown hard stop

  public getDailyMaxTrades(): number {
    const envVal = process.env.DAILY_MAX_TRADES;
    let maxTrades = envVal !== undefined ? parseInt(envVal, 10) : 3;
    if (isNaN(maxTrades)) maxTrades = 3;
    try {
      const db = DatabaseService.initialize();
      const row = db.prepare("SELECT value FROM settings WHERE key = 'DAILY_MAX_TRADES'").get() as { value: string } | undefined;
      if (row) {
        const parsed = parseInt(row.value, 10);
        if (!isNaN(parsed) && parsed > 0) maxTrades = parsed;
      }
    } catch (e) {}
    return maxTrades;
  }

  // Delta OI and Delta VIX tracking for Institutional Acceleration Guard
  private prevTotalCallOi: number = 0;
  private prevTotalPutOi: number = 0;
  private prevVix: number = 0;

  // Post-Exit Self-Tuning Routine state (calibrated from post_exit_analytics & trade history)
  private selfTuningParams: {
    targetMultiplier: number;
    runnerTrailingRiskMultiplier: number;
    minScoreAdjustment: number;
    insights: string[];
  } = {
    targetMultiplier: 1.0,
    runnerTrailingRiskMultiplier: 1.0,
    minScoreAdjustment: 0,
    insights: []
  };

  public getSelfTuningParameters() {
    return this.selfTuningParams;
  }

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
    const today = new Date();
    const prevDate = new Date(today);
    prevDate.setDate(prevDate.getDate() - 5); // Go back 5 days to ensure we get a trading day

    const todayStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(today);

    const prevDateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(prevDate);

    try {
      const candles = await this.broker.getHistoricalCandles(
        "NSE:NIFTY50-INDEX",
        "D",
        prevDateStr,
        todayStr
      );

      if (candles.length > 0) {
        const lastDay = candles[candles.length - 1];
        this.prevDayClose = lastDay.close;
        this.dailyAtr = Math.max(60, (lastDay.high - lastDay.low));
        this.cpr = CPR.calculateCPR(lastDay.high, lastDay.low, lastDay.close);
        console.log(`[AdvisoryManager] Daily CPR calculated: Pivot=${this.cpr.pivot.toFixed(2)}, Range=[${this.cpr.bottomRange.toFixed(2)} - ${this.cpr.topRange.toFixed(2)}], PrevClose=${this.prevDayClose.toFixed(2)}, DailyATR=${this.dailyAtr.toFixed(1)}`);
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

    // Calibrate parameters from automated Post-Exit Self-Tuning Routine
    try {
      this.selfTuningParams = DatabaseService.getSelfTuningParameters();
      if (this.selfTuningParams.insights.length > 0) {
        console.log(`[AdvisoryManager] 🧠 Post-Exit Self-Tuning Active: TargetMult=${this.selfTuningParams.targetMultiplier}x, RunnerTrail=${this.selfTuningParams.runnerTrailingRiskMultiplier}R, ScoreAdj=+${this.selfTuningParams.minScoreAdjustment}`);
        this.selfTuningParams.insights.forEach(i => console.log(`[AdvisoryManager] 🧠 ${i}`));
      }
    } catch (e) {}

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
    this.isOrbLocked = false;
    this.lastBreakoutEvalAt = 0;
    this.lastSignalBlockReason = "";
    this.lastTriggeredBreakoutLevel = { CALL_BUY: 0, PUT_BUY: 0 };
    this.isSignalGeneratedToday = false;
    this.currentVwap = 0;

    const allTiers: SignalTier[] = ["SNIPER", "BALANCED", "EXPLORATORY"];
    for (const t of allTiers) {
      const pos = this.tierPositions[t];
      pos.activeSignal = null;
      pos.pendingEntry = null;
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
      pos.directionalCooldownUntil = 0;
      pos.lastLossDirection = undefined;
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
      return hours === 9 && minutes >= 15 && minutes < 30;
    });

    if (orbCandles.length === 0) return;

    this.orbHigh = Math.max(...orbCandles.map((c) => c.high));
    this.orbLow = Math.min(...orbCandles.map((c) => c.low));
    this.isOrbActive = false;
    this.isOrbLocked = true;
    this.lastTriggeredBreakoutLevel = { CALL_BUY: 0, PUT_BUY: 0 };
    console.log(
      `[AdvisoryManager] 🔒 ORB hydrated from history (${orbCandles.length} bars): High=${this.orbHigh.toFixed(2)}, Low=${this.orbLow.toFixed(2)} (LOCKED)`
    );
  }

  /**
   * Self-Healing Engine: If restarted after 9:30 AM or if initial broker connection
   * was unauthenticated, dynamically fetches historical candles, hydrates ORB boundaries,
   * and calculates session VWAP on demand so trading is NEVER blocked.
   */
  public async ensureHistoricalDataAndOrb(spot: number = 0): Promise<boolean> {
    if (this.orbHigh > 0 && this.orbLow > 0 && this.indexCandles.length >= 10) {
      return true;
    }

    try {
      const today = new Date();
      const prevDate = new Date(today);
      prevDate.setDate(prevDate.getDate() - 5);

      const todayStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(today);

      const prevDateStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(prevDate);

      // 1. Fetch 5-minute historical candles
      const historical5m = await this.broker.getHistoricalCandles(
        "NSE:NIFTY50-INDEX",
        "5",
        prevDateStr,
        todayStr
      );

      if (historical5m && historical5m.length > 0) {
        this.indexCandles = historical5m;
        this.hydrateOrbFromHistory();
        this.refreshSessionVwap();
        console.log(`[AdvisoryManager] 🔄 Self-healing complete: Loaded ${this.indexCandles.length} candles. ORB High=${this.orbHigh.toFixed(2)}, Low=${this.orbLow.toFixed(2)}, VWAP=${this.currentVwap.toFixed(2)}`);
      }

      // 2. Fetch daily candle for CPR & Daily ATR if missing
      if (!this.cpr || this.prevDayClose === 0) {
        const dailyCandles = await this.broker.getHistoricalCandles(
          "NSE:NIFTY50-INDEX",
          "D",
          prevDateStr,
          todayStr
        );
        if (dailyCandles && dailyCandles.length > 0) {
          const lastDay = dailyCandles[dailyCandles.length - 1];
          this.prevDayClose = lastDay.close;
          this.dailyAtr = Math.max(60, lastDay.high - lastDay.low);
          this.cpr = CPR.calculateCPR(lastDay.high, lastDay.low, lastDay.close);
          console.log(`[AdvisoryManager] 🔄 Self-healing CPR calculated: Pivot=${this.cpr.pivot.toFixed(2)}, Range=[${this.cpr.bottomRange.toFixed(2)} - ${this.cpr.topRange.toFixed(2)}], PrevClose=${this.prevDayClose.toFixed(2)}`);
        }
      }
    } catch (err) {
      console.warn("[AdvisoryManager] Could not fetch historical candles for self-healing:", err);
    }

    // Dynamic Fallback: If ORB still uncaptured (e.g. historical candles API unavailable),
    // calculate synthetic ORB from session high/low or spot price so VWAP Pullback is NEVER blocked!
    if (this.orbHigh <= 0 || this.orbLow <= 0) {
      const effectiveSpot = spot > 0 ? spot : (this.indexSpotPrice > 0 ? this.indexSpotPrice : 23500);
      const sessionHigh = this.dayHigh > 0 ? this.dayHigh : effectiveSpot + 25;
      const sessionLow = this.dayLow < Infinity ? this.dayLow : effectiveSpot - 25;
      this.orbHigh = sessionHigh;
      this.orbLow = sessionLow;
      this.isOrbActive = false;
      this.isOrbLocked = true;
      console.log(`[AdvisoryManager] 🛡️ Fallback ORB Activated: High=${this.orbHigh.toFixed(2)}, Low=${this.orbLow.toFixed(2)} (LOCKED)`);
    }

    return true;
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
      pos.entryDelta = 0.50; // default standard ATM delta
      pos.peakPremiumLtp = trade.peak_premium && trade.peak_premium > 0 ? trade.peak_premium : trade.price;
      pos.isBreakevenLocked = !!trade.is_breakeven_locked;
      pos.isTarget1Locked = !!trade.is_target1_locked;
      pos.entryTime = trade.timestamp;
      pos.activeOptionSymbol = trade.symbol;
      pos.liveOptionLtp = null; // intentionally null — force delta model until real live tick arrives
      pos.openTradeId = trade.id;
      pos.originalInitialRisk = trade.initial_stop_loss && trade.initial_stop_loss > 0
        ? Math.max(1.0, trade.price - trade.initial_stop_loss)
        : Math.max(1.0, trade.price - (trade.stop_loss ?? (trade.price - 20)));

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
      this.tierPositions[t].pendingEntry = null; // Cancel any stale pending entries
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
      try {
        await this.resetDailySession(currentDateKey);
      } catch (err) {
        console.error("[AdvisoryManager] Day rollover reset failed:", err);
      }
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
      
      // 9:15–9:30 AM IST Opening Range (ORB) tracking window
      if (hours === 9 && minutes >= 15 && minutes < 30) {
        if (!this.isOrbLocked) {
          if (!this.isOrbActive || this.orbHigh <= 0 || this.orbLow <= 0) {
            this.orbHigh = tick.ltp;
            this.orbLow = tick.ltp;
            this.isOrbActive = true;
            if (this.prevDayClose > 0 && this.openingGapPoints === 0) {
              this.openingGapPoints = tick.ltp - this.prevDayClose;
              this.openingGapPercent = (this.openingGapPoints / this.prevDayClose) * 100;
              console.log(`[AdvisoryManager] 🌅 9:15 AM Opening Gap Detected: ${this.openingGapPoints >= 0 ? '+' : ''}${this.openingGapPoints.toFixed(2)} pts (${this.openingGapPercent.toFixed(2)}%) vs Yesterday Close (${this.prevDayClose.toFixed(2)})`);
            }
            console.log(`[AdvisoryManager] 9:15 AM Opening Drive window active. Tracking boundaries.`);
          }
          this.orbHigh = Math.max(this.orbHigh, tick.ltp);
          this.orbLow = Math.min(this.orbLow, tick.ltp);
        }
      }

      // Lock ORB range permanently after 9:30 AM IST
      if ((hours === 9 && minutes >= 30) || (hours >= 10 && hours < 15) || (hours === 15 && minutes < 15)) {
        if (!this.isOrbLocked && (this.orbHigh > 0 || this.orbLow > 0)) {
          this.isOrbActive = false;
          this.isOrbLocked = true;
          console.log(`[AdvisoryManager] 🔒 9:30 AM ORB locked permanently: High=${this.orbHigh.toFixed(2)}, Low=${this.orbLow.toFixed(2)}`);
        }
      }

      // Phase 1A: Process any pending limit pullback entry
      const sniperPos = this.tierPositions.SNIPER;
      if (sniperPos.pendingEntry) {
        if (timestamp > sniperPos.pendingEntry.expiresAt) {
          console.log(`[AdvisoryManager] [SNIPER] ⏳ Pending limit entry expired without 50% pullback retracement. Cancelled.`);
          sniperPos.pendingEntry = null;
        } else {
          const p = sniperPos.pendingEntry;
          const maxAdversePenetration = 12.0; // Max 12 pts past 50% pullback level before setup is invalidated

          // Falling Knife / Rocket Surge Guard: Invalidate if spot slices through pullback level by > 12 points
          const isInvalidated = p.type === "CALL_BUY"
            ? tick.ltp < (p.limitSpot - maxAdversePenetration)
            : tick.ltp > (p.limitSpot + maxAdversePenetration);

          if (isInvalidated) {
            console.warn(`[AdvisoryManager] [SNIPER] ⚠️ Retracement invalidated! Spot sliced through pullback level (${tick.ltp.toFixed(1)} vs limit ${p.limitSpot.toFixed(1)} by >${maxAdversePenetration} pts). Cancelling limit order to prevent adverse fill.`);
            sniperPos.pendingEntry = null;
          } else {
            const isFilled = p.type === "CALL_BUY"
              ? tick.ltp <= p.limitSpot
              : tick.ltp >= p.limitSpot;
            if (isFilled) {
              sniperPos.pendingEntry = null;

              // Phase 2B Accuracy: Calculate true retraced option price at fill moment
              let fillOptionPrice = 0;
              if (this.broker.getQuotes && p.optionSymbol) {
                try {
                  const quotes = await this.broker.getQuotes([p.optionSymbol]);
                  if (quotes && quotes[p.optionSymbol]?.ltp > 0) {
                    fillOptionPrice = quotes[p.optionSymbol].ltp;
                  }
                } catch {}
              }

              // Delta-adjusted pullback estimate if live quote is not immediately available
              if (fillOptionPrice <= 0) {
                const spotRetraced = Math.abs(tick.ltp - (p.signalSpot || p.limitSpot));
                const priceDiscount = spotRetraced * p.delta;
                fillOptionPrice = Math.max(0.5, p.optionLtpAtSignal - priceDiscount);
              }
              fillOptionPrice = parseFloat(fillOptionPrice.toFixed(2));

              // Capital Defense Check at fill time: Prevent buying decayed/cheap contracts
              if (fillOptionPrice < 45.0 || p.scaledStopLoss > fillOptionPrice * 0.45) {
                console.warn(`[AdvisoryManager] [SNIPER] 🛡️ Retracement limit filled, but option price (₹${fillOptionPrice}) failed capital defense gate. Entry aborted.`);
                return;
              }

              console.log(`[AdvisoryManager] [SNIPER] 🎯 Limit order filled on pullback! Executing ${p.type} entry at spot ${tick.ltp.toFixed(1)} (limit target was ${p.limitSpot.toFixed(1)}), option fill price: ₹${fillOptionPrice}.`);
              await this.executePositionEntry(
                "SNIPER",
                tick.ltp,
                p.type,
                p.setupType,
                p.strike,
                fillOptionPrice,
                p.delta,
                p.scaledStopLoss,
                p.scaledTarget1,
                p.scaledTarget2,
                p.scoreCard,
                `${p.reasoning} [Filled at 50% Retracement: ${tick.ltp.toFixed(1)} @ ₹${fillOptionPrice.toFixed(2)}]`,
                timestamp,
                p.optionSymbol
              );
            }
          }
        }
      }

      // Phase 2B: Evaluate signals starting from 10:00 AM IST to 3:15 PM IST!
      const canEvaluateSignals = (hours >= 10 && hours < 15) || (hours === 15 && minutes < 15);
      if (canEvaluateSignals) {
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

    // 3. Track Heavyweights & calculate continuous intraday cumulative VWAP (Bug D fix: volume > 0)
    if (tick.symbol in this.heavyweightLtp && tick.ltp > 0) {
      this.heavyweightLtp[tick.symbol] = tick.ltp;
      if (typeof tick.netChangePercent === "number" && !isNaN(tick.netChangePercent)) {
        this.heavyweightNetChange[tick.symbol] = tick.netChangePercent;
      } else if (typeof tick.netChange === "number" && tick.prevClose && tick.prevClose > 0) {
        this.heavyweightNetChange[tick.symbol] = parseFloat(((tick.netChange / tick.prevClose) * 100).toFixed(2));
      }
      const vol = (tick.volume && tick.volume > 0) ? tick.volume : 0;
      if (vol > 0) {
        const prev = this.heavyweightVolumes[tick.symbol] || { cumVol: 0, cumPv: 0 };
        const newVol = prev.cumVol + vol;
        const newPv = prev.cumPv + tick.ltp * vol;
        this.heavyweightVolumes[tick.symbol] = { cumVol: newVol, cumPv: newPv };
        this.heavyweightVwap[tick.symbol] = parseFloat((newPv / newVol).toFixed(2));
      } else if (!this.heavyweightVwap[tick.symbol] || this.heavyweightVwap[tick.symbol] === 0) {
        this.heavyweightVwap[tick.symbol] = tick.ltp;
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
          this.monitorTierRiskState(t, this.indexSpotPrice > 0 ? this.indexSpotPrice : (p.entrySpot || 0), timestamp);
        }
      }
    }

    // 6. Update Post-Exit Intelligence Tracker for closed positions
    if (tick.ltp > 0) {
      PostExitTracker.onPriceTick(tick.symbol, tick.ltp, Date.now());
    }
  }

  /**
   * Evaluates if a high-probability breakout direction occurred and routes to appropriate tier
   */
  private async evaluateBreakoutSignals(spot: number, timestamp: number): Promise<void> {
    // Account-Level Anti-Overtrading Guard: Global Daily Trade Cap (2 trades) & 2-Loss Circuit Breaker
    const globalLock = DatabaseService.isGlobalDailyTradingLocked(timestamp, this.getDailyMaxTrades());
    if (globalLock.locked) {
      this.lastSignalBlockReason = globalLock.reason;
      return;
    }

    // Track whether current bar is inside midday lunch hour (11:45 AM to 1:15 PM IST)
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
    const isLunchHour = istTotalMinutes >= 705 && istTotalMinutes < 795; // 11:45 AM to 1:15 PM IST

    // Thursday Weekly Expiry Guard (Phase 3/Category 4): Cut off new entries after 12:00 PM IST due to accelerated gamma/theta collapse
    const istDayName = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short" }).format(new Date(timestamp));
    if (istDayName === "Thu" && istTotalMinutes >= 720) {
      this.lastSignalBlockReason = "Thursday Expiry Day: New entries blocked after 12:00 PM IST due to accelerated gamma and theta collapse.";
      return;
    }

    // Universal Daily Realized Rupee Loss Stop: Hard circuit breaker if daily loss reaches -₹5,000
    const todayRealizedPnl = DatabaseService.getTodayRealizedPnl(timestamp);
    if (todayRealizedPnl <= -this.maxDailyRupeeLoss) {
      this.lastSignalBlockReason = `Universal Daily Rupee Drawdown Stop: Realized PnL (-₹${Math.abs(todayRealizedPnl).toFixed(2)}) reached max daily loss limit (-₹${this.maxDailyRupeeLoss}). Trading locked for today.`;
      console.warn(`[AdvisoryManager] 🛑 ${this.lastSignalBlockReason}`);
      return;
    }

    // CPR Filter Check: Nuanced evaluation
    // If CPR is abnormally wide (> 50 pts or > 0.35% of spot), CPR boundaries act as S/R levels rather than a total dead-zone.
    // Inside CPR penalties are handled directly by QuantitativeEngine.calculateConfluenceScore.
    const isCprExtremelyWide = !!(this.cpr && (this.cpr.topRange - this.cpr.bottomRange) > Math.min(50, spot * 0.0035));
    if (this.cpr && !isCprExtremelyWide && CPR.isPriceInsideCPR(spot, this.cpr)) {
      const cprMid = this.cpr.pivot;
      if (Math.abs(spot - cprMid) < 8) {
        this.lastSignalBlockReason = `Price sitting in narrow CPR consolidation zone [${this.cpr.bottomRange.toFixed(1)} - ${this.cpr.topRange.toFixed(1)}]. Waiting for breakout.`;
        return;
      }
    }

    // Self-healing check: Ensure ORB & history are loaded even if backend started late (e.g. 10:00 AM)
    if (this.orbHigh <= 0 || this.orbLow <= 0 || this.indexCandles.length < 5) {
      await this.ensureHistoricalDataAndOrb(spot);
    }

    const isAboveVwap = spot > this.currentVwap;
    const closePrices = this.indexCandles.map(c => c.close);
    const { trendBullish: isTrendBullish, trendBearish: isTrendBearish } = getIntradayEmaTrend(closePrices, spot);

    // Phase 6C: 15-Minute Higher Timeframe Trend Alignment
    const candles15m = Indicators.aggregate5mTo15m(this.indexCandles);
    const closes15m = candles15m.map(c => c.close);
    const trend15m = getIntradayEmaTrend(closes15m, spot);

    // Phase 6B: ADX Trend Strength Calculation
    const currentAdx = Indicators.calculateCandleADX(this.indexCandles.slice(-35), 14);

    let candidate: "CALL_BUY" | "PUT_BUY" | null = null;
    let setupType: StrategySetup = "VWAP_PULLBACK";
    let reasoning = "";

    const closedCandles = this.indexCandles.length > 1 ? this.indexCandles.slice(0, -1) : [];
    const lastClosedCandle = closedCandles.length > 0 ? closedCandles[closedCandles.length - 1] : undefined;

    // Determine Intraday Trend Direction
    // If market is trending (e.g. below VWAP with bearish EMAs or above VWAP with bullish EMAs),
    // we PRIORITIZE TREND-FOLLOWING BREAKOUTS & PULLBACKS and block counter-trend knife catching!
    const isIntradayBearTrend = !isAboveVwap && (isTrendBearish || spot < this.currentVwap - 10);
    const isIntradayBullTrend = isAboveVwap && (isTrendBullish || spot > this.currentVwap + 10);

    // =============================================================
    // STRATEGY ROUTING ENGINE: INSTITUTIONAL PULLBACK-FIRST ARCHITECTURE
    // =============================================================
    // 1. Phase 2B: Never trade before 10:00 AM IST: Let the morning structure fully form and eliminate 9:15-10:00 AM chop!
    if (istTotalMinutes < 600) {
      this.lastSignalBlockReason = "Building market structure (09:15-10:00 AM). High-conviction institutional setups activate after 10:00 AM IST.";
      return;
    }

    // Technical Indicators (ATR, SuperTrend, MACD)
    const highsList = this.indexCandles.map(c => c.high);
    const lowsList = this.indexCandles.map(c => c.low);
    const atrList = Indicators.calculateATR(highsList, lowsList, closePrices, 14);
    const atrValue = atrList.length > 0 ? atrList[atrList.length - 1] : 12;

    const stResult = Indicators.calculateSuperTrend(highsList, lowsList, closePrices, 10, 3);
    const currentStDirection = stResult.direction.length > 0 ? stResult.direction[stResult.direction.length - 1] : undefined;

    const macdResult = Indicators.calculateMACD(closePrices, 12, 26, 9);
    const curHist = macdResult.histogram.length > 0 ? macdResult.histogram[macdResult.histogram.length - 1] : 0;
    const prevHist = macdResult.histogram.length > 1 ? macdResult.histogram[macdResult.histogram.length - 2] : 0;
    const isMacdBullish = curHist > 0 || curHist > prevHist;
    const isMacdBearish = curHist < 0 || curHist < prevHist;

    // 2. Compute 15-minute VWAP Slope to ensure trend momentum
    const todayCandles = this.getTodaySessionCandles(timestamp);
    let isVwapSlopeBullish = true;
    let isVwapSlopeBearish = true;
    if (todayCandles.length >= 4) {
      const vwap15mAgo = Indicators.calculateVWAP(todayCandles.slice(0, -3));
      const slope = this.currentVwap - vwap15mAgo;
      isVwapSlopeBullish = slope >= -0.5; // rising or flat
      isVwapSlopeBearish = slope <= 0.5;  // falling or flat
    }

    // 3. Phase 2C: Completed 5-Minute Candle Bounce Confirmation with Volume Expansion
    const avgVol5 = closedCandles.slice(-5).reduce((s, c) => s + (c.volume || 0), 0) / Math.max(1, Math.min(5, closedCandles.length));
    const isCandleVolumeConfirmed = avgVol5 > 0 ? ((lastClosedCandle?.volume || 0) >= avgVol5 * 1.15) : true;

    // Dynamic ATR-based proximity to session VWAP (typically 16-22 pts for Nifty)
    const vwapProximityTolerance = Math.max(16, 0.35 * atrValue);
    const isNearVwapPullbackZone = Math.abs(spot - this.currentVwap) <= vwapProximityTolerance;

    // For CALL: last closed candle must have tested VWAP zone (<= tolerance), closed GREEN (close > open), and spot holding above VWAP & its low!
    const isCallBounceConfirmed = !!(
      lastClosedCandle &&
      (Math.abs(lastClosedCandle.low - this.currentVwap) <= vwapProximityTolerance || Math.abs(Math.min(lastClosedCandle.open, lastClosedCandle.close) - this.currentVwap) <= vwapProximityTolerance) &&
      (lastClosedCandle.close > lastClosedCandle.open) &&
      (spot >= lastClosedCandle.low && spot > this.currentVwap) &&
      isCandleVolumeConfirmed
    );
    // For PUT: last closed candle must have tested VWAP zone (<= tolerance), closed RED (close < open), and spot holding below VWAP & its high!
    const isPutRejectionConfirmed = !!(
      lastClosedCandle &&
      (Math.abs(lastClosedCandle.high - this.currentVwap) <= vwapProximityTolerance || Math.abs(Math.max(lastClosedCandle.open, lastClosedCandle.close) - this.currentVwap) <= vwapProximityTolerance) &&
      (lastClosedCandle.close < lastClosedCandle.open) &&
      (spot <= lastClosedCandle.high && spot < this.currentVwap) &&
      isCandleVolumeConfirmed
    );

    // Phase 2A: 2-Candle Confirmation (Previous candle tested VWAP zone within tolerance, and current closed candle confirms direction)
    const prevCandle = closedCandles.length > 1 ? closedCandles[closedCandles.length - 2] : undefined;
    const isCallDoubleConfirmed = !!(
      prevCandle && lastClosedCandle &&
      Math.abs(Math.min(prevCandle.open, prevCandle.close) - this.currentVwap) <= vwapProximityTolerance &&
      lastClosedCandle.close > lastClosedCandle.open &&
      lastClosedCandle.close > prevCandle.high &&
      isCandleVolumeConfirmed
    );
    const isPutDoubleConfirmed = !!(
      prevCandle && lastClosedCandle &&
      Math.abs(Math.max(prevCandle.open, prevCandle.close) - this.currentVwap) <= vwapProximityTolerance &&
      lastClosedCandle.close < lastClosedCandle.open &&
      lastClosedCandle.close < prevCandle.low &&
      isCandleVolumeConfirmed
    );

    // Classify regime to block VWAP Pullback in RANGE / LOW_VOLATILITY
    const currentRegime = QuantitativeEngine.classifyRegime(spot, this.cpr, this.indiaVixValue, this.indexCandles, atrValue);
    const isRangeOrConsolidation = currentRegime === "RANGE" || currentRegime === "LOW_VOLATILITY";

    // -------------------------------------------------------------
    // SETUP 1: VWAP PULLBACK (Institutional High-Win Trend Retracement)
    // -------------------------------------------------------------
    // Require ADX >= 20 for trend setups, 15m trend alignment, and confirmed bounce
    const isAdxTrendStrong = currentAdx >= 20;
    const isVwapOverExtended = Math.abs(spot - this.currentVwap) > Math.max(60, 2.5 * atrValue);

    if (!isRangeOrConsolidation && !isVwapOverExtended && isAdxTrendStrong && isAboveVwap && (isTrendBullish || spot > this.currentVwap + 2) && isNearVwapPullbackZone && (isCallDoubleConfirmed || isCallBounceConfirmed) && !trend15m.trendBearish && isVwapSlopeBullish && currentStDirection === "BULLISH" && isMacdBullish) {
      candidate = "CALL_BUY";
      setupType = "VWAP_PULLBACK";
      reasoning = `🎯 [VWAP PULLBACK] Institutional Bull Trend Retracement: Confirmed bounce at Session VWAP (${this.currentVwap.toFixed(1)}) with 15m Trend Bullish, ADX (${currentAdx.toFixed(1)} >= 20) and MACD momentum.`;
    } else if (!isRangeOrConsolidation && !isVwapOverExtended && isAdxTrendStrong && !isAboveVwap && (isTrendBearish || spot < this.currentVwap - 2) && isNearVwapPullbackZone && (isPutDoubleConfirmed || isPutRejectionConfirmed) && !trend15m.trendBullish && isVwapSlopeBearish && currentStDirection === "BEARISH" && isMacdBearish) {
      candidate = "PUT_BUY";
      setupType = "VWAP_PULLBACK";
      reasoning = `🎯 [VWAP PULLBACK] Institutional Bear Trend Retracement: Confirmed rejection at Session VWAP (${this.currentVwap.toFixed(1)}) with 15m Trend Bearish, ADX (${currentAdx.toFixed(1)} >= 20) and MACD momentum.`;
    }
    // -------------------------------------------------------------
    // SETUP 2: ORB TREND CONTINUATION (High-Conviction Directional Breakout after 10:00 AM)
    // -------------------------------------------------------------
    else if (!isRangeOrConsolidation && isAdxTrendStrong) {
      const orbBuffer = Math.max(2, 0.05 * atrValue);
      const isOrbBullBreakout = this.orbHigh > 0 && spot > this.orbHigh + orbBuffer && lastClosedCandle && lastClosedCandle.close > this.orbHigh;
      const isOrbBearBreakout = this.orbLow > 0 && spot < this.orbLow - orbBuffer && lastClosedCandle && lastClosedCandle.close < this.orbLow;

      if (isOrbBullBreakout && !trend15m.trendBearish && currentStDirection === "BULLISH" && isMacdBullish && isCandleVolumeConfirmed && isAboveVwap) {
        candidate = "CALL_BUY";
        setupType = "ORB_BREAKOUT";
        reasoning = `🚀 [ORB BREAKOUT] High-Conviction Bullish Breakout above ORB High (${this.orbHigh.toFixed(1)}): 15m Trend Bullish, ADX (${currentAdx.toFixed(1)} >= 20), SuperTrend aligned with volume expansion.`;
      } else if (isOrbBearBreakout && !trend15m.trendBullish && currentStDirection === "BEARISH" && isMacdBearish && isCandleVolumeConfirmed && !isAboveVwap) {
        candidate = "PUT_BUY";
        setupType = "ORB_BREAKOUT";
        reasoning = `🚀 [ORB BREAKOUT] High-Conviction Bearish Breakdown below ORB Low (${this.orbLow.toFixed(1)}): 15m Trend Bearish, ADX (${currentAdx.toFixed(1)} >= 20), SuperTrend aligned with volume expansion.`;
      }
    }
    // -------------------------------------------------------------
    // SETUP 3: TRAP REVERSAL (Fading Extreme False Breakouts with Rejection Wicks)
    // -------------------------------------------------------------
    if (!candidate && !isIntradayBearTrend && !isIntradayBullTrend) {
      const isTestingDayHigh = this.dayHigh >= this.orbHigh - 2;
      const isTestingDayLow = this.dayLow <= this.orbLow + 2;

      const candleRange = lastClosedCandle ? Math.max(4, lastClosedCandle.high - lastClosedCandle.low) : 10;
      const upperWick = lastClosedCandle ? (lastClosedCandle.high - Math.max(lastClosedCandle.open, lastClosedCandle.close)) : 0;
      const lowerWick = lastClosedCandle ? (Math.min(lastClosedCandle.open, lastClosedCandle.close) - lastClosedCandle.low) : 0;

      // Genuine Rejection Wick: Lower/Upper shadow must be at least 40% of total candle range and larger than opposite wick
      const hasUpperWickRejection = lastClosedCandle && upperWick >= 0.40 * candleRange && upperWick > lowerWick;
      const hasLowerWickRejection = lastClosedCandle && lowerWick >= 0.40 * candleRange && lowerWick > upperWick;

      // Anti-Whipsaw Filter: Check if this specific level recently failed a Trap Reversal
      const isDayHighQuarantined = this.failedTrapLevels.some(
        f => f.type === "HIGH" && Math.abs(f.level - this.dayHigh) <= 12 && f.expiredAt > timestamp
      );
      const isDayLowQuarantined = this.failedTrapLevels.some(
        f => f.type === "LOW" && Math.abs(f.level - this.dayLow) <= 12 && f.expiredAt > timestamp
      );

      if (isTestingDayHigh && !isDayHighQuarantined && (lastClosedCandle?.high || spot) >= this.orbHigh - 3 && hasUpperWickRejection && spot > this.currentVwap + 6) {
        candidate = "PUT_BUY";
        setupType = "TRAP_REVERSAL";
        reasoning = `[MEAN REVERSION] Bull Trap at Day High (${this.dayHigh.toFixed(1)}): Rejection wick confirmed. Scalp back to VWAP (${this.currentVwap.toFixed(1)}).`;
      } else if (isTestingDayLow && !isDayLowQuarantined && (lastClosedCandle?.low || spot) <= this.orbLow + 3 && hasLowerWickRejection && spot < this.currentVwap - 6) {
        candidate = "CALL_BUY";
        setupType = "TRAP_REVERSAL";
        reasoning = `[MEAN REVERSION] Bear Trap at Day Low (${this.dayLow.toFixed(1)}): Rejection wick confirmed. Scalp back to VWAP (${this.currentVwap.toFixed(1)}).`;
      }
    }

    if (!candidate) {
      this.lastSignalBlockReason = "";
      return;
    }

    // Phase 3B: Directional Cooldown after loss (45 min lock on same direction)
    const sniperState = this.tierPositions.SNIPER;
    if (candidate === sniperState.lastLossDirection && timestamp < (sniperState.directionalCooldownUntil || 0)) {
      const remainingMins = Math.ceil(((sniperState.directionalCooldownUntil || 0) - timestamp) / 60000);
      this.lastSignalBlockReason = `Directional cooldown active: same-direction ${candidate} re-entry blocked for ${remainingMins}m after loss.`;
      console.log(`[AdvisoryManager] ${this.lastSignalBlockReason}`);
      return;
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

    // =========================================================================
    // SECTOR DIVERGENCE GUARD: Banking (33%) vs IT (15%) Directional Alignment
    // =========================================================================
    const bnfLtp = this.heavyweightLtp["NSE:NIFTYBANK-INDEX"] || 0;
    const bnfVwap = this.heavyweightVwap["NSE:NIFTYBANK-INDEX"] || 0;
    const bnfNetChange = this.heavyweightNetChange["NSE:NIFTYBANK-INDEX"] || 0;

    const itLtp = this.heavyweightLtp["NSE:NIFTYIT-INDEX"] || 0;
    const itVwap = this.heavyweightVwap["NSE:NIFTYIT-INDEX"] || 0;
    const itNetChange = this.heavyweightNetChange["NSE:NIFTYIT-INDEX"] || 0;

    if (bnfLtp > 0 && bnfVwap > 0 && itLtp > 0 && itVwap > 0 && setupType !== "TRAP_REVERSAL") {
      const bnfDev = ((bnfLtp - bnfVwap) / bnfVwap) * 100;
      const itDev = ((itLtp - itVwap) / itVwap) * 100;

      // Bullish candidate (CALL_BUY): Guard against severe drag from IT or Banking
      if (candidate === "CALL_BUY") {
        const isBnfStronglyBearish = bnfDev < -0.12 && bnfNetChange < -0.25;
        const isItStronglyBearish = itDev < -0.12 && itNetChange < -0.25;
        const isSevereDivergence = (bnfDev > 0.10 && itDev < -0.15) || (itDev > 0.10 && bnfDev < -0.15);

        if (isSevereDivergence || isBnfStronglyBearish || isItStronglyBearish) {
          const reason = isSevereDivergence
            ? `Banking (${bnfDev > 0 ? "+" : ""}${bnfDev.toFixed(2)}%) and IT (${itDev > 0 ? "+" : ""}${itDev.toFixed(2)}%) are pulling in opposite directions`
            : `${isBnfStronglyBearish ? "Banking" : "IT"} is heavily bearish (${(isBnfStronglyBearish ? bnfDev : itDev).toFixed(2)}% below VWAP)`;
          this.lastSignalBlockReason = `Sector Divergence Guard: CALL blocked because ${reason}. Tug-of-war suppresses Nifty breakout follow-through.`;
          console.warn(`[AdvisoryManager] 🛡️ ${this.lastSignalBlockReason}`);
          return;
        }
      }

      // Bearish candidate (PUT_BUY): Guard against severe drag from IT or Banking
      if (candidate === "PUT_BUY") {
        const isBnfStronglyBullish = bnfDev > 0.12 && bnfNetChange > 0.25;
        const isItStronglyBullish = itDev > 0.12 && itNetChange > 0.25;
        const isSevereDivergence = (bnfDev < -0.10 && itDev > 0.15) || (itDev < -0.10 && bnfDev > 0.15);

        if (isSevereDivergence || isBnfStronglyBullish || isItStronglyBullish) {
          const reason = isSevereDivergence
            ? `Banking (${bnfDev > 0 ? "+" : ""}${bnfDev.toFixed(2)}%) and IT (${itDev > 0 ? "+" : ""}${itDev.toFixed(2)}%) are pulling in opposite directions`
            : `${isBnfStronglyBullish ? "Banking" : "IT"} is heavily bullish (${(isBnfStronglyBullish ? bnfDev : itDev).toFixed(2)}% above VWAP)`;
          this.lastSignalBlockReason = `Sector Divergence Guard: PUT blocked because ${reason}. Counter-sector strength suppresses Nifty breakdown follow-through.`;
          console.warn(`[AdvisoryManager] 🛡️ ${this.lastSignalBlockReason}`);
          return;
        }
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

    // Cost-Efficient ATM Strike Selection (Phase 3A): Switch from Deep ITM to ATM Strike (~0.50 Delta)
    // ATM options reduce statutory turnover fees by ~50% while offering optimal intraday delta and tight spreads.
    if (candidate === "CALL_BUY") {
      selectedStrike = atmStrike;
    } else if (candidate === "PUT_BUY") {
      selectedStrike = atmStrike;
    }
    console.log(`[AdvisoryManager] Selected Cost-Efficient ATM Strike ${selectedStrike} for optimal delta & low statutory fee drag.`);

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

    // =========================================================================
    // SLIPPAGE DEFENSE: Live Option Bid-Ask Spread & Liquidity Gate
    // =========================================================================
    if (optionLeg?.bid !== undefined && optionLeg?.ask !== undefined && optionLeg.bid > 0 && optionLeg.ask > 0) {
      const spread = optionLeg.ask - optionLeg.bid;
      const spreadPercent = (spread / optionLtp) * 100;
      if (spread > 1.5 || spreadPercent > 2.5) {
        this.lastSignalBlockReason = `Slippage Defense Gate: Option bid-ask spread too wide (${spread.toFixed(2)} pts / ${spreadPercent.toFixed(1)}%). Liquidity insufficient to guarantee execution without adverse slippage.`;
        console.warn(`[AdvisoryManager] 🛡️ ${this.lastSignalBlockReason}`);
        return;
      }
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
      
      let targetMultiplier = this.selfTuningParams.targetMultiplier || 1.0;
      try {
        const analytics = DatabaseService.getTradeAnalytics();
        if (analytics && analytics.suggestedTargetMultiplier) {
          targetMultiplier = Math.max(targetMultiplier, analytics.suggestedTargetMultiplier);
        }
      } catch (e) {}

      const entryPrice = optionLeg?.ltp && optionLeg.ltp > 0 ? optionLeg.ltp : optionLtp;
      
      // Calculate true dynamic RSI from market prices
      const rsiList = Indicators.calculateRSI(closePrices, 14);
      const marketRsi = rsiList.length > 0 ? rsiList[rsiList.length - 1] : 50;

      // Highly Profitable Trend Scalp & Target Geometry:
      // Phase 1A: ATR-Adaptive Wide Stop Loss (20-35 pts) to prevent premature noise shakeouts
      let scaledStopLoss = Math.max(20.0, Math.min(35.0, 1.5 * atrValue * delta));
      // Phase 1B: Asymmetric 3R/5R Target Architecture: +3.0R Target 1 (50% book), +5.0R Target 2 (Runner)
      let scaledTarget1 = parseFloat((scaledStopLoss * 3.00 * targetMultiplier).toFixed(2));
      let scaledTarget2 = parseFloat((scaledStopLoss * 5.00 * targetMultiplier).toFixed(2));

      // Mean Reversion Scalps (fading range boundaries only in non-trending markets)
      if (setupType === "TRAP_REVERSAL") {
        const vwapDist = Math.abs(spot - this.currentVwap);
        const vwapTargetPts = Math.max(15.0, Math.min(30.0, vwapDist * delta));
        scaledStopLoss = Math.max(14.0, Math.min(20.0, 1.1 * atrValue * delta));
        scaledTarget1 = parseFloat((Math.max(15.0, vwapTargetPts * 0.85) * targetMultiplier).toFixed(2));
        scaledTarget2 = parseFloat((Math.max(25.0, vwapTargetPts * 1.60) * targetMultiplier).toFixed(2));
      }

      // Phase 6A: Minimum Realized R:R Gate (Target 1 / Stop Loss >= 2.5:1)
      const realizedRR = scaledTarget1 / Math.max(1, scaledStopLoss);
      if (realizedRR < 2.5) {
        this.lastSignalBlockReason = `Realized R:R too low (${realizedRR.toFixed(2)}:1, need ≥ 2.5:1 for high-conviction trade).`;
        console.log(`[AdvisoryManager] ${this.lastSignalBlockReason}`);
        return;
      }

      // Phase 1C Capital Defense Gate: Prevent trading cheap options where stop loss exceeds 45% of option capital
      if (entryPrice < 45.0 || scaledStopLoss > entryPrice * 0.45) {
        this.lastSignalBlockReason = `Option premium too cheap (₹${entryPrice.toFixed(2)}) for required ATR stop loss (${scaledStopLoss.toFixed(1)} pts). Risk would exceed 45% of option capital. Setup blocked for capital defense.`;
        console.warn(`[AdvisoryManager] 🛡️ ${this.lastSignalBlockReason}`);
        return;
      }

      const stopLossPrice = parseFloat(Math.max(0.50, entryPrice - scaledStopLoss).toFixed(2));
      const targetPrice1 = parseFloat((entryPrice + scaledTarget1).toFixed(2));
      const targetPrice2 = parseFloat((entryPrice + scaledTarget2).toFixed(2));

      // Quantitative Score Confluence calculation
      const giftNifty = await GiftNiftyService.getGiftNiftyData(spot);
      this.latestGiftNifty = giftNifty;
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
        heavyweightsNetChange: this.heavyweightNetChange,
        optionPremiumRsi: marketRsi,
        maxCallOiStrike,
        maxPutOiStrike,
        deltaCallOi,
        deltaPutOi,
        deltaVixPercent,
        giftNiftyDelta: giftNifty.netChange,
        timestamp
      });

      // Strict Institutional Gate: Require score >= 88 (High Conviction Only). Block weak marginal chop entries (< 88).
      const baseMinScore = parseInt(process.env.MIN_SIGNAL_SCORE || "88", 10) || 88;
      const minScoreThreshold = baseMinScore + (this.selfTuningParams.minScoreAdjustment || 0);
      if (scoreCard.isFalseBreakout || scoreCard.totalScore < minScoreThreshold) {
        const moveName = triggerType === "CALL_BUY" ? "Breakout" : "Breakdown";
        const primaryReason = scoreCard.explanation.find(e => e.includes("✕") || e.includes("⚠")) || `${moveName} is valid, but confluence is ${scoreCard.totalScore}/100 (need at least ${minScoreThreshold} for High Conviction)`;
        this.lastSignalBlockReason = `${moveName} printed, but blocked: ${primaryReason.replace(/^[✕⚠]\s*/, "")}`;
        console.warn(`[AdvisoryManager] ${this.lastSignalBlockReason}`);
        return;
      }

      // Adaptive Midday Lunch Gate (11:45 AM - 1:15 PM IST):
      // Standard/Moderate setups (Score < 88) are paused to protect against Theta decay.
      // Exceptional Institutional Setups (Score >= 88 with volume expansion) are ALLOWED.
      const isVolumeExpanded = isClosedBarVolumeExpanded(this.indexCandles.map(c => c.volume));
      if (isLunchHour && (scoreCard.totalScore < 88 || !isVolumeExpanded)) {
        this.lastSignalBlockReason = `Midday lunch lull (11:45 AM - 1:15 PM): Setup score (${scoreCard.totalScore}/100) is below lunch institutional threshold (88/100 with 1.2x volume). Signal paused to protect against Theta decay.`;
        console.log(`[AdvisoryManager] ${this.lastSignalBlockReason}`);
        return;
      } else if (isLunchHour && scoreCard.totalScore >= 88 && isVolumeExpanded) {
        console.log(`[AdvisoryManager] 🚀 [LUNCH BREAKOUT EXCEPTION] Super-High Conviction Setup (${scoreCard.totalScore}/100) + Volume Expansion during lunch hours! Allowing execution.`);
      }

      // 🤖 Autonomous Institutional AI Pre-Trade Audit (Gemini 3.6 Flash - 100% Free AI Gatekeeper)
      const aiAudit = await GeminiRiskOfficer.validateTradeSetup({
        candidateType: triggerType,
        setupType,
        spot,
        vwap: this.currentVwap,
        vix: this.indiaVixValue,
        adx: currentAdx,
        regime: scoreCard.regime || "UNKNOWN",
        confluenceScore: scoreCard.totalScore,
        strike: selectedStrike,
        heavyweights: this.heavyweightLtp as any,
        giftNifty: {
          ltp: giftNifty.ltp,
          delta: giftNifty.netChange,
          sentiment: giftNifty.sentiment,
          premiumDiscount: giftNifty.premiumDiscount
        },
        cprWidthPercent: this.cpr ? CPR.getCPRWidthPercentage(this.cpr) : undefined,
        timeIST: istStr
      });

      if (!aiAudit.approved) {
        this.lastSignalBlockReason = `🤖 [GEMINI AI VETO]: ${aiAudit.reasoning}`;
        console.warn(`[AdvisoryManager] 🚫 TRADE BLOCKED BY AI RISK OFFICER: ${aiAudit.reasoning} (AI Confidence: ${aiAudit.aiConfidence}%)`);
        return;
      }
      console.log(`[AdvisoryManager] 🤖 [GEMINI AI APPROVED]: ${aiAudit.reasoning} (AI Confidence: ${aiAudit.aiConfidence}%)`);

      // High-Conviction Single-Tier Discipline: All approved setups execute on SNIPER tier
      const tier: SignalTier = "SNIPER";
      const targetPos = this.tierPositions[tier];

      // Cross-Tier Single-Position & Correlation Lock:
      // Ensure only 1 active position exists across the entire engine globally (prevent duplicate multi-tier drawdowns)
      const allTiersList: SignalTier[] = ["SNIPER", "BALANCED", "EXPLORATORY"];
      const hasAnyActiveTier = allTiersList.some(t => this.tierPositions[t].activeSignal !== null || this.tierPositions[t].pendingEntry !== null);
      if (hasAnyActiveTier || DatabaseService.hasAnyOpenBuyTrade()) {
        this.lastSignalBlockReason = "An active position or pending limit order is already open. Duplicate entries are locked to protect capital.";
        return;
      }

      // Check if this specific tier already has an active position or reached daily limits
      if (targetPos.activeSignal || targetPos.pendingEntry || DatabaseService.tierHasOpenBuy(tier)) {
        this.lastSignalBlockReason = `A ${tier} position or pending limit order is already open. New entries are paused.`;
        return;
      }
      const maxTrades = this.getDailyMaxTrades();
      if (targetPos.dailyTradesCount >= maxTrades) {
        this.lastSignalBlockReason = `${tier} daily trade cap (${maxTrades}) reached.`;
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

      // Max entries per direction cap (max entries per CALL/PUT direction per day)
      const maxDirectionEntries = Math.min(maxTrades, Math.ceil(maxTrades / 1.5));
      const directionEntries = DatabaseService.getDailyEntriesCountByDirection(tier, triggerType, timestamp);
      if (directionEntries >= maxDirectionEntries) {
        this.lastSignalBlockReason = `${tier} reached max limit (${maxDirectionEntries}) for ${triggerType} entries today.`;
        return;
      }

      if (timestamp < targetPos.stoppedCooldownUntil) {
        const remainingMins = Math.ceil((targetPos.stoppedCooldownUntil - timestamp) / 60000);
        this.lastSignalBlockReason = `${tier} is in cooldown after exit (${remainingMins}m remaining).`;
        return;
      }

      // Phase 2B: 50% Retracement Limit Entry Logic (Widen from 30% to 50% to buy at optimal pullback price)
      const candleRange = Math.max(4, (lastClosedCandle?.high || spot) - (lastClosedCandle?.low || spot));
      const limitRetracement = 0.50 * candleRange;
      const limitSpot = triggerType === "CALL_BUY"
        ? parseFloat(((lastClosedCandle?.close || spot) - limitRetracement).toFixed(2))
        : parseFloat(((lastClosedCandle?.close || spot) + limitRetracement).toFixed(2));

      const isAlreadyRetraced = triggerType === "CALL_BUY"
        ? spot <= limitSpot
        : spot >= limitSpot;

      const exactOptionSymbol = optionLeg?.symbol || this.formatFyersOptionSymbol(selectedStrike, triggerType, timestamp);

      if (!isAlreadyRetraced) {
        targetPos.pendingEntry = {
          type: triggerType,
          setupType,
          strike: selectedStrike,
          limitSpot,
          signalSpot: spot,
          optionLtpAtSignal: entryPrice,
          reasoning,
          expiresAt: timestamp + 15 * 60 * 1000, // Phase 2C: 15 minutes expiry (was 10)
          scoreCard,
          delta,
          scaledStopLoss,
          scaledTarget1,
          scaledTarget2,
          optionSymbol: exactOptionSymbol
        };
        this.lastSignalBlockReason = `🎯 Staged 50% Pullback Limit Entry: Waiting for spot to retrace to ${limitSpot.toFixed(1)} (current spot: ${spot.toFixed(1)}). Expiry: 15m.`;
        console.log(`[AdvisoryManager] [${tier}] ${this.lastSignalBlockReason}`);
        return;
      }

      await this.executePositionEntry(
        tier,
        spot,
        triggerType,
        setupType,
        selectedStrike,
        entryPrice,
        delta,
        scaledStopLoss,
        scaledTarget1,
        scaledTarget2,
        scoreCard,
        reasoning,
        timestamp,
        exactOptionSymbol
      );
  }

  /**
   * Executes position entry either immediately or when pending retracement limit order fills
   */
  private async executePositionEntry(
    tier: SignalTier,
    spot: number,
    triggerType: "CALL_BUY" | "PUT_BUY",
    setupType: StrategySetup,
    selectedStrike: number,
    entryPrice: number,
    delta: number,
    scaledStopLoss: number,
    scaledTarget1: number,
    scaledTarget2: number,
    scoreCard: SignalScoreCard,
    reasoning: string,
    timestamp: number,
    explicitOptionSymbol?: string
  ): Promise<void> {
    const targetPos = this.tierPositions[tier];
    if (targetPos.activeSignal || DatabaseService.tierHasOpenBuy(tier)) {
      return;
    }

    const stopLossPrice = parseFloat(Math.max(0.50, entryPrice - scaledStopLoss).toFixed(2));
    const targetPrice1 = parseFloat((entryPrice + scaledTarget1).toFixed(2));
    const targetPrice2 = parseFloat((entryPrice + scaledTarget2).toFixed(2));

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

    const rawOptionSymbol = explicitOptionSymbol || this.formatFyersOptionSymbol(selectedStrike, triggerType, timestamp);
    const optionSymbol = rawOptionSymbol.startsWith("NSE:") ? rawOptionSymbol : `NSE:${rawOptionSymbol}`;

    // Phase 1C: Dynamic Risk-Per-Trade Sizing (Target ₹2,000 risk per trade for ₹10k/day blueprint)
    const maxRiskPerTrade = parseInt(process.env.MAX_RISK_PER_TRADE || "2000", 10) || 2000;
    const slWidthPoints = Math.max(20.0, scaledStopLoss);
    const riskBasedLots = Math.max(1, Math.floor(maxRiskPerTrade / (slWidthPoints * 25)));

    // Phase 5C: Progressive Anti-Martingale Sizing — Press advantage after wins
    let lotMultiplier = 1.0;
    if (targetPos.dailyProfitLoss > 0) {
      lotMultiplier = 1.5;
    }
    // Sizing clamped between 75 (3 lots) and 150 (6 lots), or up to 225 qty (9 lots) on winning streak
    const logQty = Math.max(75, Math.min(225, Math.floor(riskBasedLots * lotMultiplier) * 25));

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
        entrySpot: spot,
        initialStopLoss: stopLossPrice
      }
    );
    if (!openTradeId) {
      this.lastSignalBlockReason = `Could not persist the ${tier} BUY to SQLite. Entry aborted.`;
      console.error(`[AdvisoryManager] [${tier}] Refusing to hold an in-memory-only position.`);
      return;
    }

    targetPos.activeSignal = signalObj;
    targetPos.entrySpot = spot;
    targetPos.entryDelta = delta;
    targetPos.originalInitialRisk = scaledStopLoss;
    targetPos.peakPremiumLtp = entryPrice;
    targetPos.isBreakevenLocked = false;
    targetPos.isTarget1Locked = false;
    targetPos.entryTime = timestamp;
    targetPos.activeOptionSymbol = optionSymbol;
    targetPos.liveOptionLtp = entryPrice;
    targetPos.openTradeId = openTradeId;
    this.lastTriggeredBreakoutLevel[triggerType] = spot;
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
          console.error(`[AdvisoryManager] AUTO ORDER EXECUTION FAILED:`, err?.message || err);
          // CRITICAL RISK SHIELD: Roll back in-memory position and mark database trade rejected
          // to prevent holding a phantom position and subsequently firing an unauthorized/naked SELL exit!
          targetPos.activeSignal = null;
          targetPos.entrySpot = 0;
          targetPos.liveOptionLtp = null;
          targetPos.activeOptionSymbol = "";
          targetPos.activeOrderId = null;
          targetPos.openTradeId = null;
          targetPos.entryTime = 0;
          targetPos.stoppedCooldownUntil = timestamp + 10 * 60 * 1000; // 10 min cooldown on broker rejection

          if (optionSymbol) {
            this.broker.unsubscribeTicks([optionSymbol]);
          }

          if (openTradeId) {
            try {
              const db = DatabaseService.initialize();
              db.prepare("UPDATE paper_trades SET status = 'CLOSED', reasoning = reasoning || ' [BROKER REJECTED: ' || ? || ']', net_pnl = 0 WHERE id = ?").run(err?.message || "Order rejected", openTradeId);
            } catch (dbErr) {
              console.error("[AdvisoryManager] Failed to update paper_trades on broker rejection:", dbErr);
            }
          }

          const rejectAlert = `🚨 <b>BROKER ORDER EXECUTION REJECTED</b>\n\n` +
            `Order for <b>${logQty}x ${optionSymbol}</b> failed at broker.\n` +
            `<b>Reason:</b> ${err?.message || err}\n\n` +
            `🛡️ <i>Engine safely rolled back position state. No naked positions held.</i>`;
          TelegramService.sendCustomMessage(rejectAlert).catch(() => {});
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

    this.onSignalCallback(signalObj);
    TelegramService.sendSignalAlert(signalObj).catch(err => {
      console.warn("[AdvisoryManager] Failed to send Telegram signal alert:", err?.message || err);
    });
    console.log(`[AdvisoryManager] 🎯 [SNIPER TIER] OFFICIAL TRADE SIGNAL: ${triggerType} @ Strike ${selectedStrike}. Confluence: ${scoreCard.totalScore}/100. Qty: ${logQty}`);
  }

  /**
   * Monitors active options position targets, stop-losses, and time exits for a specific tier
   */
  private monitorTierRiskState(tier: SignalTier, spot: number, timestamp: number): void {
    const pos = this.tierPositions[tier];
    if (!pos.activeSignal || !pos.activeSignal.entryPrice || !pos.activeSignal.stopLossPrice) return;

    const deltaMultiplier = pos.entryDelta && pos.entryDelta > 0 ? pos.entryDelta : 0.50;
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
    // Bug Fix: Use true originalInitialRisk to prevent risk from collapsing to 1.0 when stop is trailed to breakeven
    const initialRisk = (pos.originalInitialRisk && pos.originalInitialRisk > 0)
      ? pos.originalInitialRisk
      : Math.max(1.0, pos.activeSignal.entryPrice - (pos.activeSignal.stopLossPrice || (pos.activeSignal.entryPrice - 8)));

    // Calculate Dynamic ATR-based Breathing Cushion for Stop Loss Trailing
    const highsList = this.indexCandles.map(c => c.high);
    const lowsList = this.indexCandles.map(c => c.low);
    const closePrices = this.indexCandles.map(c => c.close);
    const atrList = Indicators.calculateATR(highsList, lowsList, closePrices, 14);
    const atrValue = atrList.length > 0 ? atrList[atrList.length - 1] : 12;
    const deltaEst = pos.entryDelta && pos.entryDelta > 0 ? pos.entryDelta : 0.50;
    // Hard breathing cushion: Never let a trailing SL sit closer than 8.0 - 15.0 pts below peak
    const minBreathingRoom = Math.max(8.0, Math.min(15.0, 1.2 * atrValue * deltaEst));

    // Intraday EOD Square-Off at 3:15 PM IST (Phase 4C):
    const istTimeStr = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(timestamp));
    const [hStr, mStr] = istTimeStr.split(":");
    const istMins = parseInt(hStr, 10) * 60 + parseInt(mStr, 10);
    if (istMins >= 915) { // 3:15 PM IST
      this.triggerTierExit(tier, "SQUARE_OFF", "Intraday EOD Market Closing Square-Off (3:15 PM IST)", timestamp, currentPremiumLtp);
      return;
    }

    // =========================================================================
    // 1. TARGET 1 HIT (+3.0R): MULTI-LOT 50% PARTIAL BOOKING + RUNNER ACTIVATION
    // =========================================================================
    if (pos.activeSignal.targetPrice1 && currentPremiumLtp >= pos.activeSignal.targetPrice1 && !pos.isTarget1Locked) {
      pos.isTarget1Locked = true;
      pos.isBreakevenLocked = true;

      // Lock Trailing SL to Entry + 1.0R of profit (protect accumulated 1R gains)
      const locked1RPrice = parseFloat((pos.activeSignal.entryPrice + initialRisk * 1.0).toFixed(2));
      const maxSafeSl = parseFloat((pos.peakPremiumLtp - minBreathingRoom).toFixed(2));
      const newSl = Math.max(locked1RPrice, maxSafeSl);
      
      if (newSl > pos.activeSignal.stopLossPrice) {
        pos.activeSignal.stopLossPrice = newSl;
      }
      this.persistOpenPositionState(pos);

      // Perform Partial Profit Booking on 50% lot if position is multi-lot (>= 50 qty)
      if (pos.openTradeId) {
        try {
          const db = DatabaseService.initialize();
          const tradeRecord = db.prepare("SELECT * FROM paper_trades WHERE id = ?").get(pos.openTradeId) as any;
          if (tradeRecord && tradeRecord.qty >= 50) {
            // Nifty options standard: Strictly round to whole lots of 25 to prevent broker order rejections
            const totalLots = Math.max(1, Math.floor(tradeRecord.qty / 25));
            const partialLots = Math.floor(totalLots / 2);
            if (partialLots > 0) {
              const partialQty = partialLots * 25;
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
                `[${tier} TIER] Target 1 (+3.0R) Hit! 50% partial profit booked (${partialQty} qty / ${partialLots} lots @ ₹${currentPremiumLtp.toFixed(2)}). Remaining ${remainingQty} qty (${totalLots - partialLots} lots) runner active with SL locked at +1.0R.`,
                {
                  tier,
                  pnl: currentPremiumLtp - entryPx,
                  parentTradeId: pos.openTradeId,
                  entryPrice: entryPx,
                  marketRegime: pos.activeSignal?.regime,
                  confluenceScore: pos.activeSignal?.scoreCard?.totalScore
                }
              ).catch(() => {});

              db.prepare("UPDATE paper_trades SET qty = ?, is_runner = 1, partial_exit_price = ? WHERE id = ?").run(remainingQty, currentPremiumLtp, pos.openTradeId);
              console.log(`[AdvisoryManager] [${tier}] 🎯 Multi-Lot Partial Profit Booked: ${partialQty} qty (${partialLots} lots) @ ₹${currentPremiumLtp.toFixed(2)} (Net PnL: ₹${netPnl.toFixed(2)}). Remaining ${remainingQty} qty Trend Runner active!`);

              // Auto-execute partial profit booking order at broker if live auto-execution is enabled
              if (tier === "SNIPER" && process.env.AUTO_ORDER_EXECUTION === "true" && pos.activeOptionSymbol) {
                const optSymbol = pos.activeOptionSymbol;
                const executePartialWithRetry = async (attempt: number = 1): Promise<void> => {
                  try {
                    console.log(`[AdvisoryManager] [SNIPER] Routing partial exit order to broker (Attempt ${attempt}/2): ${partialQty}x ${optSymbol}`);
                    const orderId = await this.broker.placeOptionOrder(optSymbol, partialQty, "SELL", "MARKET");
                    console.log(`[AdvisoryManager] [SNIPER] AUTO PARTIAL SELL ORDER FILLED. Order ID: ${orderId}`);
                  } catch (err: any) {
                    console.error(`[AdvisoryManager] [SNIPER] AUTO PARTIAL SELL FAILED (Attempt ${attempt}/2):`, err?.message || err);
                    if (attempt < 2) {
                      setTimeout(() => { executePartialWithRetry(attempt + 1); }, 1000);
                    } else {
                      // Roll back SQLite qty so subsequent full exit covers the entire position (prevents orphaned unhedged broker contracts)
                      try {
                        db.prepare("UPDATE paper_trades SET qty = ? WHERE id = ?").run(tradeRecord.qty, pos.openTradeId);
                      } catch {}
                      const alert = `🚨 <b>PARTIAL EXIT FAILED AT BROKER</b>\n\n` +
                        `Failed to sell <b>${partialQty}x ${optSymbol}</b> at Target 1.\n` +
                        `<b>Error:</b> ${err?.message || err}\n\n` +
                        `⚠️ <i>Quantity retained at ${tradeRecord.qty}x so subsequent full exit will close entire position.</i>`;
                      TelegramService.sendCustomMessage(alert).catch(() => {});
                    }
                  }
                };
                executePartialWithRetry().catch(() => {});
              }
            }
          }
        } catch (e) {
          console.error(`[AdvisoryManager] Error performing partial profit booking:`, e);
        }
      }

      console.log(`[AdvisoryManager] [${tier}] Target 1 crossed! Trailing stop stepped up to ₹${pos.activeSignal.stopLossPrice.toFixed(2)}`);
      
      if (tier === "SNIPER") {
        const targetLockSignal: AdvisorySignal = {
          ...pos.activeSignal,
          type: "HOLD",
          reasoning: `Target 1 (+3.0R) achieved at ₹${currentPremiumLtp.toFixed(2)}! 50% partial profit booked. Trailing stop locked at +1.0R (₹${pos.activeSignal.stopLossPrice.toFixed(2)}) for remaining Trend Runner.`
        };
        this.onSignalCallback(targetLockSignal);
        TelegramService.sendSignalAlert(targetLockSignal).catch(() => {});
      }
    }

    // =========================================================================
    // 2. FULL TAKE-PROFIT TARGET 2 EXIT (+5.0R / Multi-Bagger Climax)
    // =========================================================================
    if (pos.activeSignal.targetPrice2 && currentPremiumLtp >= pos.activeSignal.targetPrice2) {
      this.triggerTierExit(tier, "EXIT_PROFIT", "Target 2 (+5.0R) achieved. Full profit booked.", timestamp, currentPremiumLtp);
      return;
    }

    // =========================================================================
    // 3. PHASE 1D: POST-TARGET-1 RUNNER TRAILING (Let Winners Run)
    // =========================================================================
    if (pos.isTarget1Locked) {
      // Trail runner at Peak Premium - 1.0 * initialRisk (generous cushion for huge moves, self-tuning calibrated)
      const runnerRiskMult = this.selfTuningParams.runnerTrailingRiskMultiplier || 1.0;
      const runnerTrailSl = parseFloat((pos.peakPremiumLtp - initialRisk * runnerRiskMult).toFixed(2));
      // But never trail below Entry + 1.0R (locked profit minimum)
      const minRunnerSl = parseFloat((pos.activeSignal.entryPrice + initialRisk * 1.0).toFixed(2));
      const newSl = Math.max(runnerTrailSl, minRunnerSl);
      
      if (newSl > pos.activeSignal.stopLossPrice) {
        pos.activeSignal.stopLossPrice = newSl;
        this.persistOpenPositionState(pos);
        console.log(`[AdvisoryManager] [${tier}] 🚀 Runner Trailing SL raised to ₹${pos.activeSignal.stopLossPrice.toFixed(2)} (Peak: ₹${pos.peakPremiumLtp.toFixed(2)})`);
      }
    } else {
      // PRE-TARGET-1: Do NOT trail stop prematurely. Give the position room to develop!
      // Only exception: Move SL to breakeven (+2 pts cushion) after reaching +1.5R peak
      if (!pos.isBreakevenLocked && pos.peakPremiumLtp >= pos.activeSignal.entryPrice + initialRisk * 1.5) {
        const breakEvenSl = parseFloat((pos.activeSignal.entryPrice + 2.0).toFixed(2));
        if (breakEvenSl > pos.activeSignal.stopLossPrice) {
          pos.activeSignal.stopLossPrice = breakEvenSl;
          pos.isBreakevenLocked = true;
          this.persistOpenPositionState(pos);
          console.log(`[AdvisoryManager] [${tier}] 🔒 Breakeven Lock: Trade reached +1.5R peak. SL moved to Cost + ₹2.0 (₹${pos.activeSignal.stopLossPrice.toFixed(2)}).`);
        }
      }
    }

    // =========================================================================
    // 4. AFTER 2:30 PM (14:30 IST) PROFIT ACCELERATION LOCK (Lock Gains Before Theta Cliff)
    // =========================================================================
    if (istMins >= 870 && currentPremiumLtp > pos.activeSignal.entryPrice) {
      const eodTrailSl = parseFloat((pos.peakPremiumLtp - initialRisk * 0.5).toFixed(2));
      const costSl = parseFloat((pos.activeSignal.entryPrice + 2.0).toFixed(2));
      const finalEodSl = Math.max(eodTrailSl, costSl);
      if (finalEodSl > pos.activeSignal.stopLossPrice) {
        pos.activeSignal.stopLossPrice = finalEodSl;
        this.persistOpenPositionState(pos);
        console.log(`[AdvisoryManager] [${tier}] ⏰ Post-2:30 PM EOD Profit Lock: SL tightened to ₹${pos.activeSignal.stopLossPrice.toFixed(2)} ahead of 3:15 PM.`);
      }
    }

    // =========================================================================
    // 5. MEAN REVERSION VWAP RECLAIM (Move SL to Cost only if breathing room exists)
    // =========================================================================
    if (!pos.isBreakevenLocked && pos.activeSignal.reasoning?.includes("MEAN REVERSION") && this.currentVwap > 0) {
      const isCallReclaimingVwap = pos.activeSignal.type === "CALL_BUY" && spot >= this.currentVwap;
      const isPutReclaimingVwap = pos.activeSignal.type === "PUT_BUY" && spot <= this.currentVwap;
      if (isCallReclaimingVwap || isPutReclaimingVwap) {
        if (currentPremiumLtp >= pos.activeSignal.entryPrice + minBreathingRoom) {
          const vwapCostSl = parseFloat((pos.activeSignal.entryPrice + 1.00).toFixed(2));
          if (vwapCostSl > pos.activeSignal.stopLossPrice) {
            pos.activeSignal.stopLossPrice = vwapCostSl;
            pos.isBreakevenLocked = true;
            this.persistOpenPositionState(pos);
            console.log(`[AdvisoryManager] [${tier}] 🎯 Spot crossed Session VWAP (${this.currentVwap.toFixed(1)})! Mean Reversion target secured, SL trailed to Cost (₹${pos.activeSignal.stopLossPrice.toFixed(2)}).`);
          }
        }
      }
    }

    // =========================================================================
    // 7. THETA TIMEOUT EXIT (Phase 4A: Disabled for SNIPER Tier — Trust the SL & Targets!)
    // =========================================================================
    if (tier !== "SNIPER") {
      const thetaTimeoutMs = tier === "BALANCED" ? 30 * 60 * 1000 : 25 * 60 * 1000;
      if (elapsed > thetaTimeoutMs && pos.activeSignal.entryPrice > 0) {
        const premiumChangePercent = Math.abs(currentPremiumLtp - pos.activeSignal.entryPrice) / pos.activeSignal.entryPrice * 100;
        if (premiumChangePercent < 2.0 && currentPremiumLtp <= pos.activeSignal.entryPrice) {
          const timeoutMins = Math.round(thetaTimeoutMs / 60000);
          this.triggerTierExit(tier, "THETA_EXIT", `Option premium decay warning. Sideways chop > ${timeoutMins} minutes without directional progress.`, timestamp, currentPremiumLtp);
          return;
        }
      }
    }

    // =========================================================================
    // 8. HARD STOP LOSS & TRAILING STOP PROFIT LOCK CHECK: Always strictly enforced
    // =========================================================================
    if (currentPremiumLtp <= pos.activeSignal.stopLossPrice) {
      const isProfitableOrLocked = (pos.isTarget1Locked || pos.isBreakevenLocked || currentPremiumLtp >= pos.activeSignal.entryPrice);
      const exitType: AdvisorySignal["type"] = isProfitableOrLocked ? "EXIT_PROFIT" : "EXIT_STOP_LOSS";
      const exitReason = isProfitableOrLocked
        ? `Trailing Stop Profit Lock triggered. Runner protected at ₹${currentPremiumLtp.toFixed(2)}.`
        : "Hard stop loss threshold crossed.";
      this.triggerTierExit(tier, exitType, exitReason, timestamp, currentPremiumLtp);
      return;
    }
  }

  private triggerTierExit(tier: SignalTier, type: AdvisorySignal["type"], reasoning: string, timestamp: number, exitPrice?: number): void {
    const pos = this.tierPositions[tier];
    if (!pos.activeSignal || pos.isExitInFlight) return;
    pos.isExitInFlight = true;

    pos.dailyTradesCount++;
    pos.pendingEntry = null; // cancel any stale pending entry
    const optionSymbol = pos.activeOptionSymbol;
    let formattedReasoning = `[${tier} TIER] ${reasoning}`;
    const entry = pos.activeSignal.entryPrice || 0;
    const exit = exitPrice || entry;
    const pnl = entry > 0 ? (exit - entry) : 0;

    // Bug A fix: Use true originalInitialRisk rather than trailed stopLossPrice
    const initialRisk = (pos.originalInitialRisk && pos.originalInitialRisk > 0)
      ? pos.originalInitialRisk
      : Math.max(1.0, entry - (pos.activeSignal.stopLossPrice || 0));
    const ratio = pnl / initialRisk;

    if (pnl < 0) {
      pos.dailyLossesCount++;
      pos.dailyProfitLoss += ratio;
      pos.stoppedCooldownUntil = timestamp + 25 * 60 * 1000; // 25 min cooldown on loss
      pos.lastLossDirection = pos.activeSignal.type as "CALL_BUY" | "PUT_BUY";
      pos.directionalCooldownUntil = timestamp + 45 * 60 * 1000; // Phase 3B: 45 min same-direction cooldown

      // Quarantine failed trap level for 45 minutes to prevent immediate double-dip
      if (pos.activeSignal.reasoning?.includes("MEAN REVERSION") || pos.activeSignal.reasoning?.includes("Trap")) {
        const trapType = pos.activeSignal.type === "CALL_BUY" ? "LOW" : "HIGH";
        const level = pos.entrySpot || entry;
        this.failedTrapLevels.push({
          level,
          type: trapType,
          expiredAt: timestamp + 45 * 60 * 1000
        });
        console.log(`[Risk Engine] [${tier}] Quarantining failed Trap Reversal level ${level.toFixed(1)} (${trapType}) for 45 minutes.`);
      }

      console.log(`[Risk Engine] [${tier}] Loss exit (${ratio.toFixed(2)}R). Cooldown until ${new Date(pos.stoppedCooldownUntil).toLocaleTimeString()}. Daily P&L: ${pos.dailyProfitLoss.toFixed(2)}R.`);
    } else {
      // Profitable exit (including Trailing Stop Profit Lock & Take-Profit targets)
      pos.dailyLossesCount = 0; // Reset consecutive loss counter on profit!
      pos.dailyProfitLoss += ratio;
      // Smart Cooldown: Only 2 minutes cooldown on profitable/breakeven exits to allow continuation re-entry
      const cooldownMs = type === "THETA_EXIT" ? 20 * 60 * 1000 : 2 * 60 * 1000;
      pos.stoppedCooldownUntil = timestamp + cooldownMs;
      console.log(`[Risk Engine] [${tier}] Profitable/Breakeven exit (+${ratio.toFixed(2)}R). Consecutive loss counter reset. Cooldown until ${new Date(pos.stoppedCooldownUntil).toLocaleTimeString()}. Daily P&L: ${pos.dailyProfitLoss.toFixed(2)}R.`);
    }

    // Retrieve the actual entry qty from the open SQLite record (critical for dynamic lot sizing)
    let openTradeId: number | undefined = pos.openTradeId ?? undefined;
    let qty = parseInt(process.env.ORDER_QTY || "75", 10) || 75; // fallback default
    if (openTradeId) {
      try {
        const db = DatabaseService.initialize();
        const tradeRow = db.prepare("SELECT qty FROM paper_trades WHERE id = ?").get(openTradeId) as any;
        if (tradeRow && tradeRow.qty > 0) {
          qty = tradeRow.qty;
        }
      } catch {}
    } else {
      const openBuys = DatabaseService.getOpenBuyTrades(tier);
      if (openBuys.length > 0) {
        openTradeId = openBuys[openBuys.length - 1].id;
        qty = openBuys[openBuys.length - 1].qty || qty;
      }
    }

    const grossPnl = pnl * qty;
    const fees = ExcelLogger.calculateStatutoryFees(exit, qty);
    const netPnl = grossPnl - fees;
    if (openTradeId) {
      DatabaseService.markPaperTradeClosed(openTradeId, { pnl: grossPnl, fees, netPnl });
      // Register with Post-Exit Intelligence Tracker
      if (optionSymbol && exit > 0) {
        PostExitTracker.registerExit(openTradeId, optionSymbol, exit, tier, timestamp);
      }
    }

    // Auto Execution SELL exit only for SNIPER Tier
    if (tier === "SNIPER" && process.env.AUTO_ORDER_EXECUTION === "true" && optionSymbol) {
      console.log(`[AdvisoryManager] [SNIPER] AUTO-EXECUTION ACTIVE. Placing SELL exit order for ${qty}x ${optionSymbol}`);
      
      const executeOrderWithRetry = async (attempt: number = 1): Promise<void> => {
        try {
          const orderId = await this.broker.placeOptionOrder(optionSymbol, qty, "SELL", "MARKET");
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
        } catch (err: any) {
          console.error(`[AdvisoryManager] AUTO EXIT ORDER FAILED (Attempt ${attempt}/3):`, err?.message || err);
          if (attempt < 3) {
            // Exponential backoff: 1000ms for attempt 2, 2000ms for attempt 3
            const backoffDelay = attempt * 1000;
            setTimeout(() => { executeOrderWithRetry(attempt + 1); }, backoffDelay);
          } else {
            // All 3 attempts failed: Mark database state and dispatch urgent Telegram notification
            if (openTradeId) {
              try {
                const db = DatabaseService.initialize();
                db.prepare("UPDATE paper_trades SET status = 'EXIT_FAILED_BROKER', reasoning = reasoning || ' [CRITICAL: Broker auto SELL failed: ' || ? || ']' WHERE id = ?").run(err?.message || "SELL failed", openTradeId);
              } catch (dbErr) {
                console.error("[AdvisoryManager] Failed to update paper_trades on broker SELL failure:", dbErr);
              }
            }

            const emergencyMsg = `🚨 <b>CRITICAL BROKER EXIT FAILURE</b>\n\n` +
              `Auto-exit SELL order failed at broker after 3 attempts for <b>${qty}x ${optionSymbol}</b>.\n` +
              `<b>Exit Type:</b> ${type}\n` +
              `<b>Error:</b> ${err?.message || err}\n\n` +
              `⚠️ <b>ACTION REQUIRED:</b> Please MANUALLY square off this position immediately on your broker terminal to prevent unbounded losses!`;
            TelegramService.sendCustomMessage(emergencyMsg).catch(() => {});
          }
        }
      };

      executeOrderWithRetry().catch(() => {});
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

    if (optionSymbol) {
      this.broker.unsubscribeTicks([optionSymbol]);
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
    pos.isExitInFlight = false;
  }

  private persistOpenPositionState(pos: TierPositionState): void {
    if (!pos.openTradeId || !pos.activeSignal) return;
    DatabaseService.updateOpenPaperTradeState(pos.openTradeId, {
      stopLoss: pos.activeSignal.stopLossPrice,
      peakPremium: pos.peakPremiumLtp,
      isBreakevenLocked: pos.isBreakevenLocked,
      isTarget1Locked: pos.isTarget1Locked,
      isRunner: pos.isTarget1Locked
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
    const isLunchBlock = totalMinutes >= 705 && totalMinutes < 795;
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

    // Calculate dynamic breakout targets including confirmation buffer & anti-churn swing levels
    let targetCallLevel = hasOrb ? this.orbHigh + buffer : 0;
    let targetPutLevel = hasOrb ? this.orbLow - buffer : 0;

    if (this.lastTriggeredBreakoutLevel.CALL_BUY > 0) {
      targetCallLevel = Math.max(targetCallLevel, this.lastTriggeredBreakoutLevel.CALL_BUY + 5);
    }
    if (this.lastTriggeredBreakoutLevel.PUT_BUY > 0) {
      targetPutLevel = Math.min(targetPutLevel, this.lastTriggeredBreakoutLevel.PUT_BUY - 5);
    }

    const spotValid = spot > 0;
    const ptsToCall = (hasOrb && spotValid && targetCallLevel > spot) ? parseFloat((targetCallLevel - spot).toFixed(2)) : 0;
    const ptsToPut = (hasOrb && spotValid && spot > targetPutLevel) ? parseFloat((spot - targetPutLevel).toFixed(2)) : 0;
    const insideOrb = hasOrb && spotValid && spot <= this.orbHigh && spot >= this.orbLow;
    const brokeCall = hasOrb && spotValid && spot >= targetCallLevel;
    const brokePut = hasOrb && spotValid && spot <= targetPutLevel;

    const dbOpenBuys = DatabaseService.getOpenBuyTrades();
    const openBuyTier = (["SNIPER", "BALANCED", "EXPLORATORY"] as const).find(
      (t) => this.tierPositions[t].activeSignal?.type.includes("BUY")
    ) || (dbOpenBuys[0]?.tier as SignalTier | undefined);

    let waitingReason = "";
    if (openBuyTier) {
      waitingReason = isLunchBlock
        ? `Open ${openBuyTier} trade is still managed through lunch (stop-loss, targets, theta).`
        : `Active ${openBuyTier} signal is live. Targets are on the signal card.`;
    } else if (!hasOrb) {
      if (totalMinutes >= 570) {
        this.ensureHistoricalDataAndOrb(spot).catch(() => {});
      }
      waitingReason = "Opening range is not captured yet. Hydrating historical session range from broker...";
    } else if (sessionPhase === "PRE_OPEN") {
      waitingReason = "Session has not opened. Signals start after the 9:15–9:30 AM ORB window.";
    } else if (sessionPhase === "ORB") {
      waitingReason = `Building opening range. CALL above ${this.orbHigh.toFixed(2)}, PUT below ${this.orbLow.toFixed(2)}.`;
    } else if (sessionPhase === "LUNCH") {
      waitingReason = "Midday lunch window (11:45 AM–1:15 PM IST). High-conviction institutional setups (Score >= 88) active; moderate chop paused.";
    } else if (sessionPhase === "SQUARE_OFF" || sessionPhase === "CLOSED") {
      waitingReason = "New entries are closed for the day (3:15 PM square-off).";
    } else if (insideCpr) {
      waitingReason = "Spot is inside CPR. Breakout entries are withheld until price leaves the pivot range.";
    } else if (insideOrb) {
      waitingReason = `Nifty is inside opening range (${this.orbLow.toFixed(2)} - ${this.orbHigh.toFixed(2)}). CALL target: ${targetCallLevel.toFixed(2)}; PUT target: ${targetPutLevel.toFixed(2)}.`;
    } else if (hasOrb && spot > this.orbHigh && !brokeCall) {
      waitingReason = `ORB high tagged. CALL needs a confirmed hold at/above ${targetCallLevel.toFixed(2)}.`;
    } else if (hasOrb && spot < this.orbLow && !brokePut) {
      waitingReason = `ORB low tagged. PUT needs a confirmed hold at/below ${targetPutLevel.toFixed(2)}.`;
    } else if (brokeCall && !aboveVwap) {
      waitingReason = `ORB target (${targetCallLevel.toFixed(2)}) broken, but spot is still below session VWAP (${this.currentVwap.toFixed(2)}). CALL is blocked.`;
    } else if (brokeCall && !trendBullish) {
      waitingReason = `ORB target (${targetCallLevel.toFixed(2)}) broken, but 5-minute 9/21 EMA is not bullish. CALL is blocked.`;
    } else if (brokePut && aboveVwap) {
      waitingReason = `ORB target (${targetPutLevel.toFixed(2)}) broken, but spot is still above session VWAP (${this.currentVwap.toFixed(2)}). PUT is blocked.`;
    } else if (brokePut && !trendBearish) {
      waitingReason = `ORB target (${targetPutLevel.toFixed(2)}) broken, but 5-minute 9/21 EMA is not bearish. PUT is blocked.`;
    } else if (brokeCall || brokePut) {
      waitingReason = this.lastSignalBlockReason
        || "ORB breakout gate passed and local filters aligned. Pricing option chain.";
    }

    return {
      spot,
      vwap: this.currentVwap,
      vix: this.indiaVixValue,
      orbHigh: this.orbHigh,
      orbLow: this.orbLow,
      targetCallLevel,
      targetPutLevel,
      buffer,
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
      },
      giftNifty: GiftNiftyService.getGiftNiftyData(spot)
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
