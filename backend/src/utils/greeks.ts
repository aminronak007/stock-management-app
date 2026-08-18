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
    // Avoid division by zero when daysToExpiry is extremely close to 0
    const T = Math.max(daysToExpiry, 0.0001) / 365;
    const vol = Math.max(IV, 0.0001) / 100;

    const d1 = (Math.log(S / K) + (r + (vol * vol) / 2) * T) / (vol * Math.sqrt(T));
    const d2 = d1 - vol * Math.sqrt(T);

    const pdfD1 = this.stdNormPDF(d1);
    const cdfD1 = this.stdNormCDF(d1);
    const cdfD2 = this.stdNormCDF(d2);
    const cdfMinusD1 = this.stdNormCDF(-d1);
    const cdfMinusD2 = this.stdNormCDF(-d2);

    // Call Greeks
    const callDelta = cdfD1;
    const callTheta = (- (S * pdfD1 * vol) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * cdfD2) / 365;

    // Put Greeks
    const putDelta = cdfD1 - 1;
    const putTheta = (- (S * pdfD1 * vol) / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * cdfMinusD2) / 365;

    // Shared Greeks
    const gamma = pdfD1 / (S * vol * Math.sqrt(T));
    const vega = (S * Math.sqrt(T) * pdfD1) / 100; // Normalized per 1% change in IV

    return {
      call: {
        delta: callDelta,
        theta: callTheta,
        gamma: gamma,
        vega: vega
      },
      put: {
        delta: putDelta,
        theta: putTheta,
        gamma: gamma,
        vega: vega
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
