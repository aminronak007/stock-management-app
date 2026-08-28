"use client";

import React from "react";

export interface EngineStatus {
  spot: number;
  vwap: number;
  vix: number;
  orbHigh: number;
  orbLow: number;
  targetCallLevel?: number;
  targetPutLevel?: number;
  buffer?: number;
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
  giftNifty?: {
    ltp: number;
    prevClose: number;
    netChange: number;
    percentChange: number;
    sessionChange?: number;
    sessionPercentChange?: number;
    premiumDiscount: number;
    sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
    timestamp: number;
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
  const targetCall = status.targetCallLevel && status.targetCallLevel > 0 ? status.targetCallLevel : status.orbHigh;
  const targetPut = status.targetPutLevel && status.targetPutLevel > 0 ? status.targetPutLevel : status.orbLow;

  const spotValid = status.spot !== undefined && status.spot !== null && status.spot > 0;
  const callBroken = hasOrb && spotValid && status.spot >= targetCall;
  const putBroken = hasOrb && spotValid && status.spot <= targetPut;

  const ptsToCall = (hasOrb && spotValid && targetCall > status.spot) ? (targetCall - status.spot) : (status.ptsToCall || 0);
  const ptsToPut = (hasOrb && spotValid && status.spot > targetPut) ? (status.spot - targetPut) : (status.ptsToPut || 0);
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
          <span className={`text-[10px] font-outfit ${callBroken ? "font-bold text-emerald-400" : "text-gray-500"}`}>
            {callBroken ? "level broken" : `${fmtPts(ptsToCall)} remaining`}
          </span>
        </div>
        <p className={`${compact ? "text-xs" : "text-sm"} font-outfit font-semibold text-white mt-0.5`}>
          Needs Nifty above {hasOrb ? fmt(targetCall) : "--"}
        </p>
        {hasOrb && (
          <p className="text-[9.5px] text-gray-500 mt-0.5 font-mono">
            ORB High: {fmt(status.orbHigh)}
          </p>
        )}
      </div>

      <div className={`rounded-lg border px-3 ${compact ? "py-2" : "py-2.5"} ${
        putBroken
          ? "bg-rose-500/10 border-rose-500/20"
          : "bg-white/[0.03] border-white/5"
      }`}>
        <div className="flex justify-between items-baseline gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400">PUT</span>
          <span className={`text-[10px] font-outfit ${putBroken ? "font-bold text-rose-400" : "text-gray-500"}`}>
            {putBroken ? "level broken" : `${fmtPts(ptsToPut)} remaining`}
          </span>
        </div>
        <p className={`${compact ? "text-xs" : "text-sm"} font-outfit font-semibold text-white mt-0.5`}>
          Needs Nifty below {hasOrb ? fmt(targetPut) : "--"}
        </p>
        {hasOrb && (
          <p className="text-[9.5px] text-gray-500 mt-0.5 font-mono">
            ORB Low: {fmt(status.orbLow)}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-[11px] text-gray-400 leading-relaxed">
          {status.waitingReason}
        </p>
        {status.waitingReason?.includes("anti-churn") && (
          <span className="inline-flex items-center gap-1 text-[9.5px] font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/25 w-fit">
            🛡️ Anti-Churn Protection (Step +5 pts above last entry)
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

export const GiftNiftyCard: React.FC<{
  giftNifty?: EngineStatus["giftNifty"];
  ticks?: { [symbol: string]: any };
  spotPrice?: number;
}> = ({ giftNifty: initialGift, ticks, spotPrice }) => {
  const futTick = ticks?.["NSE:NIFTY26SEPFUT"] || Object.values(ticks || {}).find((t: any) => t?.symbol?.includes("NIFTY") && t?.symbol?.includes("FUT"));
  const spotTick = ticks?.["NSE:NIFTY50-INDEX"];

  let giftNifty = initialGift;
  if (futTick && futTick.ltp > 0) {
    const ltp = futTick.ltp;
    const prevClose = futTick.prevClose || (futTick.netChange ? ltp - futTick.netChange : (futTick.change ? ltp / (1 + futTick.change / 100) : 24281.9));
    const netChange = futTick.netChange !== undefined && futTick.netChange !== 0 ? futTick.netChange : (prevClose > 0 ? ltp - prevClose : 0);
    const percentChange = futTick.change !== undefined && futTick.change !== 0 ? futTick.change : (futTick.netChangePercent || (prevClose > 0 ? (netChange / prevClose) * 100 : 0));
    const spotVal = spotTick?.ltp || spotPrice || (ltp - 35);
    const spread = ltp - spotVal;
    const sentiment: "BULLISH" | "BEARISH" | "NEUTRAL" =
      netChange > 20 ? "BULLISH" : netChange < -20 ? "BEARISH" : "NEUTRAL";

    giftNifty = {
      ltp,
      prevClose,
      netChange: parseFloat(netChange.toFixed(2)),
      percentChange: parseFloat(percentChange.toFixed(2)),
      sessionChange: netChange,
      sessionPercentChange: percentChange,
      premiumDiscount: parseFloat(spread.toFixed(2)),
      sentiment,
      timestamp: Date.now()
    };
  }

  if (!giftNifty) return null;

  const displayChange = giftNifty.sessionChange !== undefined ? giftNifty.sessionChange : giftNifty.netChange;
  const displayPct = giftNifty.sessionPercentChange !== undefined ? giftNifty.sessionPercentChange : giftNifty.percentChange;
  const isPositive = displayChange >= 0;

  return (
    <div className="rounded-xl border border-cyan-500/20 bg-gradient-to-br from-cyan-950/25 via-slate-900/50 to-slate-950/80 p-3 shadow-sm flex flex-col gap-2">
      {/* Header: Title + Live Indicator + Sentiment */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs">🌍</span>
          <span className="text-[11px] font-bold text-cyan-300 uppercase tracking-wider font-outfit">
            GIFT Nifty (NSE IX)
          </span>
          <span className="flex items-center gap-1 text-[8.5px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.2 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live
          </span>
        </div>
        <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
          giftNifty.sentiment === "BULLISH"
            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
            : giftNifty.sentiment === "BEARISH"
            ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
            : "bg-white/10 text-gray-300"
        }`}>
          {giftNifty.sentiment}
        </span>
      </div>

      {/* Price & Change Row */}
      <div className="flex items-baseline justify-between pt-0.5">
        <span className="text-lg font-bold font-outfit text-white tracking-tight">
          ₹{fmt(giftNifty.ltp)}
        </span>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-[11px] font-bold font-outfit ${
            isPositive
              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
              : "bg-rose-500/15 text-rose-400 border border-rose-500/25"
          }`}>
            {isPositive ? "+" : ""}{displayChange.toFixed(2)} ({isPositive ? "+" : ""}{displayPct.toFixed(2)}%)
          </span>
          <span className="text-[10px] text-gray-400 font-mono hidden sm:inline">
            Day: {giftNifty.netChange >= 0 ? "+" : ""}{giftNifty.netChange.toFixed(1)}
          </span>
        </div>
      </div>
    </div>
  );
};
