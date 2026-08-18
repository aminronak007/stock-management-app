import React from "react";

interface SimulatorSandboxProps {
  ws: WebSocket | null;
}

export const SimulatorSandbox: React.FC<SimulatorSandboxProps> = ({ ws }) => {
  const triggerMockSignal = (type: string, details: any = {}) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      alert("WebSocket connection is not open!");
      return;
    }

    ws.send(
      JSON.stringify({
        type: "TRIGGER_MOCK_SIGNAL",
        payload: {
          type,
          ...details
        }
      })
    );
  };

  return (
    <div className="card sandbox-card w-full max-w-2xl mx-auto">
      <div className="card-header mb-6 pb-4 border-b border-white/5">
        <h3 className="font-outfit text-base font-semibold tracking-wide">DEVELOPER SIMULATOR SANDBOX</h3>
        <p className="text-xs text-[var(--color-text-secondary)] mt-1.5 leading-relaxed">
          Place mock signal notifications, target wicks, and closed transactions to test warning sirens and SEBI compliance sequences locally.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Call Option Sandbox */}
        <div className="flex flex-col gap-3 p-4 bg-white/[0.02] border border-[var(--border-color)] rounded-xl">
          <span className="text-xs font-semibold text-[var(--color-positive)] tracking-wider font-outfit uppercase">
            Call Option Scenarios
          </span>
          <button
            onClick={() =>
              triggerMockSignal("CALL_BUY", {
                strike: "24450 CE",
                entry: "₹130.00",
                sl: "₹105.00",
                t1: "₹155.00",
                t2: "₹185.00",
                reasoning: "ORB High break confirmed. Buying 24450 CE."
              })
            }
            className="text-xs font-medium bg-[rgba(16,185,129,0.12)] hover:bg-[rgba(16,185,129,0.2)] text-[var(--color-positive)] border border-[rgba(16,185,129,0.25)] py-2.5 rounded-lg transition-all"
          >
            Trigger CALL BUY Signal
          </button>
        </div>

        {/* Put Option Sandbox */}
        <div className="flex flex-col gap-3 p-4 bg-white/[0.02] border border-[var(--border-color)] rounded-xl">
          <span className="text-xs font-semibold text-[var(--color-negative)] tracking-wider font-outfit uppercase">
            Put Option Scenarios
          </span>
          <button
            onClick={() =>
              triggerMockSignal("PUT_BUY", {
                strike: "24300 PE",
                entry: "₹110.00",
                sl: "₹85.00",
                t1: "₹135.00",
                t2: "₹160.00",
                reasoning: "ORB Low break confirmed. Buying 24300 PE."
              })
            }
            className="text-xs font-medium bg-[rgba(244,63,94,0.12)] hover:bg-[rgba(244,63,94,0.2)] text-[var(--color-negative)] border border-[rgba(244,63,94,0.25)] py-2.5 rounded-lg transition-all"
          >
            Trigger PUT BUY Signal
          </button>
        </div>

        {/* Exits Sandbox */}
        <div className="flex flex-col gap-3 p-4 bg-white/[0.02] border border-[var(--border-color)] rounded-xl col-span-2">
          <span className="text-xs font-semibold text-[var(--color-text-secondary)] tracking-wider font-outfit uppercase">
            Risk & Profit Management exits
          </span>
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() =>
                triggerMockSignal("EXIT_PROFIT", {
                  reasoning: "Ultimate Target 2 breached. Position closed with profit."
                })
              }
              className="text-xs font-medium bg-white/5 hover:bg-white/10 border border-[var(--border-color)] py-2.5 rounded-lg text-white transition-all"
            >
              Simulate Take Profit
            </button>
            <button
              onClick={() =>
                triggerMockSignal("EXIT_STOP_LOSS", {
                  reasoning: "Trailing stop-loss breached. Protective exit activated."
                })
              }
              className="text-xs font-medium bg-white/5 hover:bg-white/10 border border-[var(--border-color)] py-2.5 rounded-lg text-[var(--color-negative)] transition-all"
            >
              Simulate Stop Loss
            </button>
            <button
              onClick={() =>
                triggerMockSignal("HOLD", {
                  reasoning: "Locking premium threshold. Position locked."
                })
              }
              className="text-xs font-medium bg-white/5 hover:bg-white/10 border border-[var(--border-color)] py-2.5 rounded-lg text-[var(--color-warning)] transition-all"
            >
              Simulate Hold Alert
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
