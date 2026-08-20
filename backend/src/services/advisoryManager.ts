import { IBrokerAdapter, Candle, OptionChainItem, CompactTick } from "../adapters/IBrokerAdapter";
import { Indicators } from "../utils/indicators";
import { Greeks } from "../utils/greeks";
import { CPR, CPRValues } from "../utils/cpr";
import { ExcelLogger } from "../utils/excelLogger";
import { QuantitativeEngine } from "../utils/quantitativeEngine";
import { DatabaseService, SignalTier } from "../utils/database";
import { TelegramService } from "./telegramService";

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

interface TierPositionState {
  activeSignal: AdvisorySignal | null;
  entrySpot: number;
  liveOptionLtp?: number;
  peakPremiumLtp: number;
  isBreakevenLocked: boolean;
  isTarget1Locked: boolean;
  entryTime: number;
  activeOptionSymbol: string;
  activeOrderId: string;
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
  private isOrbActive: boolean = false;
  private orbHigh: number = 0;
  private orbLow: number = 0;
  private isSignalGeneratedToday: boolean = false;

  // 3-Tier Independent Position State Machines:
  // 1. SNIPER (Score >= 75%) -> Official Alert & Optional Real Execution
  // 2. BALANCED (Score 60% - 74%) -> Moderate Paper Trading (Tracked silently in DB/CSV)
  // 3. EXPLORATORY (Score < 60%) -> Aggressive Paper Trading (Tracked silently in DB/CSV)
  private tierPositions: { [key in SignalTier]: TierPositionState } = {
    SNIPER: {
      activeSignal: null,
      entrySpot: 0,
      liveOptionLtp: 0,
      peakPremiumLtp: 0,
      isBreakevenLocked: false,
      isTarget1Locked: false,
      entryTime: 0,
      activeOptionSymbol: "",
      activeOrderId: "",
      dailyTradesCount: 0,
      dailyLossesCount: 0,
      dailyProfitLoss: 0,
      stoppedCooldownUntil: 0
    },
    BALANCED: {
      activeSignal: null,
      entrySpot: 0,
      liveOptionLtp: 0,
      peakPremiumLtp: 0,
      isBreakevenLocked: false,
      isTarget1Locked: false,
      entryTime: 0,
      activeOptionSymbol: "",
      activeOrderId: "",
      dailyTradesCount: 0,
      dailyLossesCount: 0,
      dailyProfitLoss: 0,
      stoppedCooldownUntil: 0
    },
    EXPLORATORY: {
      activeSignal: null,
      entrySpot: 0,
      liveOptionLtp: 0,
      peakPremiumLtp: 0,
      isBreakevenLocked: false,
      isTarget1Locked: false,
      entryTime: 0,
      activeOptionSymbol: "",
      activeOrderId: "",
      dailyTradesCount: 0,
      dailyLossesCount: 0,
      dailyProfitLoss: 0,
      stoppedCooldownUntil: 0
    }
  };

  // Public getter for UI backwards-compatibility (returns official SNIPER signal)
  public get activeSignal(): AdvisorySignal | null {
    return this.tierPositions.SNIPER.activeSignal;
  }

