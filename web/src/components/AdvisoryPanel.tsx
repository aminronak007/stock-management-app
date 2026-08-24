"use client";

import React from "react";

interface ConfluenceBreakdown {
  score: number;
  max: number;
  factors: string[];
}

interface SignalData {
  type: string;
  strike?: string;
  strikePrice?: number | string;
  entry?: string;
  entryPrice?: number | string;
  sl?: string;
  stopLossPrice?: number | string;
  t1?: string;
  targetPrice1?: number | string;
  t2?: string;
  targetPrice2?: number | string;
  reasoning: string;
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
}

interface AdvisoryPanelProps {
  signal: SignalData | null;
  logs: string[];
}

export const AdvisoryPanel: React.FC<AdvisoryPanelProps> = ({
  signal,
  logs
}) => {
  const getBadgeClass = (type: string) => {
    if (type === "CALL_BUY") return "badge-call";
    if (type === "PUT_BUY") return "badge-put";
    return "badge-neutral";
  };

  const getSignalBoxClass = (type: string) => {
    if (type === "CALL_BUY") return "signal-direction-box call-buy";
    if (type === "PUT_BUY") return "signal-direction-box put-buy";
    return "signal-direction-box";
  };

  const formatPrice = (value: unknown) => {
    if (value === undefined || value === null || value === "") return "₹--";
    if (typeof value === "number" && Number.isFinite(value)) return `₹${value.toFixed(2)}`;
    return String(value);
  };

  // Safe checks for default UI display
  const signalType = signal ? signal.type : "WAITING";
  const directionText = signal 
    ? (signal.type === "CALL_BUY" ? "CALL OPTION TARGET" : signal.type === "PUT_BUY" ? "PUT OPTION TARGET" : "EXIT POSITION") 
    : "NO SIGNAL";
  const strikeLabel = signal?.strike || signal?.strikePrice;
  const strikeText = signal
    ? (strikeLabel ? `Nifty ${strikeLabel}` : "Nifty ATM")
    : "Monitoring Nifty Spot Breakout";
  const entryVal = signal ? formatPrice(signal.entry ?? signal.entryPrice) : "₹--";
  const slVal = signal ? formatPrice(signal.sl ?? signal.stopLossPrice) : "₹--";
  const t1Val = signal ? formatPrice(signal.t1 ?? signal.targetPrice1) : "₹--";
  const t2Val = signal ? formatPrice(signal.t2 ?? signal.targetPrice2) : "₹--";
  const scoreCard = signal?.scoreCard;

  return (
    <div className="advisory-grid flex flex-col gap-6 w-full">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
      {/* 1. Active Signal Card */}
      <div className="card signal-card h-full">
        <div className="card-header flex justify-between items-center mb-4 pb-3 border-b border-white/5">
          <h3 className="font-outfit text-sm font-semibold tracking-wider">ACTIVE TRADE SIGNAL</h3>
          <span id="signal-state-badge" className={getBadgeClass(signalType)}>
            {signalType}
          </span>
        </div>
        
        <div className="signal-details flex gap-6 items-center">
          <div className={getSignalBoxClass(signalType)} id="signal-box" style={{ flex: 1 }}>
            <span className="signal-direction-text text-2xl font-bold font-outfit" id="signal-direction">
              {directionText}
            </span>
            <span className="signal-strike-text text-xs text-[var(--color-text-secondary)]" id="signal-strike">
              {strikeText}
            </span>
          </div>

          <div className="targets-container flex flex-col gap-2.5 w-[240px]">
            <div className="target-row flex justify-between text-xs">
              <span className="target-name text-[var(--color-text-secondary)]">Entry Premium:</span>
              <span className="target-val font-semibold font-outfit" id="signal-entry">{entryVal}</span>
            </div>
            <div className="target-row flex justify-between text-xs">
              <span className="target-name text-[var(--color-text-secondary)]">Stop Loss:</span>
              <span className="target-val sl font-semibold font-outfit text-[var(--color-negative)]" id="signal-sl">{slVal}</span>
            </div>
            <div className="target-row flex justify-between text-xs">
              <span className="target-name text-[var(--color-text-secondary)]">Target 1 (0.5x Vol):</span>
              <span className="target-val target font-semibold font-outfit text-[var(--color-positive)]" id="signal-t1">{t1Val}</span>
            </div>
            <div className="target-row flex justify-between text-xs">
              <span className="target-name text-[var(--color-text-secondary)]">Target 2 (1.0x Vol):</span>
              <span className="target-val target font-semibold font-outfit text-[var(--color-positive)]" id="signal-t2">{t2Val}</span>
            </div>
          </div>
        </div>

        {signal && signal.reasoning && (
          <div className="mt-4 pt-3 border-t border-white/5 text-xs text-gray-400 font-sans leading-relaxed">
            <span className="text-gray-500 font-semibold uppercase text-[10px] block mb-0.5">Execution Reasoning:</span>
            {signal.reasoning}
          </div>
        )}
      </div>

      {/* 2. Confluence Scoring Engine */}
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

      {/* 3. System Terminal Logs Card */}
      <div className="card logs-card">
        <div className="card-header flex justify-between items-center mb-4 pb-3 border-b border-white/5">
          <h3 className="font-outfit text-sm font-semibold tracking-wider">SYSTEM CONSOLE LOGS</h3>
          <span className="badge-neutral text-[10px] uppercase">Live Server Pipeline</span>
        </div>
        
        <div className="logs-console" id="logs-console-area" style={{ maxHeight: "240px", overflowY: "auto" }}>
          {logs.map((log, idx) => {
            let className = "log-line system";
            if (log.includes("SIGNAL TRIGGERED") || log.includes("UI ALERT")) {
              className = "log-line success-alert";
            } else if (log.includes("EXIT TRIGGERED") || log.includes("Stop-loss breached")) {
              className = "log-line error-alert";
            } else if (log.includes("warning") || log.includes("Decay")) {
              className = "log-line warning-alert";
            }
            return (
              <div key={idx} className={className}>
                {log}
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
};
