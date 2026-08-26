"use client";

import React, { useEffect, useState } from "react";
import { Watchlist } from "../components/Watchlist";
import { CandlestickChart } from "../components/CandlestickChart";
import { AdvisoryPanel } from "../components/AdvisoryPanel";
import { SimulatorSandbox } from "../components/SimulatorSandbox";
import { QuantitativePanels } from "../components/QuantitativePanels";
import { DatabaseViewer } from "../components/DatabaseViewer";
import { SignalGateStatus, EngineStatus } from "../components/SignalGateStatus";
import { PositionsViewer } from "../components/PositionsViewer";
import { SettingsViewer } from "../components/SettingsViewer";

interface TickData {
  symbol: string;
  ltp: number;
  netChange?: number;
  netChangePercent: number;
  bidPrice: number;
  askPrice: number;
  timestamp: number;
}

interface SignalData {
  type: string;
  strike: string;
  entry: string;
  sl: string;
  t1: string;
  t2: string;
  reasoning: string;
  scoreCard?: any;
}

function formatRupee(value: unknown): string {
  if (value === undefined || value === null || value === "") return "₹--";
  if (typeof value === "string") {
    if (value.startsWith("₹")) return value;
    const parsed = Number(value.replace(/[₹,]/g, ""));
    return Number.isFinite(parsed) ? `₹${parsed.toFixed(2)}` : value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `₹${value.toFixed(2)}`;
  }
  return "₹--";
}

function normalizeSignal(raw: any): SignalData | null {
  if (!raw || !raw.type) return null;
  const strike = raw.strike ?? raw.strikePrice;
  return {
    type: raw.type,
    strike: strike != null && strike !== "" ? String(strike) : "",
    entry: formatRupee(raw.entry ?? raw.entryPrice),
    sl: formatRupee(raw.sl ?? raw.stopLossPrice),
    t1: formatRupee(raw.t1 ?? raw.targetPrice1),
    t2: formatRupee(raw.t2 ?? raw.targetPrice2),
    reasoning: raw.reasoning || "",
    scoreCard: raw.scoreCard
  };
}

export interface PositionData {
  tier: "SNIPER" | "BALANCED" | "EXPLORATORY";
  symbol: string;
  strike: number | string;
  type: string;
  qty: number;
  entryPrice: number;
  currentLtp: number;
  pnl: number;
  pnlPercent: number;
  stopLoss: number;
  target1?: number;
  target2?: number;
  isBreakevenLocked: boolean;
  isTarget1Locked: boolean;
  entryTime: number;
  entrySpot?: number;
  currentSpot?: number;
  openTradeId?: number;
}

const SAMPLE_POSITIONS: PositionData[] = [];

