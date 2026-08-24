import { Indicators } from "./indicators";

/** Intraday Nifty 50 options structure: 9/21 EMA on 5m, not stock-swing 50/200. */
export const NIFTY_OPTIONS_EMA_FAST = 9;
export const NIFTY_OPTIONS_EMA_SLOW = 21;
export const NIFTY_OPTIONS_VOLUME_MULT = 1.2;

export interface IntradayTrend {
  trendBullish: boolean;
  trendBearish: boolean;
  emaFast: number;
  emaSlow: number;
  ready: boolean;
}

/**
 * Confirmation beyond the raw ORB print so a 1–2 pt wick is not treated as a breakout.
 * About 5–6 Nifty points at current index levels.
 */
export function orbConfirmationBuffer(spot: number): number {
  if (!Number.isFinite(spot) || spot <= 0) return 5;
  return Math.max(5, spot * 0.00025);
}

export function lastEma(values: number[]): number {
  return values.length > 0 ? values[values.length - 1] : 0;
}

/**
 * 5-minute 9/21 trend. If EMAs are not ready yet, trend gates pass so session VWAP remains the first filter.
 */
export function getIntradayEmaTrend(closes: number[], spot: number): IntradayTrend {
  const emaFastList = Indicators.calculateEMA(closes, NIFTY_OPTIONS_EMA_FAST);
  const emaSlowList = Indicators.calculateEMA(closes, NIFTY_OPTIONS_EMA_SLOW);
  const emaFast = lastEma(emaFastList);
  const emaSlow = lastEma(emaSlowList);
  const ready = emaFast > 0 && emaSlow > 0;

  if (!ready) {
    return { trendBullish: true, trendBearish: true, emaFast, emaSlow, ready: false };
  }

  return {
    trendBullish: spot > emaFast && emaFast > emaSlow,
    trendBearish: spot < emaFast && emaFast < emaSlow,
    emaFast,
    emaSlow,
    ready: true
  };
}

/**
 * Index volume is noisy and the current 5m bar is still filling.
 * Compare the last *closed* bar to the prior five closed bars at 1.2×.
 * If volume is missing/zero, do not block — PCR and VWAP carry that job for options.
 */
export function isClosedBarVolumeExpanded(volumes: number[], multiplier: number = NIFTY_OPTIONS_VOLUME_MULT): boolean {
  const closed = volumes.length > 1 ? volumes.slice(0, -1) : volumes;
  const usable = closed.filter((v) => Number.isFinite(v) && v > 0);
  if (usable.length < 3) return true;

  const lookback = usable.slice(-6, -1);
  const lastClosed = usable[usable.length - 1];
  if (lookback.length === 0 || lastClosed <= 0) return true;

  const avg = lookback.reduce((a, b) => a + b, 0) / lookback.length;
  if (avg <= 0) return true;
  return lastClosed >= multiplier * avg;
}
