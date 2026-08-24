"use client";

import React, { useState } from "react";
import { PositionData } from "../app/page";

interface PositionsViewerProps {
  positions: PositionData[];
  realizedPnl?: number;
  onManualExit: (tier: string) => Promise<void> | void;
}

export const PositionsViewer: React.FC<PositionsViewerProps> = ({
  positions = [],
  realizedPnl = 0,
  onManualExit
}) => {
  const [exitingTier, setExitingTier] = useState<string | null>(null);
  const [isExitingAll, setIsExitingAll] = useState(false);

  // Calculate portfolio totals
  const totalPnl = positions.reduce((acc, p) => acc + (p.pnl || 0), 0);
  const totalInvested = positions.reduce((acc, p) => acc + (p.entryPrice * p.qty || 0), 0);
  const totalPnlPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
  const isOverallProfit = totalPnl >= 0;

  const handleExitClick = async (tier: string) => {
    if (exitingTier || isExitingAll) return;
    setExitingTier(tier);
    try {
      await onManualExit(tier);
    } finally {
      setTimeout(() => setExitingTier(null), 1000);
    }
  };

  const handleExitAll = async () => {
    if (positions.length === 0 || isExitingAll) return;
    if (!window.confirm(`Are you sure you want to manually exit ALL ${positions.length} open position(s) at current market price?`)) {
      return;
    }
    setIsExitingAll(true);
    try {
      for (const pos of positions) {
        await onManualExit(pos.tier);
      }
    } finally {
      setIsExitingAll(false);
    }
  };

  return (
    <div className="positions-container flex flex-col gap-6 w-full max-w-7xl mx-auto pb-10">
      {/* 1. Header Metrics Strip (4 Spacious Executive Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Open Positions */}
        <div className="card p-5 rounded-xl border border-white/5 bg-[#12151e]/80 flex flex-col justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Open Positions</span>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl lg:text-3xl font-extrabold font-outfit text-white">
              {positions.length}
            </span>
            <span className="text-xs font-semibold text-gray-400">/ 3 Max Tiers</span>
          </div>
          <span className="text-[11px] text-gray-500 mt-1">
            {positions.length === 0 ? "Zero market exposure" : "Real-time tick evaluated"}
          </span>
        </div>

        {/* Metric 2: Total Unrealized P&L */}
        <div className={`card p-5 rounded-xl border flex flex-col justify-between transition-all ${
          positions.length === 0 
            ? "bg-[#12151e]/80 border-white/5" 
            : isOverallProfit
            ? "bg-emerald-950/20 border-emerald-500/30 shadow-[0_0_25px_rgba(16,185,129,0.15)]"
            : "bg-rose-950/20 border-rose-500/30 shadow-[0_0_25px_rgba(244,63,94,0.15)]"
        }`}>
          <div className="flex justify-between items-center text-xs font-semibold uppercase tracking-wider text-gray-400">
            <span>Total Unrealized P&L</span>
            {positions.length > 0 && (
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                LIVE
              </span>
            )}
          </div>
          <div className="mt-3">
            <span className={`text-2xl lg:text-3xl font-extrabold font-outfit tracking-tight ${
              positions.length === 0 ? "text-gray-400" : isOverallProfit ? "text-emerald-400" : "text-rose-400"
            }`}>
              {positions.length === 0 ? "₹0.00" : (isOverallProfit ? `+₹${totalPnl.toFixed(2)}` : `-₹${Math.abs(totalPnl).toFixed(2)}`)}
            </span>
            {positions.length > 0 && (
              <span className={`text-xs font-bold ml-2 font-outfit ${isOverallProfit ? "text-emerald-500" : "text-rose-500"}`}>
                ({isOverallProfit ? "+" : ""}{totalPnlPercent.toFixed(2)}%)
              </span>
            )}
          </div>
          <span className="text-[11px] text-gray-500 mt-1">Net mark-to-market</span>
        </div>

        {/* Metric 3: Invested Capital */}
        <div className="card p-5 rounded-xl border border-white/5 bg-[#12151e]/80 flex flex-col justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Invested Capital</span>
          <div className="mt-3">
            <span className="text-2xl lg:text-3xl font-extrabold font-outfit text-white">
              ₹{totalInvested.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <span className="text-[11px] text-gray-500 mt-1">{positions.length} Active Option Leg(s)</span>
        </div>

        {/* Metric 4: Today Realized P&L */}
        <div className={`card p-5 rounded-xl border flex flex-col justify-between transition-all ${
          realizedPnl === 0 
            ? "bg-[#12151e]/80 border-white/5" 
            : realizedPnl > 0
            ? "bg-emerald-950/20 border-emerald-500/30 shadow-[0_0_25px_rgba(16,185,129,0.12)]"
            : "bg-rose-950/20 border-rose-500/30 shadow-[0_0_25px_rgba(244,63,94,0.12)]"
        }`}>
          <div className="flex justify-between items-center text-xs font-semibold uppercase tracking-wider text-gray-400">
            <span>Today Realized P&L</span>
            <span className={`text-[9.5px] font-bold px-2 py-0.5 rounded border uppercase ${
              realizedPnl >= 0 
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                : "bg-rose-500/10 text-rose-400 border-rose-500/20"
            }`}>
              BOOKED
            </span>
          </div>
          <div className="mt-3">
            <span className={`text-2xl lg:text-3xl font-extrabold font-outfit tracking-tight ${
              realizedPnl === 0 ? "text-gray-400" : realizedPnl > 0 ? "text-emerald-400" : "text-rose-400"
            }`}>
              {realizedPnl >= 0 ? `+₹${realizedPnl.toFixed(2)}` : `-₹${Math.abs(realizedPnl).toFixed(2)}`}
            </span>
          </div>
          <span className="text-[11px] text-gray-500 mt-1">Locked from closed trades</span>
        </div>
      </div>

      {/* 2. Main Live Positions Table Card */}
      <div className="card border border-white/10 bg-[#0d1017] rounded-xl overflow-hidden shadow-2xl">
        <div className="card-header flex flex-wrap justify-between items-center px-6 py-4 border-b border-white/5 bg-[#12151e]/90">
          <div className="flex items-center flex-wrap gap-3">
            <div className="relative flex items-center justify-center">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping absolute"></span>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
            </div>
            <h3 className="font-outfit text-base font-bold tracking-wider text-white uppercase">
              Open Positions ({positions.length})
            </h3>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-white/5 text-gray-400 border border-white/5 uppercase">
              Live Fyers Streaming Feed
            </span>
            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase flex items-center gap-1">
              <span>🛡️</span> Hard 3:15 PM Exit Active
            </span>
          </div>

          {positions.length > 1 && (
            <button
              onClick={handleExitAll}
              disabled={isExitingAll}
              className="px-3.5 py-1.5 rounded-lg text-xs font-bold font-outfit uppercase tracking-wider bg-rose-600 hover:bg-rose-500 text-white transition-all shadow-[0_0_15px_rgba(225,29,72,0.4)] disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
            >
              {isExitingAll ? "Exiting All..." : "Exit All Positions"}
            </button>
          )}
        </div>

        <div className="p-0 overflow-x-auto">
          {positions.length === 0 ? (
            <div className="text-center py-16 px-4 flex flex-col items-center justify-center gap-3">
              <div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center text-gray-500 mb-1 border border-white/5">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
              </div>
              <span className="text-base font-bold text-gray-200">No Open Positions</span>
              <span className="text-xs text-gray-400 max-w-md text-center leading-relaxed">
                The terminal is actively monitoring Nifty 50 live ticks and 8-factor confluence conditions. When an official trade signal triggers, your live open position will display here with real-time P&L updates and instant manual exit controls.
              </span>
            </div>
          ) : (
            <table className="w-full text-left text-xs font-sans border-collapse">
              <thead>
                <tr className="bg-white/[0.02] border-b border-white/5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  <th className="py-3.5 px-6">Tier</th>
                  <th className="py-3.5 px-4">Strike</th>
                  <th className="py-3.5 px-4 text-center">Qty</th>
                  <th className="py-3.5 px-4 text-right">Entry</th>
                  <th className="py-3.5 px-4 text-right">LTP</th>
                  <th className="py-3.5 px-6 text-right">P&L</th>
                  <th className="py-3.5 px-6">Targets</th>
                  <th className="py-3.5 px-6 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-outfit">
                {positions.map((pos, idx) => {
                  const isCall = pos.type.includes("CALL");
                  const isProfit = pos.pnl >= 0;
                  const isExiting = exitingTier === pos.tier || isExitingAll;

                  return (
                    <tr key={idx} className="hover:bg-white/[0.02] transition-colors group">
                      {/* 1. Strategy Tier (Compact Icon Badge) */}
                      <td className="py-4 px-6">
                        <div 
                          title={`${pos.tier} Strategy Tier`}
                          className={`w-8 h-8 rounded-lg border flex items-center justify-center text-sm shadow-sm transition-transform hover:scale-105 cursor-default ${
                            pos.tier === "SNIPER" 
                              ? "bg-amber-500/15 border-amber-500/40 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.2)]" 
                              : pos.tier === "BALANCED"
                              ? "bg-blue-500/15 border-blue-500/40 text-blue-300 shadow-[0_0_10px_rgba(59,130,246,0.2)]"
                              : "bg-purple-500/15 border-purple-500/40 text-purple-300 shadow-[0_0_10px_rgba(168,85,247,0.2)]"
                          }`}
                        >
                          {pos.tier === "SNIPER" ? "🎯" : pos.tier === "BALANCED" ? "⚖️" : "🔬"}
                        </div>
                      </td>

                      {/* 2. Detailed Strike (Nifty 50 + Strike + Badge) */}
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-400 font-outfit uppercase tracking-wider">
                            NIFTY 50
                          </span>
                          <span className="font-outfit font-extrabold text-white text-base tracking-tight">
                            {pos.strike}
                          </span>
                          <span className={`text-[10.5px] font-extrabold px-2 py-0.5 rounded-md font-outfit uppercase tracking-wider ${
                            isCall 
                              ? "bg-emerald-500/15 border border-emerald-500/35 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.2)]" 
                              : "bg-rose-500/15 border border-rose-500/35 text-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.2)]"
                          }`}>
                            {isCall ? "CE" : "PE"}
                          </span>
                        </div>
                      </td>

                      {/* 3. Quantity */}
                      <td className="py-4 px-4 text-center font-semibold text-gray-200 text-sm">
                        {pos.qty} <span className="text-[11px] text-gray-500 font-normal ml-0.5">({pos.qty / 25}L)</span>
                      </td>

                      {/* 4. Entry Price */}
                      <td className="py-4 px-4 text-right font-semibold text-gray-200 text-sm font-mono">
                        ₹{pos.entryPrice.toFixed(2)}
                      </td>

                      {/* 5. LTP (Live Running Price) */}
                      <td className="py-4 px-4 text-right font-bold text-white text-sm font-mono">
                        <span className="px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/10 inline-block shadow-inner">
                          ₹{pos.currentLtp.toFixed(2)}
                        </span>
                      </td>

                      {/* 6. P&L */}
                      <td className="py-4 px-6 text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          <span className={`text-base font-extrabold font-outfit ${isProfit ? "text-emerald-400" : "text-rose-400"}`}>
                            {isProfit ? `+₹${pos.pnl.toFixed(2)}` : `-₹${Math.abs(pos.pnl).toFixed(2)}`}
                          </span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                            isProfit ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
                          }`}>
                            {isProfit ? `+${pos.pnlPercent.toFixed(2)}%` : `${pos.pnlPercent.toFixed(2)}%`}
                          </span>
                        </div>
                      </td>

                      {/* 7. Targets & Risk */}
                      <td className="py-4 px-6">
                        <div className="flex flex-col gap-1.5 text-[11px]">
                          <div className="flex items-center gap-2.5">
                            <span className="px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-300 font-medium">
                              SL: <strong className="font-bold text-rose-400">₹{pos.stopLoss.toFixed(2)}</strong>
                            </span>
                            {pos.target1 && (
                              <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 font-medium">
                                T1: <strong className="font-bold text-emerald-400">₹{pos.target1.toFixed(2)}</strong>
                              </span>
                            )}
                            {pos.target2 && (
                              <span className="px-2 py-0.5 rounded bg-teal-500/10 border border-teal-500/20 text-teal-300 font-medium">
                                T2: <strong className="font-bold text-teal-400">₹{pos.target2.toFixed(2)}</strong>
                              </span>
                            )}
                          </div>
                          {pos.isBreakevenLocked && (
                            <span className="inline-flex items-center gap-1 text-[9.5px] font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/25 w-fit shadow-[0_0_8px_rgba(245,158,11,0.1)]">
                              🔒 Breakeven Locked (Risk ₹0.00)
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 8. Action Button */}
                      <td className="py-4 px-6 text-center">
                        <button
                          onClick={() => handleExitClick(pos.tier)}
                          disabled={isExiting}
                          className="px-3.5 py-1.5 rounded-lg text-xs font-bold font-outfit uppercase tracking-wider bg-rose-500/10 hover:bg-rose-600 border border-rose-500/30 hover:border-rose-600 text-rose-300 hover:text-white transition-all shadow-[0_0_10px_rgba(244,63,94,0.15)] hover:shadow-[0_0_15px_rgba(244,63,94,0.5)] disabled:opacity-50 flex items-center justify-center gap-1.5 mx-auto cursor-pointer"
                        >
                          {isExiting ? (
                            <>
                              <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                              <span>Exiting...</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                              </svg>
                              <span>Exit</span>
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
