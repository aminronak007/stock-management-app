export class Greeks {
  /**
   * Probability density function of standard normal distribution
   */
  private static stdNormPDF(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  }

  /**
   * Cumulative distribution function of standard normal distribution (Hastings approximation)
   */
  private static stdNormCDF(x: number): number {
    if (x < 0) {
      return 1 - this.stdNormCDF(-x);
    }
    const p = 0.2316419;
    const b1 = 0.319381530;
    const b2 = -0.356563782;
    const b3 = 1.781477937;
    const b4 = -1.821255978;
    const b5 = 1.330274429;
    
    const t = 1 / (1 + p * x);
    const cdf = 1 - this.stdNormPDF(x) * (b1 * t + b2 * t * t + b3 * Math.pow(t, 3) + b4 * Math.pow(t, 4) + b5 * Math.pow(t, 5));
    return cdf;
  }

  /**
   * Computes Black-Scholes Greeks for Call and Put options.
   * @param S Spot Index Price (e.g. Nifty LTP)
   * @param K Strike Price
   * @param daysToExpiry Days remaining to expiry (e.g. 5 days = 5/365 years)
   * @param IV Implied Volatility as a percentage (e.g. 15% = 0.15)
   * @param r Risk-free rate (defaults to 0.07 for 7%)
   */
  public static calculateGreeks(
    S: number,
    K: number,
    daysToExpiry: number,
    IV: number,
    r: number = 0.07
  ) {
    // 1. Sanitize and clamp all inputs against NaN, zero, or negative values
    const safeS = (typeof S === "number" && Number.isFinite(S) && S > 0) ? S : 25000;
    const safeK = (typeof K === "number" && Number.isFinite(K) && K > 0) ? K : safeS;
    const safeDays = (typeof daysToExpiry === "number" && Number.isFinite(daysToExpiry) && daysToExpiry > 0) ? daysToExpiry : 1.0;
    const safeIV = (typeof IV === "number" && Number.isFinite(IV) && IV >= 5.0) ? IV : 13.5;
    const safeR = (typeof r === "number" && Number.isFinite(r) && r > 0) ? r : 0.07;

    // Avoid division by zero when daysToExpiry is extremely close to 0 (minimum ~1.5 hours)
    const T = Math.max(safeDays, 0.0001) / 365;
    const vol = Math.max(safeIV, 0.0001) / 100;

    const d1 = (Math.log(safeS / safeK) + (safeR + (vol * vol) / 2) * T) / (vol * Math.sqrt(T));
    const d2 = d1 - vol * Math.sqrt(T);

    const pdfD1 = this.stdNormPDF(d1);
    const cdfD1 = this.stdNormCDF(d1);
    const cdfD2 = this.stdNormCDF(d2);
    const cdfMinusD2 = this.stdNormCDF(-d2);

    // Call Greeks with finite clamps (delta strictly 0.01 - 0.99)
    const rawCallDelta = Number.isFinite(cdfD1) ? cdfD1 : 0.50;
    const callDelta = Math.max(0.01, Math.min(0.99, rawCallDelta));
    const rawCallTheta = (- (safeS * pdfD1 * vol) / (2 * Math.sqrt(T)) - safeR * safeK * Math.exp(-safeR * T) * cdfD2) / 365;
    const callTheta = Number.isFinite(rawCallTheta) ? rawCallTheta : -5.0;

    // Put Greeks with finite clamps (delta strictly -0.99 to -0.01)
    const rawPutDelta = Number.isFinite(cdfD1 - 1) ? (cdfD1 - 1) : -0.50;
    const putDelta = Math.max(-0.99, Math.min(-0.01, rawPutDelta));
    const rawPutTheta = (- (safeS * pdfD1 * vol) / (2 * Math.sqrt(T)) + safeR * safeK * Math.exp(-safeR * T) * cdfMinusD2) / 365;
    const putTheta = Number.isFinite(rawPutTheta) ? rawPutTheta : -5.0;

    // Shared Greeks
    const rawGamma = pdfD1 / (safeS * vol * Math.sqrt(T));
    const gamma = Number.isFinite(rawGamma) ? rawGamma : 0.001;
    const rawVega = (safeS * Math.sqrt(T) * pdfD1) / 100; // Normalized per 1% change in IV
    const vega = Number.isFinite(rawVega) ? rawVega : 0.01;

    return {
      call: {
        delta: parseFloat(callDelta.toFixed(4)),
        theta: parseFloat(callTheta.toFixed(4)),
        gamma: parseFloat(gamma.toFixed(6)),
        vega: parseFloat(vega.toFixed(4))
      },
      put: {
        delta: parseFloat(putDelta.toFixed(4)),
        theta: parseFloat(putTheta.toFixed(4)),
        gamma: parseFloat(gamma.toFixed(6)),
        vega: parseFloat(vega.toFixed(4))
      }
    };
  }

  /**
   * Expected Intraday Volatility Range Cone
   */
  public static calculateExpectedIntradayRange(
    spotPrice: number,
    vixOrIv: number
  ): number {
    // IV expected range = spot * (IV_atm / sqrt(365))
    const volDecimal = vixOrIv / 100;
    return spotPrice * (volDecimal / Math.sqrt(365));
  }
}
