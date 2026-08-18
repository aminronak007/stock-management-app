import { IBrokerAdapter, Candle, OptionChainItem, CompactTick } from "../adapters/IBrokerAdapter";
import { Indicators } from "../utils/indicators";
import { Greeks } from "../utils/greeks";
import { CPR, CPRValues } from "../utils/cpr";
import { ExcelLogger } from "../utils/excelLogger";
import { QuantitativeEngine } from "../utils/quantitativeEngine";
import { DatabaseService } from "../utils/database";

export interface AdvisorySignal {
  type: "CALL_BUY" | "PUT_BUY" | "HOLD" | "EXIT_PROFIT" | "EXIT_STOP_LOSS" | "THETA_EXIT";
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

  // Active Position State Machine
  public activeSignal: AdvisorySignal | null = null;
  private peakPremiumLtp: number = 0;
  private isBreakevenLocked: boolean = false;
  private isTarget1Locked: boolean = false;
  private entryTime: number = 0;
  private activeOptionSymbol: string = "";
  private activeOrderId: string = "";

  // Quantitative Risk Engine Safeguards
  private dailyLossLimit: number = -2.0; // max -2R daily drawdown
  private dailyMaxTrades: number = 5;
  private dailyTradesCount: number = 0;
  private dailyLossesCount: number = 0;
  private dailyProfitLoss: number = 0;
  private stoppedCooldownUntil: number = 0;

