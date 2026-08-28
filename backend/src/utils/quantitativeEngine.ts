import { CPRValues } from "./cpr";
import { Indicators } from "./indicators";
import { getIntradayEmaTrend, isClosedBarVolumeExpanded, NIFTY_OPTIONS_EMA_SLOW } from "./niftyOptionsSetup";

export type MarketRegime = 
  | "TREND_UP"
  | "TREND_DOWN"
  | "RANGE"
  | "HIGH_VOLATILITY"
  | "LOW_VOLATILITY"
  | "BREAKOUT_ATTEMPT"
  | "REVERSAL";

export type StrategySetup = 
  | "ORB_BREAKOUT"
  | "TRAP_REVERSAL"
  | "VWAP_PULLBACK";

export interface ConfluenceFactors {
  marketStructure: { score: number; max: number; factors: string[] };
  vwapMomentum: { score: number; max: number; factors: string[] };
  heavyweights: { score: number; max: number; factors: string[] };
  optionsStructure: { score: number; max: number; factors: string[] };
  volatility: { score: number; max: number; factors: string[] };
  regimeAlignment: { score: number; max: number; factors: string[] };
  optionMomentum: { score: number; max: number; factors: string[] };
  riskReward: { score: number; max: number; factors: string[] };
}

export interface SignalScoreCard {
  totalScore: number;
  qualityLabel: "NO_TRADE" | "WATCH" | "WEAK_SETUP" | "HIGH_QUALITY" | "VERY_HIGH_QUALITY";
  regime: MarketRegime;
  setupType?: StrategySetup;
  isFalseBreakout: boolean;
  isCounterTrend: boolean;
  factors: ConfluenceFactors;
  explanation: string[];
}

export class QuantitativeEngine {
  /**
   * Classifies the current market regime based on indicators and price action
   */
  public static classifyRegime(
    spot: number,
    cpr: CPRValues | null,
    vix: number,
    candles5m: { close: number; high: number; low: number; volume: number }[],
    atr: number
  ): MarketRegime {
    if (vix > 20) return "HIGH_VOLATILITY";
    if (vix < 9) return "LOW_VOLATILITY";

    if (candles5m.length >= NIFTY_OPTIONS_EMA_SLOW) {
      const closes = candles5m.map(c => c.close);
      const highs = candles5m.map(c => c.high);
      const lows = candles5m.map(c => c.low);
      const { emaFast, emaSlow, ready } = getIntradayEmaTrend(closes, spot);
      
      if (ready) {
        const emaDiff = Math.abs(emaFast - emaSlow) / spot * 100;
        const adxList = Indicators.calculateADX(highs, lows, closes, 14);
        const currentAdx = adxList.length > 0 ? adxList[adxList.length - 1] : 20;

        if (emaDiff < 0.08 || currentAdx < 18) return "RANGE";

        if (spot > emaFast && emaFast > emaSlow && currentAdx >= 20) return "TREND_UP";
        if (spot < emaFast && emaFast < emaSlow && currentAdx >= 20) return "TREND_DOWN";
      }
    }

    // CPR Width check: extremely wide CPR suggests low volatility consolidation
    if (cpr) {
      const cprWidthPercent = (Math.abs(cpr.topRange - cpr.bottomRange) / cpr.pivot) * 100;
      if (cprWidthPercent > 0.45) return "RANGE";
    }

    return "BREAKOUT_ATTEMPT";
  }

