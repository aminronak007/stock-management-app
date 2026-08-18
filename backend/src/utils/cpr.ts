export interface CPRValues {
  pivot: number;
  bc: number;
  tc: number;
  bottomRange: number;
  topRange: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
}

export class CPR {
  /**
   * Calculates Central Pivot Range (CPR) and Classical Pivot levels based on previous day's data
   */
  public static calculateCPR(
    high: number,
    low: number,
    close: number
  ): CPRValues {
    const pivot = (high + low + close) / 3;
    const bc = (high + low) / 2;
    const tc = (pivot - bc) + pivot;

    // Standardize bottom and top bounds of the range
    const bottomRange = Math.min(bc, tc);
    const topRange = Math.max(bc, tc);

    // Classical Support and Resistance levels
    const r1 = 2 * pivot - low;
    const s1 = 2 * pivot - high;
    const r2 = pivot + (high - low);
    const s2 = pivot - (high - low);
    const r3 = high + 2 * (pivot - low);
    const s3 = low - 2 * (high - pivot);

    return {
      pivot,
      bc,
      tc,
      bottomRange,
      topRange,
      r1,
      r2,
      r3,
      s1,
      s2,
      s3
    };
  }

  /**
   * Determines if a given price is inside the CPR boundary (consolidation indicator)
   */
  public static isPriceInsideCPR(price: number, cpr: CPRValues): boolean {
    return price >= cpr.bottomRange && price <= cpr.topRange;
  }

  /**
   * Evaluates the width of the CPR range as a percentage of the pivot.
   * Narrow CPR (< 0.15%) usually indicates a trending day.
   * Wide CPR (> 0.25%) usually indicates a sideways/consolidation range-bound day.
   */
  public static getCPRWidthPercentage(cpr: CPRValues): number {
    const width = cpr.topRange - cpr.bottomRange;
    return (width / cpr.pivot) * 100;
  }
}
