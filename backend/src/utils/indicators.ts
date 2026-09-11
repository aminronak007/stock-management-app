export class Indicators {
  /**
   * Calculates Simple Moving Average (SMA)
   */
  public static calculateSMA(prices: number[], period: number): number[] {
    const sma: number[] = [];
    if (prices.length < period) return sma;

    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += prices[i];
    }
    sma.push(sum / period);

    for (let i = period; i < prices.length; i++) {
      sum = sum - prices[i - period] + prices[i];
      sma.push(sum / period);
    }
    return sma;
  }

  /**
   * Calculates Exponential Moving Average (EMA)
   */
  public static calculateEMA(prices: number[], period: number): number[] {
    const ema: number[] = [];
    if (prices.length < period) return ema;

    const k = 2 / (period + 1);
    
    // First EMA is simple SMA
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += prices[i];
    }
    let prevEma = sum / period;
    ema.push(prevEma);

    for (let i = period; i < prices.length; i++) {
      const currentEma = prices[i] * k + prevEma * (1 - k);
      ema.push(currentEma);
      prevEma = currentEma;
    }
    return ema;
  }

  /**
   * Calculates Relative Strength Index (RSI)
   */
  public static calculateRSI(prices: number[], period: number = 14): number[] {
    const rsi: number[] = [];
    if (prices.length <= period) return rsi;

    const gains: number[] = [];
    const losses: number[] = [];

    // Calculate changes
    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? -change : 0);
    }

    // First average gain / loss
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 0; i < period; i++) {
      avgGain += gains[i];
      avgLoss += losses[i];
    }
    avgGain /= period;
    avgLoss /= period;

    let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + rs));

    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      
      rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi.push(100 - 100 / (1 + rs));
    }

    return rsi;
  }

  /**
   * Calculates Average True Range (ATR)
   */
  public static calculateATR(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number = 14
  ): number[] {
    const atr: number[] = [];
    const len = highs.length;
    if (len < period + 1) return atr;

    const trs: number[] = [];
    
    // First TR is just High - Low
    trs.push(highs[0] - lows[0]);

    for (let i = 1; i < len; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trs.push(tr);
    }

    // First ATR is SMA of TRs
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += trs[i];
    }
    let prevAtr = sum / period;
    atr.push(prevAtr);

    for (let i = period; i < trs.length; i++) {
      const currentAtr = (prevAtr * (period - 1) + trs[i]) / period;
      atr.push(currentAtr);
      prevAtr = currentAtr;
    }

    return atr;
  }

  /**
   * Calculates Volume Weighted Average Price (VWAP)
   */
  public static calculateVWAP(candles: { high: number; low: number; close: number; volume?: number }[]): number {
    if (candles.length === 0) return 0;
    let cumulativeTypicalVolume = 0;
    let cumulativeVolume = 0;
    let fallbackTypicalSum = 0;

    for (const c of candles) {
      const typicalPrice = (c.high + c.low + c.close) / 3;
      fallbackTypicalSum += typicalPrice;
      const vol = (c.volume && c.volume > 0) ? c.volume : 0;
      if (vol > 0) {
        cumulativeTypicalVolume += typicalPrice * vol;
        cumulativeVolume += vol;
      }
    }

    if (cumulativeVolume > 0) {
      return cumulativeTypicalVolume / cumulativeVolume;
    }
    return fallbackTypicalSum / candles.length;
  }

  /**
   * Calculates Average Directional Index (ADX)
   */
  public static calculateADX(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number = 14
  ): number[] {
    const adx: number[] = [];
    const len = highs.length;
    if (len < period * 2) return adx;

    const trs: number[] = [];
    const plusDMs: number[] = [];
    const minusDMs: number[] = [];

    for (let i = 1; i < len; i++) {
      const upMove = highs[i] - highs[i - 1];
      const downMove = lows[i - 1] - lows[i];

      const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
      const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;

      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );

      trs.push(tr);
      plusDMs.push(plusDM);
      minusDMs.push(minusDM);
    }

    if (trs.length < period) return adx;

    let smoothTR = 0;
    let smoothPlusDM = 0;
    let smoothMinusDM = 0;

    for (let i = 0; i < period; i++) {
      smoothTR += trs[i];
      smoothPlusDM += plusDMs[i];
      smoothMinusDM += minusDMs[i];
    }

    const dxList: number[] = [];

    const getDx = (sTR: number, sP: number, sM: number) => {
      const plusDI = sTR > 0 ? (sP / sTR) * 100 : 0;
      const minusDI = sTR > 0 ? (sM / sTR) * 100 : 0;
      const sum = plusDI + minusDI;
      return sum > 0 ? (Math.abs(plusDI - minusDI) / sum) * 100 : 0;
    };

    dxList.push(getDx(smoothTR, smoothPlusDM, smoothMinusDM));

    for (let i = period; i < trs.length; i++) {
      smoothTR = smoothTR - smoothTR / period + trs[i];
      smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDMs[i];
      smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDMs[i];
      dxList.push(getDx(smoothTR, smoothPlusDM, smoothMinusDM));
    }

    if (dxList.length < period) return adx;

    let adxVal = 0;
    for (let i = 0; i < period; i++) {
      adxVal += dxList[i];
    }
    adxVal /= period;
    adx.push(adxVal);

    for (let i = period; i < dxList.length; i++) {
      adxVal = (adxVal * (period - 1) + dxList[i]) / period;
      adx.push(adxVal);
    }

    return adx;
  }

  /**
   * Helper to calculate ADX directly from a Candle array
   */
  public static calculateCandleADX(candles: { high: number; low: number; close: number }[], period: number = 14): number {
    if (!candles || candles.length < 14) return 20.0;
    const effectivePeriod = candles.length < period * 2 ? Math.max(7, Math.floor(candles.length / 2)) : period;
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    const adxList = this.calculateADX(highs, lows, closes, effectivePeriod);
    return adxList.length > 0 ? parseFloat(adxList[adxList.length - 1].toFixed(2)) : 20.0;
  }

  /**
   * Calculates Bollinger Bands and Bandwidth %
   */
  public static calculateBollingerBands(
    prices: number[],
    period: number = 20,
    stdDevMultiplier: number = 2.0
  ): { upper: number; middle: number; lower: number; bandwidth: number } | null {
    if (prices.length < period) return null;
    const slice = prices.slice(-period);
    const middle = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, p) => sum + Math.pow(p - middle, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    const upper = middle + stdDevMultiplier * stdDev;
    const lower = middle - stdDevMultiplier * stdDev;
    const bandwidth = middle > 0 ? ((upper - lower) / middle) * 100 : 0;
    return {
      upper: parseFloat(upper.toFixed(2)),
      middle: parseFloat(middle.toFixed(2)),
      lower: parseFloat(lower.toFixed(2)),
      bandwidth: parseFloat(bandwidth.toFixed(2))
    };
  }

  /**
   * Calculates SuperTrend indicator (period, multiplier)
   */
  public static calculateSuperTrend(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number = 10,
    multiplier: number = 3
  ): SuperTrendResult {
    const len = closes.length;
    if (len === 0) return { superTrend: [], direction: [] };
    const atr = this.calculateATR(highs, lows, closes, period);
    const superTrend: number[] = new Array(len).fill(0);
    const direction: ("BULLISH" | "BEARISH")[] = new Array(len).fill("BULLISH");

    const upperBand: number[] = new Array(len).fill(0);
    const lowerBand: number[] = new Array(len).fill(0);

    for (let i = 0; i < len; i++) {
      const hl2 = (highs[i] + lows[i]) / 2;
      const currentAtr = atr[i] || 10;
      const basicUpper = hl2 + multiplier * currentAtr;
      const basicLower = hl2 - multiplier * currentAtr;

      if (i === 0) {
        upperBand[i] = basicUpper;
        lowerBand[i] = basicLower;
        direction[i] = closes[i] >= basicLower ? "BULLISH" : "BEARISH";
        superTrend[i] = direction[i] === "BULLISH" ? lowerBand[i] : upperBand[i];
      } else {
        lowerBand[i] = (basicLower > lowerBand[i - 1] || closes[i - 1] < lowerBand[i - 1]) ? basicLower : lowerBand[i - 1];
        upperBand[i] = (basicUpper < upperBand[i - 1] || closes[i - 1] > upperBand[i - 1]) ? basicUpper : upperBand[i - 1];

        if (direction[i - 1] === "BULLISH") {
          direction[i] = closes[i] < lowerBand[i] ? "BEARISH" : "BULLISH";
        } else {
          direction[i] = closes[i] > upperBand[i] ? "BULLISH" : "BEARISH";
        }
        superTrend[i] = direction[i] === "BULLISH" ? lowerBand[i] : upperBand[i];
      }
    }

    return { superTrend, direction };
  }

  /**
   * Calculates Moving Average Convergence Divergence (MACD) with 1-to-1 index alignment
   */
  public static calculateMACD(
    closes: number[],
    fastPeriod: number = 12,
    slowPeriod: number = 26,
    signalPeriod: number = 9
  ): MACDResult {
    const len = closes.length;
    if (len === 0) return { macd: [], signal: [], histogram: [] };

    const calcAlignedEMA = (values: number[], period: number): number[] => {
      const out: number[] = new Array(values.length).fill(0);
      if (values.length === 0) return out;
      const k = 2 / (period + 1);
      out[0] = values[0];
      for (let i = 1; i < values.length; i++) {
        out[i] = values[i] * k + out[i - 1] * (1 - k);
      }
      return out;
    };

    const fastEma = calcAlignedEMA(closes, fastPeriod);
    const slowEma = calcAlignedEMA(closes, slowPeriod);
    const macd: number[] = new Array(len);

    for (let i = 0; i < len; i++) {
      macd[i] = parseFloat((fastEma[i] - slowEma[i]).toFixed(4));
    }

    const signal = calcAlignedEMA(macd, signalPeriod);
    const histogram: number[] = new Array(len);
    for (let i = 0; i < len; i++) {
      histogram[i] = parseFloat((macd[i] - signal[i]).toFixed(4));
    }

    return { macd, signal, histogram };
  }
}

export interface SuperTrendResult {
  superTrend: number[];
  direction: ("BULLISH" | "BEARISH")[];
}

export interface MACDResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

