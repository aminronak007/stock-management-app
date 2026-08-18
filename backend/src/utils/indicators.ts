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
}
