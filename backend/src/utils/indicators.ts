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

    for (const c of candles) {
      const typicalPrice = (c.high + c.low + c.close) / 3;
      const vol = (c.volume && c.volume > 0) ? c.volume : 1;
      cumulativeTypicalVolume += typicalPrice * vol;
      cumulativeVolume += vol;
    }

    return cumulativeVolume > 0 ? (cumulativeTypicalVolume / cumulativeVolume) : (candles[candles.length - 1].close || 0);
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
}
