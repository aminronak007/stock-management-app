"use client";

import React, { useState, useEffect } from "react";

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

export const SettingsViewer: React.FC = () => {
  const [sessions, setSessions] = useState<DatabaseSession[]>([]);
  const [settings, setSettings] = useState<DatabaseSetting[]>([]);
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<string>("");
  const [actionMessage, setActionMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  // Copied token state
  const [copiedToken, setCopiedToken] = useState(false);

  const fetchSettingsData = async () => {
    try {
      setIsLoading(true);
      const res = await fetch("http://localhost:8080/api/database/overview");
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
        setSettings(data.settings || []);
        setStats(data.stats || null);
        setLastRefreshed(new Date().toLocaleTimeString());
      }
    } catch (e) {
      console.error("Failed to load settings:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSettingsData();
  }, []);

  const showToast = (text: string, type: "success" | "error" | "info" = "success") => {
    setActionMessage({ text, type });
    setTimeout(() => setActionMessage(null), 4000);
  };

  const handleClearPaperTrades = async () => {
    if (!window.confirm("⚠️ Are you sure you want to permanently clear the paper trading ledger from SQLite? This cannot be undone.")) return;
    try {
      setIsProcessingAction(true);
      const res = await fetch("http://localhost:8080/api/database/clear-paper-trades", { method: "POST" });
      if (res.ok) {
        showToast("✅ Paper trading ledger has been successfully cleared.", "success");
        await fetchSettingsData();
      } else {
        showToast("✖ Failed to clear paper trades.", "error");
      }
    } catch (e: any) {
      showToast(`✖ Error: ${e.message}`, "error");
    } finally {
      setIsProcessingAction(false);
    }
  };

  const handleClearSignals = async () => {
    if (!window.confirm("⚠️ Are you sure you want to clear advisory signals history from SQLite?")) return;
    try {
      setIsProcessingAction(true);
      const res = await fetch("http://localhost:8080/api/database/clear-signals", { method: "POST" });
      if (res.ok) {
        showToast("✅ Advisory signals history cleared.", "success");
        await fetchSettingsData();
      } else {
        showToast("✖ Failed to clear signals.", "error");
      }
    } catch (e: any) {
      showToast(`✖ Error: ${e.message}`, "error");
    } finally {
      setIsProcessingAction(false);
    }
  };

  const handlePurgeCorrupted = async () => {
    try {
      setIsProcessingAction(true);
      const res = await fetch("http://localhost:8080/api/database/purge-corrupted-trades", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        showToast(`✅ Purged ${data.count} corrupted/dummy test records.`, "success");
        await fetchSettingsData();
      } else {
        showToast("✖ Failed to purge records.", "error");
      }
    } catch (e: any) {
      showToast(`✖ Error: ${e.message}`, "error");
    } finally {
      setIsProcessingAction(false);
    }
  };

  const activeFyersSession = sessions.find(s => s.provider?.toLowerCase().includes("fyers")) || sessions[0];
  const isSessionExpired = activeFyersSession ? Date.now() > activeFyersSession.expires_at : true;

  const handleCopyToken = () => {
    if (activeFyersSession?.access_token) {
      navigator.clipboard.writeText(activeFyersSession.access_token);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
      showToast("📋 Token copied to clipboard.", "info");
    }
  };

  const handleOpenAuth = () => {
    window.open("https://api-t1.fyers.in/api/v3/generate-authcode", "_blank");
  };

  return (
    <div className="settings-page flex flex-col gap-6 w-full pb-12 font-outfit text-white">
      {/* Toast Notification */}
      {actionMessage && (
        <div className={`fixed top-16 right-6 z-50 px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-4 duration-200 text-xs font-bold ${
          actionMessage.type === "success" 
            ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
            : actionMessage.type === "error"
            ? "bg-rose-500/20 border-rose-500/40 text-rose-300"
            : "bg-indigo-500/20 border-indigo-500/40 text-indigo-300"
        }`}>
          <span>{actionMessage.text}</span>
        </div>
      )}

      {/* Header Deck */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-6 rounded-2xl bg-white/[0.02] border border-white/10 shadow-xl">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-lg shadow-inner">
              ⚙️
            </div>
            <div>
              <h1 className="text-xl font-extrabold tracking-wide text-white">System Settings & Broker Configuration</h1>
              <p className="text-xs text-gray-400 font-sans mt-0.5">
                Manage live broker authentication, execution parameters, risk limits, and SQLite state storage.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {lastRefreshed && (
            <span className="text-[11px] text-gray-400 font-mono bg-black/40 px-3 py-1.5 rounded-lg border border-white/5">
              Refreshed: <span className="text-emerald-400 font-bold">{lastRefreshed}</span>
            </span>
          )}
          <button
            onClick={fetchSettingsData}
            disabled={isLoading}
            className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-gray-200 hover:text-white transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50"
          >
            <span className={isLoading ? "animate-spin" : ""}>🔄</span> Refresh
          </button>
        </div>
      </div>

      {/* Grid: 2 Columns for Broker Authentication & Risk Parameters */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Card 1: Broker & Session Authentication */}
        <div className="card p-6 rounded-2xl bg-white/[0.02] border border-white/10 flex flex-col justify-between shadow-xl">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-white/5">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">🔐</span>
                <h2 className="text-sm font-bold uppercase tracking-wider text-gray-200">Broker Authentication & Session</h2>
              </div>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                !isSessionExpired && activeFyersSession
                  ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                  : "bg-rose-500/15 border-rose-500/30 text-rose-400"
              }`}>
                <span className={`w-2 h-2 rounded-full ${!isSessionExpired && activeFyersSession ? "bg-emerald-400 animate-pulse" : "bg-rose-400"}`}></span>
                {!isSessionExpired && activeFyersSession ? "ACTIVE SESSION" : "EXPIRED / DISCONNECTED"}
              </span>
            </div>

            <div className="mt-5 flex flex-col gap-4 text-xs">
              <div className="flex justify-between items-center py-2 border-b border-white/5">
                <span className="text-gray-400 font-sans">Broker Provider:</span>
                <span className="font-bold text-white font-mono bg-white/5 px-2.5 py-1 rounded-md">
                  {activeFyersSession?.provider || "FYERS API v3"}
                </span>
              </div>

              <div className="flex flex-col gap-1.5 py-2 border-b border-white/5">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 font-sans">Cached Access Token:</span>
                  {activeFyersSession?.access_token && (
                    <button
                      onClick={handleCopyToken}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold cursor-pointer"
                    >
                      {copiedToken ? "✓ Copied!" : "📋 Copy Token"}
                    </button>
                  )}
                </div>
                <div className="bg-black/50 border border-white/5 p-2.5 rounded-lg font-mono text-[11px] text-gray-300 break-all select-all">
                  {activeFyersSession?.access_token
                    ? `${activeFyersSession.access_token.substring(0, 24)}...${activeFyersSession.access_token.substring(activeFyersSession.access_token.length - 12)}`
                    : "No active access token stored in database."}
                </div>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-white/5">
                <span className="text-gray-400 font-sans">Token Expiration (Daily 5:00 AM Rule):</span>
                <span className="font-mono text-gray-200 font-bold">
                  {activeFyersSession?.expires_at ? new Date(activeFyersSession.expires_at).toLocaleString() : "--"}
                </span>
              </div>

              <div className="flex justify-between items-center py-2">
                <span className="text-gray-400 font-sans">WebSocket Feed Status:</span>
                <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  Live Fyers Streaming Feed Active
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-white/5 flex gap-3">
            <button
              onClick={handleOpenAuth}
              className="flex-1 py-2.5 px-4 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-300 hover:text-indigo-200 font-bold text-xs transition-all cursor-pointer flex items-center justify-center gap-2 shadow-lg"
            >
              <span>🔑</span> Re-Authenticate Broker (2FA Login)
            </button>
          </div>
        </div>

        {/* Card 2: Risk Management & Engine Controls */}
        <div className="card p-6 rounded-2xl bg-white/[0.02] border border-white/10 flex flex-col justify-between shadow-xl">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-white/5">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">🛡️</span>
                <h2 className="text-sm font-bold uppercase tracking-wider text-gray-200">Execution Risk & Engine Limits</h2>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 border border-amber-500/30 text-amber-300">
                HARD LIMITS ACTIVE
              </span>
            </div>

            <div className="mt-5 flex flex-col gap-3.5 text-xs font-sans">
              <div className="flex justify-between items-center py-2 border-b border-white/5">
                <div>
                  <div className="font-bold text-white">Max Allocation per Option Leg</div>
                  <div className="text-[11px] text-gray-500">Maximum portfolio capital deployed in single trade</div>
                </div>
                <span className="font-mono font-extrabold text-emerald-400 text-sm">₹50,000</span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-white/5">
                <div>
                  <div className="font-bold text-white">Hard 3:15 PM Auto Square-Off</div>
                  <div className="text-[11px] text-gray-500">Auto liquidation rule prevents overnight theta bleed</div>
                </div>
                <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold text-[11px]">
                  ENABLED (3:15 PM)
                </span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-white/5">
                <div>
                  <div className="font-bold text-white">Slippage Tolerance Multiplier</div>
                  <div className="text-[11px] text-gray-500">Quantitative backtest & paper fill slippage model</div>
                </div>
                <span className="font-mono font-bold text-gray-200">0.5% (50 bps)</span>
              </div>

              <div className="flex justify-between items-center py-2">
                <div>
                  <div className="font-bold text-white">Minimum 8-Factor Confluence Threshold</div>
                  <div className="text-[11px] text-gray-500">Required signal filter gating score</div>
                </div>
                <span className="font-mono font-bold text-indigo-400">80 / 100</span>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-white/5">
            <p className="text-[11px] text-gray-500 italic">
              * Risk parameters are enforced by QuantitativeEngine in <code className="text-gray-400 font-mono">backend/src/services/advisoryManager.ts</code>.
            </p>
          </div>
        </div>

      </div>

      {/* Section 3: SQLite Database & Storage Maintenance */}
      <div className="card p-6 rounded-2xl bg-white/[0.02] border border-white/10 shadow-xl">
        <div className="flex items-center justify-between pb-4 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">🗄️</span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-200">Database Storage & Maintenance</h2>
          </div>
          <span className="text-xs text-gray-400 font-mono">SQLite 3 (WAL Mode)</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-5">
          <div className="p-4 rounded-xl bg-black/40 border border-white/5 flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-gray-400 uppercase">Recorded Paper Trades</span>
            <span className="text-2xl font-extrabold text-emerald-400 font-mono mt-2">{stats?.totalPaperTrades || 0}</span>
            <span className="text-[10px] text-gray-500 mt-1">Full Ledger & Cycle Logs</span>
          </div>

          <div className="p-4 rounded-xl bg-black/40 border border-white/5 flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-gray-400 uppercase">Generated AI Signals</span>
            <span className="text-2xl font-extrabold text-indigo-400 font-mono mt-2">{stats?.totalSignals || 0}</span>
            <span className="text-[10px] text-gray-500 mt-1">Historical High-Probability Alerts</span>
          </div>

          <div className="p-4 rounded-xl bg-black/40 border border-white/5 flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-gray-400 uppercase">Database File Path</span>
            <span className="text-xs font-mono text-gray-300 mt-2 break-all">{stats?.dbPath || "backend/data/state.db"}</span>
            <span className="text-[10px] text-emerald-400 font-semibold mt-1">● Synchronized</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="pt-4 border-t border-white/5 flex flex-wrap items-center gap-3">
          <button
            onClick={handleClearPaperTrades}
            disabled={isProcessingAction}
            className="px-4 py-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-400 font-bold text-xs transition-all cursor-pointer flex items-center gap-2 shadow-sm disabled:opacity-50"
          >
            <span>🧹</span> Clear Paper Trades Ledger
          </button>

          <button
            onClick={handleClearSignals}
            disabled={isProcessingAction}
            className="px-4 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 font-bold text-xs transition-all cursor-pointer flex items-center gap-2 shadow-sm disabled:opacity-50"
          >
            <span>🗑️</span> Clear Signals History
          </button>

          <button
            onClick={handlePurgeCorrupted}
            disabled={isProcessingAction}
            className="px-4 py-2.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 font-bold text-xs transition-all cursor-pointer flex items-center gap-2 shadow-sm disabled:opacity-50"
          >
            <span>⚡</span> Purge Corrupted/Dummy Records
          </button>
        </div>
      </div>

      {/* Section 4: System Parameters & Environment Keys */}
      <div className="card p-6 rounded-2xl bg-white/[0.02] border border-white/10 shadow-xl">
        <div className="flex items-center justify-between pb-4 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">📋</span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-200">System Environment & Runtime Parameters</h2>
          </div>
          <span className="text-xs text-gray-400 font-mono">Port 8080 (REST + WS)</span>
        </div>

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/10 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                <th className="py-3 px-4">Configuration Key</th>
                <th className="py-3 px-4">Database Value</th>
                <th className="py-3 px-4">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-outfit">
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
                  <td colSpan={3} className="py-8 text-center text-gray-500 text-sm font-sans">
                    Default environment configurations loaded from <code className="text-gray-400 font-mono">backend/.env</code>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