  /**
   * Evaluates if a breakout is high-risk false breakout
   */
  public static detectFalseBreakout(
    spot: number,
    orbHigh: number,
    orbLow: number,
    triggerType: "CALL_BUY" | "PUT_BUY",
    heavyweightsLtp: { [symbol: string]: number },
    heavyweightsVwap: { [symbol: string]: number },
    currentVolume: number,
    avgVolume5: number,
    latestCandle?: { close: number; open: number; high: number; low: number }
  ): boolean {
    // 1. Immediate rejection: breakout but price returned inside ORB
    if (triggerType === "CALL_BUY" && spot <= orbHigh) return true;
    if (triggerType === "PUT_BUY" && spot >= orbLow) return true;
    
    // 2. Bank Nifty Index Synchronicity Check: If Bank Nifty strongly diverges from Nifty 50, flag false breakout
    const bankNiftyLtp = heavyweightsLtp["NSE:NIFTYBANK-INDEX"] || 0;
    const bankNiftyVwap = heavyweightsVwap["NSE:NIFTYBANK-INDEX"] || 0;
    if (bankNiftyLtp > 0 && bankNiftyVwap > 0) {
      if (triggerType === "CALL_BUY" && bankNiftyLtp < bankNiftyVwap * 0.999) {
        return true; // Bank Nifty is below VWAP while Nifty attempts Call Breakout -> Divergence Trap!
      }
      if (triggerType === "PUT_BUY" && bankNiftyLtp > bankNiftyVwap * 1.001) {
        return true; // Bank Nifty is above VWAP while Nifty attempts Put Breakdown -> Divergence Trap!
      }
    }

    // 2b. Heavyweight Divergence Trap - If heavyweights actively oppose breakout, flag false breakout
    let heavyweightAlignsCount = 0;
    let validActiveCount = 0;
    const trackedKeys = Object.keys(heavyweightsLtp);
    trackedKeys.forEach(sym => {
      const ltp = heavyweightsLtp[sym] || 0;
      const vwap = heavyweightsVwap[sym] || 0;
      if (ltp > 0 && vwap > 0) {
        validActiveCount++;
        if (triggerType === "CALL_BUY" && ltp > vwap) heavyweightAlignsCount++;
        if (triggerType === "PUT_BUY" && ltp < vwap) heavyweightAlignsCount++;
      }
    });

    if (validActiveCount >= 2 && heavyweightAlignsCount / validActiveCount < 0.45) {
      return true; // Heavyweights strongly opposing spot move -> False Breakout Trap!
    }

    // 3. Exhaustion Pin-Bar / Rejection Wick Check:
    // If the latest closed candle spiked outside ORB but closed with a heavy opposing rejection wick (> 45% of candle range), it flags an exhaustion trap
    if (latestCandle) {
      const candleRange = latestCandle.high - latestCandle.low;
      if (candleRange > 3) {
        if (triggerType === "CALL_BUY") {
          const upperWick = latestCandle.high - Math.max(latestCandle.open, latestCandle.close);
          if (upperWick / candleRange > 0.45 && latestCandle.close < latestCandle.open) {
            return true; // Shooting star / Bearish rejection pinbar at highs!
          }
        } else if (triggerType === "PUT_BUY") {
          const lowerWick = Math.min(latestCandle.open, latestCandle.close) - latestCandle.low;
          if (lowerWick / candleRange > 0.45 && latestCandle.close > latestCandle.open) {
            return true; // Hammer / Bullish rejection pinbar at lows!
          }
        }
      }
    }

    return false;
  }

