import { DatabaseService } from "../utils/database";
import { Backtester } from "./backtester";
import { IBrokerAdapter } from "../adapters/IBrokerAdapter";

export interface OptimizationResult {
  optimalScore: number;
  expectedWinRate: number;
  expectedNetProfit: number;
  previousScore: number;
}

export class ParameterOptimizer {
  private broker: IBrokerAdapter;

  constructor(broker: IBrokerAdapter) {
    this.broker = broker;
  }

  /**
   * Evaluates past 15 days of trade outcomes and updates system thresholds
   */
  public async runCalibrationLoop(): Promise<OptimizationResult> {
    console.log("[Optimizer] Initiating self-learning calibration loop...");

    const db = DatabaseService.initialize();
    
    // Get current score settings (default 80)
    let currentScore = 80;
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'MIN_SIGNAL_SCORE'").get() as { value: string } | undefined;
      if (row) {
        currentScore = parseInt(row.value, 10) || 80;
      }
    } catch (e) {
      console.warn("[Optimizer] Failed to read settings from db, using default 80.");
    }

    const backtester = new Backtester(this.broker);
    const candidateScores = [75, 80, 85, 90];
    
    let bestScore = currentScore;
    let bestNetProfit = -999999;
    let bestWinRate = 0;

    const toDate = new Date().toISOString().split("T")[0];
    const fromDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]; // past 15 days

    for (const score of candidateScores) {
      try {
        const result = await backtester.runBacktest({
          symbol: "NSE:NIFTY50-INDEX",
          minScore: score,
          slippageMultiplier: 0.005, // 0.5% standard slippage
          fromDate,
          toDate,
          useWfo: false
        });

        console.log(`[Optimizer] Candidate Score ${score} => Win Rate: ${result.report.winRate}%, Net Profit: ₹${result.report.netProfit}`);

        // Select parameter configuration with highest net profit and positive expectancy
        if (result.report.netProfit > bestNetProfit && result.report.totalTrades >= 3) {
          bestNetProfit = result.report.netProfit;
          bestWinRate = result.report.winRate;
          bestScore = score;
        }
      } catch (e: any) {
        console.error(`[Optimizer] Sweep failed for score ${score}:`, e.message);
      }
    }

    // Persist optimized parameters back to SQLite database settings
    try {
      const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
      stmt.run("MIN_SIGNAL_SCORE", bestScore.toString());
      console.log(`[Optimizer] Calibration Complete. Optimal MIN_SIGNAL_SCORE updated in database: ${bestScore} (Win Rate: ${bestWinRate}%, Net Profit: ₹${bestNetProfit})`);
    } catch (e: any) {
      console.error("[Optimizer] Failed to save optimized parameters to database:", e.message);
    }

    return {
      optimalScore: bestScore,
      expectedWinRate: bestWinRate,
      expectedNetProfit: bestNetProfit,
      previousScore: currentScore
    };
  }
}
