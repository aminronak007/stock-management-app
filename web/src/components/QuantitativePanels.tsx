"use client";

import React from "react";
import { SignalGateStatus, EngineStatus } from "./SignalGateStatus";

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
  engineStatus?: EngineStatus | null;
}

export const QuantitativePanels: React.FC<QuantitativePanelsProps> = ({
  spotPrice,
  vixValue,
  activeSignal,
  engineStatus
}) => {
  // Calculate Expected Move (volatility cone range)
  const expectedDailyMove = spotPrice * ((vixValue || 14.5) / 100 / Math.sqrt(365));
  const upperRange = spotPrice + expectedDailyMove;
  const lowerRange = spotPrice - expectedDailyMove;

  const scoreCard = activeSignal?.scoreCard;
  const regime = scoreCard?.regime || "BREAKOUT_ATTEMPT";

  return (
    <div className="quant-grid flex flex-col gap-6 w-full">

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
        {/* Expected Intraday Volatility Cone */}
        <div className="card p-5 rounded-xl border border-white/5 bg-[#12141a]/90 flex flex-col h-full min-w-0">
          <span className="text-[10px] text-gray-500 font-semibold tracking-wider uppercase">Expected Volatility Cone</span>
          <div className="flex flex-col gap-1 mt-2">
            <span className="text-xl font-bold font-outfit text-white">
              {spotPrice ? spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "--"}
            </span>
            <span className="text-xs text-indigo-400 font-medium font-outfit">
              Expected Daily Move: ±{expectedDailyMove.toFixed(1)} pts
            </span>
          </div>

          <div className="mt-auto pt-5">
            {/* Range progress line visualization */}
            <div className="relative h-1.5 bg-white/5 rounded-full overflow-hidden flex items-center justify-between">
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

        <div className="card p-5 rounded-xl border border-white/5 bg-[#12141a]/90 h-full min-w-0">
          <SignalGateStatus status={engineStatus || null} />
        </div>

        {/* Regime Classification */}
        <div className="card bg-gradient-to-br from-[#12141a]/90 to-[#181b24]/90 p-5 rounded-xl border border-white/5 relative overflow-hidden h-full min-w-0 flex flex-col">
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

          <div className="mt-auto pt-4 flex flex-wrap gap-2">
            <span className="text-[10px] font-semibold bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded">
              ATR Range: {(spotPrice * 0.0006).toFixed(1)} pts
            </span>
            <span className="text-[10px] font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">
              VIX: {vixValue ? vixValue.toFixed(2) : "14.5"}
            </span>
          </div>
        </div>
      </div>

    </div>
  );
};
