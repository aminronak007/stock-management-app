import React, { useState } from "react";

interface SignalData {
  type: string;
  strike: string;
  entry: string;
  sl: string;
  t1: string;
  t2: string;
  reasoning: string;
}

interface AdvisoryPanelProps {
  signal: SignalData | null;
  logs: string[];
}

export const AdvisoryPanel: React.FC<AdvisoryPanelProps> = ({
  signal,
  logs
}) => {
  const [chkBuyPlaced, setChkBuyPlaced] = useState(false);
  const [chkBuyFilled, setChkBuyFilled] = useState(false);
  const [chkSellPlaced, setChkSellPlaced] = useState(false);

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

  // Safe checks for default UI display
  const signalType = signal ? signal.type : "WAITING";
  const directionText = signal ? (signal.type === "CALL_BUY" ? "CALL OPTION TARGET" : signal.type === "PUT_BUY" ? "PUT OPTION TARGET" : "EXIT POSITION") : "NO SIGNAL";
  const strikeText = signal ? `Nifty ${signal.strike}` : "Monitor Index Spot";
  const entryVal = signal ? signal.entry : "₹--";
  const slVal = signal ? signal.sl : "₹--";
  const t1Val = signal ? signal.t1 : "₹--";
  const t2Val = signal ? signal.t2 : "₹--";

  return (
    <div className="advisory-grid grid grid-cols-2 gap-6 w-full">
      
      {/* 1. Signal Card */}
      <div className="card signal-card">
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
      </div>

      {/* 2. Compliance Checklist */}
      <div className="card compliance-card">
        <div className="card-header flex justify-between items-center mb-4 pb-3 border-b border-white/5">
          <h3 className="font-outfit text-sm font-semibold tracking-wider">SEBI COMPLIANCE CHECKLIST</h3>
          <span className="badge-neutral text-[10px]">MANUAL ROUTING ONLY</span>
        </div>
        
        <div className="checklist-wrapper flex flex-col gap-4">
          <p className="checklist-desc text-xs text-[var(--color-text-secondary)] leading-relaxed">
            Verify execution sequence to avoid margin lock errors. Place protection orders before writing premiums.
          </p>

          <div className="flex flex-col gap-3">
            <div className="checklist-item-row flex items-start gap-3 bg-white/[0.02] border border-[var(--border-color)] p-3 rounded-xl">
              <input
                type="checkbox"
                id="chk-buy-placed"
                checked={chkBuyPlaced}
                onChange={(e) => setChkBuyPlaced(e.target.checked)}
                className="w-4.5 h-4.5 mt-0.5 accent-[var(--accent-color)] cursor-pointer"
              />
              <label htmlFor="chk-buy-placed" className="cursor-pointer flex flex-col gap-0.5">
                <strong className="text-xs font-semibold">1. Buy Order Placed First</strong>
                <span className="chk-subtext text-[10px] text-[var(--color-text-secondary)]" id="chk-buy-details">
                  Place long hedging/protection call/put option order.
                </span>
              </label>
            </div>

            <div className="checklist-item-row flex items-start gap-3 bg-white/[0.02] border border-[var(--border-color)] p-3 rounded-xl">
              <input
                type="checkbox"
                id="chk-buy-filled"
                checked={chkBuyFilled}
                disabled={!chkBuyPlaced}
                onChange={(e) => setChkBuyFilled(e.target.checked)}
                className="w-4.5 h-4.5 mt-0.5 accent-[var(--accent-color)] cursor-pointer disabled:opacity-50"
              />
              <label htmlFor="chk-buy-filled" className="cursor-pointer flex flex-col gap-0.5">
                <strong className="text-xs font-semibold">2. Buy Order Confirmed / Filled</strong>
                <span className="chk-subtext text-[10px] text-[var(--color-text-secondary)]">
                  Verify purchase fill status in broker client tab before placing short order.
                </span>
              </label>
            </div>

            <div className="checklist-item-row flex items-start gap-3 bg-white/[0.02] border border-[var(--border-color)] p-3 rounded-xl">
              <input
                type="checkbox"
                id="chk-sell-placed"
                checked={chkSellPlaced}
                disabled={!chkBuyFilled}
                onChange={(e) => setChkSellPlaced(e.target.checked)}
                className="w-4.5 h-4.5 mt-0.5 accent-[var(--accent-color)] cursor-pointer disabled:opacity-50"
              />
              <label htmlFor="chk-sell-placed" className="cursor-pointer flex flex-col gap-0.5">
                <strong className="text-xs font-semibold">3. Write Option Order Placed</strong>
                <span className="chk-subtext text-[10px] text-[var(--color-text-secondary)]" id="chk-sell-details">
                  Place actual short premium writing trade (Hedged Margin Released).
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* 3. System Terminal Logs card */}
      <div className="card logs-card col-span-2">
        <div className="card-header flex justify-between items-center mb-4 pb-3 border-b border-white/5">
          <h3 className="font-outfit text-sm font-semibold tracking-wider">SYSTEM CONSOLE LOGS</h3>
          <span className="badge-neutral text-[10px] uppercase">Live Server Pipeline</span>
        </div>
        
        <div className="logs-console" id="logs-console-area">
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