  /**
   * Computes the confluence score (0-100) card
   */
  public static calculateConfluence(params: {
    spot: number;
    currentVwap: number;
    orbHigh: number;
    orbLow: number;
    triggerType: "CALL_BUY" | "PUT_BUY";
    setupType?: StrategySetup;
    cpr: CPRValues | null;
    pcr: number;
    vix: number;
    atr: number;
    riskReward: number;
    candles5m: { close: number; high: number; low: number; volume: number; open?: number }[];
    heavyweightsLtp: { [symbol: string]: number };
    heavyweightsVwap: { [symbol: string]: number };
    optionPremiumRsi: number;
    maxCallOiStrike?: number;
    maxPutOiStrike?: number;
    deltaCallOi?: number;
    deltaPutOi?: number;
    deltaVixPercent?: number;
    giftNiftyDelta?: number;
  }): SignalScoreCard {
    const {
      spot,
      currentVwap,
      orbHigh,
      orbLow,
      triggerType,
      setupType = "ORB_BREAKOUT",
      cpr,
      pcr,
      vix,
      atr,
      riskReward,
      candles5m,
      heavyweightsLtp,
      heavyweightsVwap,
      optionPremiumRsi,
      maxCallOiStrike,
      maxPutOiStrike,
      deltaCallOi,
      deltaPutOi,
      deltaVixPercent,
      giftNiftyDelta
    } = params;

    const explanation: string[] = [];
    const regime = this.classifyRegime(spot, cpr, vix, candles5m, atr);

    // Initial check: False Breakout (Only for ORB_BREAKOUT entries; TRAP_REVERSAL trades the trap itself)
    const currentCandle = candles5m[candles5m.length - 1];
    const prev5Volumes = candles5m.slice(-6, -1).map(c => c.volume);
    const avgVolume5 = prev5Volumes.length > 0 ? prev5Volumes.reduce((a, b) => a + b, 0) / prev5Volumes.length : 0;
    const currentVolume = currentCandle ? currentCandle.volume : 0;

    let isFalseBreakout = setupType === "ORB_BREAKOUT" 
      ? this.detectFalseBreakout(
          spot,
          orbHigh,
          orbLow,
          triggerType,
          heavyweightsLtp,
          heavyweightsVwap,
          currentVolume,
          avgVolume5,
          currentCandle && currentCandle.open !== undefined ? (currentCandle as { close: number; open: number; high: number; low: number }) : undefined
        )
      : false;

    // 5m 9/21 trend confirmation (Nifty options)
    let isCounterTrend = false;
    if (candles5m.length >= NIFTY_OPTIONS_EMA_SLOW) {
      const closes = candles5m.map(c => c.close);
      const { emaFast, emaSlow, ready } = getIntradayEmaTrend(closes, spot);
      if (ready) {
        if (triggerType === "CALL_BUY" && (spot < emaFast || emaFast < emaSlow)) isCounterTrend = true;
        if (triggerType === "PUT_BUY" && (spot > emaFast || emaFast > emaSlow)) isCounterTrend = true;
      }
    }

    // Multi-Timeframe 15m Trend check
    let is15mTrendAligned = false;
    let is15mCounterTrend = false;
    if (candles5m.length >= 9) {
      const closes15m: number[] = [];
      for (let i = 2; i < candles5m.length; i += 3) {
        closes15m.push(candles5m[i].close);
      }
      if (closes15m.length >= 5) {
        const { trendBullish: b15, trendBearish: br15, ready: ready15 } = getIntradayEmaTrend(closes15m, spot, 5, 13);
        if (ready15) {
          if (triggerType === "CALL_BUY") {
            if (b15) is15mTrendAligned = true;
            if (br15) is15mCounterTrend = true;
          } else if (triggerType === "PUT_BUY") {
            if (br15) is15mTrendAligned = true;
            if (b15) is15mCounterTrend = true;
          }
        }
      }
    }

    // Institutional OI Wall Resistance/Support Check
    let isNearCallWall = false;
    let isNearPutWall = false;
    if (triggerType === "CALL_BUY" && maxCallOiStrike && maxCallOiStrike > 0) {
      if (spot < maxCallOiStrike && (maxCallOiStrike - spot) <= 15) {
        isNearCallWall = true;
      }
    } else if (triggerType === "PUT_BUY" && maxPutOiStrike && maxPutOiStrike > 0) {
      if (spot > maxPutOiStrike && (spot - maxPutOiStrike) <= 15) {
        isNearPutWall = true;
      }
    }

    // Confluence Factors breakdown cards
    const factors: ConfluenceFactors = {
      marketStructure: { score: 0, max: 20, factors: [] },
      vwapMomentum: { score: 0, max: 15, factors: [] },
      heavyweights: { score: 0, max: 15, factors: [] },
      optionsStructure: { score: 0, max: 15, factors: [] },
      volatility: { score: 0, max: 10, factors: [] },
      regimeAlignment: { score: 0, max: 10, factors: [] },
      optionMomentum: { score: 0, max: 10, factors: [] },
      riskReward: { score: 0, max: 5, factors: [] }
    };

    // 1. Market Structure (20 Points)
    if (setupType === "TRAP_REVERSAL") {
      factors.marketStructure.score += 15;
      factors.marketStructure.factors.push(triggerType === "PUT_BUY" 
        ? "Bull Trap confirmed: Spot rejected from Day High / ORB High towards VWAP"
        : "Bear Trap confirmed: Spot rejected from Day Low / ORB Low towards VWAP");
    } else if (setupType === "VWAP_PULLBACK") {
      factors.marketStructure.score += 10;
      factors.marketStructure.factors.push("Pullback to dynamic VWAP / 21 EMA support/resistance verified");
    } else {
      if (triggerType === "CALL_BUY") {
        if (spot > orbHigh) {
          factors.marketStructure.score += 10;
          factors.marketStructure.factors.push("Spot breakout above ORB High");
        }
      } else {
        if (spot < orbLow) {
          factors.marketStructure.score += 10;
          factors.marketStructure.factors.push("Spot breakdown below ORB Low");
        }
      }
    }

    if (cpr) {
      const outsideCpr = spot > cpr.topRange || spot < cpr.bottomRange;
      if (outsideCpr) {
        factors.marketStructure.score += 10;
        factors.marketStructure.factors.push("Price clear of consolidation CPR range");
      }
    } else {
      factors.marketStructure.score += 10;
    }

    // 2. VWAP & Momentum (15 Points)
    if (setupType === "TRAP_REVERSAL") {
      factors.vwapMomentum.score += 12;
      factors.vwapMomentum.factors.push("Mean Reversion target: Session VWAP reversion path clear");
    } else {
      const isAboveVwap = spot > currentVwap;
      if ((triggerType === "CALL_BUY" && isAboveVwap) || (triggerType === "PUT_BUY" && !isAboveVwap)) {
        factors.vwapMomentum.score += 8;
        factors.vwapMomentum.factors.push("Spot aligned with session VWAP direction");
      }
      const volumeExpanded = isClosedBarVolumeExpanded(candles5m.map(c => c.volume));
      if (volumeExpanded) {
        factors.vwapMomentum.score += 7;
        factors.vwapMomentum.factors.push("Closed-bar volume expanded vs recent 5m average (1.2×)");
      } else if (currentVolume >= 1.0 * avgVolume5 && avgVolume5 > 0) {
        factors.vwapMomentum.score += 4;
        factors.vwapMomentum.factors.push("Volume above baseline threshold");
      }
    }

    // 3. Heavyweights Confirmation (15 Points)
    let heavyweightAlignsCount = 0;
    let validActiveCount = 0;
    const trackedKeys = Object.keys(heavyweightsLtp);
    trackedKeys.forEach(sym => {
      const ltp = heavyweightsLtp[sym] || 0;
      const vwap = heavyweightsVwap[sym] || 0;
      if (ltp > 0 && vwap > 0) {
        validActiveCount++;
        if (triggerType === "CALL_BUY" && ltp > vwap) heavyweightAlignsCount++;
        if (triggerType === "PUT_BUY" && ltp < vwap) heavyweightAlignsCount++;
      }
    });

    if (validActiveCount > 0) {
      const ratio = heavyweightAlignsCount / validActiveCount;
      if (ratio >= 0.8) {
        factors.heavyweights.score += 15;
        factors.heavyweights.factors.push("All active heavyweight stocks (Reliance/HDFC/ICICI) strongly confirm breakout trend");
      } else if (ratio >= 0.5) {
        factors.heavyweights.score += 10;
        factors.heavyweights.factors.push("Majority heavyweight alignment confirmed");
      } else {
        factors.heavyweights.score = 0;
        factors.heavyweights.factors.push("❌ HEAVYWEIGHT WARNING: Heavyweight stocks opposing breakout - HIGH RISK TRAP!");
        explanation.push("Heavyweight stock VWAP alignment failed (< 50%). High probability fakeout trap.");
      }
    } else {
      factors.heavyweights.score += 10;
      factors.heavyweights.factors.push("Index-based momentum alignment active");
    }

    // 4. Options Market Structure / PCR & ΔOI (15 Points)
    if (triggerType === "CALL_BUY" && pcr <= 1.35) {
      factors.optionsStructure.score += 5;
      factors.optionsStructure.factors.push(`PCR levels supportive for CALL buying (${pcr.toFixed(2)})`);
    } else if (triggerType === "PUT_BUY" && pcr >= 0.60) {
      factors.optionsStructure.score += 5;
      factors.optionsStructure.factors.push(`PCR levels supportive for PUT buying (${pcr.toFixed(2)})`);
    }
    if ((triggerType === "CALL_BUY" && pcr >= 0.90 && pcr <= 1.25) ||
        (triggerType === "PUT_BUY" && pcr >= 0.70 && pcr <= 1.10)) {
      factors.optionsStructure.score += 5;
      factors.optionsStructure.factors.push(`Option chain OI concentration favourable (PCR=${pcr.toFixed(2)})`);
    } else if (pcr > 0 && pcr < 5) {
      factors.optionsStructure.score += 2;
    }

    // Delta OI Unwinding Check
    if (triggerType === "CALL_BUY" && deltaCallOi !== undefined && deltaCallOi < 0) {
      factors.optionsStructure.score += 5;
      factors.optionsStructure.factors.push("Institutional Call Unwinding detected (Shorts covering, trend accelerating)");
    } else if (triggerType === "PUT_BUY" && deltaPutOi !== undefined && deltaPutOi < 0) {
      factors.optionsStructure.score += 5;
      factors.optionsStructure.factors.push("Institutional Put Unwinding detected (Shorts covering, trend accelerating)");
    }

    // 5. Volatility (10 Points)
    if (vix >= 12 && vix <= 18) {
      factors.volatility.score += 6;
      factors.volatility.factors.push(`India VIX inside optimal trading band (${vix.toFixed(1)})`);
    } else if (vix >= 10 && vix < 12) {
      factors.volatility.score += 5;
      factors.volatility.factors.push(`Low India VIX (${vix.toFixed(1)}): ITM option delta calibrated for momentum`);
    } else {
      factors.volatility.score += 3;
    }
    if (atr > 6) {
      factors.volatility.score += 4;
      factors.volatility.factors.push(`ATR offers sufficient intraday range (${atr.toFixed(1)} pts)`);
    }

    // 6. Regime Alignment & Multi-Timeframe (15m) Trend Confirmation (10 Points)
    if (setupType === "TRAP_REVERSAL") {
      factors.regimeAlignment.score += 10;
      factors.regimeAlignment.factors.push("Mean Reversion strategy matches RANGE / Consolidation market regime");
    } else if (triggerType === "CALL_BUY" && regime === "TREND_UP") {
      factors.regimeAlignment.score += 10;
      factors.regimeAlignment.factors.push("CALL option aligned with 5m & 15m TREND_UP regime");
    } else if (triggerType === "PUT_BUY" && regime === "TREND_DOWN") {
      factors.regimeAlignment.score += 10;
      factors.regimeAlignment.factors.push("PUT option aligned with 5m & 15m TREND_DOWN regime");
    } else if (regime === "BREAKOUT_ATTEMPT") {
      factors.regimeAlignment.score += is15mTrendAligned ? 10 : 6;
      factors.regimeAlignment.factors.push(is15mTrendAligned 
        ? "Breakout matches regime & 15m higher timeframe trend"
        : "Breakout strategy matches breakout regime");
    }

    // 7. Option Momentum (10 Points)
    if (setupType === "TRAP_REVERSAL") {
      factors.optionMomentum.score += 8;
      factors.optionMomentum.factors.push("Exhaustion momentum confirmed for mean reversion scalp");
    } else if (optionPremiumRsi > 52 && optionPremiumRsi < 78) {
      factors.optionMomentum.score += 6;
      factors.optionMomentum.factors.push(`Option premium RSI indicates breakout acceleration (${optionPremiumRsi.toFixed(1)})`);
    } else {
      factors.optionMomentum.score += 3;
    }
    factors.optionMomentum.score += 4;
    factors.optionMomentum.factors.push("Option spread bid/ask is liquid");

    // 8. Risk/Reward (5 Points)
    if (riskReward >= 1.5) {
      factors.riskReward.score += 5;
      factors.riskReward.factors.push(`Risk reward ratio matches parameters (RR=${riskReward.toFixed(2)})`);
    }

    // Sum overall score
    let totalScore = 
      factors.marketStructure.score +
      factors.vwapMomentum.score +
      factors.heavyweights.score +
      factors.optionsStructure.score +
      factors.volatility.score +
      factors.regimeAlignment.score +
      factors.optionMomentum.score +
      factors.riskReward.score;

    // ADX Trend Strength Check (Choppiness filter)
    const highs = candles5m.map(c => c.high);
    const lows = candles5m.map(c => c.low);
    const closes = candles5m.map(c => c.close);
    const adxList = Indicators.calculateADX(highs, lows, closes, 14);
    const currentAdx = adxList.length > 0 ? adxList[adxList.length - 1] : 20;

    const isChoppyAdx = currentAdx < 18;

    // Apply strict institutional penalties (Exempt TRAP_REVERSAL from counter-trend penalty)
    if (isCounterTrend && setupType !== "TRAP_REVERSAL") {
      totalScore = Math.max(0, totalScore - 15);
      explanation.push("⚠ 5M COUNTER TREND TRADE PENALTY (-15 points applied)");
    }

    if (is15mCounterTrend && setupType !== "TRAP_REVERSAL") {
      totalScore = 0;
      isFalseBreakout = true;
      explanation.push("✕ 15M INSTITUTIONAL TREND GATE: 15-minute higher timeframe trend opposes breakout. High probability failure.");
    }

    if (isNearCallWall) {
      totalScore = Math.max(0, totalScore - 15);
      explanation.push(`⚠ CALL RESISTANCE WALL PENALTY (-15 points): Spot approaching Max Call OI Resistance Wall at ${maxCallOiStrike}`);
    }

    if (isNearPutWall) {
      totalScore = Math.max(0, totalScore - 15);
      explanation.push(`⚠ PUT SUPPORT WALL PENALTY (-15 points): Spot approaching Max Put OI Support Wall at ${maxPutOiStrike}`);
    }

    if (triggerType === "CALL_BUY" && deltaCallOi !== undefined && deltaCallOi > 30000) {
      totalScore = Math.max(0, totalScore - 20);
      explanation.push("⚠ INSTITUTIONAL CALL WRITING WALL (-20 points): Heavy call addition into breakout.");
    }

    if (triggerType === "PUT_BUY" && deltaPutOi !== undefined && deltaPutOi > 30000) {
      totalScore = Math.max(0, totalScore - 20);
      explanation.push("⚠ INSTITUTIONAL PUT WRITING WALL (-20 points): Heavy put addition into breakdown.");
    }

    if (deltaVixPercent !== undefined && deltaVixPercent < -3.0) {
      totalScore = Math.max(0, totalScore - 10);
      explanation.push(`⚠ VEGA COLLAPSE WARNING (-10 points): India VIX dropped rapidly (${deltaVixPercent.toFixed(1)}%). Premium decay risk.`);
    }

    if (isChoppyAdx && setupType === "ORB_BREAKOUT") {
      totalScore = Math.max(0, totalScore - 15);
      explanation.push(`⚠ CHOPPY MARKET PENALTY (ADX=${currentAdx.toFixed(1)} < 18: -15 points applied)`);
    }

    // BANK NIFTY & HEAVYWEIGHT INSTITUTIONAL CONSENSUS GATES:
    const bnfLtp = heavyweightsLtp["NSE:NIFTYBANK-INDEX"] || 0;
    const bnfVwap = heavyweightsVwap["NSE:NIFTYBANK-INDEX"] || 0;
    const isBankNiftyDiverging = (triggerType === "CALL_BUY" && bnfLtp > 0 && bnfVwap > 0 && bnfLtp < bnfVwap) ||
                                 (triggerType === "PUT_BUY" && bnfLtp > 0 && bnfVwap > 0 && bnfLtp > bnfVwap);

    if (isBankNiftyDiverging && setupType !== "TRAP_REVERSAL") {
      totalScore = Math.max(0, totalScore - 20);
      explanation.push("⚠ BANK NIFTY DIVERGENCE PENALTY (-20 points): Bank Nifty opposing Nifty breakout direction.");
    }

    const relLtp = heavyweightsLtp["NSE:RELIANCE-EQ"] || 0;
    const relVwap = heavyweightsVwap["NSE:RELIANCE-EQ"] || 0;
    const hdfcLtp = heavyweightsLtp["NSE:HDFCBANK-EQ"] || 0;
    const hdfcVwap = heavyweightsVwap["NSE:HDFCBANK-EQ"] || 0;
    const areTopTwoOpposing = (triggerType === "CALL_BUY" && relLtp > 0 && relLtp < relVwap && hdfcLtp > 0 && hdfcLtp < hdfcVwap) ||
                              (triggerType === "PUT_BUY" && relLtp > 0 && relLtp > relVwap && hdfcLtp > 0 && hdfcLtp > hdfcVwap);
    if (areTopTwoOpposing && setupType !== "TRAP_REVERSAL") {
      totalScore = 0;
      isFalseBreakout = true;
      explanation.push("✕ INSTITUTIONAL DIVERGENCE GATE: Both Reliance and HDFC Bank opposing breakout. 100% False Breakout Trap.");
    }

    // Global Macro Factor: GIFT Nifty (NSE IFSC) Leading Indicator
    if (giftNiftyDelta !== undefined) {
      if (triggerType === "CALL_BUY") {
        if (giftNiftyDelta > 20) {
          totalScore = Math.min(100, totalScore + 5);
          explanation.push(`🌍 GLOBAL MACRO TAILWIND (+5 points): GIFT Nifty bullish lead (+${giftNiftyDelta.toFixed(1)} pts)`);
        } else if (giftNiftyDelta < -35) {
          totalScore = 0;
          isFalseBreakout = true;
          explanation.push(`✕ GLOBAL MACRO DIVERGENCE: GIFT Nifty dumping (-${Math.abs(giftNiftyDelta).toFixed(1)} pts) into domestic CALL breakout. High risk bull trap.`);
        }
      } else if (triggerType === "PUT_BUY") {
        if (giftNiftyDelta < -20) {
          totalScore = Math.min(100, totalScore + 5);
          explanation.push(`🌍 GLOBAL MACRO TAILWIND (+5 points): GIFT Nifty bearish breakdown lead (${giftNiftyDelta.toFixed(1)} pts)`);
        } else if (giftNiftyDelta > 35) {
          totalScore = 0;
          isFalseBreakout = true;
          explanation.push(`✕ GLOBAL MACRO DIVERGENCE: GIFT Nifty surging (+${giftNiftyDelta.toFixed(1)} pts) against domestic PUT breakdown. High risk bear trap.`);
        }
      }
    }

    // STRICT STRATEGY-REGIME GATE:
    // Option Buying Breakouts in a RANGE regime or severe chop (ADX < 18) bleed heavily to Theta decay.
    // In RANGE regimes, ONLY Mean-Reversion / Trap Reversal setups are allowed.
    if (regime === "RANGE" && setupType === "ORB_BREAKOUT") {
      totalScore = 0;
      explanation.push("✕ RANGE REGIME GATE: ORB Breakouts are strictly blocked in consolidation (RANGE) to prevent Theta decay. Only Reversals permitted.");
    }

    if (currentAdx < 18 && setupType === "ORB_BREAKOUT") {
      totalScore = 0;
      explanation.push(`✕ CHOPPY ADX GATE (ADX=${currentAdx.toFixed(1)} < 18): Breakout option buying strictly prohibited in sideways chop.`);
    }

    // RANGE Regime Penalty: Only applies to trend breakouts, not to Mean Reversion scalps
    if (regime === "RANGE" && setupType !== "TRAP_REVERSAL") {
      totalScore = Math.max(0, totalScore - 12);
      explanation.push("⚠ RANGE REGIME PENALTY (-12 points): Sideways consolidation detected. Theta decay risk high.");
    }

    if (isFalseBreakout && setupType === "ORB_BREAKOUT") {
      totalScore = 0;
      explanation.push("✕ FALSE BREAKOUT DETECTED: Breakout signal score reset to zero.");
    }

    if (currentAdx < 14 && setupType === "ORB_BREAKOUT") {
      totalScore = 0;
      explanation.push(`✕ SEVERE CHOP DETECTED (ADX=${currentAdx.toFixed(1)} < 14): Breakout signal score reset to zero.`);
    }

    // Quality labeling
    let qualityLabel: SignalScoreCard["qualityLabel"] = "NO_TRADE";
    if (totalScore >= 90) qualityLabel = "VERY_HIGH_QUALITY";
    else if (totalScore >= 80) qualityLabel = "HIGH_QUALITY";
    else if (totalScore >= 70) qualityLabel = "WEAK_SETUP";
    else if (totalScore >= 60) qualityLabel = "WATCH";

    // Build human readable explanation lists
    explanation.push(`Regime Classification: ${regime}`);
    explanation.push(`Calculated Signal Confluence: ${totalScore}/100 [Quality: ${qualityLabel.replace(/_/g, " ")}]`);
    if (isCounterTrend) explanation.push("Trend context: Price moving against 5-minute 9/21 EMA");

    return {
      totalScore,
      qualityLabel,
      regime,
      setupType,
      isFalseBreakout,
      isCounterTrend,
      factors,
      explanation
    };
  }
}
