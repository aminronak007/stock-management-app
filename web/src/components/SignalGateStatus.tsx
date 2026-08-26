"use client";

import React from "react";

export interface EngineStatus {
  spot: number;
  vwap: number;
  vix: number;
  orbHigh: number;
  orbLow: number;
  ptsToCall: number;
  ptsToPut: number;
  insideOrb: boolean;
  insideCpr: boolean;
  isLunchBlock: boolean;
  sessionPhase: string;
  waitingReason: string;
  hasActiveSignal: boolean;
  filters: {
    hasOrb: boolean;
    aboveVwap: boolean;
    volumeHigh: boolean;
    trendBullish: boolean;
    trendBearish: boolean;
  };
}

interface SignalGateStatusProps {
  status: EngineStatus | null;
  compact?: boolean;
}

function fmt(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n) || n === 0) return "--";
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPts(n: number): string {
  if (!Number.isFinite(n)) return "--";
  return `${Math.max(0, n).toFixed(1)} pts`;
}

export const SignalGateStatus: React.FC<SignalGateStatusProps> = ({
  status,
  compact = false
}) => {
  if (!status) {
    return (
      <div className="text-center py-4 text-gray-600 text-xs">
        Loading signal gates from the engine...
      </div>
    );
  }

  const hasOrb = status.filters.hasOrb && status.orbHigh > 0;
  const callBroken = hasOrb && status.ptsToCall < 0;
  const putBroken = hasOrb && status.ptsToPut < 0;
  const phaseLabel = status.sessionPhase.replace(/_/g, " ");

  return (
    <div className={`flex flex-col ${compact ? "gap-2.5" : "gap-3"}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold tracking-wider uppercase text-gray-500">
          Signal gates (ORB)
        </span>
        <span className="text-[9px] font-bold px-2 py-0.5 rounded border bg-white/5 border-white/10 text-gray-400">
          {phaseLabel}
        </span>
      </div>

      <div className={`rounded-lg border px-3 ${compact ? "py-2" : "py-2.5"} ${
        callBroken
          ? "bg-emerald-500/10 border-emerald-500/20"
          : "bg-white/[0.03] border-white/5"
      }`}>
        <div className="flex justify-between items-baseline gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">CALL</span>
          <span className="text-[10px] text-gray-500 font-outfit">
            {callBroken ? "level broken" : `${fmtPts(status.ptsToCall)} remaining`}
          </span>
        </div>
        <p className={`${compact ? "text-xs" : "text-sm"} font-outfit font-semibold text-white mt-0.5`}>
          Needs Nifty above {hasOrb ? fmt(status.orbHigh) : "--"}
        </p>
      </div>

      <div className={`rounded-lg border px-3 ${compact ? "py-2" : "py-2.5"} ${
        putBroken
          ? "bg-rose-500/10 border-rose-500/20"
          : "bg-white/[0.03] border-white/5"
      }`}>
        <div className="flex justify-between items-baseline gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400">PUT</span>
          <span className="text-[10px] text-gray-500 font-outfit">
            {putBroken ? "level broken" : `${fmtPts(status.ptsToPut)} remaining`}
          </span>
        </div>
        <p className={`${compact ? "text-xs" : "text-sm"} font-outfit font-semibold text-white mt-0.5`}>
          Needs Nifty below {hasOrb ? fmt(status.orbLow) : "--"}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-[11px] text-gray-400 leading-relaxed">
          {status.waitingReason}
        </p>
        {status.waitingReason.includes("anti-churn") && (
          <span className="inline-flex items-center gap-1 text-[9.5px] font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/25 w-fit">
            🛡️ Anti-Churn Protection (Step +10 pts above last entry)
          </span>
        )}
      </div>

      {!compact && (
        <div className="flex flex-wrap gap-1.5">
          {[
            { on: status.filters.aboveVwap, label: "Above VWAP" },
            { on: status.filters.trendBullish, label: "Bullish 9/21" },
            { on: status.filters.trendBearish, label: "Bearish 9/21" },
            { on: status.filters.volumeHigh, label: "Volume 1.2x" },
            { on: !status.insideCpr, label: "Outside CPR" },
            { on: !status.isLunchBlock, label: "Session open" }
          ].map((chip) => (
            <span
              key={chip.label}
              className={`text-[9px] font-semibold px-2 py-0.5 rounded border ${
                chip.on
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  : "bg-white/5 border-white/10 text-gray-500"
              }`}
            >
              {chip.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
