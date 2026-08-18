import React, { useState } from "react";

interface ConfluenceBreakdown {
  score: number;
  max: number;
  factors: string[];
}

interface QuantitativePanelsProps {
  spotPrice: number;
  vixValue: number;
  activeSignal: {
    type: string;
    strikePrice?: number;
    entryPrice?: number;
    stopLossPrice?: number;
    targetPrice1?: number;
    targetPrice2?: number;
    reasoning?: string;
    scoreCard?: {
      totalScore: number;
      qualityLabel: string;
      regime: string;
      isFalseBreakout: boolean;
      isCounterTrend: boolean;
      factors: {
        marketStructure: ConfluenceBreakdown;
        vwapMomentum: ConfluenceBreakdown;
        heavyweights: ConfluenceBreakdown;
        optionsStructure: ConfluenceBreakdown;
        volatility: ConfluenceBreakdown;
        regimeAlignment: ConfluenceBreakdown;
        optionMomentum: ConfluenceBreakdown;
        riskReward: ConfluenceBreakdown;
      };
      explanation: string[];
    };
  } | null;
}

export const QuantitativePanels: React.FC<QuantitativePanelsProps> = ({
  spotPrice,
  vixValue,
  activeSignal
}) => {
  // Backtest parameters state
  const [minScore, setMinScore] = useState<number>(80);
  const [slippage, setSlippage] = useState<number>(0.005);
  const [useWfo, setUseWfo] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [report, setReport] = useState<any | null>(null);
  const [backtestTrades, setBacktestTrades] = useState<any[]>([]);

  // Calculate Expected Move (volatility cone range)
  const expectedDailyMove = spotPrice * ((vixValue || 14.5) / 100 / Math.sqrt(365));
  const upperRange = spotPrice + expectedDailyMove;
  const lowerRange = spotPrice - expectedDailyMove;

  // Run backtester HTTP query
  const runBacktestSession = async () => {
    setIsLoading(true);
    setReport(null);
    try {
      const res = await fetch("http://localhost:8080/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: "NSE:NIFTY50-INDEX",
          minScore,
          slippageMultiplier: slippage,
          fromDate: "2026-08-01",
          toDate: new Date().toISOString().split("T")[0],
          useWfo
        })
      });
      const data = await res.json();
      setReport(data.report);
      setBacktestTrades(data.trades);
    } catch (e) {
      console.error("Backtester execution failed:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const scoreCard = activeSignal?.scoreCard;
  const regime = scoreCard?.regime || "BREAKOUT_ATTEMPT";

  return (
    <div className="quant-grid grid grid-cols-1 xl:grid-cols-3 gap-6">
      
      {/* COLUMN 1: Regime, Expected Move Barrier & Risk */}
      <div className="flex flex-col gap-6">
        
        {/* Regime Classification */}
        <div className="card bg-gradient-to-br from-[#12141a]/90 to-[#181b24]/90 p-5 rounded-xl border border-white/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 rounded-full blur-xl"></div>
          <span className="text-[10px] text-indigo-400 font-semibold tracking-wider uppercase">Market Regime</span>
          <h3 className="text-lg font-bold text-white mt-1 font-outfit">{regime.replace(/_/g, " ")}</h3>
          
          <p className="text-xs text-gray-400 mt-2.5 leading-relaxed">
            {regime === "TREND_UP" && "Strong bullish trend identified. Directional CALL buying breakout strategies are authorized."}
            {regime === "TREND_DOWN" && "Strong bearish trend identified. Directional PUT buying breakdown strategies are authorized."}
            {regime === "RANGE" && "Range-bound consolidation environment detected. Directional option buying is restricted to prevent theta loss."}
            {regime === "HIGH_VOLATILITY" && "High VIX volatility spike registered. Prefer defined-risk spreads to avoid premium crush."}
            {regime === "LOW_VOLATILITY" && "Low volatility compressions. Directional options buying is blocked due to dry premium momentum."}
            {regime === "BREAKOUT_ATTEMPT" && "Consolidation limits tested. Momentum breakout filters are active to detect early breakouts."}
          </p>

          <div className="mt-4 flex gap-2">
            <span className="text-[10px] font-semibold bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded">
              ATR Range: {(spotPrice * 0.0006).toFixed(1)} pts
            </span>
            <span className="text-[10px] font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">
              VIX: {vixValue ? vixValue.toFixed(2) : "14.5"}
            </span>
          </div>
        </div>

        {/* Expected Intraday Volatility Cone */}
        <div className="card p-5 rounded-xl border border-white/5 bg-[#12141a]/90 flex flex-col">
          <span className="text-[10px] text-gray-500 font-semibold tracking-wider uppercase">Expected Move Cone</span>
          <div className="flex justify-between items-baseline mt-2">
            <span className="text-xl font-bold font-outfit text-white">
              {spotPrice ? spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "--"}
            </span>
            <span className="text-xs text-indigo-400 font-medium font-outfit">
              Daily Move: ±{expectedDailyMove.toFixed(1)} pts
            </span>
          </div>

          {/* Range progress line visualization */}
          <div className="relative mt-5 h-1.5 bg-white/5 rounded-full overflow-hidden flex items-center justify-between">
            <div className="absolute left-0 right-0 h-full bg-gradient-to-r from-rose-500/30 via-indigo-500/40 to-emerald-500/30"></div>
            <div className="absolute left-[50%] -translate-x-[50%] w-2 h-2 rounded-full bg-white border border-indigo-600 shadow-md"></div>
          </div>

          <div className="flex justify-between text-[11px] font-medium mt-3 text-gray-400">
            <div className="flex flex-col">
              <span className="text-rose-400 font-semibold text-[10px] uppercase">Lower Range</span>
              <span>{lowerRange.toFixed(1)}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-emerald-400 font-semibold text-[10px] uppercase">Upper Range</span>
              <span>{upperRange.toFixed(1)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* COLUMN 2: Multi-Factor Confluence & Score */}
      <div className="flex flex-col gap-6">
        
        {/* Score Card Panel */}
        <div className="card p-5 rounded-xl border border-white/5 bg-[#12141a]/90 relative">
          <span className="text-[10px] text-indigo-400 font-semibold tracking-wider uppercase">Confluence Quality</span>
          
          <div className="flex justify-between items-center mt-3">
            <div className="flex flex-col">
              <span className="text-3xl font-extrabold text-white font-outfit">
                {scoreCard ? scoreCard.totalScore : "0"}
                <span className="text-sm font-normal text-gray-500">/100</span>
              </span>
              <span className={`text-[10px] font-bold mt-1 tracking-wide uppercase px-2 py-0.5 rounded border inline-block ${
                scoreCard?.qualityLabel === "VERY_HIGH_QUALITY" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
                scoreCard?.qualityLabel === "HIGH_QUALITY" ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-400" :
                scoreCard?.qualityLabel === "WEAK_SETUP" ? "bg-amber-500/10 border-amber-500/20 text-amber-400" :
                "bg-rose-500/10 border-rose-500/20 text-rose-400"
              }`}>
                {scoreCard ? scoreCard.qualityLabel.replace(/_/g, " ") : "NO SETUP"}
              </span>
            </div>

            <div className="flex flex-col items-end text-xs text-gray-400">
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${scoreCard?.isFalseBreakout ? "bg-rose-500" : "bg-emerald-500"}`}></span>
                <span>False Breakout: {scoreCard?.isFalseBreakout ? "DETECTED" : "CLEAR"}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`w-2 h-2 rounded-full ${scoreCard?.isCounterTrend ? "bg-amber-500" : "bg-emerald-500"}`}></span>
                <span>Counter Trend: {scoreCard?.isCounterTrend ? "YES" : "NO"}</span>
              </div>
            </div>
          </div>

          {/* Breakdown checklist */}
          <div className="mt-5 flex flex-col gap-2">
            {scoreCard ? (
              <>
                <div className="flex justify-between items-center text-xs border-b border-white/5 pb-1">
                  <span className="text-gray-400">Market Structure</span>
                  <span className="font-semibold text-white">{scoreCard.factors.marketStructure.score}/{scoreCard.factors.marketStructure.max}</span>
                </div>
                <div className="flex justify-between items-center text-xs border-b border-white/5 pb-1">
                  <span className="text-gray-400">VWAP & Momentum</span>
                  <span className="font-semibold text-white">{scoreCard.factors.vwapMomentum.score}/{scoreCard.factors.vwapMomentum.max}</span>
                </div>
                <div className="flex justify-between items-center text-xs border-b border-white/5 pb-1">
                  <span className="text-gray-400">Heavyweights Alignment</span>
                  <span className="font-semibold text-white">{scoreCard.factors.heavyweights.score}/{scoreCard.factors.heavyweights.max}</span>
                </div>
                <div className="flex justify-between items-center text-xs border-b border-white/5 pb-1">
                  <span className="text-gray-400">Options Structure & PCR</span>
                  <span className="font-semibold text-white">{scoreCard.factors.optionsStructure.score}/{scoreCard.factors.optionsStructure.max}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-400">Risk/Reward Validation</span>
                  <span className="font-semibold text-white">{scoreCard.factors.riskReward.score}/{scoreCard.factors.riskReward.max}</span>
                </div>
              </>
            ) : (
              <div className="text-center py-6 text-gray-600 text-xs">
                No active advisory signal. Waiting for Nifty breakout triggers...
              </div>
            )}
          </div>
        </div>
      </div>

      {/* COLUMN 3: Out-of-sample Walk Forward Backtester */}
      <div className="flex flex-col gap-6 xl:col-span-1">
        
        {/* Backtester configuration & triggers */}
        <div className="card p-5 rounded-xl border border-white/5 bg-[#12141a]/90">
          <span className="text-[10px] text-indigo-400 font-semibold tracking-wider uppercase">Out-of-sample Backtester</span>
          
          <div className="mt-4 flex flex-col gap-3">
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Min Confluence Score (Filter)</label>
              <select
                value={minScore}
                onChange={(e) => setMinScore(parseInt(e.target.value))}
                className="w-full bg-[#1c1d24] border border-white/5 text-white text-xs px-2.5 py-1.5 rounded outline-none mt-1"
              >
                {[65, 70, 75, 80, 85, 90].map(s => (
                  <option key={s} value={s}>{s} (Only High Probability setups)</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Slippage Premium Drag</label>
              <select
                value={slippage}
                onChange={(e) => setSlippage(parseFloat(e.target.value))}
                className="w-full bg-[#1c1d24] border border-white/5 text-white text-xs px-2.5 py-1.5 rounded outline-none mt-1"
              >
                <option value={0.002}>0.20% slippage leg drag</option>
                <option value={0.005}>0.50% standard slippage leg drag</option>
                <option value={0.010}>1.00% high slip leg drag</option>
              </select>
            </div>

            <div className="flex justify-between items-center py-1">
              <div className="flex flex-col">
                <span className="text-xs font-medium text-white">Walk-Forward Optimization</span>
                <span className="text-[9px] text-gray-500">Run Out-of-Sample test window validation</span>
              </div>
              <input
                type="checkbox"
                checked={useWfo}
                onChange={(e) => setUseWfo(e.target.checked)}
                className="w-4 h-4 accent-indigo-600 cursor-pointer"
              />
            </div>

            <button
              onClick={runBacktestSession}
              disabled={isLoading}
              className="w-full mt-2 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded transition flex items-center justify-center gap-2"
            >
              {isLoading ? "Running quantitative backtest..." : "🚀 RUN BACKTEST & MONTE CARLO"}
            </button>

            <button
              onClick={async () => {
                setIsLoading(true);
                try {
                  const res = await fetch("http://localhost:8080/api/optimize", { method: "POST" });
                  const data = await res.json();
                  alert(`Self-Calibration Complete!\n\nOptimal score calibrated: ${data.optimalScore}/100 (Expected Win Rate: ${data.expectedWinRate}%).\n\nThis has been saved to the SQLite database and is active for live alerts.`);
                } catch (e) {
                  alert("Optimization sweep failed.");
                } finally {
                  setIsLoading(false);
                }
              }}
              disabled={isLoading}
              className="w-full mt-2 py-1.5 border border-indigo-500/30 hover:border-indigo-500/50 text-indigo-400 font-semibold text-[11px] rounded transition flex items-center justify-center gap-2 bg-indigo-500/5"
            >
              🔄 SELF-CALIBRATE SETTINGS (AI LEARN)
            </button>
          </div>
        </div>

        {/* Backtester Results Panel */}
        {report && (
          <div className="card p-5 rounded-xl border border-white/5 bg-[#12141a]/90 flex flex-col gap-4">
            <span className="text-[10px] text-emerald-400 font-semibold tracking-wider uppercase">Performance Report Summary</span>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-2 bg-white/5 rounded">
                <span className="text-[9px] text-gray-500 uppercase">Win Rate</span>
                <div className="font-bold text-white text-sm">{report.winRate}%</div>
              </div>
              <div className="p-2 bg-white/5 rounded">
                <span className="text-[9px] text-gray-500 uppercase">Profit Factor</span>
                <div className="font-bold text-white text-sm">{report.profitFactor}</div>
              </div>
              <div className="p-2 bg-white/5 rounded">
                <span className="text-[9px] text-gray-500 uppercase">Net Return</span>
                <div className="font-bold text-emerald-400 text-sm">₹{(report.netProfit).toLocaleString()}</div>
              </div>
              <div className="p-2 bg-white/5 rounded">
                <span className="text-[9px] text-gray-500 uppercase">Expectancy</span>
                <div className="font-bold text-white text-sm">₹{report.expectancy.toFixed(0)}</div>
              </div>
            </div>

            {/* Overfit check */}
            <div className="p-3 bg-white/5 rounded-lg border border-white/5 text-xs">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-gray-400">Overfitting Check:</span>
                <span className={`font-bold uppercase tracking-wider text-[10px] px-1.5 py-0.5 rounded ${
                  report.overfitAnalysis.label === "ROBUST" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                  report.overfitAnalysis.label === "OVERFIT_RISK" ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" :
                  "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                }`}>
                  {report.overfitAnalysis.label.replace(/_/g, " ")}
                </span>
              </div>
              <p className="text-[10px] text-gray-500 mt-1">
                {report.overfitAnalysis.label === "ROBUST" ? "Optimal parameter is robust. Discrepancy between training & validation falls inside standard bands." :
                 report.overfitAnalysis.label === "OVERFIT_RISK" ? "WARNING: Optimization parameters show sign of leakage and overfitting." :
                 "Insufficient trade statistics to validate overfitting parameters."}
              </p>
            </div>

            {/* Monte Carlo stats */}
            <div className="p-3 bg-[#16181f]/80 rounded-lg border border-white/5 text-xs flex flex-col gap-1.5 font-outfit">
              <span className="text-[9px] text-indigo-400 font-semibold tracking-wider uppercase">Monte Carlo Risk Metrics</span>
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-400">Probability of Ruin (30% Drawdown):</span>
                <span className="font-bold text-rose-400">{report.monteCarlo.probabilityOfRuinPercent}%</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-400">Median expected return path:</span>
                <span className="font-bold text-emerald-400">+{report.monteCarlo.medianFinalReturnPercent}%</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-400">Worst losing streak sequence:</span>
                <span className="font-bold text-white">{report.monteCarlo.worstStreakCount} trades</span>
              </div>
            </div>

          </div>
        )}

      </div>
      
    </div>
  );
};
