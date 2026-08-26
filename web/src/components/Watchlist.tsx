import React, { useState, useEffect } from "react";

interface TickData {
  ltp: number;
  netChange?: number;
  netChangePercent: number;
  bidPrice: number;
  askPrice: number;
  timestamp: number;
}

interface WatchlistProps {
  activeSymbol: string;
  setActiveSymbol: (symbol: string) => void;
  ticks: { [symbol: string]: TickData };
  activeTab: number;
  setActiveTab: (tabId: number) => void;
  watchlistSymbols: string[];
  addSymbol: (symbol: string) => void;
  removeSymbol: (symbol: string) => void;
}

// Database of top liquid Indian indices and stocks
const SEARCH_DATABASE = [
  // Core Indices
  { id: "BSE:SENSEX-INDEX", displayName: "Sensex", desc: "BSE Spot Index" },
  { id: "NSE:NIFTY50-INDEX", displayName: "Nifty 50", desc: "NSE Spot Index" },
  { id: "NSE:NIFTYBANK-INDEX", displayName: "Nifty Bank", desc: "NSE Banking Index" },
  { id: "NSE:FINNIFTY-INDEX", displayName: "Fin Nifty", desc: "NSE Financial Index" },
  { id: "NSE:INDIAVIX-INDEX", displayName: "India VIX", desc: "NSE Volatility Index" },
  // Liquid Equities
  { id: "NSE:RELIANCE-EQ", displayName: "RELIANCE", desc: "Reliance Industries Ltd." },
  { id: "NSE:TCS-EQ", displayName: "TCS", desc: "Tata Consultancy Services Ltd." },
  { id: "NSE:HDFCBANK-EQ", displayName: "HDFCBANK", desc: "HDFC Bank Ltd." },
  { id: "NSE:ICICIBANK-EQ", displayName: "ICICIBANK", desc: "ICICI Bank Ltd." },
  { id: "NSE:INFY-EQ", displayName: "INFY", desc: "Infosys Ltd." },
  { id: "NSE:SBIN-EQ", displayName: "SBIN", desc: "State Bank of India" },
  { id: "NSE:BHARTIARTL-EQ", displayName: "BHARTIARTL", desc: "Bharti Airtel Ltd." },
  { id: "NSE:LT-EQ", displayName: "LT", desc: "Larsen & Toubro Ltd." },
  { id: "NSE:ITC-EQ", displayName: "ITC", desc: "ITC Ltd." },
  { id: "NSE:KOTAKBANK-EQ", displayName: "KOTAKBANK", desc: "Kotak Mahindra Bank Ltd." },
  { id: "NSE:AXISBANK-EQ", displayName: "AXISBANK", desc: "Axis Bank Ltd." },
  { id: "NSE:HINDUNILVR-EQ", displayName: "HINDUNILVR", desc: "Hindustan Unilever Ltd." },
  { id: "NSE:TATAMOTORS-EQ", displayName: "TATAMOTORS", desc: "Tata Motors Ltd." },
  { id: "NSE:WIPRO-EQ", displayName: "WIPRO", desc: "Wipro Ltd." },
  { id: "NSE:HCLTECH-EQ", displayName: "HCLTECH", desc: "HCL Technologies Ltd." },
  { id: "NSE:BAJFINANCE-EQ", displayName: "BAJFINANCE", desc: "Bajaj Finance Ltd." },
  { id: "NSE:MARUTI-EQ", displayName: "MARUTI", desc: "Maruti Suzuki India Ltd." },
  { id: "NSE:SUNPHARMA-EQ", displayName: "SUNPHARMA", desc: "Sun Pharmaceutical Industries Ltd." },
  { id: "NSE:ASIANPAINT-EQ", displayName: "ASIANPAINT", desc: "Asian Paints Ltd." },
  { id: "NSE:TITAN-EQ", displayName: "TITAN", desc: "Titan Company Ltd." },
  { id: "NSE:JSWSTEEL-EQ", displayName: "JSWSTEEL", desc: "JSW Steel Ltd." },
  { id: "NSE:POWERGRID-EQ", displayName: "POWERGRID", desc: "Power Grid Corp of India Ltd." },
  { id: "NSE:NTPC-EQ", displayName: "NTPC", desc: "NTPC Ltd." },
  { id: "NSE:COALINDIA-EQ", displayName: "COALINDIA", desc: "Coal India Ltd." },
  { id: "NSE:ONGC-EQ", displayName: "ONGC", desc: "Oil & Natural Gas Corp Ltd." },
  { id: "NSE:ULTRACEMCO-EQ", displayName: "ULTRACEMCO", desc: "UltraTech Cement Ltd." },
  { id: "NSE:GRASIM-EQ", displayName: "GRASIM", desc: "Grasim Industries Ltd." },
  { id: "NSE:HINDALCO-EQ", displayName: "HINDALCO", desc: "Hindalco Industries Ltd." },
  { id: "NSE:TATASTEEL-EQ", displayName: "TATASTEEL", desc: "Tata Steel Ltd." }
];