export default function Home() {
  const [activeTab, setActiveTab] = useState<"terminal" | "advisory" | "positions" | "database" | "settings" | "simulator">("terminal");
  const [activeSymbol, setActiveSymbol] = useState("NSE:NIFTY50-INDEX");
  const [ticks, setTicks] = useState<{ [symbol: string]: TickData }>({});
  const [activeSignal, setActiveSignal] = useState<SignalData | null>(null);
  const [positions, setPositions] = useState<PositionData[]>([]);
  const [realizedPnl, setRealizedPnl] = useState<number>(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [liveTime, setLiveTime] = useState("");
  const [systemState, setSystemState] = useState("DISCONNECTED");
  const [cprData, setCprData] = useState<{ pivot: number; top: number; bottom: number; widthPercent: number } | null>(null);
  const [enableSimulator, setEnableSimulator] = useState(false);
  const [autoExecution, setAutoExecution] = useState<boolean>(false);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isBrokerAuth, setIsBrokerAuth] = useState<boolean>(false);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);

  const [activeWlTab, setActiveWlTab] = useState<number>(1);
  const [watchlistTabs, setWatchlistTabs] = useState<{ [tabId: number]: string[] }>({
    1: ["BSE:SENSEX-INDEX", "NSE:NIFTY50-INDEX", "NSE:NIFTYBANK-INDEX", "NSE:FINNIFTY-INDEX", "NSE:INDIAVIX-INDEX"],
    2: ["NSE:RELIANCE-EQ", "NSE:TCS-EQ", "NSE:HDFCBANK-EQ"],
    3: [],
    4: [],
    5: []
  });

  // Load persisted watchlists from LocalStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("watchlistTabs");
      if (saved) {
        setWatchlistTabs(JSON.parse(saved));
      }
    } catch (e) {
      console.warn("Failed to load watchlistTabs from localStorage:", e);
    }
  }, []);

  const addSymbolToActiveWatchlist = (symbol: string) => {
    setWatchlistTabs(prev => {
      const currentList = prev[activeWlTab] || [];
      if (currentList.includes(symbol)) return prev;
      const updated = {
        ...prev,
        [activeWlTab]: [...currentList, symbol]
      };
      localStorage.setItem("watchlistTabs", JSON.stringify(updated));
      return updated;
    });
  };

  const removeSymbolFromActiveWatchlist = (symbol: string) => {
    setWatchlistTabs(prev => {
      const currentList = prev[activeWlTab] || [];
      const updated = {
        ...prev,
        [activeWlTab]: currentList.filter(s => s !== symbol)
      };
      localStorage.setItem("watchlistTabs", JSON.stringify(updated));
      return updated;
    });
  };

  // Sync active symbol to active list first entry if missing
  useEffect(() => {
    const list = watchlistTabs[activeWlTab] || [];
    if (list.length > 0 && !list.includes(activeSymbol)) {
      setActiveSymbol(list[0]);
    }
  }, [activeWlTab, watchlistTabs]);

  // Notify backend WebSocket of subscription changes
  useEffect(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      const activeSymbols = watchlistTabs[activeWlTab] || [];
      socket.send(JSON.stringify({
        type: "SUBSCRIBE_SYMBOLS",
        payload: activeSymbols
      }));
    }
  }, [watchlistTabs, activeWlTab, socket]);

  // Time ticker
  useEffect(() => {
    const updateTime = () => {
      const timeStr = new Date().toLocaleTimeString("en-US", { hour12: false });
      setLiveTime(timeStr);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch CPR data, engine status, and active positions on mount
  useEffect(() => {
    fetch("http://localhost:8080/api/quotes")
      .then(res => res.json())
      .then(data => {
        if (data && typeof data === "object") {
          setTicks(prev => ({ ...prev, ...data }));
        }
      })
      .catch(() => {});

    fetch("http://localhost:8080/api/cpr")
      .then(res => res.json())
      .then(data => {
        setCprData(data);
        setLogs(prev => [...prev, `[System] CPR initialized: Pivot=${data.pivot?.toFixed(2) || "--"}`]);
      })
      .catch(() => setLogs(prev => [...prev, "[System] Failed to fetch CPR parameters."]));

    fetch("http://localhost:8080/api/engine-status")
      .then(res => res.json())
      .then(data => setEngineStatus(data))
      .catch(() => {});

    fetch("http://localhost:8080/api/positions")
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data.positions)) {
          setPositions(data.positions);
        }
        if (data.realizedPnl !== undefined) {
          setRealizedPnl(data.realizedPnl);
        }
      })
      .catch(() => {});
  }, []);

  const handleManualExit = async (tier: string) => {
    try {
      // Optimistic UI exit: instantly remove only this tier
      setPositions(prev => prev.filter(p => p.tier !== tier));

      const res = await fetch("http://localhost:8080/api/positions/exit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, reason: "Manual user exit from Positions Dashboard" })
      });
      const data = await res.json();
      if (Array.isArray(data.positions)) {
        setPositions(data.positions);
      }
      if (data.realizedPnl !== undefined) {
        setRealizedPnl(data.realizedPnl);
      }
      setLogs(prev => [...prev, `[Positions] ${data.message || `Position (${tier}) exited.`}`]);
    } catch (e: any) {
      console.error("Manual exit failed:", e);
      setLogs(prev => [...prev, `[Positions] Position (${tier}) closed.`]);
    }
  };

  // WebSocket live ticks & signals pipeline
  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: NodeJS.Timeout;
    let isDisposed = false;

    function connect() {
      if (isDisposed) return;
      console.log("[WebSocket] Connecting to backend...");
      ws = new WebSocket("ws://localhost:8080");

      ws.onopen = () => {
        console.log("[WebSocket] Connected successfully.");
        setSystemState("ACTIVE");
        setSocket(ws);
        setLogs(prev => [...prev, "[System] Connected to live algorithmic advisor feed."]);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === "TICK") {
            const tick: TickData = message.payload;
            setTicks(prev => ({
              ...prev,
              [tick.symbol]: tick
            }));

            // Instant high-frequency tick recalculation for live positions
            setPositions(prev => {
              if (prev.length === 0) return prev;
              let changed = false;
              const updated = prev.map(pos => {
                if (pos.symbol === tick.symbol && tick.ltp > 0 && tick.ltp !== pos.currentLtp) {
                  changed = true;
                  const pnl = parseFloat(((tick.ltp - pos.entryPrice) * pos.qty).toFixed(2));
                  const pnlPercent = parseFloat((((tick.ltp - pos.entryPrice) / pos.entryPrice) * 100).toFixed(2));
                  return {
                    ...pos,
                    currentLtp: tick.ltp,
                    pnl,
                    pnlPercent
                  };
                }
                return pos;
              });
              return changed ? updated : prev;
            });
          } else if (message.type === "TICK_BATCH") {
            // Batched tick delivery: process all ticks in a single React state update
            const tickBatch: TickData[] = message.payload;
            if (Array.isArray(tickBatch) && tickBatch.length > 0) {
              setTicks(prev => {
                const next = { ...prev };
                for (const tick of tickBatch) {
                  next[tick.symbol] = tick;
                }
                return next;
              });

              // Update positions from batched ticks (direct option tick or spot delta model)
              setPositions(prev => {
                if (prev.length === 0) return prev;
                let changed = false;
                const tickMap: { [symbol: string]: TickData } = {};
                for (const tick of tickBatch) {
                  tickMap[tick.symbol] = tick;
                }
                const spotTick = tickMap["NSE:NIFTY50-INDEX"];

                const updated = prev.map(pos => {
                  const directTick = tickMap[pos.symbol];
                  if (directTick && directTick.ltp > 0 && directTick.ltp !== pos.currentLtp) {
                    changed = true;
                    const pnl = parseFloat(((directTick.ltp - pos.entryPrice) * pos.qty).toFixed(2));
                    const pnlPercent = parseFloat((((directTick.ltp - pos.entryPrice) / pos.entryPrice) * 100).toFixed(2));
                    return { ...pos, currentLtp: directTick.ltp, pnl, pnlPercent };
                  } else if (spotTick && spotTick.ltp > 0 && pos.entrySpot && pos.entrySpot > 0) {
                    const deltaMultiplier = 0.50;
                    const spotMove = pos.type.includes("CALL")
                      ? (spotTick.ltp - pos.entrySpot)
                      : (pos.entrySpot - spotTick.ltp);
                    const estimatedLtp = parseFloat(Math.max(0.50, pos.entryPrice + (spotMove * deltaMultiplier)).toFixed(2));
                    if (estimatedLtp !== pos.currentLtp) {
                      changed = true;
                      const pnl = parseFloat(((estimatedLtp - pos.entryPrice) * pos.qty).toFixed(2));
                      const pnlPercent = parseFloat((((estimatedLtp - pos.entryPrice) / pos.entryPrice) * 100).toFixed(2));
                      return { ...pos, currentLtp: estimatedLtp, pnl, pnlPercent, currentSpot: spotTick.ltp };
                    }
                  }
                  return pos;
                });
                return changed ? updated : prev;
              });
            }
          } else if (message.type === "POSITIONS") {
            if (Array.isArray(message.payload)) {
              setPositions(message.payload);
            }
            if (message.realizedPnl !== undefined) {
              setRealizedPnl(message.realizedPnl);
            }
          } else if (message.type === "SIGNAL") {
            const signal = normalizeSignal(message.payload);
            if (!signal) return;
            setActiveSignal(signal);
            
            let alertMsg = `>>> [UI ALERT - ${signal.type}] Strikes: Nifty ${signal.strike || "Spot"} | Entry: ${signal.entry || "--"} | SL: ${signal.sl || "--"}`;
            setLogs(prev => [...prev, alertMsg, `Alert Context: ${signal.reasoning}`]);

            // Auto-clear exit notifications after 8 seconds to resume monitoring view
            if (signal.type.includes("EXIT") || signal.type.includes("THETA")) {
              setTimeout(() => {
                setActiveSignal(prev => (prev?.type === signal.type ? null : prev));
              }, 8000);
            }

            // Play auditory sound alert
            if (signal.type === "CALL_BUY") playAlertSound(440);
            else if (signal.type === "PUT_BUY") playAlertSound(330);
            else playAlertSound(550);
          } else if (message.type === "WELCOME") {
            setLogs(prev => [...prev, `[Broker] Session status received (Broker Provider: ${message.payload.provider})`]);
            setEnableSimulator(message.payload.enableSimulator === true);
            setAutoExecution(message.payload.autoExecution === true);
            setIsBrokerAuth(message.payload.brokerAuthenticated === true);
            if (message.payload.activeSignal) {
              setActiveSignal(normalizeSignal(message.payload.activeSignal));
            }
            if (Array.isArray(message.payload.positions)) {
              setPositions(message.payload.positions);
            }
            if (message.payload.engineStatus) {
              setEngineStatus(message.payload.engineStatus);
            }
          } else if (message.type === "POSITIONS") {
            if (Array.isArray(message.payload)) {
              setPositions(message.payload);
            }
            if (message.realizedPnl !== undefined) {
              setRealizedPnl(message.realizedPnl);
            }
          } else if (message.type === "ENGINE_STATUS") {
            setEngineStatus(message.payload);
          }
        } catch (e) {
          console.error("Failed to parse WebSocket message:", e);
        }
      };

      ws.onclose = (event) => {
        console.warn("[WebSocket] Connection lost.");
        setSystemState("DISCONNECTED");
        setSocket(null);
        
        // If clean close (from React strict mode cleanup), do not trigger reconnect
        if (event.wasClean) return;
        
        setLogs(prev => [...prev, "[System] Connection lost. Retrying in 3 seconds..."]);
        reconnectTimer = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      isDisposed = true;
      if (ws) ws.close(); // Clean close
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  // Play audio synthesizer alerts
  const playAlertSound = (frequency: number) => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
      console.warn("Audio Context alert failed to play", e);
    }
  };

  // Helper values for active symbol
  const activeTick = ticks[activeSymbol];
  const activeLtp = activeTick ? activeTick.ltp : 0;
  const activeBid = activeTick ? activeTick.bidPrice : activeLtp;
  const activeAsk = activeTick ? activeTick.askPrice : activeLtp;

  // Render mock depth ladder
  const depthBids = Array.from({ length: 5 }, (_, i) => activeBid - i * 0.4);
  const depthAsks = Array.from({ length: 5 }, (_, i) => activeAsk + i * 0.4);

  // Top header values
  const formatHeaderIndex = (tick?: TickData) => {
    if (!tick || tick.ltp === undefined || tick.ltp === null) {
      return { ltp: "--", change: "0.00 (0.00%)", isPositive: true };
    }
    const ltpStr = tick.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const changePercent = tick.netChangePercent !== undefined && tick.netChangePercent !== null ? tick.netChangePercent : 0;
    const netChange = tick.netChange !== undefined && tick.netChange !== null
      ? tick.netChange
      : (tick.ltp - (tick.ltp / (1 + changePercent / 100)));

    const isPositive = (netChange !== null ? netChange : changePercent) >= 0;
    const pointsStr = `${netChange >= 0 ? "+" : ""}${netChange.toFixed(2)}`;
    const percentStr = `(${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%)`;
    return { ltp: ltpStr, change: `${pointsStr} ${percentStr}`, isPositive };
  };

  const sensexData = formatHeaderIndex(ticks["BSE:SENSEX-INDEX"]);
  const niftyData = formatHeaderIndex(ticks["NSE:NIFTY50-INDEX"]);
  const vixData = formatHeaderIndex(ticks["NSE:INDIAVIX-INDEX"]);

  return (
    <>
      {/* Top Glassmorphic Navigation Bar */}
      <header className="app-header">
        <div className="header-logo flex items-center gap-3">
          <div className="logo-circle">N50</div>
          <h1 className="font-outfit text-lg font-semibold tracking-wide">
            NIFTY 50 <span className="text-sm font-normal text-[var(--accent-color)] ml-1.5">Advisory Terminal</span>
          </h1>
        </div>
        
        {/* Real-time metrics */}
        <div className="header-metrics flex gap-3.5 font-outfit">
          <div className="metric-card flex flex-col items-end px-2 border-r border-white/5">
            <span className="metric-label text-[9px] text-[var(--color-text-secondary)] font-semibold tracking-wider">SENSEX</span>
            <span className={`metric-value text-[13px] font-bold ${sensexData.isPositive ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]"}`}>
              {sensexData.ltp}
            </span>
            <span className={`metric-subtext text-[10px] ${sensexData.isPositive ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]"}`}>
              {sensexData.change}
            </span>
          </div>
          <div className="metric-card flex flex-col items-end px-2 border-r border-white/5">
            <span className="metric-label text-[9px] text-[var(--color-text-secondary)] font-semibold tracking-wider">NIFTY 50</span>
            <span className={`metric-value text-[13px] font-bold ${niftyData.isPositive ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]"}`}>
              {niftyData.ltp}
            </span>
            <span className={`metric-subtext text-[10px] ${niftyData.isPositive ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]"}`}>
              {niftyData.change}
            </span>
          </div>
          <div className="metric-card flex flex-col items-end px-2 border-r border-white/5">
            <span className="metric-label text-[9px] text-[var(--color-text-secondary)] font-semibold tracking-wider">INDIA VIX</span>
            <span className={`metric-value text-[13px] font-bold ${vixData.isPositive ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]"}`}>
              {vixData.ltp}
            </span>
            <span className={`metric-subtext text-[10px] ${vixData.isPositive ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]"}`}>
              {vixData.change}
            </span>
          </div>
          {/* Status & Broker Session Stacked Section */}
          <div className="flex flex-col items-end justify-center gap-1 pl-3 border-l border-white/10 font-outfit">
            {/* Top Row: Routing & System State */}
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-1">
                <span className="text-[8px] text-[var(--color-text-secondary)] font-semibold tracking-wider uppercase">ROUTING:</span>
                <span className={`text-[10px] font-bold ${autoExecution ? "text-[var(--color-positive)]" : "text-amber-400"}`}>
                  {autoExecution ? "AUTO-LIVE" : "PAPER-ONLY"}
                </span>
              </div>
              <div className="w-[1px] h-2.5 bg-white/10"></div>
              <div className="flex items-center gap-1">
                <span className="text-[8px] text-[var(--color-text-secondary)] font-semibold tracking-wider uppercase">STATE:</span>
                <span className={`text-[10px] font-bold ${systemState === "ACTIVE" ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]"}`}>
                  {systemState}
                </span>
              </div>
            </div>

            {/* Bottom Row: Fyers Live & Re-Auth Control */}
            <div className="flex items-center gap-1.5">
              {isBrokerAuth ? (
                <>
                  <span className="inline-flex items-center gap-1.5 text-[9.5px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    FYERS LIVE
                  </span>
                  <button
                    onClick={async () => {
                      try {
                        await fetch("http://localhost:8080/api/logout", { method: "POST" });
                        setIsBrokerAuth(false);
                        setLogs(prev => [...prev, "[Broker] Logged out. Session cleared."]);
                        const authRes = await fetch("http://localhost:8080/api/fyers-auth-url");
                        if (authRes.ok) {
                          const authData = await authRes.json();
                          if (authData.url) {
                            window.open(authData.url, "_blank");
                            return;
                          }
                        }
                        const clientId = "W8C1B64UA9-200";
                        const redirect = encodeURIComponent("http://localhost:8080/api/fyers-callback");
                        window.open(`https://api-t1.fyers.in/api/v3/generate-authcode?client_id=${clientId}&redirect_uri=${redirect}&response_type=code&state=state_code`, "_blank");
                      } catch (e) {
                        console.error("Logout error:", e);
                      }
                    }}
                    title="Logout and re-authorize Fyers 2FA session"
                    className="text-[9.5px] font-semibold text-gray-300 hover:text-white bg-white/10 hover:bg-rose-500/20 border border-white/10 hover:border-rose-500/30 px-2 py-0.5 rounded transition-all cursor-pointer flex items-center gap-1"
                  >
                    🔄 Re-Auth
                  </button>
                </>
              ) : (
                <button
                  onClick={async () => {
                    try {
                      const authRes = await fetch("http://localhost:8080/api/fyers-auth-url");
                      if (authRes.ok) {
                        const authData = await authRes.json();
                        if (authData.url) {
                          window.open(authData.url, "_blank");
                          return;
                        }
                      }
                    } catch {}
                    const clientId = "W8C1B64UA9-200";
                    const redirect = encodeURIComponent("http://localhost:8080/api/fyers-callback");
                    window.open(`https://api-t1.fyers.in/api/v3/generate-authcode?client_id=${clientId}&redirect_uri=${redirect}&response_type=code&state=state_code`, "_blank");
                  }}
                  className="text-[9.5px] font-bold text-white bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 px-2.5 py-1 rounded shadow-md transition-all cursor-pointer flex items-center gap-1"
                >
                  🔒 Login 2FA
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="app-body flex flex-1 overflow-hidden">
        {/* Sidebar Watchlist */}
        <Watchlist 
          activeSymbol={activeSymbol} 
          setActiveSymbol={setActiveSymbol} 
          ticks={ticks} 
          activeTab={activeWlTab}
          setActiveTab={setActiveWlTab}
          watchlistSymbols={watchlistTabs[activeWlTab] || []}
          addSymbol={addSymbolToActiveWatchlist}
          removeSymbol={removeSymbolFromActiveWatchlist}
        />

        {/* Dashboard Panels */}
        <section className="main-panel flex-1 flex flex-col overflow-hidden">
          {/* Glassmorphic Tab Container */}
          <div className="tab-container flex justify-between items-center h-[50px] border-b border-[var(--border-color)] px-6 bg-white/[0.02]">
            <div className="tab-buttons flex gap-3">
              <button 
                className={`tab-btn flex items-center gap-2 ${activeTab === "terminal" ? "active" : ""}`}
                onClick={() => setActiveTab("terminal")}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 3v18h18M18 17l-6-6-4 4-5-5"/></svg>
                Live Terminal & Charts
              </button>
              <button 
                className={`tab-btn flex items-center gap-2 ${activeTab === "advisory" ? "active" : ""}`}
                onClick={() => setActiveTab("advisory")}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                AI Advisory Engine
              </button>
              <button 
                className={`tab-btn flex items-center gap-2 ${activeTab === "positions" ? "active" : ""}`}
                onClick={() => setActiveTab("positions")}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
                <span>Live Positions</span>
                {positions.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-emerald-400 text-black text-[9px] font-extrabold font-outfit shadow-sm animate-pulse">
                    {positions.length}
                  </span>
                )}
              </button>
              <button 
                className={`tab-btn flex items-center gap-2 ${activeTab === "database" ? "active" : ""}`}
                onClick={() => setActiveTab("database")}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
                Database & Trade History
              </button>
              <button 
                className={`tab-btn flex items-center gap-2 ${activeTab === "settings" ? "active" : ""}`}
                onClick={() => setActiveTab("settings")}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                Settings
              </button>
              {enableSimulator && (
                <button 
                  className={`tab-btn flex items-center gap-2 ${activeTab === "simulator" ? "active" : ""}`}
                  onClick={() => setActiveTab("simulator")}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/></svg>
                  Sandbox Simulator
                </button>
              )}
            </div>
            <div className="time-stamp text-xs text-[var(--color-text-secondary)] font-outfit bg-white/5 px-2.5 py-1 rounded-md" id="live-time">
              {liveTime}
            </div>
          </div>

          {/* Viewports */}
          <div className="viewport-content flex-1 overflow-y-auto p-6">
            {activeTab === "terminal" ? (
              <div className="viewport-grid grid grid-cols-[1fr_320px] gap-6 h-full">
                
                {/* 1. Canvas Chart */}
                <CandlestickChart 
                  activeSymbol={activeSymbol} 
                  currentPrice={activeLtp} 
                />

                {/* 2. Market Depth Card & Compact Signal Card Column */}
                <div className="flex flex-col gap-6 w-full max-w-[320px]">
                  
                  {/* Market Depth Card */}
                  <div className="card depth-card">
                    <div className="card-header flex justify-between items-center mb-4 pb-3 border-b border-white/5">
                      <h3 className="font-outfit text-sm font-semibold tracking-wider">
                        Market Depth <span className="text-xs text-[var(--color-text-secondary)] font-normal ml-2">Top 5 Bid/Ask</span>
                      </h3>
                    </div>
                    <div className="depth-wrapper flex flex-col gap-3">
                      <div className="depth-header flex justify-between text-[10px] font-semibold text-[var(--color-text-secondary)] border-b border-[var(--border-color)] pb-1.5">
                        <span>BID (Buy)</span>
                        <span>ASK (Sell)</span>
                      </div>
                      <div className="depth-grid flex flex-col gap-2.5">
                        {Array.from({ length: 5 }).map((_, index) => (
                          <div key={index} className="depth-row grid grid-cols-4 items-center text-xs">
                            <span className="bid-qty text-[var(--color-text-secondary)]">{(1000 + index * 500).toLocaleString()}</span>
                            <span className="bid-price positive text-[var(--color-positive)] font-outfit">
                              {depthBids[index].toFixed(2)}
                            </span>
                            <span className="ask-price negative text-[var(--color-negative)] font-outfit text-right">
                              {depthAsks[index].toFixed(2)}
                            </span>
                            <span className="ask-qty text-[var(--color-text-secondary)] text-right">{(800 + index * 400).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Compact Active Signal Panel */}
                  <div className="card compact-signal-card">
                    <div className="card-header flex justify-between items-center mb-3 pb-2 border-b border-white/5">
                      <h3 className="font-outfit text-xs font-semibold tracking-wider uppercase">Active Advisory Signal</h3>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded border inline-block ${
                        activeSignal ? (activeSignal.type === "CALL_BUY" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-rose-500/10 border-rose-500/20 text-rose-400") : "bg-white/5 border-white/5 text-gray-500"
                      }`}>
                        {activeSignal ? activeSignal.type : "WAITING"}
                      </span>
                    </div>

                    {activeSignal ? (
                      activeSignal.type.includes("BUY") ? (
                        <div className="flex flex-col gap-3">
                          <div className={`p-3 rounded-lg flex flex-col items-center justify-center text-center ${
                            activeSignal.type === "CALL_BUY" ? "bg-emerald-500/5 border border-emerald-500/10" : "bg-rose-500/5 border border-rose-500/10"
                          }`}>
                            <span className={`text-xs font-bold uppercase tracking-wider ${activeSignal.type === "CALL_BUY" ? "text-emerald-400" : "text-rose-400"}`}>
                              {activeSignal.type === "CALL_BUY" ? "CALL BUY ADVISORY" : "PUT BUY ADVISORY"}
                            </span>
                            <span className="text-[11px] text-gray-400 font-semibold mt-1">
                              Strike: Nifty {activeSignal.strike || "ATM"}
                            </span>
                          </div>

                          <div className="flex flex-col gap-2 text-xs text-gray-400">
                            <div className="flex justify-between py-1 border-b border-white/5">
                              <span>Entry Premium:</span>
                              <span className="font-bold text-white">{activeSignal.entry}</span>
                            </div>
                            <div className="flex justify-between py-1 border-b border-white/5">
                              <span className="text-rose-400">Stop Loss:</span>
                              <span className="font-bold text-rose-400">{activeSignal.sl}</span>
                            </div>
                            <div className="flex justify-between py-1 border-b border-white/5">
                              <span className="text-emerald-400">Target 1:</span>
                              <span className="font-bold text-emerald-400">{activeSignal.t1}</span>
                            </div>
                            <div className="flex justify-between py-1">
                              <span className="text-emerald-400">Target 2:</span>
                              <span className="font-bold text-emerald-400">{activeSignal.t2}</span>
                            </div>
                          </div>

                          <div className="text-[10px] text-gray-500 italic mt-1 leading-relaxed border-t border-white/5 pt-2">
                            Reason: {activeSignal.reasoning}
                          </div>
                        </div>
                      ) : (
                        <div className="p-4 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-center flex flex-col gap-2">
                          <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider">
                            POSITION CLOSED ({activeSignal.type.replace(/_/g, " ")})
                          </span>
                          <span className="text-[11px] text-gray-400 leading-relaxed">{activeSignal.reasoning}</span>
                        </div>
                      )
                    ) : (
                      <SignalGateStatus status={engineStatus} compact />
                    )}
                  </div>

                </div>

              </div>
            ) : activeTab === "advisory" ? (
              <div className="flex flex-col gap-6">
                <QuantitativePanels
                  spotPrice={activeLtp}
                  vixValue={parseFloat(vixData.ltp) || (ticks["NSE:INDIAVIX-INDEX"]?.ltp ?? 10.57)}
                  activeSignal={activeSignal}
                  engineStatus={engineStatus}
                />
                <AdvisoryPanel 
                  signal={activeSignal} 
                  logs={logs}
                />
              </div>
            ) : activeTab === "positions" ? (
              <PositionsViewer
                positions={positions}
                realizedPnl={realizedPnl}
                onManualExit={handleManualExit}
              />
            ) : activeTab === "database" ? (
              <DatabaseViewer />
            ) : activeTab === "settings" ? (
              <SettingsViewer />
            ) : (
              <SimulatorSandbox ws={socket} />
            )}
          </div>
        </section>
      </main>
    </>
  );
}
