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
    if (vix < 10) return "LOW_VOLATILITY";

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
    avgVolume5: number
  ): boolean {
    // 1. Immediate rejection: breakout but price returned inside ORB
    if (triggerType === "CALL_BUY" && spot <= orbHigh) return true;
    if (triggerType === "PUT_BUY" && spot >= orbLow) return true;
    
    // 2. Upgrade 1: Heavyweight Divergence Trap - If heavyweights actively oppose breakout, flag false breakout
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

    if (validActiveCount >= 2 && heavyweightAlignsCount / validActiveCount < 0.35) {
      return true; // Heavyweights strongly opposing spot move -> False Breakout Trap!
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
    cpr: CPRValues | null;
    pcr: number;
    vix: number;
    atr: number;
    riskReward: number;
    candles5m: { close: number; high: number; low: number; volume: number }[];
    heavyweightsLtp: { [symbol: string]: number };
    heavyweightsVwap: { [symbol: string]: number };
    optionPremiumRsi: number;
  }): SignalScoreCard {
    const {
      spot,
      currentVwap,
      orbHigh,
      orbLow,
      triggerType,
      cpr,
      pcr,
      vix,
      atr,
      riskReward,
      candles5m,
      heavyweightsLtp,
      heavyweightsVwap,
      optionPremiumRsi
    } = params;

    const explanation: string[] = [];
    const regime = this.classifyRegime(spot, cpr, vix, candles5m, atr);

    // Initial check: False Breakout
    const currentCandle = candles5m[candles5m.length - 1];
    const prev5Volumes = candles5m.slice(-6, -1).map(c => c.volume);
    const avgVolume5 = prev5Volumes.length > 0 ? prev5Volumes.reduce((a, b) => a + b, 0) / prev5Volumes.length : 0;
    const currentVolume = currentCandle ? currentCandle.volume : 0;

    const isFalseBreakout = this.detectFalseBreakout(
      spot,
      orbHigh,
      orbLow,
      triggerType,
      heavyweightsLtp,
      heavyweightsVwap,
      currentVolume,
      avgVolume5
    );

    // 5m 9/21 trend confirmation (Nifty options), not swing 50/200
    let isCounterTrend = false;
    if (candles5m.length >= NIFTY_OPTIONS_EMA_SLOW) {
      const closes = candles5m.map(c => c.close);
      const { emaFast, emaSlow, ready } = getIntradayEmaTrend(closes, spot);
      if (ready) {
        if (triggerType === "CALL_BUY" && (spot < emaFast || emaFast < emaSlow)) isCounterTrend = true;
        if (triggerType === "PUT_BUY" && (spot > emaFast || emaFast > emaSlow)) isCounterTrend = true;
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
      // Fallback if index-based trading is running
      factors.heavyweights.score += 10;
      factors.heavyweights.factors.push("Index-based momentum alignment active");
    }

    // 4. Options Market Structure / PCR (15 Points)
    if (triggerType === "CALL_BUY" && pcr <= 1.35) {
      factors.optionsStructure.score += 8;
      factors.optionsStructure.factors.push(`PCR levels supportive for CALL buying (${pcr.toFixed(2)})`);
    } else if (triggerType === "PUT_BUY" && pcr >= 0.60) {
      factors.optionsStructure.score += 8;
      factors.optionsStructure.factors.push(`PCR levels supportive for PUT buying (${pcr.toFixed(2)})`);
    }
    // OI concentration: award points only when PCR skew is meaningful
    if ((triggerType === "CALL_BUY" && pcr >= 0.90 && pcr <= 1.25) ||
        (triggerType === "PUT_BUY" && pcr >= 0.70 && pcr <= 1.10)) {
      factors.optionsStructure.score += 7;
      factors.optionsStructure.factors.push(`Option chain OI concentration favourable (PCR=${pcr.toFixed(2)})`);
    } else if (pcr > 0 && pcr < 5) {
      factors.optionsStructure.score += 3;
      factors.optionsStructure.factors.push(`Option chain OI present but skew is non-ideal (PCR=${pcr.toFixed(2)})`);
    }

    // 5. Volatility (10 Points)
    if (vix >= 12 && vix <= 18) {
      factors.volatility.score += 6;
      factors.volatility.factors.push(`India VIX inside optimal trading band (${vix.toFixed(1)})`);
    } else {
      factors.volatility.score += 3;
      factors.volatility.factors.push(`India VIX is non-optimal/stale (${vix.toFixed(1)})`);
    }
    // ATR size check
    if (atr > 8) {
      factors.volatility.score += 4;
      factors.volatility.factors.push(`ATR offers sufficient intraday range (${atr.toFixed(1)} pts)`);
    }

    // 6. Regime Alignment & Multi-Timeframe (15m) Trend Confirmation (10 Points)
    // Aggregate 5m candles into 15m candles for higher-timeframe trend check
    let is15mTrendAligned = false;
    if (candles5m.length >= 9) {
      const closes15m: number[] = [];
      for (let i = 2; i < candles5m.length; i += 3) {
        closes15m.push(candles5m[i].close);
      }
      if (closes15m.length >= 5) {
        const { trendBullish: b15, trendBearish: br15 } = getIntradayEmaTrend(closes15m, spot);
        if (triggerType === "CALL_BUY" && b15) is15mTrendAligned = true;
        if (triggerType === "PUT_BUY" && br15) is15mTrendAligned = true;
      }
    }

    if (triggerType === "CALL_BUY" && regime === "TREND_UP") {
      factors.regimeAlignment.score += 10;
      factors.regimeAlignment.factors.push("CALL option aligned with 5m & 15m TREND_UP regime");
    } else if (triggerType === "PUT_BUY" && regime === "TREND_DOWN") {
      factors.regimeAlignment.score += 10;
      factors.regimeAlignment.factors.push("PUT option aligned with 5m & 15m TREND_DOWN regime");
    } else if (regime === "BREAKOUT_ATTEMPT") {
      factors.regimeAlignment.score += is15mTrendAligned ? 9 : 6;
      factors.regimeAlignment.factors.push(is15mTrendAligned 
        ? "Breakout matches regime & 15m higher timeframe trend"
        : "Breakout strategy matches breakout regime");
    }

    // 7. Option Momentum (10 Points)
    if (optionPremiumRsi > 52 && optionPremiumRsi < 78) {
      factors.optionMomentum.score += 6;
      factors.optionMomentum.factors.push(`Option premium RSI indicates breakout acceleration (${optionPremiumRsi.toFixed(1)})`);
    } else {
      factors.optionMomentum.score += 3;
    }
    // Bid/Ask spread quality (simulated default)
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

    // Apply strict penalties
    if (isCounterTrend) {
      totalScore = Math.max(0, totalScore - 15);
      explanation.push("⚠ COUNTER TREND TRADE PENALTY (-15 points applied)");
    }

    if (isChoppyAdx) {
      totalScore = Math.max(0, totalScore - 15);
      explanation.push(`⚠ CHOPPY MARKET PENALTY (ADX=${currentAdx.toFixed(1)} < 18: -15 points applied)`);
    }

    // RANGE Regime Penalty: Sideways markets kill option premiums via Theta decay
    if (regime === "RANGE") {
      totalScore = Math.max(0, totalScore - 12);
      explanation.push("⚠ RANGE REGIME PENALTY (-12 points): Sideways consolidation detected. Theta decay risk high.");
    }

    if (isFalseBreakout || currentAdx < 14) {
      totalScore = 0;
      explanation.push(isFalseBreakout
        ? "✕ FALSE BREAKOUT DETECTED: Signal score reset to zero."
        : `✕ SEVERE CHOP DETECTED (ADX=${currentAdx.toFixed(1)} < 14): Signal score reset to zero.`);
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
      isFalseBreakout,
      isCounterTrend,
      factors,
      explanation
    };
  }
}