export const Watchlist: React.FC<WatchlistProps> = ({
  activeSymbol,
  setActiveSymbol,
  ticks,
  activeTab,
  setActiveTab,
  watchlistSymbols,
  addSymbol,
  removeSymbol
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<typeof SEARCH_DATABASE>([]);
  const [isFocused, setIsFocused] = useState(false);

  // Filter search queries local auto-suggest dropdown
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const query = searchQuery.toLowerCase();
    const filtered = SEARCH_DATABASE.filter(item => 
      item.displayName.toLowerCase().includes(query) || 
      item.desc.toLowerCase().includes(query)
    ).slice(0, 8); // Max 8 suggestions
    setSearchResults(filtered);
  }, [searchQuery]);

  return (
    <aside className="sidebar flex flex-col h-full border-r border-[var(--border-color)] bg-[#0d0e12] w-[310px] flex-shrink-0">
      
      {/* Search Container */}
      <div className="p-4 border-b border-[var(--border-color)] relative">
        <div className="relative">
          <input
            type="text"
            placeholder="Search stock, index (eg: SBIN, Bank)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsFocused(true)}
            className="w-full bg-[#16181e] border border-white/5 focus:border-[var(--accent-color)] text-white text-xs px-3 py-2.5 pl-8 rounded-lg outline-none transition-all"
          />
          <span className="absolute left-2.5 top-3.5 text-gray-500 flex items-center">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </span>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-3 text-gray-500 hover:text-white text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* Suggest Dropdown */}
        {isFocused && searchResults.length > 0 && (
          <div className="absolute left-4 right-4 mt-1.5 bg-[#1a1c23] border border-white/10 rounded-lg shadow-2xl z-50 max-h-[250px] overflow-y-auto">
            {searchResults.map((item) => {
              const inWatchlist = watchlistSymbols.includes(item.id);
              return (
                <div
                  key={item.id}
                  className="flex justify-between items-center p-2.5 hover:bg-[#232630] border-b border-white/5 cursor-pointer text-xs"
                >
                  <div className="flex flex-col gap-0.5 flex-1 pr-2" onClick={() => { setActiveSymbol(item.id); setIsFocused(false); }}>
                    <span className="font-semibold text-white">{item.displayName}</span>
                    <span className="text-[9px] text-[var(--color-text-secondary)]">{item.desc}</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (inWatchlist) {
                        removeSymbol(item.id);
                      } else {
                        addSymbol(item.id);
                      }
                    }}
                    className={`px-2 py-1 rounded text-[10px] font-semibold transition ${
                      inWatchlist 
                        ? "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30" 
                        : "bg-indigo-600 text-white hover:bg-indigo-700"
                    }`}
                  >
                    {inWatchlist ? "Remove" : "+ Add"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Watchlist Display */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5" onClick={() => setIsFocused(false)}>
        {watchlistSymbols.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-6 text-gray-500">
            <svg className="mb-2 text-gray-600" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            <p className="text-xs">Watchlist {activeTab} is empty.</p>
            <p className="text-[10px] text-gray-600 mt-1">Search and add stocks above.</p>
          </div>
        ) : (
          watchlistSymbols.map((symId) => {
            const dbItem = SEARCH_DATABASE.find(i => i.id === symId);
            const displayName = dbItem ? dbItem.displayName : symId.split(":")[1]?.split("-")[0] || symId;
            const desc = dbItem ? dbItem.desc : "Equity Stock Spot";

            const tick = ticks[symId];
            const ltp = tick ? tick.ltp : null;
            const changePercent = tick ? tick.netChangePercent : null;
            const netChange = tick && tick.netChange !== undefined && tick.netChange !== null 
              ? tick.netChange 
              : (ltp !== null && changePercent !== null ? ltp - (ltp / (1 + changePercent / 100)) : null);
            
            const isPositive = (netChange !== null ? netChange : (changePercent ?? 0)) >= 0;
            const changeColor = isPositive ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]";
            const changeSign = isPositive ? "+" : "";

            const displayLtp = ltp !== null ? ltp.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "--";
            const pointsStr = netChange !== null 
              ? `${netChange >= 0 ? "+" : ""}${netChange.toFixed(2)}` 
              : `${changeSign}0.00`;
            const percentStr = changePercent !== null 
              ? `(${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%)` 
              : "(0.00%)";
            const displayChange = ltp !== null ? `${pointsStr} ${percentStr}` : "0.00 (0.00%)";

            return (
              <div
                key={symId}
                className={`group flex justify-between items-center p-3 rounded-lg cursor-pointer transition-all border border-transparent relative ${
                  activeSymbol === symId 
                    ? "bg-[rgba(99,102,241,0.12)] border-[rgba(99,102,241,0.25)]" 
                    : "hover:bg-[#1a1d25] hover:border-white/5"
                }`}
                onClick={() => setActiveSymbol(symId)}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-semibold text-white">{displayName}</span>
                  <span className="text-[9px] text-gray-500">{desc}</span>
                </div>
                
                <div className="flex items-center gap-2 font-outfit">
                  <div className="flex flex-col items-end gap-0.5 group-hover:hidden">
                    <span className="text-[13px] font-medium text-white">{displayLtp}</span>
                    <span className={`text-[10px] font-medium ${changeColor}`}>
                      {displayChange}
                    </span>
                  </div>
                  
                  {/* Delete Option (only visible on hover states) */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSymbol(symId);
                    }}
                    className="hidden group-hover:flex items-center justify-center p-1.5 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 rounded transition"
                    title="Remove from watchlist"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Kite-style Tab Indicator Row */}
      <div className="p-3 border-t border-[var(--border-color)] bg-[#131419] flex justify-between items-center text-xs font-semibold select-none">
        <span className="text-gray-500 uppercase tracking-wider text-[10px]">Watchlists:</span>
        <div className="flex gap-1 bg-[#1c1d24] p-0.5 rounded-lg border border-white/5">
          {[1, 2, 3, 4, 5].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`w-6 h-6 rounded flex items-center justify-center text-[11px] font-bold transition-all ${
                activeTab === tab 
                  ? "bg-[var(--accent-color)] text-white shadow-lg" 
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
};