  // Risk parameters
  private dailyLossLimit: number = -2.0; // max -2R daily drawdown
  private dailyMaxTrades: number = 5;

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
      }
    } catch (e) {
      console.warn("[AdvisoryManager] Failed to load 5-minute Nifty history. Starting fresh.", e);
    }
  }

  /**
   * Main entry point to process streaming real-time ticks
   */
  public async processTick(tick: CompactTick): Promise<void> {
    const timestamp = tick.timestamp || Date.now();
    const allTiers: SignalTier[] = ["SNIPER", "BALANCED", "EXPLORATORY"];

    // 1. Time Check in IST (Indian Standard Time, UTC+5:30)
    const istTimeStr = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(timestamp));
    const [hoursStr, minutesStr] = istTimeStr.split(":");
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);

    // Universal Hard Square-Off at 15:15 IST across all tiers
    if (hours === 15 && minutes >= 15) {
      for (const t of allTiers) {
        if (this.tierPositions[t].activeSignal) {
          this.triggerTierExit(t, "SQUARE_OFF", "Universal 3:15 PM Square-off Alert. Terminate open positions.", timestamp);
        }
      }
      return;
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
      
      // Calculate true Volume Weighted Average Price (VWAP) for Nifty Index
      if (this.indexCandles.length > 0) {
        this.currentVwap = Indicators.calculateVWAP(this.indexCandles);
      } else {
        this.currentVwap = tick.ltp;
      }
      
      // ORB range calculation (first 15 minutes of session: 9:15 - 9:30 AM IST)
      if (hours === 9 && minutes >= 15 && minutes < 30) {
        if (!this.isOrbActive) {
          this.orbHigh = tick.ltp;
          this.orbLow = tick.ltp;
          this.isOrbActive = true;
          console.log(`[AdvisoryManager] 9:15 AM ORB range active. Starting boundaries tracking.`);
        } else {
          this.orbHigh = Math.max(this.orbHigh, tick.ltp);
          this.orbLow = Math.min(this.orbLow, tick.ltp);
        }
      }

      // Check breakout triggers post 9:30 AM IST
      if ((hours === 9 && minutes >= 30) || (hours >= 10 && hours < 15) || (hours === 15 && minutes < 15)) {
        this.isOrbActive = false; // ORB creation range completed
        await this.evaluateBreakoutSignals(tick.ltp, timestamp);
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
      if (p.activeSignal && p.activeOptionSymbol && tick.symbol === p.activeOptionSymbol && tick.ltp > 0) {
        p.liveOptionLtp = tick.ltp;
      }
    }
  }

  /**
   * Evaluates if a high-probability breakout direction occurred and routes to appropriate tier
   */
  private async evaluateBreakoutSignals(spot: number, timestamp: number): Promise<void> {
    // Lunch Hour Consolidation Filter: Block signals between 11:30 AM and 1:30 PM IST
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
    if (istTotalMinutes >= 690 && istTotalMinutes <= 810) {
      return;
    }

    // CPR Filter Check: If price opened or is sitting inside CPR, trade with caution
    if (this.cpr && CPR.isPriceInsideCPR(spot, this.cpr)) {
      return;
    }

    const isAboveVwap = spot > this.currentVwap;
    
    // Check Open Interest and PCR
    const chain = await this.broker.getOptionChain("NSE:NIFTY50-INDEX");
    if (chain.length === 0) return;

    // Calculate Put-Call Ratio
    let totalPutOi = 0;
    let totalCallOi = 0;
    chain.forEach(item => {
      totalPutOi += item.put.openInterest;
      totalCallOi += item.call.openInterest;
    });
    const pcr = totalCallOi > 0 ? totalPutOi / totalCallOi : 1.0;

    // Calculate EMAs (50 and 200 EMA) for Trend-Alignment Filter
    const closePrices = this.indexCandles.map(c => c.close);
    const ema50List = Indicators.calculateEMA(closePrices, 50);
    const ema200List = Indicators.calculateEMA(closePrices, 200);
    const ema50 = ema50List.length > 0 ? ema50List[ema50List.length - 1] : 0;
    const ema200 = ema200List.length > 0 ? ema200List[ema200List.length - 1] : 0;

    const isTrendBullish = ema50 > 0 && ema200 > 0 ? (spot > ema50 && ema50 > ema200) : true;
    const isTrendBearish = ema50 > 0 && ema200 > 0 ? (spot < ema50 && ema50 < ema200) : true;

    // Calculate Volume Breakout Filter
    const volumes = this.indexCandles.map(c => c.volume);
    const prev5Volumes = volumes.slice(-6, -1); // exclude current bar
    const avgVolume5 = prev5Volumes.length > 0 ? prev5Volumes.reduce((a, b) => a + b, 0) / prev5Volumes.length : 0;
    const currentVolume = volumes[volumes.length - 1] || 0;
    const isVolumeHigh = avgVolume5 > 0 ? currentVolume >= 1.5 * avgVolume5 : true;

    let triggerType: "CALL_BUY" | "PUT_BUY" | null = null;
    let reasoning = "";

    if (spot > this.orbHigh && isAboveVwap && pcr <= 1.35 && isTrendBullish && isVolumeHigh) {
      triggerType = "CALL_BUY";
      reasoning = `Bullish ORB Breakout above ${this.orbHigh.toFixed(2)}.`;
    } else if (spot < this.orbLow && !isAboveVwap && pcr >= 0.60 && isTrendBearish && isVolumeHigh) {
      triggerType = "PUT_BUY";
      reasoning = `Bearish ORB Breakdown below ${this.orbLow.toFixed(2)}.`;
    }

    if (triggerType) {
      // Dynamic strike interval (100 for BankNifty/Sensex, 50 for Nifty)
      const strikeInterval = 50;
      let selectedStrike = Math.round(spot / strikeInterval) * strikeInterval;
      
      // Retrieve ATM option chain details
      const atmChain = chain.find(item => item.strikePrice === selectedStrike);
      const optionLeg = triggerType === "CALL_BUY" ? atmChain?.call : atmChain?.put;
      const optionLtp = optionLeg?.ltp && optionLeg.ltp > 0 ? optionLeg.ltp : 0;

      if (!optionLtp) {
        console.warn(
          `[AdvisoryManager] Missing live premium for strike ${selectedStrike} (${triggerType}). Skipping signal.`
        );
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
          }
        }
        return Math.max(1, days);
      };

      const expiryDateStr = atmChain?.expiryDate || chain[0]?.expiryDate;
      const expiryDays = getDaysToExpiry(expiryDateStr);
      const greeksResult = Greeks.calculateGreeks(spot, selectedStrike, expiryDays, this.indiaVixValue);
      const delta = triggerType === "CALL_BUY" ? greeksResult.call.delta : Math.abs(greeksResult.put.delta);

      const expectedRange = Greeks.calculateExpectedIntradayRange(spot, this.indiaVixValue);
      
      let targetMultiplier = 1.0;
      try {
        const analytics = DatabaseService.getTradeAnalytics();
        if (analytics && analytics.suggestedTargetMultiplier) {
          targetMultiplier = analytics.suggestedTargetMultiplier;
        }
      } catch (e) {}

      const targetOffset1 = 0.5 * expectedRange * targetMultiplier;
      const targetOffset2 = 1.0 * expectedRange * targetMultiplier;

      const entryPrice = optionLtp;
      const highsList = this.indexCandles.map(c => c.high);
      const lowsList = this.indexCandles.map(c => c.low);
      const atrList = Indicators.calculateATR(highsList, lowsList, closePrices, 14);
      const atrValue = atrList.length > 0 ? atrList[atrList.length - 1] : 12; 
      
      // Calculate true dynamic RSI from market prices
      const rsiList = Indicators.calculateRSI(closePrices, 14);
      const marketRsi = rsiList.length > 0 ? rsiList[rsiList.length - 1] : 50;

      const scaledTarget1 = targetOffset1 * delta;
      const scaledTarget2 = targetOffset2 * delta;
      const scaledStopLoss = 1.5 * atrValue * delta;

      const stopLossPrice = entryPrice - scaledStopLoss;
      const targetPrice1 = entryPrice + scaledTarget1;
      const targetPrice2 = entryPrice + scaledTarget2;

      // Quantitative Score Confluence calculation
      const riskReward = scaledTarget2 / Math.max(1, scaledStopLoss);
      const scoreCard = QuantitativeEngine.calculateConfluence({
        spot,
        currentVwap: this.currentVwap,
        orbHigh: this.orbHigh,
        orbLow: this.orbLow,
        triggerType,
        cpr: this.cpr,
        pcr,
        vix: this.indiaVixValue,
        atr: atrValue,
        riskReward,
        candles5m: this.indexCandles,
        heavyweightsLtp: this.heavyweightLtp,
        heavyweightsVwap: this.heavyweightVwap,
        optionPremiumRsi: marketRsi
      });

      // Strict rejection: zero trade on detected false breakout or score < 45
      if (scoreCard.isFalseBreakout || scoreCard.totalScore < 45) {
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
      if (targetPos.activeSignal) return;
      if (targetPos.dailyTradesCount >= this.dailyMaxTrades) return;
      if (targetPos.dailyProfitLoss <= this.dailyLossLimit) return;
      if (timestamp < targetPos.stoppedCooldownUntil) return;

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

      // Populate position state for this tier
      targetPos.activeSignal = signalObj;
      targetPos.entrySpot = spot;
      targetPos.peakPremiumLtp = entryPrice;
      targetPos.isBreakevenLocked = false;
      targetPos.isTarget1Locked = false;
      targetPos.entryTime = timestamp;
      this.isSignalGeneratedToday = true;

      const optionSymbol = atmChain 
        ? (triggerType === "CALL_BUY" ? atmChain.call.symbol : atmChain.put.symbol)
        : this.formatFyersOptionSymbol(selectedStrike, triggerType, timestamp);

      targetPos.activeOptionSymbol = optionSymbol;
      targetPos.liveOptionLtp = entryPrice;

      // Dynamically subscribe live option contract to broker WebSocket for real-time tick streaming
      if (optionSymbol) {
        console.log(`[AdvisoryManager] [${tier}] Subscribing live WebSocket to active option contract: ${optionSymbol}`);
        this.broker.subscribeTicks([optionSymbol]);
      }
      
      // Auto Execution placement only for SNIPER Tier
      if (tier === "SNIPER" && process.env.AUTO_ORDER_EXECUTION === "true") {
        const qtyStr = process.env.ORDER_QTY || "25";
        const qty = parseInt(qtyStr, 10) || 25;
        console.log(`[AdvisoryManager] [SNIPER] AUTO-EXECUTION ACTIVE. Placing BUY option order: ${qty}x ${optionSymbol}`);
        this.broker.placeOptionOrder(optionSymbol, qty, "BUY", "MARKET")
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

      // Log BUY transaction into CSV with Tier tag
      const logQtyStr = process.env.ORDER_QTY || "25";
      const logQty = parseInt(logQtyStr, 10) || 25;
      ExcelLogger.logTransaction(
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
          confluenceScore: scoreCard.totalScore
        }
      );

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

      // Only notify UI and sound audio alarms for official SNIPER signals
      if (tier === "SNIPER") {
        this.onSignalCallback(signalObj);
        TelegramService.sendSignalAlert(signalObj).catch(err => {
          console.warn("[AdvisoryManager] Failed to send Telegram signal alert:", err?.message || err);
        });
        console.log(`[AdvisoryManager] 🎯 [SNIPER TIER] OFFICIAL TRADE SIGNAL: ${triggerType} @ Strike ${selectedStrike}. Confluence: ${scoreCard.totalScore}/100.`);
      } else {
        console.log(`[AdvisoryManager] 📊 [${tier} TIER] Paper Trade initiated in background: ${triggerType} @ Strike ${selectedStrike}. Score: ${scoreCard.totalScore}/100.`);
      }
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

    // Dynamic Breakeven profit locker: if gain reaches 1:1 risk-reward target
    const initialRisk = pos.activeSignal.entryPrice - pos.activeSignal.stopLossPrice;
    if (!pos.isBreakevenLocked && currentPremiumLtp >= pos.activeSignal.entryPrice + initialRisk) {
      pos.isBreakevenLocked = true;
      pos.activeSignal.stopLossPrice = pos.activeSignal.entryPrice;
      console.log(`[AdvisoryManager] [${tier}] Breakeven Profit Locker engaged at ${pos.activeSignal.entryPrice.toFixed(2)}`);
      
      if (tier === "SNIPER") {
        const holdSignal: AdvisorySignal = {
          ...pos.activeSignal,
          type: "HOLD",
          reasoning: "Breakeven locked. Position risk is zero."
        };
        this.onSignalCallback(holdSignal);
        TelegramService.sendSignalAlert(holdSignal).catch(() => {});
      }
    }

    // Theta Exit check: position is open > 12 minutes and sideways
    if (elapsed > 12 * 60 * 1000) {
      const percentageChange = Math.abs(spotMovementGain / spot) * 100;
      if (percentageChange < 0.15) {
        this.triggerTierExit(tier, "THETA_EXIT", "Option premium decay warning. Sideways chop > 12 minutes.", timestamp, currentPremiumLtp);
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
    
    // Target 1 Trail Step-up
    if (pos.activeSignal.targetPrice1 && currentPremiumLtp >= pos.activeSignal.targetPrice1 && !pos.isTarget1Locked) {
      pos.isTarget1Locked = true;
      const profitLockPrice = pos.activeSignal.entryPrice + (pos.activeSignal.targetPrice1 - pos.activeSignal.entryPrice) * 0.5;
      pos.activeSignal.stopLossPrice = parseFloat(profitLockPrice.toFixed(2));
      console.log(`[AdvisoryManager] [${tier}] Target 1 crossed! Trailing stop stepped up to ₹${profitLockPrice.toFixed(2)}`);
      
      if (tier === "SNIPER") {
        const targetLockSignal: AdvisorySignal = {
          ...pos.activeSignal,
          type: "HOLD",
          reasoning: `Target 1 achieved. Trailing stop stepped up to ₹${profitLockPrice.toFixed(2)} to secure profits.`
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
      pos.stoppedCooldownUntil = timestamp + 5 * 60 * 1000;
      console.log(`[Risk Engine] [${tier}] ${type} triggered (${ratio >= 0 ? '+' : ''}${ratio.toFixed(2)}R). Cooldown until ${new Date(pos.stoppedCooldownUntil).toLocaleTimeString()}.`);
    }

    const qtyStr = process.env.ORDER_QTY || "25";
    const qty = parseInt(qtyStr, 10) || 25;

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
    pos.isBreakevenLocked = false;
    pos.isTarget1Locked = false;
    pos.peakPremiumLtp = 0;
    pos.entryTime = 0;
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

  public getTierPositions() {
    return this.tierPositions;
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
