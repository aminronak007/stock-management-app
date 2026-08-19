"use client";

import React, { useEffect, useState, useMemo } from "react";

interface DatabaseSignal {
  id: number;
  timestamp: number;
  type: string;
  strike_price?: number;
  entry_price?: number;
  stop_loss_price?: number;
  target_price1?: number;
  target_price2?: number;
  reasoning: string;
}

interface PaperTrade {
  id: number;
  timestamp: number;
  datetime: string;
  type: string;
  symbol: string;
  strike?: string;
  qty: number;
  price: number;
  stop_loss?: number;
  target1?: number;
  target2?: number;
  invested_capital: number;
  pnl?: number;
  pnl_percent?: number;
  reasoning: string;
  market_regime?: string;
  confluence_score?: number;
  status: string;
}

interface TradeAnalytics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRatePercent: number;
  totalPnl: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  target1HitRate: number;
  target2HitRate: number;
  callWinRate: number;
  putWinRate: number;
  suggestedTargetMultiplier: number;
  suggestedScoreBias: number;
}

interface DatabaseSession {
  provider: string;
  access_token: string;
  expires_at: number;
}

interface DatabaseSetting {
  key: string;
  value: string;
}

interface DatabaseStats {
  totalSignals: number;
  totalPaperTrades: number;
  totalSessions: number;
  totalSettings: number;
  dbPath: string;
  engineTime: number;
}