  // Callback to alert Electron UI
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
        console.warn("[AdvisoryManager] Could not fetch daily candles. Using default CPR.");
        this.cpr = CPR.calculateCPR(24050, 23950, 24000);
      }
    } catch (e) {
      console.error("[AdvisoryManager] Failed to fetch CPR parameters. Using fallback.", e);
      this.cpr = CPR.calculateCPR(24050, 23950, 24000);
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
    const timestamp = tick.timestamp;
    const timeOfDay = new Date(timestamp);
    const hours = timeOfDay.getHours();
    const minutes = timeOfDay.getMinutes();

    // 1. Time Check: Universal Hard Square-Off at 15:15 IST
    if (hours === 15 && minutes >= 15 && this.activeSignal && this.activeSignal.type !== "HOLD") {
      this.triggerExit("EXIT_PROFIT", "Universal 3:15 PM Square-off Alert. Terminate open positions.", timestamp);
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
      
      // Update custom mock VWAP and volume calculations for Nifty index (for demo/test mode)
      this.currentVwap = tick.ltp - 2; // placeholder calculation
      
      // ORB range calculation (first 15 minutes of session: 9:15 - 9:30 AM)
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

      // Check breakout triggers post 9:30 AM
      if ((hours === 9 && minutes >= 30) || hours > 9) {
        this.isOrbActive = false; // ORB creation range completed
        
        if (this.dailyTradesCount < this.dailyMaxTrades && !this.activeSignal) {
          await this.evaluateBreakoutSignals(tick.ltp, timestamp);
        }
      }

      // Monitor active position risk parameters
      if (this.activeSignal && this.activeSignal.type.includes("BUY")) {
        this.monitorRiskState(tick.ltp, timestamp);
      }
    }

    // 3. Track Heavyweights
    if (tick.symbol in this.heavyweightLtp) {
      this.heavyweightLtp[tick.symbol] = tick.ltp;
      // Mock VWAP value for stocks (normally streamed in depth/ticker payload)
      this.heavyweightVwap[tick.symbol] = tick.ltp - (Math.random() * 4 - 2); 
    }

    // 4. Track VIX
    if (tick.symbol === "NSE:INDIAVIX-INDEX") {
      this.indiaVixValue = tick.ltp;
    }
  }

  /**
   * Evaluates if a high-probability breakout direction occurred
   */
  private async evaluateBreakoutSignals(spot: number, timestamp: number): Promise<void> {
    // Risk Engine Checks
    if (this.dailyTradesCount >= this.dailyMaxTrades) {
      console.log(`[AdvisoryManager] Daily trade limit reached (${this.dailyTradesCount}/${this.dailyMaxTrades}). Blocking signals.`);
      return;
    }
    if (this.dailyProfitLoss <= this.dailyLossLimit) {
      console.log(`[AdvisoryManager] Daily loss limit breached (${this.dailyProfitLoss.toFixed(1)}R). All trading Halted today.`);
      return;
    }
    if (timestamp < this.stoppedCooldownUntil) {
      console.log(`[AdvisoryManager] Trade cooldown active. Re-entry blocked until ${new Date(this.stoppedCooldownUntil).toLocaleTimeString()}.`);
      return;
    }

    // Lunch Hour Consolidation Filter: Block signals between 11:30 AM and 1:30 PM
    const currentHour = new Date(timestamp).getHours();
    const currentMin = new Date(timestamp).getMinutes();
    const totalMinutes = currentHour * 60 + currentMin;
    if (totalMinutes >= 690 && totalMinutes <= 810) {
      console.log(`[AdvisoryManager] Lunch consolidation filter active (${currentHour}:${currentMin < 10 ? '0' + currentMin : currentMin}). Blocking breakout signals.`);
      return;
    }

    // CPR Filter Check: If price opened or is sitting inside CPR, trade with caution
    if (this.cpr && CPR.isPriceInsideCPR(spot, this.cpr)) {
      console.log("[AdvisoryManager] Spot is currently inside the Central Pivot Range (CPR). Consolidation Day flagged. Breaks blocked.");
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
    const pcr = totalPutOi / totalCallOi;

    // Calculate EMAs (50 and 200 EMA) for Trend-Alignment Filter
    const closePrices = this.indexCandles.map(c => c.close);
    const ema50List = Indicators.calculateEMA(closePrices, 50);
    const ema200List = Indicators.calculateEMA(closePrices, 200);
    const ema50 = ema50List.length > 0 ? ema50List[ema50List.length - 1] : 0;
    const ema200 = ema200List.length > 0 ? ema200List[ema200List.length - 1] : 0;

    const isTrendBullish = ema50 > 0 && ema200 > 0 ? (spot > ema50 && ema50 > ema200) : true;
    const isTrendBearish = ema50 > 0 && ema200 > 0 ? (spot < ema50 && ema50 < ema200) : true;

    // Calculate Volume Breakout Filter (Current bar volume >= 1.5x previous 5-bar volume average)
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
      // Strike rounded selection based on Black-Scholes Greeks (Delta ATM)
      let selectedStrike = Math.round(spot / 50) * 50;
      
      // Retrieve ATM option chain details
      const atmChain = chain.find(item => item.strikePrice === selectedStrike);
      const optionLtp = triggerType === "CALL_BUY" 
        ? (atmChain ? atmChain.call.ltp : 100) 
        : (atmChain ? atmChain.put.ltp : 100);

      // Calculate dynamic weekly options expiry days (NSE Thursday expiry tracker)
      const getDaysToExpiry = (): number => {
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

      const expiryDays = getDaysToExpiry();
      // Calculate Black-Scholes Greeks using Spot, Strike, Expiry, and Volatility (India VIX)
      const greeksResult = Greeks.calculateGreeks(spot, selectedStrike, expiryDays, this.indiaVixValue);
      const delta = triggerType === "CALL_BUY" ? greeksResult.call.delta : Math.abs(greeksResult.put.delta);

      // Math targets using expected volatility cone range: expected range = spot * IV / sqrt(365)
      const expectedRange = Greeks.calculateExpectedIntradayRange(spot, this.indiaVixValue);
      
      // Calculate targets in spot points
      const targetOffset1 = 0.5 * expectedRange;
      const targetOffset2 = 1.0 * expectedRange;

      const entryPrice = optionLtp;
      const highsList = this.indexCandles.map(c => c.high);
      const lowsList = this.indexCandles.map(c => c.low);
      const atrList = Indicators.calculateATR(highsList, lowsList, closePrices, 14);
      const atrValue = atrList.length > 0 ? atrList[atrList.length - 1] : 12; 
      
      // Apply Black-Scholes Delta to scale target offsets and ATR stop loss to option premium pricing
      const scaledTarget1 = targetOffset1 * delta;
      const scaledTarget2 = targetOffset2 * delta;
      const scaledStopLoss = 1.5 * atrValue * delta;

      const stopLossPrice = entryPrice - scaledStopLoss;
      const targetPrice1 = entryPrice + scaledTarget1;
      const targetPrice2 = entryPrice + scaledTarget2;

      // Quantitative Score Confluence check
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
        optionPremiumRsi: 55 // default placeholder
      });

      let minSignalScore = parseInt(process.env.MIN_SIGNAL_SCORE || "80", 10) || 80;
      try {
        const db = DatabaseService.initialize();
        const row = db.prepare("SELECT value FROM settings WHERE key = 'MIN_SIGNAL_SCORE'").get() as { value: string } | undefined;
        if (row) {
          minSignalScore = parseInt(row.value, 10) || minSignalScore;
        }
      } catch (e) {
        // use fallback
      }

      if (scoreCard.totalScore < minSignalScore) {
        console.log(`[AdvisoryManager] Signal blocked. Confluence score (${scoreCard.totalScore}/100) below MIN_SIGNAL_SCORE (${minSignalScore}).`);
        return;
      }

      const formattedReasoning = `${reasoning} Score: ${scoreCard.totalScore}/100. [Greeks Delta: ${delta.toFixed(2)}, SL=${scaledStopLoss.toFixed(1)}, T1=+${scaledTarget1.toFixed(1)}, T2=+${scaledTarget2.toFixed(1)}]`;

      this.activeSignal = {
        type: triggerType,
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

      this.peakPremiumLtp = entryPrice;
      this.isBreakevenLocked = false;
      this.entryTime = timestamp;
      this.isSignalGeneratedToday = true;

      // Extract Option Symbol Name from Chain or generate standard weekly Fyers symbol representation
      const optionSymbol = triggerType === "CALL_BUY"
        ? (atmChain ? atmChain.call.symbol : `NSE:NIFTY26820${selectedStrike}CE`)
        : (atmChain ? atmChain.put.symbol : `NSE:NIFTY26820${selectedStrike}PE`);

      this.activeOptionSymbol = optionSymbol;
      
      // Auto Execution placement block
      if (process.env.AUTO_ORDER_EXECUTION === "true") {
        const qtyStr = process.env.ORDER_QTY || "25";
        const qty = parseInt(qtyStr, 10) || 25;
        console.log(`[AdvisoryManager] AUTO-EXECUTION ACTIVE. Placing BUY option order: ${qty}x ${optionSymbol}`);
        this.broker.placeOptionOrder(optionSymbol, qty, "BUY", "MARKET")
          .then(orderId => {
            this.activeOrderId = orderId;
            console.log(`[AdvisoryManager] AUTO BUY ORDER FILLED. Order ID: ${orderId}`);
            if (this.activeSignal) {
              this.activeSignal.reasoning += ` | Fyers Order Fill ID: ${orderId}`;
              this.onSignalCallback(this.activeSignal);
            }
          })
          .catch(err => {
            console.error(`[AdvisoryManager] AUTO ORDER EXECUTION FAILED:`, err.message);
          });
      }

      // Log BUY transaction inside the Excel Ledger CSV file
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
          sl: stopLossPrice,
          t1: targetPrice1,
          t2: targetPrice2
        }
      );

      this.onSignalCallback(this.activeSignal);
      console.log(`[AdvisoryManager] SIGNAL TRIGGERED: ${triggerType} @ Strike ${selectedStrike}. Premium entry=${entryPrice.toFixed(2)}.`);
    }
  }

  /**
   * Monitors active options position targets, stop-losses, and time exits
   */
  private monitorRiskState(spot: number, timestamp: number): void {
    if (!this.activeSignal || !this.activeSignal.entryPrice || !this.activeSignal.stopLossPrice) return;

    // Simulate options price fluctuations relative to spot index movements
    const spotDelta = spot - (this.activeSignal.type === "CALL_BUY" ? this.orbHigh : this.orbLow);
    const premiumMultiplier = 0.50; // delta proxy
    const currentPremiumLtp = parseFloat((this.activeSignal.entryPrice + spotDelta * premiumMultiplier).toFixed(2));

    this.peakPremiumLtp = Math.max(this.peakPremiumLtp, currentPremiumLtp);

    // Dynamic Breakeven profit locker: if gain reaches 1:1 risk-reward target
    const initialRisk = this.activeSignal.entryPrice - this.activeSignal.stopLossPrice;
    if (!this.isBreakevenLocked && currentPremiumLtp >= this.activeSignal.entryPrice + initialRisk) {
      this.isBreakevenLocked = true;
      this.activeSignal.stopLossPrice = this.activeSignal.entryPrice;
      console.log(`[AdvisoryManager] Breakeven Profit Locker engaged. Stop-loss moved to entry price: ${this.activeSignal.entryPrice.toFixed(2)}`);
      
      this.onSignalCallback({
        ...this.activeSignal,
        type: "HOLD",
        reasoning: "Breakeven locked. Position risk is zero."
      });
    }

    // Theta Exit check: position is open > 12 minutes (720,000 ms) and spot index changed less than 0.15%
    const elapsed = timestamp - this.entryTime;
    if (elapsed > 12 * 60 * 1000) {
      const percentageChange = Math.abs(spotDelta / spot) * 100;
      if (percentageChange < 0.15) {
        this.triggerExit("THETA_EXIT", "Option premium decay warning. Sideways chop > 12 minutes.", timestamp, currentPremiumLtp);
        return;
      }
    }

    // Stop Loss Trigger
    if (currentPremiumLtp <= this.activeSignal.stopLossPrice) {
      this.triggerExit("EXIT_STOP_LOSS", `Stop-loss breached at premium price ${currentPremiumLtp.toFixed(2)}.`, timestamp, currentPremiumLtp);
      return;
    }

    // Target 2 Trigger
    if (this.activeSignal.targetPrice2 && currentPremiumLtp >= this.activeSignal.targetPrice2) {
      this.triggerExit("EXIT_PROFIT", `Ultimate Target 2 breached at premium price ${currentPremiumLtp.toFixed(2)}. Booking profits.`, timestamp, currentPremiumLtp);
      return;
    }
    
    // Target 1 Trigger - Step-2 Trailing Stop Lock
    if (this.activeSignal.targetPrice1 && currentPremiumLtp >= this.activeSignal.targetPrice1 && !this.isTarget1Locked) {
      this.isTarget1Locked = true;
      const profitLockPrice = parseFloat((this.activeSignal.entryPrice + 0.5 * (this.activeSignal.targetPrice1 - this.activeSignal.entryPrice)).toFixed(2));
      this.activeSignal.stopLossPrice = Math.max(this.activeSignal.stopLossPrice, profitLockPrice);
      console.log(`[AdvisoryManager] Target 1 reached! Trailing Stop-loss stepped up to lock in profit: ₹${profitLockPrice.toFixed(2)}`);
      this.onSignalCallback({
        ...this.activeSignal,
        type: "HOLD",
        reasoning: `Target 1 achieved. Trailing stop stepped up to ₹${profitLockPrice.toFixed(2)} to secure profits.`
      });
    }
  }

  private triggerExit(type: AdvisorySignal["type"], reasoning: string, timestamp: number, exitPrice?: number): void {
    if (!this.activeSignal) return;

    // Risk Engine statistics increment
    this.dailyTradesCount++;
    const optionSymbol = this.activeOptionSymbol;
    let formattedReasoning = reasoning;
    const entry = this.activeSignal.entryPrice || 0;
    const exit = exitPrice || entry;
    const pnl = entry > 0 ? (exit - entry) : 0;

    if (type === "EXIT_STOP_LOSS") {
      this.dailyLossesCount++;
      this.dailyProfitLoss -= 1.0; // deduct 1R of risk
      this.stoppedCooldownUntil = timestamp + 15 * 60 * 1000; // 15 minutes cooldown after SL
      console.log(`[Risk Engine] Stop-loss hit. Cooldown started until ${new Date(this.stoppedCooldownUntil).toLocaleTimeString()}. Daily P&L: ${this.dailyProfitLoss.toFixed(2)}R.`);
    } else if (type === "EXIT_PROFIT") {
      const initialRisk = entry - (this.activeSignal.stopLossPrice || 0);
      const ratio = initialRisk > 0 ? (pnl / initialRisk) : 1.5;
      this.dailyProfitLoss += ratio;
      console.log(`[Risk Engine] Take-profit achieved (+${ratio.toFixed(2)}R). Daily P&L: ${this.dailyProfitLoss.toFixed(2)}R.`);
    }

    const qtyStr = process.env.ORDER_QTY || "25";
    const qty = parseInt(qtyStr, 10) || 25;

    // Auto Execution SELL exit order placement
    if (process.env.AUTO_ORDER_EXECUTION === "true" && optionSymbol) {
      console.log(`[AdvisoryManager] AUTO-EXECUTION ACTIVE. Placing SELL exit order for ${qty}x ${optionSymbol}`);
      this.broker.placeOptionOrder(optionSymbol, qty, "SELL", "MARKET")
        .then(orderId => {
          console.log(`[AdvisoryManager] AUTO SELL EXIT ORDER FILLED. Order ID: ${orderId}`);
          
          // Log inside the Excel Ledger CSV file with the actual order ID
          ExcelLogger.logTransaction(
            type,
            optionSymbol,
            this.activeSignal?.strikePrice || "",
            qty,
            exit,
            `${reasoning} | Fyers Order: ${orderId}`,
            { pnl }
          );

          // Send update callback once order id is resolved
          this.onSignalCallback({
            type,
            strikePrice: this.activeSignal?.strikePrice,
            entryPrice: this.activeSignal?.entryPrice,
            reasoning: `${reasoning} | Fyers Exit Order: ${orderId}`,
            timestamp
          });
        })
        .catch(err => {
          console.error(`[AdvisoryManager] AUTO EXIT ORDER PLACEMENT FAILED:`, err.message);
        });
    } else {
      // If paper trading or manual, log transaction directly
      ExcelLogger.logTransaction(
        type,
        optionSymbol,
        this.activeSignal.strikePrice || "",
        qty,
        exit,
        reasoning,
        { pnl }
      );
    }

    const exitSignal: AdvisorySignal = {
      type,
      strikePrice: this.activeSignal.strikePrice,
      entryPrice: this.activeSignal.entryPrice,
      reasoning: formattedReasoning,
      timestamp
    };

    console.log(`[AdvisoryManager] EXIT TRIGGERED: ${type}. Reason: ${reasoning}`);
    this.activeSignal = null;
    this.activeOptionSymbol = "";
    this.activeOrderId = "";
    this.isBreakevenLocked = false;
    this.isTarget1Locked = false;
    this.peakPremiumLtp = 0;
    this.entryTime = 0;
    this.onSignalCallback(exitSignal);
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
}
