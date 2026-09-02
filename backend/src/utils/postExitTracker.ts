import { DatabaseService } from "./database";

interface ActiveExitTracker {
  tradeId: number;
  symbol: string;
  exitPrice: number;
  exitTimestamp: number;
  exitDatetime: string;
  tier: string;
  peakPostExitPrice: number;
  snapshots: {
    price_5m?: number;
    price_15m?: number;
    price_30m?: number;
    price_60m?: number;
    eod_price?: number;
  };
  lastPersistTimestamp: number;
}

export class PostExitTracker {
  private static trackers: Map<number, ActiveExitTracker> = new Map();

  /**
   * Register a newly exited trade to monitor post-exit performance
   */
  public static registerExit(
    tradeId: number,
    symbol: string,
    exitPrice: number,
    tier: string = "SNIPER",
    timestamp: number = Date.now()
  ): void {
    if (!tradeId || !symbol || exitPrice <= 0) return;

    const now = new Date(timestamp);
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = now.getFullYear();
    const time = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
    const exitDatetime = `${day}-${month}-${year}, ${time}`;

    const tracker: ActiveExitTracker = {
      tradeId,
      symbol,
      exitPrice,
      exitTimestamp: timestamp,
      exitDatetime,
      tier,
      peakPostExitPrice: exitPrice,
      snapshots: {},
      lastPersistTimestamp: timestamp
    };

    this.trackers.set(tradeId, tracker);

    try {
      DatabaseService.recordPostExit({
        trade_id: tradeId,
        symbol,
        exit_price: exitPrice,
        exit_timestamp: timestamp,
        exit_datetime: exitDatetime,
        tier,
        mfe_price: exitPrice,
        mfe_percent: 0,
        updated_at: timestamp
      });
      console.log(`[PostExitTracker] 📡 Tracking initiated for Trade #${tradeId} (${symbol}) @ ₹${exitPrice.toFixed(2)}.`);
    } catch (e) {
      console.error(`[PostExitTracker] Error registering post-exit record for trade #${tradeId}:`, e);
    }
  }

  /**
   * Update active post-exit trackers with incoming market price ticks
   */
  public static onPriceTick(symbol: string, currentPrice: number, timestamp: number = Date.now()): void {
    if (this.trackers.size === 0 || !symbol || currentPrice <= 0) return;

    for (const [tradeId, tracker] of this.trackers.entries()) {
      if (tracker.symbol !== symbol) continue;

      const elapsed = timestamp - tracker.exitTimestamp;
      const elapsedMinutes = elapsed / (60 * 1000);

      // Track Maximum Favorable Excursion (peak price reached after exit)
      let stateChanged = false;
      if (currentPrice > tracker.peakPostExitPrice) {
        tracker.peakPostExitPrice = currentPrice;
        stateChanged = true;

        const gainFromExitPct = ((currentPrice - tracker.exitPrice) / tracker.exitPrice) * 100;
        if (gainFromExitPct >= 30 && gainFromExitPct < 35) {
          console.warn(`[PostExitTracker] 🚀 Alert: Exited Trade #${tradeId} (${symbol}) has gained +${gainFromExitPct.toFixed(1)}% post-exit (LTP: ₹${currentPrice.toFixed(2)} vs Exit: ₹${tracker.exitPrice.toFixed(2)})!`);
        } else if (gainFromExitPct >= 75 && gainFromExitPct < 85) {
          console.warn(`[PostExitTracker] 🔥 Super-Runner Alert: Exited Trade #${tradeId} (${symbol}) exploded +${gainFromExitPct.toFixed(1)}% post-exit (LTP: ₹${currentPrice.toFixed(2)})!`);
        }
      }

      // Checkpoint Snapshots
      if (elapsedMinutes >= 5 && tracker.snapshots.price_5m === undefined) {
        tracker.snapshots.price_5m = currentPrice;
        stateChanged = true;
      }
      if (elapsedMinutes >= 15 && tracker.snapshots.price_15m === undefined) {
        tracker.snapshots.price_15m = currentPrice;
        stateChanged = true;
      }
      if (elapsedMinutes >= 30 && tracker.snapshots.price_30m === undefined) {
        tracker.snapshots.price_30m = currentPrice;
        stateChanged = true;
      }
      if (elapsedMinutes >= 60 && tracker.snapshots.price_60m === undefined) {
        tracker.snapshots.price_60m = currentPrice;
        stateChanged = true;
      }

      // Persist state to DB periodically (throttled to at most once every 5 seconds per tracker or on snapshot)
      if (stateChanged || (timestamp - tracker.lastPersistTimestamp >= 5000)) {
        tracker.lastPersistTimestamp = timestamp;
        const mfePercent = ((tracker.peakPostExitPrice - tracker.exitPrice) / tracker.exitPrice) * 100;
        try {
          DatabaseService.updatePostExitAnalytics(tradeId, {
            mfe_price: tracker.peakPostExitPrice,
            mfe_percent: mfePercent,
            price_5m: tracker.snapshots.price_5m,
            price_15m: tracker.snapshots.price_15m,
            price_30m: tracker.snapshots.price_30m,
            price_60m: tracker.snapshots.price_60m,
            eod_price: currentPrice
          });
        } catch (e) {}
      }

      // Remove tracker after 120 minutes (2 hours) of post-exit monitoring
      if (elapsedMinutes >= 120) {
        this.trackers.delete(tradeId);
        console.log(`[PostExitTracker] Completed 120m monitoring for Trade #${tradeId} (${symbol}). Peak MFE was ₹${tracker.peakPostExitPrice.toFixed(2)} (+${(((tracker.peakPostExitPrice - tracker.exitPrice)/tracker.exitPrice)*100).toFixed(1)}%).`);
      }
    }
  }

  /**
   * Get currently active tracking list count
   */
  public static getActiveCount(): number {
    return this.trackers.size;
  }
}