export const DatabaseViewer: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<"trades" | "signals" | "sessions" | "settings">("trades");
  const [paperTrades, setPaperTrades] = useState<PaperTrade[]>([]);
  const [signals, setSignals] = useState<DatabaseSignal[]>([]);
  const [analytics, setAnalytics] = useState<TradeAnalytics | null>(null);
  const [sessions, setSessions] = useState<DatabaseSession[]>([]);
  const [settings, setSettings] = useState<DatabaseSetting[]>([]);
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterType, setFilterType] = useState<string>("ALL");
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [lastRefreshed, setLastRefreshed] = useState<string>("");

  const fetchData = async () => {
    try {
      setIsLoading(true);
      const res = await fetch("http://localhost:8080/api/database/overview");
      if (res.ok) {
        const data = await res.json();
        setPaperTrades(data.paperTrades || []);
        setSignals(data.signals || []);
        setAnalytics(data.analytics || null);
        setSessions(data.sessions || []);
        setSettings(data.settings || []);
        setStats(data.stats || null);
        setLastRefreshed(new Date().toLocaleTimeString());
      }
    } catch (e) {
      console.error("Failed to load database overview:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Filter paper trades
  const filteredPaperTrades = useMemo(() => {
    return paperTrades.filter(trade => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = 
        (trade.reasoning && trade.reasoning.toLowerCase().includes(q)) ||
        (trade.symbol && trade.symbol.toLowerCase().includes(q)) ||
        (trade.strike && trade.strike.toLowerCase().includes(q)) ||
        (trade.type && trade.type.toLowerCase().includes(q));

      let matchesFilter = true;
      if (filterType === "PROFIT") matchesFilter = (trade.pnl || 0) > 0;
      else if (filterType === "LOSS") matchesFilter = (trade.pnl || 0) < 0;
      else if (filterType === "BUY") matchesFilter = trade.type.includes("BUY");
      else if (filterType === "EXIT") matchesFilter = trade.type.includes("EXIT");
      else if (filterType === "CALL") matchesFilter = trade.type.includes("CALL") || (trade.symbol ? trade.symbol.includes("CE") : false);
      else if (filterType === "PUT") matchesFilter = trade.type.includes("PUT") || (trade.symbol ? trade.symbol.includes("PE") : false);

      return matchesSearch && matchesFilter;
    });
  }, [paperTrades, searchQuery, filterType]);

  // Filter advisory signals
  const filteredSignals = useMemo(() => {
    return signals.filter(sig => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = 
        (sig.reasoning && sig.reasoning.toLowerCase().includes(q)) ||
        (sig.strike_price && sig.strike_price.toString().includes(q)) ||
        (sig.type && sig.type.toLowerCase().includes(q));

      let matchesType = true;
      if (filterType === "BUY") matchesType = sig.type.includes("BUY");
      else if (filterType === "EXIT") matchesType = sig.type.includes("EXIT");
      else if (filterType !== "ALL" && filterType !== "PROFIT" && filterType !== "LOSS" && filterType !== "CALL" && filterType !== "PUT") {
        matchesType = sig.type === filterType;
      }

      return matchesSearch && matchesType;
    });
  }, [signals, searchQuery, filterType]);

  const handleClearPaperTrades = async () => {
    if (!window.confirm("Are you sure you want to clear the paper trading ledger from SQLite?")) return;
    try {
      const res = await fetch("http://localhost:8080/api/database/clear-paper-trades", { method: "POST" });
      if (res.ok) await fetchData();
    } catch (e) {
      console.error("Error clearing paper trades:", e);
    }
  };

  const handleClearSignals = async () => {
    if (!window.confirm("Are you sure you want to clear the advisory signals history from SQLite?")) return;
    try {
      const res = await fetch("http://localhost:8080/api/database/clear-signals", { method: "POST" });
      if (res.ok) await fetchData();
    } catch (e) {
      console.error("Error clearing signals:", e);
    }
  };

  const handleExportTradesCSV = () => {
    if (paperTrades.length === 0) return;
    const headers = ["Timestamp", "Type", "Symbol", "Strike", "Qty", "Price", "StopLoss", "Target1", "Target2", "InvestedCapital", "PnL", "PnL_Percent", "Regime", "Reasoning"];
    const rows = paperTrades.map(t => [
      `"${t.datetime || new Date(t.timestamp).toLocaleString()}"`,
      t.type,
      t.symbol,
      t.strike || "",
      t.qty,
      t.price,
      t.stop_loss || "",
      t.target1 || "",
      t.target2 || "",
      t.invested_capital,
      t.pnl !== undefined && t.pnl !== null ? t.pnl : "",
      t.pnl_percent !== undefined && t.pnl_percent !== null ? `${t.pnl_percent.toFixed(2)}%` : "",
      t.market_regime || "",
      `"${(t.reasoning || "").replace(/"/g, '""')}"`
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `paper_trades_db_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getBadgeClass = (type: string) => {
    if (type === "CALL_BUY") return "bg-emerald-500/15 border-emerald-500/30 text-emerald-400";
    if (type === "PUT_BUY") return "bg-rose-500/15 border-rose-500/30 text-rose-400";
    if (type === "EXIT_PROFIT") return "bg-teal-500/15 border-teal-500/30 text-teal-400";
    if (type === "EXIT_STOP_LOSS") return "bg-red-500/15 border-red-500/30 text-red-400";
    if (type === "THETA_EXIT") return "bg-amber-500/15 border-amber-500/30 text-amber-400";
    return "bg-indigo-500/15 border-indigo-500/30 text-indigo-400";
  };

  const netPnl = analytics?.totalPnl || 0;
  const isNetProfit = netPnl >= 0;

  return (
    <div className="database-viewer flex flex-col gap-6 w-full pb-10">
      
      {/* Top Header Overview & Adaptive Machine Learning Analytics Cards */}
      <div className="grid grid-cols-4 gap-4">
        
        {/* Card 1: Total PnL & Win Rate */}
        <div className="card p-4 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Paper Trading Net P&L</div>
            <div className={`text-2xl font-bold font-outfit mt-1 flex items-baseline gap-2 ${isNetProfit ? "text-emerald-400" : "text-rose-400"}`}>
              {isNetProfit ? `+₹${netPnl.toFixed(2)}` : `-₹${Math.abs(netPnl).toFixed(2)}`}
              <span className="text-xs font-semibold text-gray-400">
                ({analytics?.winningTrades || 0}W / {analytics?.losingTrades || 0}L)
              </span>
            </div>
          </div>
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold text-lg ${isNetProfit ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" : "bg-rose-500/10 border border-rose-500/20 text-rose-400"}`}>
            {isNetProfit ? "📈" : "📉"}
          </div>
        </div>

        {/* Card 2: Win Rate & Profit Factor */}
        <div className="card p-4 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Win Rate & Profit Factor</div>
            <div className="text-2xl font-bold font-outfit text-white mt-1 flex items-baseline gap-2">
              {analytics?.winRatePercent ? `${analytics.winRatePercent.toFixed(1)}%` : "0.0%"}
              <span className="text-xs font-semibold text-indigo-400">
                PF: {analytics?.profitFactor ? analytics.profitFactor.toFixed(2) : "1.00"}
              </span>
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-lg">
            🎯
          </div>
        </div>

        {/* Card 3: Adaptive Target Calibration AI */}
        <div className="card p-4 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Adaptive Target AI</div>
            <div className="text-xs font-bold font-outfit text-emerald-400 mt-1 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Multiplier: {analytics?.suggestedTargetMultiplier ? `${analytics.suggestedTargetMultiplier.toFixed(2)}x` : "1.00x"}
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">
              T1 Hit: {analytics?.target1HitRate ? `${analytics.target1HitRate.toFixed(0)}%` : "--"} | T2 Hit: {analytics?.target2HitRate ? `${analytics.target2HitRate.toFixed(0)}%` : "--"}
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400 text-lg">
            🧠
          </div>
        </div>

        {/* Card 4: Sync Status & Controls */}
        <div className="card p-4 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col justify-between">
          <div className="flex justify-between items-center text-[11px] text-gray-400 font-semibold">
            <span>SQLITE & CSV SYNC</span>
            <span className="text-emerald-400 font-outfit">{lastRefreshed ? `${lastRefreshed}` : "Syncing..."}</span>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={fetchData}
              disabled={isLoading}
              className="flex-1 text-xs font-semibold py-1.5 px-3 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 text-white transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              🔄 {isLoading ? "..." : "Refresh"}
            </button>
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`text-xs font-semibold py-1.5 px-3 rounded-lg border transition-all cursor-pointer ${
                autoRefresh 
                  ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400" 
                  : "bg-white/5 border-white/10 text-gray-400"
              }`}
            >
              {autoRefresh ? "Live Sync ON" : "Live Sync OFF"}
            </button>
          </div>
        </div>

      </div>

      {/* Main Database Table Container */}
      <div className="card rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden shadow-2xl">
        
        {/* Table Tabs Navigation */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setActiveSubTab("trades")}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeSubTab === "trades"
                  ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg"
                  : "bg-white/5 text-gray-400 hover:text-white hover:bg-white/10"
              }`}
            >
              <span>💼</span> Paper Trading Ledger ({paperTrades.length})
            </button>
            <button
              onClick={() => setActiveSubTab("signals")}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeSubTab === "signals"
                  ? "bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-lg"
                  : "bg-white/5 text-gray-400 hover:text-white hover:bg-white/10"
              }`}
            >
              <span>📋</span> Advisory Signals Log ({signals.length})
            </button>
            <button
              onClick={() => setActiveSubTab("sessions")}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeSubTab === "sessions"
                  ? "bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-lg"
                  : "bg-white/5 text-gray-400 hover:text-white hover:bg-white/10"
              }`}
            >
              <span>🔒</span> Broker Sessions ({sessions.length})
            </button>
            <button
              onClick={() => setActiveSubTab("settings")}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeSubTab === "settings"
                  ? "bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-lg"
                  : "bg-white/5 text-gray-400 hover:text-white hover:bg-white/10"
              }`}
            >
              <span>⚙️</span> Engine Settings ({settings.length})
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            {activeSubTab === "trades" && (
              <>
                <button
                  onClick={handleExportTradesCSV}
                  className="text-xs font-semibold py-1.5 px-3 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  📥 Export Trades CSV
                </button>
                <button
                  onClick={handleClearPaperTrades}
                  className="text-xs font-semibold py-1.5 px-3 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  🗑️ Clear Trades
                </button>
              </>
            )}
            {activeSubTab === "signals" && (
              <button
                onClick={handleClearSignals}
                className="text-xs font-semibold py-1.5 px-3 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                🗑️ Clear Signals
              </button>
            )}
          </div>
        </div>

        {/* Search & Filter Bar */}
        {(activeSubTab === "trades" || activeSubTab === "signals") && (
          <div className="flex items-center justify-between gap-4 p-4 border-b border-white/5 bg-white/[0.01]">
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <span className="text-gray-500 text-sm">🔍</span>
              <input
                type="text"
                placeholder="Search symbol, strike, reasoning, or type..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-gray-400 uppercase">Filter:</span>
              {activeSubTab === "trades" ? (
                ["ALL", "PROFIT", "LOSS", "BUY", "EXIT", "CALL", "PUT"].map(f => (
                  <button
                    key={f}
                    onClick={() => setFilterType(f)}
                    className={`text-[11px] font-bold px-2.5 py-1 rounded-md border transition-all cursor-pointer ${
                      filterType === f
                        ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                        : "bg-white/5 border-white/5 text-gray-400 hover:text-white"
                    }`}
                  >
                    {f}
                  </button>
                ))
              ) : (
                ["ALL", "BUY", "EXIT"].map(f => (
                  <button
                    key={f}
                    onClick={() => setFilterType(f)}
                    className={`text-[11px] font-bold px-2.5 py-1 rounded-md border transition-all cursor-pointer ${
                      filterType === f
                        ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-300"
                        : "bg-white/5 border-white/5 text-gray-400 hover:text-white"
                    }`}
                  >
                    {f}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* 1. Paper Trades Tab Content */}
        {activeSubTab === "trades" && (
          <div className="overflow-x-auto max-h-[580px] overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.02] text-[11px] font-semibold text-gray-400 uppercase tracking-wider sticky top-0 backdrop-blur-md">
                  <th className="py-3 px-4"># ID</th>
                  <th className="py-3 px-4">Date & Time</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Symbol / Strike</th>
                  <th className="py-3 px-4">Qty</th>
                  <th className="py-3 px-4">Execution Price</th>
                  <th className="py-3 px-4">Stop Loss</th>
                  <th className="py-3 px-4">Targets (T1 / T2)</th>
                  <th className="py-3 px-4">Invested Capital</th>
                  <th className="py-3 px-4">Realized P&L</th>
                  <th className="py-3 px-4">Regime / Confluence</th>
                  <th className="py-3 px-4">Reasoning</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs font-outfit">
                {filteredPaperTrades.length > 0 ? (
                  filteredPaperTrades.map((t) => {
                    const hasPnl = t.pnl !== undefined && t.pnl !== null;
                    const isProfit = hasPnl && t.pnl! >= 0;
                    return (
                      <tr key={t.id} className="hover:bg-white/[0.03] transition-colors">
                        <td className="py-3 px-4 text-gray-500 font-mono">#{t.id}</td>
                        <td className="py-3 px-4 text-gray-300 whitespace-nowrap">
                          {t.datetime || new Date(t.timestamp).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${getBadgeClass(t.type)}`}>
                            {t.type}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="font-bold text-white">{t.symbol}</div>
                          {t.strike && <div className="text-[10px] text-gray-400">Strike: {t.strike}</div>}
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold text-gray-300">
                          {t.qty}x
                        </td>
                        <td className="py-3 px-4 text-white font-bold whitespace-nowrap">
                          ₹{t.price.toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-rose-400 font-semibold whitespace-nowrap">
                          {t.stop_loss ? `₹${t.stop_loss.toFixed(2)}` : "--"}
                        </td>
                        <td className="py-3 px-4 text-emerald-400 whitespace-nowrap">
                          {t.target1 ? `T1: ₹${t.target1.toFixed(2)}` : "--"}
                          {t.target2 && <span className="block text-[10px] text-emerald-400/80">T2: ₹${t.target2.toFixed(2)}</span>}
                        </td>
                        <td className="py-3 px-4 text-gray-300 whitespace-nowrap font-mono">
                          ₹{t.invested_capital.toFixed(2)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {hasPnl ? (
                            <div className={`font-bold ${isProfit ? "text-emerald-400" : "text-rose-400"}`}>
                              {isProfit ? `+₹${t.pnl!.toFixed(2)}` : `-₹${Math.abs(t.pnl!).toFixed(2)}`}
                              {t.pnl_percent !== undefined && t.pnl_percent !== null && (
                                <span className="block text-[10px] font-normal">
                                  ({t.pnl_percent >= 0 ? "+" : ""}{t.pnl_percent.toFixed(1)}%)
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-500 italic">Position Open</span>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {t.market_regime ? (
                            <span className="px-2 py-0.5 rounded bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[10px] font-bold">
                              {t.market_regime}
                            </span>
                          ) : "--"}
                          {t.confluence_score && (
                            <span className="block text-[10px] text-gray-400 mt-0.5">Score: {t.confluence_score}/100</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-gray-400 font-sans text-[11.5px] max-w-xs leading-relaxed">
                          {t.reasoning || "--"}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={12} className="py-16 text-center text-gray-500 text-sm font-sans">
                      {isLoading ? "Loading paper trading ledger from SQLite..." : "No paper trades recorded yet. Ticks will automatically log Buy & Exit transactions here and in CSV."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 2. Signals Tab Content */}
        {activeSubTab === "signals" && (
          <div className="overflow-x-auto max-h-[580px] overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.02] text-[11px] font-semibold text-gray-400 uppercase tracking-wider sticky top-0 backdrop-blur-md">
                  <th className="py-3 px-4"># ID</th>
                  <th className="py-3 px-4">Date & Time</th>
                  <th className="py-3 px-4">Signal Type</th>
                  <th className="py-3 px-4">Strike</th>
                  <th className="py-3 px-4">Entry</th>
                  <th className="py-3 px-4">Stop Loss</th>
                  <th className="py-3 px-4">Target 1</th>
                  <th className="py-3 px-4">Target 2</th>
                  <th className="py-3 px-4">Quantitative Reasoning</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs font-outfit">
                {filteredSignals.length > 0 ? (
                  filteredSignals.map((sig) => (
                    <tr key={sig.id} className="hover:bg-white/[0.03] transition-colors">
                      <td className="py-3 px-4 text-gray-500 font-mono">#{sig.id}</td>
                      <td className="py-3 px-4 text-gray-300 whitespace-nowrap">
                        {new Date(sig.timestamp).toLocaleDateString()}{" "}
                        <span className="text-gray-500 font-mono">{new Date(sig.timestamp).toLocaleTimeString()}</span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${getBadgeClass(sig.type)}`}>
                          {sig.type}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold text-white whitespace-nowrap">
                        {sig.strike_price ? `${sig.strike_price} ${sig.type.includes("CALL") ? "CE" : sig.type.includes("PUT") ? "PE" : ""}` : "--"}
                      </td>
                      <td className="py-3 px-4 text-emerald-400 font-semibold whitespace-nowrap">
                        {sig.entry_price ? `₹${sig.entry_price.toFixed(2)}` : "--"}
                      </td>
                      <td className="py-3 px-4 text-rose-400 font-semibold whitespace-nowrap">
                        {sig.stop_loss_price ? `₹${sig.stop_loss_price.toFixed(2)}` : "--"}
                      </td>
                      <td className="py-3 px-4 text-emerald-400/90 whitespace-nowrap">
                        {sig.target_price1 ? `₹${sig.target_price1.toFixed(2)}` : "--"}
                      </td>
                      <td className="py-3 px-4 text-emerald-400 whitespace-nowrap font-bold">
                        {sig.target_price2 ? `₹${sig.target_price2.toFixed(2)}` : "--"}
                      </td>
                      <td className="py-3 px-4 text-gray-400 font-sans text-[11.5px] max-w-md leading-relaxed">
                        {sig.reasoning || "--"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} className="py-16 text-center text-gray-500 text-sm font-sans">
                      {isLoading ? "Fetching data from SQLite database..." : "No advisory signals recorded yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 3. Sessions Tab Content */}
        {activeSubTab === "sessions" && (
          <div className="p-6">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    <th className="py-3 px-4">Broker Provider</th>
                    <th className="py-3 px-4">Access Token (Encrypted/Cached)</th>
                    <th className="py-3 px-4">Expires At</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-xs font-outfit">
                  {sessions.length > 0 ? (
                    sessions.map((s, idx) => {
                      const isExpired = Date.now() > s.expires_at;
                      return (
                        <tr key={idx} className="hover:bg-white/[0.03] transition-colors">
                          <td className="py-3 px-4 font-bold text-white">{s.provider}</td>
                          <td className="py-3 px-4 text-gray-400 font-mono">
                            {s.access_token ? `${s.access_token.substring(0, 16)}...${s.access_token.substring(s.access_token.length - 8)}` : "--"}
                          </td>
                          <td className="py-3 px-4 text-gray-300">
                            {new Date(s.expires_at).toLocaleString()}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                              isExpired 
                                ? "bg-rose-500/15 border-rose-500/30 text-rose-400" 
                                : "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${isExpired ? "bg-rose-400" : "bg-emerald-400 animate-pulse"}`}></span>
                              {isExpired ? "EXPIRED (Daily 5 AM Rule)" : "ACTIVE SESSION"}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={4} className="py-12 text-center text-gray-500 text-sm font-sans">
                        No active sessions cached in database.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 4. Settings Tab Content */}
        {activeSubTab === "settings" && (
          <div className="p-6">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    <th className="py-3 px-4">Configuration Key</th>
                    <th className="py-3 px-4">Database Value</th>
                    <th className="py-3 px-4">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-xs font-outfit">
                  {settings.length > 0 ? (
                    settings.map((st, idx) => (
                      <tr key={idx} className="hover:bg-white/[0.03] transition-colors">
                        <td className="py-3 px-4 font-bold text-indigo-400 font-mono">{st.key}</td>
                        <td className="py-3 px-4 text-emerald-400 font-bold">{st.value}</td>
                        <td className="py-3 px-4 text-gray-400 font-sans">Persisted system runtime parameter</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="py-12 text-center text-gray-500 text-sm font-sans">
                        No custom settings rows stored. Default parameters loaded from environment (.env).
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
