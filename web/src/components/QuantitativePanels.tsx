"use client";

import React from "react";

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
  // Calculate Expected Move (volatility cone range)
  const expectedDailyMove = spotPrice * ((vixValue || 14.5) / 100 / Math.sqrt(365));
  const upperRange = spotPrice + expectedDailyMove;
  const lowerRange = spotPrice - expectedDailyMove;

  const scoreCard = activeSignal?.scoreCard;
  const regime = scoreCard?.regime || "BREAKOUT_ATTEMPT";

  return (
    <div className="quant-grid grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">

      {/* COLUMN 1: Regime & Volatility Expected Move Barrier */}
      <div className="flex flex-col gap-6">

        {/* Regime Classification */}
        <div className="card bg-gradient-to-br from-[#12141a]/90 to-[#181b24]/90 p-5 rounded-xl border border-white/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 rounded-full blur-xl"></div>
          <span className="text-[10px] text-indigo-400 font-semibold tracking-wider uppercase">Live Market Regime</span>
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
          <span className="text-[10px] text-gray-500 font-semibold tracking-wider uppercase">Expected Volatility Cone</span>
          <div className="flex justify-between items-baseline mt-2">
            <span className="text-xl font-bold font-outfit text-white">
              {spotPrice ? spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "--"}
            </span>
            <span className="text-xs text-indigo-400 font-medium font-outfit">
              Expected Daily Move: ±{expectedDailyMove.toFixed(1)} pts
            </span>
          </div>

          {/* Range progress line visualization */}
          <div className="relative mt-5 h-1.5 bg-white/5 rounded-full overflow-hidden flex items-center justify-between">
            <div className="absolute left-0 right-0 h-full bg-gradient-to-r from-rose-500/30 via-indigo-500/40 to-emerald-500/30"></div>
            <div className="absolute left-[50%] -translate-x-[50%] w-2 h-2 rounded-full bg-white border border-indigo-600 shadow-md"></div>
          </div>

          <div className="flex justify-between text-[11px] font-medium mt-3 text-gray-400">
            <div className="flex flex-col">
              <span className="text-rose-400 font-semibold text-[10px] uppercase">Lower Cone Range</span>
              <span className="font-outfit">{lowerRange.toFixed(1)}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-emerald-400 font-semibold text-[10px] uppercase">Upper Cone Range</span>
              <span className="font-outfit">{upperRange.toFixed(1)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* COLUMN 2: Multi-Factor Confluence & Score */}
      <div className="flex flex-col gap-6">

        {/* Score Card Panel */}
        <div className="card p-5 rounded-xl border border-white/5 bg-[#12141a]/90 relative h-full flex flex-col justify-between">
          <div>
            <span className="text-[10px] text-indigo-400 font-semibold tracking-wider uppercase">Confluence Scoring Engine</span>

            <div className="flex justify-between items-center mt-3">
              <div className="flex flex-col">
                <span className="text-3xl font-extrabold text-white font-outfit">
                  {scoreCard ? scoreCard.totalScore : "0"}
                  <span className="text-sm font-normal text-gray-500">/100</span>
                </span>
                <span className={`text-[10px] font-bold mt-1 tracking-wide uppercase px-2 py-0.5 rounded border inline-block ${scoreCard?.qualityLabel === "VERY_HIGH_QUALITY" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
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
                  <div className="flex justify-between items-center text-xs border-b border-white/5 pb-1.5">
                    <span className="text-gray-400">Market Structure</span>
                    <span className="font-semibold text-white">{scoreCard.factors.marketStructure.score}/{scoreCard.factors.marketStructure.max}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs border-b border-white/5 pb-1.5">
                    <span className="text-gray-400">VWAP & Momentum</span>
                    <span className="font-semibold text-white">{scoreCard.factors.vwapMomentum.score}/{scoreCard.factors.vwapMomentum.max}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs border-b border-white/5 pb-1.5">
                    <span className="text-gray-400">Heavyweights Alignment</span>
                    <span className="font-semibold text-white">{scoreCard.factors.heavyweights.score}/{scoreCard.factors.heavyweights.max}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs border-b border-white/5 pb-1.5">
                    <span className="text-gray-400">Options Structure & PCR</span>
                    <span className="font-semibold text-white">{scoreCard.factors.optionsStructure.score}/{scoreCard.factors.optionsStructure.max}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-gray-400">Risk/Reward Validation</span>
                    <span className="font-semibold text-white">{scoreCard.factors.riskReward.score}/{scoreCard.factors.riskReward.max}</span>
                  </div>
                </>
              ) : (
                <div className="text-center py-6 text-gray-600 text-xs leading-relaxed">
                  No active advisory signal.<br />Monitoring Nifty 50 spot breakout conditions...
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};
