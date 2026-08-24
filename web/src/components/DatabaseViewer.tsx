"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";

interface DatabaseSignal {
  id: number;
  timestamp: number;
  type: string;
  tier?: string;
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
  tier?: string;
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
  fees?: number;
  net_pnl?: number;
  reasoning: string;
  market_regime?: string;
  confluence_score?: number;
  status: string;
  parent_trade_id?: number;
  entry_price?: number;
}

interface TradeAnalytics {
  tier?: string;
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

interface TierOverviewAnalytics {
  overall: TradeAnalytics;
  sniper: TradeAnalytics;
  balanced: TradeAnalytics;
  exploratory: TradeAnalytics;
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

const getIstDateString = (timestamp?: number, datetimeStr?: string): string => {
  if (timestamp && !isNaN(Number(timestamp))) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date(Number(timestamp)));
  }
  if (datetimeStr) {
    const d = new Date(datetimeStr);
    if (!isNaN(d.getTime())) {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(d);
    }
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
};

interface FilterOption {
  value: string;
  label: string;
  icon?: string;
  color?: string;
}

const tradeFilterOptions: FilterOption[] = [
  { value: "ALL", label: "All Types", icon: "🌐" },
  { value: "PROFIT", label: "Profit Only", icon: "🟢", color: "text-emerald-400" },
  { value: "LOSS", label: "Loss Only", icon: "🔴", color: "text-rose-400" },
  { value: "BUY", label: "Buy Orders", icon: "📥", color: "text-emerald-300" },
  { value: "EXIT", label: "Exit Orders", icon: "📤", color: "text-amber-300" },
  { value: "CALL", label: "Calls (CE)", icon: "📈", color: "text-cyan-300" },
  { value: "PUT", label: "Puts (PE)", icon: "📉", color: "text-purple-300" },
];

const signalFilterOptions: FilterOption[] = [
  { value: "ALL", label: "All Signals", icon: "🌐" },
  { value: "BUY", label: "Buy Signals", icon: "📥", color: "text-emerald-300" },
  { value: "EXIT", label: "Exit Signals", icon: "📤", color: "text-amber-300" },
];

// Modern Dark Glassmorphic Filter Dropdown Component
const CustomFilterDropdown: React.FC<{
  value: string;
  onChange: (val: string) => void;
  options: FilterOption[];
}> = ({ value, onChange, options }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => o.value === value) || options[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md border ${
          value !== "ALL"
            ? "bg-indigo-500/20 border-indigo-500/50 text-white shadow-indigo-500/10"
            : "bg-black/50 hover:bg-black/70 border-white/10 hover:border-white/20 text-white"
        }`}
      >
        <span className={`flex items-center gap-1.5 ${selectedOption.color || "text-white"}`}>
          {selectedOption.icon && <span>{selectedOption.icon}</span>}
          <span>{selectedOption.label}</span>
        </span>
        <span className={`text-[9px] text-gray-400 transition-transform duration-200 ${isOpen ? "rotate-180 text-white" : ""}`}>
          ▼
        </span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-52 rounded-2xl bg-[#0d1017]/95 backdrop-blur-2xl border border-white/15 shadow-2xl shadow-black/90 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
          <div className="px-3.5 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-white/5 flex items-center justify-between">
            <span>Filter Transactions</span>
            <span className="text-[9px] text-indigo-400 font-mono">LIVE</span>
          </div>
          <div className="py-1">
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-3.5 py-2 text-xs flex items-center justify-between transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-indigo-500/20 text-indigo-300 font-bold border-l-2 border-indigo-400"
                      : "text-gray-300 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {option.icon && <span>{option.icon}</span>}
                    <span className={option.color || ""}>{option.label}</span>
                  </div>
                  {isSelected && <span className="text-indigo-400 text-xs font-bold">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// Modern Dark Glassmorphic Interactive Calendar Component
const CustomCalendarPicker: React.FC<{
  selectedDate: string;
  todayDateStr: string;
  onSelectDate: (dateStr: string) => void;
  activeTradeDates?: Set<string>;
}> = ({ selectedDate, todayDateStr, onSelectDate, activeTradeDates }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const initDate = selectedDate !== "ALL" ? new Date(selectedDate) : new Date(todayDateStr);
  const [viewYear, setViewYear] = useState<number>(initDate.getFullYear() || 2026);
  const [viewMonth, setViewMonth] = useState<number>(initDate.getMonth() || 7);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const calendarDays = useMemo(() => {
    const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const days: {
      day: number;
      month: number;
      year: number;
      dateStr: string;
      isCurrentMonth: boolean;
      isToday: boolean;
      isSelected: boolean;
      isFuture: boolean;
      hasTrades: boolean;
    }[] = [];

    // Prev month overflow
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const m = viewMonth === 0 ? 11 : viewMonth - 1;
      const y = viewMonth === 0 ? viewYear - 1 : viewYear;
      const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({
        day: d,
        month: m,
        year: y,
        dateStr,
        isCurrentMonth: false,
        isToday: dateStr === todayDateStr,
        isSelected: dateStr === selectedDate,
        isFuture: dateStr > todayDateStr,
        hasTrades: activeTradeDates ? activeTradeDates.has(dateStr) : false
      });
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({
        day: d,
        month: viewMonth,
        year: viewYear,
        dateStr,
        isCurrentMonth: true,
        isToday: dateStr === todayDateStr,
        isSelected: dateStr === selectedDate,
        isFuture: dateStr > todayDateStr,
        hasTrades: activeTradeDates ? activeTradeDates.has(dateStr) : false
      });
    }

    // Next month overflow
    const totalCells = days.length > 35 ? 42 : 35;
    const remaining = totalCells - days.length;
    for (let d = 1; d <= remaining; d++) {
      const m = viewMonth === 11 ? 0 : viewMonth + 1;
      const y = viewMonth === 11 ? viewYear + 1 : viewYear;
      const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({
        day: d,
        month: m,
        year: y,
        dateStr,
        isCurrentMonth: false,
        isToday: dateStr === todayDateStr,
        isSelected: dateStr === selectedDate,
        isFuture: dateStr > todayDateStr,
        hasTrades: activeTradeDates ? activeTradeDates.has(dateStr) : false
      });
    }

    return days;
  }, [viewYear, viewMonth, selectedDate, todayDateStr, activeTradeDates]);

  const triggerLabel = useMemo(() => {
    if (selectedDate === "ALL") return "All History";
    if (selectedDate === todayDateStr) return "Today";
    const [y, m, d] = selectedDate.split("-");
    const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
    if (isNaN(dateObj.getTime())) return selectedDate;
    return dateObj.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }, [selectedDate, todayDateStr]);

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      {/* Custom Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer shadow-md ${
          selectedDate !== "ALL" && selectedDate !== todayDateStr
            ? "bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-amber-500/10"
            : "bg-black/50 hover:bg-black/70 border-white/10 text-gray-200 hover:text-white hover:border-white/20"
        }`}
      >
        <span>📆</span>
        <span>{triggerLabel}</span>
        <span className={`text-[9px] text-gray-400 transition-transform duration-200 ${isOpen ? "rotate-180 text-white" : ""}`}>
          ▼
        </span>
      </button>

      {/* Modern Glass Calendar Popup */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 rounded-2xl bg-[#0b0e14]/95 backdrop-blur-2xl border border-white/15 shadow-2xl shadow-black/90 p-4 z-50 animate-in fade-in zoom-in-95 duration-150">
          
          {/* Header Month / Year & Prev/Next Buttons */}
          <div className="flex justify-between items-center mb-3.5 pb-2.5 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="text-sm font-extrabold text-white tracking-wide">
                {monthNames[viewMonth]} {viewYear}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white text-xs transition-colors cursor-pointer border border-white/5"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white text-xs transition-colors cursor-pointer border border-white/5"
              >
                ›
              </button>
            </div>
          </div>

          {/* Weekday Row */}
          <div className="grid grid-cols-7 gap-1 text-center mb-2">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day, dIdx) => (
              <span
                key={day}
                className={`text-[10px] font-bold uppercase tracking-wider py-0.5 ${
                  dIdx === 0 || dIdx === 6 ? "text-rose-400/70" : "text-gray-500"
                }`}
              >
                {day}
              </span>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1.5 text-center">
            {calendarDays.map((item, idx) => {
              const disabled = item.isFuture;
              return (
                <button
                  key={idx}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onSelectDate(item.dateStr);
                    setIsOpen(false);
                  }}
                  className={`relative w-8 h-8 mx-auto flex flex-col items-center justify-center rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    item.isSelected
                      ? "bg-emerald-500 text-black font-extrabold shadow-lg shadow-emerald-500/40 scale-110 z-10"
                      : item.isToday
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 font-bold"
                      : !item.isCurrentMonth
                      ? "text-gray-600 hover:text-gray-400 hover:bg-white/5"
                      : disabled
                      ? "text-gray-700 cursor-not-allowed opacity-30"
                      : "text-gray-200 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <span>{item.day}</span>
                  {item.hasTrades && !item.isSelected && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 absolute bottom-0.5 shadow-sm shadow-emerald-400/50"></span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Footer Quick Action Buttons */}
          <div className="flex items-center justify-between pt-3 mt-3 border-t border-white/10 text-xs">
            <button
              type="button"
              onClick={() => {
                onSelectDate(todayDateStr);
                setIsOpen(false);
              }}
              className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 font-bold text-[11px] transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Today ({todayDateStr.split("-")[2]})
            </button>

            <button
              type="button"
              onClick={() => {
                onSelectDate("ALL");
                setIsOpen(false);
              }}
              className="px-3 py-1.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 font-bold text-[11px] transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
            >
              <span>🌐</span> All History
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Modern Dark Glassmorphic Pagination Component
interface ModernPaginationProps {
  currentPage: number;
  totalRecords: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

const ModernPagination: React.FC<ModernPaginationProps> = ({
  currentPage,
  totalRecords,
  pageSize,
  onPageChange,
  onPageSizeChange
}) => {
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const startRecord = totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endRecord = Math.min(currentPage * pageSize, totalRecords);

  const getPageNumbers = () => {
    const delta = 2;
    const range: number[] = [];
    for (let i = Math.max(2, currentPage - delta); i <= Math.min(totalPages - 1, currentPage + delta); i++) {
      range.push(i);
    }
    if (currentPage - delta > 2) range.unshift(-1);
    if (currentPage + delta < totalPages - 1) range.push(-2);
    range.unshift(1);
    if (totalPages > 1 && !range.includes(totalPages)) range.push(totalPages);
    return range;
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3.5 border-t border-white/10 bg-white/[0.015] text-xs">
      {/* Left: Info & Per Page selector */}
      <div className="flex items-center gap-3">
        <span className="text-gray-400 font-sans">
          Showing <span className="font-bold text-white font-mono">{startRecord}</span> to <span className="font-bold text-white font-mono">{endRecord}</span> of <span className="font-bold text-emerald-400 font-mono">{totalRecords}</span> entries
        </span>

        <div className="flex items-center gap-1.5 bg-black/40 border border-white/10 rounded-lg px-2 py-0.5">
          <span className="text-[10px] text-gray-500 font-bold uppercase">Rows:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              onPageSizeChange(Number(e.target.value));
              onPageChange(1);
            }}
            className="bg-transparent text-[11px] font-bold text-white focus:outline-none cursor-pointer [color-scheme:dark]"
          >
            <option value={10} className="bg-[#12141a] text-white">10</option>
            <option value={25} className="bg-[#12141a] text-white">25</option>
            <option value={50} className="bg-[#12141a] text-white">50</option>
            <option value={100} className="bg-[#12141a] text-white">100</option>
          </select>
        </div>
      </div>

      {/* Right: Page Navigation Pills */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className="w-7 h-7 flex items-center justify-center rounded-lg border border-white/5 bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed text-[10px] font-bold transition-all cursor-pointer"
          title="First Page"
        >
          ⏮
        </button>

        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="px-2.5 py-1 rounded-lg border border-white/5 bg-white/5 text-gray-300 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer"
        >
          ‹ Prev
        </button>

        <div className="flex items-center gap-1 mx-1">
          {getPageNumbers().map((p, idx) => {
            if (p < 0) {
              return (
                <span key={`dots-${idx}`} className="px-1 text-gray-600 font-mono text-xs">
                  ...
                </span>
              );
            }
            const isActive = p === currentPage;
            return (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                className={`w-7 h-7 rounded-lg text-xs font-bold transition-all flex items-center justify-center cursor-pointer ${
                  isActive
                    ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/30 font-extrabold scale-105"
                    : "bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white border border-white/5"
                }`}
              >
                {p}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages || totalPages === 0}
          className="px-2.5 py-1 rounded-lg border border-white/5 bg-white/5 text-gray-300 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer"
        >
          Next ›
        </button>

        <button
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages || totalPages === 0}
          className="w-7 h-7 flex items-center justify-center rounded-lg border border-white/5 bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed text-[10px] font-bold transition-all cursor-pointer"
          title="Last Page"
        >
          ⏭
        </button>
      </div>
    </div>
  );
};

export const DatabaseViewer: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<"trades" | "signals">("trades");
  const [selectedTier, setSelectedTier] = useState<"ALL" | "SNIPER" | "BALANCED" | "EXPLORATORY">("SNIPER");
  const [paperTrades, setPaperTrades] = useState<PaperTrade[]>([]);
  const [signals, setSignals] = useState<DatabaseSignal[]>([]);
  const [analytics, setAnalytics] = useState<TradeAnalytics | null>(null);
  const [tierAnalytics, setTierAnalytics] = useState<TierOverviewAnalytics | null>(null);
  const [sessions, setSessions] = useState<DatabaseSession[]>([]);
  const [settings, setSettings] = useState<DatabaseSetting[]>([]);
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  
  const todayDateStr = useMemo(() => getIstDateString(Date.now()), []);
  const todayDateFormatted = useMemo(() => {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short"
    }).format(new Date());
  }, []);
  const [selectedDate, setSelectedDate] = useState<string>(todayDateStr);

  const activeTradeDates = useMemo(() => {
    const dates = new Set<string>();
    for (const t of paperTrades) {
      const d = getIstDateString(t.timestamp, t.datetime);
      if (d) dates.add(d);
    }
    for (const s of signals) {
      const d = getIstDateString(s.timestamp);
      if (d) dates.add(d);
    }
    return dates;
  }, [paperTrades, signals]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 200);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  const [filterType, setFilterType] = useState<string>("ALL");
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [lastRefreshed, setLastRefreshed] = useState<string>("");
  const [tradesViewMode, setTradesViewMode] = useState<"ledger" | "pairs">("ledger");

  const fetchData = async () => {
    try {
      setIsLoading(true);
      const res = await fetch("http://localhost:8080/api/database/overview");
      if (res.ok) {
        const data = await res.json();
        setPaperTrades(data.paperTrades || []);
        setSignals(data.signals || []);
        setAnalytics(data.analytics || null);
        setTierAnalytics(data.tierAnalytics || null);
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

  // Bidirectional trade link mapping (Pairs each Exit to its corresponding Buy)
  const tradeLinkages = useMemo(() => {
    const linkMap = new Map<number, {
      pairedId?: number;
      entryPrice?: number;
      exitPrice?: number;
      exitType?: string;
      pnl?: number;
      pnlPercent?: number;
      isExit: boolean;
      status: "OPEN" | "CLOSED";
    }>();

    const sortedTrades = [...paperTrades].sort((a, b) => a.id - b.id);
    const openStacks: { [key: string]: PaperTrade[] } = {};

    for (const t of sortedTrades) {
      const tierKey = `${t.tier || "SNIPER"}_${t.symbol}`;
      if (!openStacks[tierKey]) openStacks[tierKey] = [];

      if (t.type.includes("BUY")) {
        openStacks[tierKey].push(t);
        linkMap.set(t.id, { isExit: false, status: "OPEN" });
      } else {
        let parentBuy: PaperTrade | undefined;
        if (t.parent_trade_id) {
          parentBuy = sortedTrades.find(x => x.id === t.parent_trade_id);
        }
        if (!parentBuy && openStacks[tierKey].length > 0) {
          parentBuy = openStacks[tierKey].pop();
        }

        if (parentBuy) {
          linkMap.set(t.id, {
            isExit: true,
            pairedId: parentBuy.id,
            entryPrice: t.entry_price || parentBuy.price,
            exitPrice: t.price,
            exitType: t.type,
            pnl: t.pnl,
            pnlPercent: t.pnl_percent,
            status: "CLOSED"
          });

          linkMap.set(parentBuy.id, {
            isExit: false,
            pairedId: t.id,
            entryPrice: parentBuy.price,
            exitPrice: t.price,
            exitType: t.type,
            pnl: t.pnl,
            pnlPercent: t.pnl_percent,
            status: "CLOSED"
          });
        } else {
          linkMap.set(t.id, {
            isExit: true,
            entryPrice: t.entry_price,
            exitPrice: t.price,
            exitType: t.type,
            pnl: t.pnl,
            status: "CLOSED"
          });
        }
      }
    }

    return linkMap;
  }, [paperTrades]);

  // Group into Round-Trip Trade Cycles (with Date, Tier, Type, and Search Filtering)
  const roundTripPairs = useMemo(() => {
    const pairs: {
      id: string;
      tier: string;
      symbol: string;
      strike?: string;
      qty: number;
      entryTrade: PaperTrade;
      exitTrade?: PaperTrade;
      entryPrice: number;
      exitPrice?: number;
      entryTime: string;
      exitTime?: string;
      durationMins?: number;
      pnl?: number;
      pnlPercent?: number;
      status: "OPEN" | "CLOSED";
      exitReason?: string;
      exitType?: string;
    }[] = [];

    const sortedBuys = [...paperTrades]
      .filter(t => t.type.includes("BUY"))
      .filter(buy => {
        if (selectedTier !== "ALL" && (buy.tier || "SNIPER") !== selectedTier) return false;
        if (selectedDate !== "ALL") {
          const entryDate = getIstDateString(buy.timestamp, buy.datetime);
          const link = tradeLinkages.get(buy.id);
          const exitTrade = link?.pairedId ? paperTrades.find(t => t.id === link.pairedId) : undefined;
          const exitDate = exitTrade ? getIstDateString(exitTrade.timestamp, exitTrade.datetime) : undefined;
          if (entryDate !== selectedDate && exitDate !== selectedDate) return false;
        }
        return true;
      })
      .sort((a, b) => b.id - a.id);

    for (const buy of sortedBuys) {
      const link = tradeLinkages.get(buy.id);
      let exitTrade: PaperTrade | undefined;
      if (link?.pairedId) {
        exitTrade = paperTrades.find(t => t.id === link.pairedId);
      }

      const isClosed = !!exitTrade;
      const durationMins = exitTrade
        ? Math.max(1, Math.round((exitTrade.timestamp - buy.timestamp) / 60000))
        : undefined;

      pairs.push({
        id: `CYCLE-${buy.id}${exitTrade ? `-${exitTrade.id}` : ""}`,
        tier: buy.tier || "SNIPER",
        symbol: buy.symbol,
        strike: buy.strike,
        qty: buy.qty,
        entryTrade: buy,
        exitTrade,
        entryPrice: buy.price,
        exitPrice: exitTrade?.price,
        entryTime: buy.datetime || new Date(buy.timestamp).toLocaleTimeString(),
        exitTime: exitTrade ? (exitTrade.datetime || new Date(exitTrade.timestamp).toLocaleTimeString()) : undefined,
        durationMins,
        pnl: exitTrade?.pnl,
        pnlPercent: exitTrade?.pnl_percent,
        status: isClosed ? "CLOSED" : "OPEN",
        exitReason: exitTrade?.reasoning,
        exitType: exitTrade?.type
      });
    }

    // Filter Cycles by filterType and search query
    return pairs.filter(pair => {
      // 1. Filter Type
      if (filterType === "PROFIT" && (pair.pnl === undefined || pair.pnl <= 0)) return false;
      if (filterType === "LOSS" && (pair.pnl === undefined || pair.pnl >= 0)) return false;
      if (filterType === "CALL" && !pair.symbol.includes("CE") && !pair.entryTrade.type.includes("CALL")) return false;
      if (filterType === "PUT" && !pair.symbol.includes("PE") && !pair.entryTrade.type.includes("PUT")) return false;
      if (filterType === "EXIT" && !pair.exitTrade) return false;
      if (filterType === "BUY" && pair.status !== "OPEN") return false;

      // 2. Search Query (Symbol, Strike, Reasoning, IDs, Tier, Action)
      if (debouncedSearch && debouncedSearch.trim()) {
        const q = debouncedSearch.trim().toLowerCase().replace(/^#/, "");
        const matches = 
          pair.id.toLowerCase().includes(q) ||
          pair.symbol.toLowerCase().includes(q) ||
          (pair.strike && pair.strike.toString().toLowerCase().includes(q)) ||
          pair.tier.toLowerCase().includes(q) ||
          (pair.exitReason && pair.exitReason.toLowerCase().includes(q)) ||
          (pair.entryTrade.reasoning && pair.entryTrade.reasoning.toLowerCase().includes(q)) ||
          (pair.exitType && pair.exitType.toLowerCase().includes(q)) ||
          (pair.status && pair.status.toLowerCase().includes(q)) ||
          pair.entryTrade.id.toString().includes(q) ||
          (pair.exitTrade && pair.exitTrade.id.toString().includes(q));
        if (!matches) return false;
      }

      return true;
    });
  }, [paperTrades, tradeLinkages, selectedTier, selectedDate, filterType, debouncedSearch]);

  // Filter paper trades by Search, Type, Tier, and Date
  const filteredPaperTrades = useMemo(() => {
    return paperTrades.filter(trade => {
      // 1. Date filter (Default: Today)
      if (selectedDate !== "ALL") {
        const tradeDate = getIstDateString(trade.timestamp, trade.datetime);
        if (tradeDate !== selectedDate) return false;
      }

      // 2. Tier filter
      const tradeTier = trade.tier || "SNIPER";
      if (selectedTier !== "ALL" && tradeTier !== selectedTier) {
        return false;
      }

      // 3. Search query
      const q = searchQuery.toLowerCase();
      const matchesSearch = 
        (trade.reasoning && trade.reasoning.toLowerCase().includes(q)) ||
        (trade.symbol && trade.symbol.toLowerCase().includes(q)) ||
        (trade.strike && trade.strike.toLowerCase().includes(q)) ||
        (trade.type && trade.type.toLowerCase().includes(q)) ||
        (trade.tier && trade.tier.toLowerCase().includes(q));

      // 4. Type filter
      let matchesFilter = true;
      if (filterType === "PROFIT") matchesFilter = (trade.pnl || 0) > 0;
      else if (filterType === "LOSS") matchesFilter = (trade.pnl || 0) < 0;
      else if (filterType === "BUY") matchesFilter = trade.type.includes("BUY");
      else if (filterType === "EXIT") matchesFilter = trade.type.includes("EXIT") || trade.type === "SQUARE_OFF";
      else if (filterType === "CALL") matchesFilter = trade.type.includes("CALL") || (trade.symbol ? trade.symbol.includes("CE") : false);
      else if (filterType === "PUT") matchesFilter = trade.type.includes("PUT") || (trade.symbol ? trade.symbol.includes("PE") : false);

      return matchesSearch && matchesFilter;
    });
  }, [paperTrades, searchQuery, filterType, selectedTier, selectedDate]);

  // Filter advisory signals by Date, Search, and Type
  const filteredSignals = useMemo(() => {
    return signals.filter(sig => {
      // 1. Date filter
      if (selectedDate !== "ALL") {
        const sigDate = getIstDateString(sig.timestamp);
        if (sigDate !== selectedDate) return false;
      }

      // 2. Tier filter
      if (selectedTier !== "ALL" && (sig.tier || "SNIPER") !== selectedTier) {
        return false;
      }

      // 3. Search query
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
  }, [signals, searchQuery, filterType, selectedTier, selectedDate]);

  // Pagination States (Default: 10 items per page)
  const [tradesPage, setTradesPage] = useState<number>(1);
  const [tradesLimit, setTradesLimit] = useState<number>(10);

  const [cyclesPage, setCyclesPage] = useState<number>(1);
  const [cyclesLimit, setCyclesLimit] = useState<number>(10);

  const [signalsPage, setSignalsPage] = useState<number>(1);
  const [signalsLimit, setSignalsLimit] = useState<number>(10);

  const [sessionsPage, setSessionsPage] = useState<number>(1);
  const [sessionsLimit, setSessionsLimit] = useState<number>(10);

  const [settingsPage, setSettingsPage] = useState<number>(1);
  const [settingsLimit, setSettingsLimit] = useState<number>(10);

  // Dynamic DB-Level Search and Queries
  const [dbTrades, setDbTrades] = useState<PaperTrade[]>([]);
  const [dbTradesTotal, setDbTradesTotal] = useState<number>(0);
  const [isDbTradesLoading, setIsDbTradesLoading] = useState<boolean>(false);

  const [dbSignals, setDbSignals] = useState<DatabaseSignal[]>([]);
  const [dbSignalsTotal, setDbSignalsTotal] = useState<number>(0);
  const [isDbSignalsLoading, setIsDbSignalsLoading] = useState<boolean>(false);

  const [dbSessions, setDbSessions] = useState<DatabaseSession[]>([]);
  const [dbSessionsTotal, setDbSessionsTotal] = useState<number>(0);

  const [dbSettings, setDbSettings] = useState<DatabaseSetting[]>([]);
  const [dbSettingsTotal, setDbSettingsTotal] = useState<number>(0);

  // Fetch Trades directly from DB level
  const fetchDbTrades = useCallback(async () => {
    try {
      setIsDbTradesLoading(true);
      const params = new URLSearchParams({
        page: String(tradesPage),
        limit: String(tradesLimit),
        tier: selectedTier,
        date: selectedDate,
        filterType: filterType,
        search: debouncedSearch
      });
      const res = await fetch(`http://localhost:8080/api/database/trades?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setDbTrades(data.items || []);
        setDbTradesTotal(data.total || 0);
      }
    } catch (e) {
      console.error("Failed to query db trades:", e);
    } finally {
      setIsDbTradesLoading(false);
    }
  }, [tradesPage, tradesLimit, selectedTier, selectedDate, filterType, debouncedSearch]);

  useEffect(() => {
    fetchDbTrades();
  }, [fetchDbTrades]);

  // Fetch Signals directly from DB level
  const fetchDbSignals = useCallback(async () => {
    try {
      setIsDbSignalsLoading(true);
      const params = new URLSearchParams({
        page: String(signalsPage),
        limit: String(signalsLimit),
        tier: selectedTier,
        date: selectedDate,
        filterType: filterType,
        search: debouncedSearch
      });
      const res = await fetch(`http://localhost:8080/api/database/signals?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setDbSignals(data.items || []);
        setDbSignalsTotal(data.total || 0);
      }
    } catch (e) {
      console.error("Failed to query db signals:", e);
    } finally {
      setIsDbSignalsLoading(false);
    }
  }, [signalsPage, signalsLimit, selectedTier, selectedDate, filterType, debouncedSearch]);

  useEffect(() => {
    fetchDbSignals();
  }, [fetchDbSignals]);

  // Fetch Sessions directly from DB level
  const fetchDbSessions = useCallback(async () => {
    try {
      const res = await fetch(`http://localhost:8080/api/database/sessions?page=${sessionsPage}&limit=${sessionsLimit}`);
      if (res.ok) {
        const data = await res.json();
        setDbSessions(data.items || []);
        setDbSessionsTotal(data.total || 0);
      }
    } catch (e) {
      console.error("Failed to query db sessions:", e);
    }
  }, [sessionsPage, sessionsLimit]);

  useEffect(() => {
    fetchDbSessions();
  }, [fetchDbSessions]);

  // Fetch Settings directly from DB level
  const fetchDbSettings = useCallback(async () => {
    try {
      const res = await fetch(`http://localhost:8080/api/database/settings?page=${settingsPage}&limit=${settingsLimit}`);
      if (res.ok) {
        const data = await res.json();
        setDbSettings(data.items || []);
        setDbSettingsTotal(data.total || 0);
      }
    } catch (e) {
      console.error("Failed to query db settings:", e);
    }
  }, [settingsPage, settingsLimit]);

  useEffect(() => {
    fetchDbSettings();
  }, [fetchDbSettings]);

  // Reset page to 1 whenever filters change
  useEffect(() => {
    setTradesPage(1);
    setCyclesPage(1);
    setSignalsPage(1);
    setSessionsPage(1);
    setSettingsPage(1);
  }, [selectedDate, selectedTier, filterType, debouncedSearch, tradesViewMode]);

  // Paginated cycles slice for cycles view mode
  const paginatedCycles = useMemo(() => {
    const start = (cyclesPage - 1) * cyclesLimit;
    return roundTripPairs.slice(start, start + cyclesLimit);
  }, [roundTripPairs, cyclesPage, cyclesLimit]);

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
    const headers = ["Timestamp", "Type", "Tier", "Symbol", "Strike", "Qty", "Price", "StopLoss", "Target1", "Target2", "InvestedCapital", "PnL", "PnL_Percent", "Regime", "Reasoning"];
    const rows = filteredPaperTrades.map(t => [
      `"${t.datetime || new Date(t.timestamp).toLocaleString()}"`,
      t.type,
      t.tier || "SNIPER",
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
    link.setAttribute("download", `paper_trades_${selectedTier.toLowerCase()}_${new Date().toISOString().split("T")[0]}.csv`);
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
    if (type === "SQUARE_OFF") return "bg-indigo-500/15 border-indigo-500/30 text-indigo-300";
    return "bg-indigo-500/15 border-indigo-500/30 text-indigo-400";
  };

  const formatDateTimeSplit = (datetimeStr?: string, timestamp?: number) => {
    let datePart = "";
    let timePart = "";

    if (datetimeStr && datetimeStr.includes(",")) {
      const parts = datetimeStr.split(",");
      datePart = parts[0].trim();
      timePart = parts.slice(1).join(",").trim();
    } else {
      const d = timestamp && !isNaN(Number(timestamp)) ? new Date(Number(timestamp)) : (datetimeStr ? new Date(datetimeStr) : new Date());
      datePart = d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
      timePart = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
    }

    return (
      <div className="flex flex-col whitespace-nowrap leading-tight">
        <span className="font-semibold text-gray-200 text-[11px]">{datePart}</span>
        <span className="text-[10px] text-gray-400 font-mono mt-0.5">{timePart}</span>
      </div>
    );
  };

  const getTierBadge = (tier?: string) => {
    const t = tier || "SNIPER";
    if (t === "SNIPER") {
      return (
        <span 
          title="SNIPER Tier (Score ≥ 75%)" 
          className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-sm bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 shadow-sm shadow-emerald-500/10 cursor-help"
        >
          🎯
        </span>
      );
    }
    if (t === "BALANCED") {
      return (
        <span 
          title="BALANCED Tier (Score 60% - 74%)" 
          className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-sm bg-blue-500/15 border border-blue-500/30 text-blue-400 shadow-sm shadow-blue-500/10 cursor-help"
        >
          ⚖️
        </span>
      );
    }
    return (
      <span 
        title="EXPLORATORY Tier (Score < 60%)" 
        className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-sm bg-amber-500/15 border border-amber-500/30 text-amber-400 shadow-sm shadow-amber-500/10 cursor-help"
      >
        🔬
      </span>
    );
  };

  // Date & Tier aware dynamic analytics computation
  const computeAnalyticsFor = (tierFilter: "ALL" | "SNIPER" | "BALANCED" | "EXPLORATORY"): TradeAnalytics => {
    const closedExits = paperTrades.filter(t => {
      // Only count exit transactions (type NOT LIKE '%BUY%') to prevent double counting
      const isExit = !t.type.includes("BUY");
      if (!isExit || t.pnl === undefined || t.pnl === null) return false;
      if (tierFilter !== "ALL" && (t.tier || "SNIPER") !== tierFilter) return false;
      if (selectedDate !== "ALL") {
        const tradeDate = getIstDateString(t.timestamp, t.datetime);
        if (tradeDate !== selectedDate) return false;
      }
      return true;
    });

    const totalTrades = closedExits.length;
    let winningTrades = 0;
    let losingTrades = 0;
    let breakevenTrades = 0;
    let totalPnl = 0;
    let totalWinPnl = 0;
    let totalLossPnl = 0;
    let largestWin = 0;
    let largestLoss = 0;
    let target1Hits = 0;
    let target2Hits = 0;
    let callWins = 0;
    let totalCalls = 0;
    let putWins = 0;
    let totalPuts = 0;

    for (const t of closedExits) {
      const pnlVal = t.net_pnl !== undefined && t.net_pnl !== null ? t.net_pnl : (t.pnl || 0);
      totalPnl += pnlVal;

      const isCall = t.symbol.includes("CE") || t.type.includes("CALL");
      const isPut = t.symbol.includes("PE") || t.type.includes("PUT");
      if (isCall) totalCalls++;
      if (isPut) totalPuts++;

      if (pnlVal > 0) {
        winningTrades++;
        totalWinPnl += pnlVal;
        if (pnlVal > largestWin) largestWin = pnlVal;
        if (isCall) callWins++;
        if (isPut) putWins++;
        if (t.reasoning?.includes("Target 1") || t.type === "EXIT_PROFIT") target1Hits++;
        if (t.reasoning?.includes("Target 2")) target2Hits++;
      } else if (pnlVal < 0) {
        losingTrades++;
        totalLossPnl += Math.abs(pnlVal);
        if (Math.abs(pnlVal) > largestLoss) largestLoss = Math.abs(pnlVal);
      } else {
        breakevenTrades++;
      }
    }

    const winRatePercent = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const avgWin = winningTrades > 0 ? totalWinPnl / winningTrades : 0;
    const avgLoss = losingTrades > 0 ? totalLossPnl / losingTrades : 0;
    const profitFactor = totalLossPnl > 0 ? totalWinPnl / totalLossPnl : (totalWinPnl > 0 ? 99.9 : 0);

    return {
      tier: tierFilter,
      totalTrades,
      winningTrades,
      losingTrades,
      breakevenTrades,
      winRatePercent,
      totalPnl,
      profitFactor,
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      target1HitRate: totalTrades > 0 ? (target1Hits / totalTrades) * 100 : 0,
      target2HitRate: totalTrades > 0 ? (target2Hits / totalTrades) * 100 : 0,
      callWinRate: totalCalls > 0 ? (callWins / totalCalls) * 100 : 0,
      putWinRate: totalPuts > 0 ? (putWins / totalPuts) * 100 : 0,
      suggestedTargetMultiplier: 1.0,
      suggestedScoreBias: 0
    };
  };

  const dynamicAnalytics = useMemo(() => ({
    overall: computeAnalyticsFor("ALL"),
    sniper: computeAnalyticsFor("SNIPER"),
    balanced: computeAnalyticsFor("BALANCED"),
    exploratory: computeAnalyticsFor("EXPLORATORY")
  }), [paperTrades, selectedDate]);

  const activeAnalytics = useMemo(() => {
    if (selectedTier === "SNIPER") return dynamicAnalytics.sniper;
    if (selectedTier === "BALANCED") return dynamicAnalytics.balanced;
    if (selectedTier === "EXPLORATORY") return dynamicAnalytics.exploratory;
    return dynamicAnalytics.overall;
  }, [dynamicAnalytics, selectedTier]);

  const netPnl = activeAnalytics?.totalPnl || 0;
  const isNetProfit = netPnl >= 0;

  return (
    <div className="database-viewer flex flex-col gap-6 w-full pb-10">
      
      {/* 3-Tier Multi-Track Performance Comparison Bar */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-white/[0.04] via-white/[0.02] to-white/[0.04] border border-white/10 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-base">📊</span>
            <span className="text-xs font-bold text-white uppercase tracking-wider">3-Tier Multi-Track Strategy Engine</span>
            <span className="text-[11px] text-gray-400">— Real-time Paper Trading comparison by Confluence Score</span>
          </div>
          <div className="text-[11px] text-emerald-400 font-mono flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Independent Multi-Track Simulator Active
          </div>
        </div>

        {/* Tier Selector Buttons */}
        <div className="grid grid-cols-4 gap-3 pt-1">
          <button
            onClick={() => setSelectedTier("ALL")}
            className={`p-3 rounded-xl border transition-all text-left cursor-pointer flex flex-col justify-between ${
              selectedTier === "ALL"
                ? "bg-white/10 border-white/30 shadow-lg"
                : "bg-white/[0.02] border-white/5 hover:bg-white/5 text-gray-400 hover:text-white"
            }`}
          >
            <div className="flex justify-between items-center text-xs font-bold">
              <span>🌐 All Tiers Combined</span>
              <span className="text-[10px] text-gray-400 font-mono">{dynamicAnalytics.overall.totalTrades} Trades</span>
            </div>
            <div className="text-lg font-bold font-outfit text-white mt-1">
              {dynamicAnalytics.overall.winRatePercent ? `${dynamicAnalytics.overall.winRatePercent.toFixed(1)}%` : "0.0%"} WR
              <span className={`text-xs ml-2 font-mono ${dynamicAnalytics.overall.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {dynamicAnalytics.overall.totalPnl >= 0 ? "+" : ""}₹{dynamicAnalytics.overall.totalPnl.toFixed(2)}
              </span>
            </div>
          </button>

          <button
            onClick={() => setSelectedTier("SNIPER")}
            className={`p-3 rounded-xl border transition-all text-left cursor-pointer flex flex-col justify-between ${
              selectedTier === "SNIPER"
                ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-lg shadow-emerald-500/10"
                : "bg-white/[0.02] border-white/5 hover:bg-white/5 text-gray-400 hover:text-emerald-300"
            }`}
          >
            <div className="flex justify-between items-center text-xs font-bold">
              <span className="flex items-center gap-1.5">🎯 Sniper Mode (≥75%)</span>
              <span className="text-[10px] text-emerald-400 font-mono">{dynamicAnalytics.sniper.totalTrades} Trades</span>
            </div>
            <div className="text-lg font-bold font-outfit text-emerald-400 mt-1">
              {dynamicAnalytics.sniper.winRatePercent ? `${dynamicAnalytics.sniper.winRatePercent.toFixed(1)}%` : "0.0%"} WR
              <span className="text-xs ml-2 font-mono text-emerald-400">
                {dynamicAnalytics.sniper.totalPnl >= 0 ? "+" : ""}₹{dynamicAnalytics.sniper.totalPnl.toFixed(2)}
              </span>
            </div>
            <div className="text-[10px] text-emerald-400/70 mt-0.5">Official UI Alert Signals</div>
          </button>

          <button
            onClick={() => setSelectedTier("BALANCED")}
            className={`p-3 rounded-xl border transition-all text-left cursor-pointer flex flex-col justify-between ${
              selectedTier === "BALANCED"
                ? "bg-blue-500/15 border-blue-500/40 text-blue-300 shadow-lg shadow-blue-500/10"
                : "bg-white/[0.02] border-white/5 hover:bg-white/5 text-gray-400 hover:text-blue-300"
            }`}
          >
            <div className="flex justify-between items-center text-xs font-bold">
              <span className="flex items-center gap-1.5">⚖️ Balanced (60% - 74%)</span>
              <span className="text-[10px] text-blue-400 font-mono">{dynamicAnalytics.balanced.totalTrades} Trades</span>
            </div>
            <div className="text-lg font-bold font-outfit text-blue-400 mt-1">
              {dynamicAnalytics.balanced.winRatePercent ? `${dynamicAnalytics.balanced.winRatePercent.toFixed(1)}%` : "0.0%"} WR
              <span className={`text-xs ml-2 font-mono ${dynamicAnalytics.balanced.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {dynamicAnalytics.balanced.totalPnl >= 0 ? "+" : ""}₹{dynamicAnalytics.balanced.totalPnl.toFixed(2)}
              </span>
            </div>
            <div className="text-[10px] text-blue-400/70 mt-0.5">Background Paper Trades</div>
          </button>

          <button
            onClick={() => setSelectedTier("EXPLORATORY")}
            className={`p-3 rounded-xl border transition-all text-left cursor-pointer flex flex-col justify-between ${
              selectedTier === "EXPLORATORY"
                ? "bg-amber-500/15 border-amber-500/40 text-amber-300 shadow-lg shadow-amber-500/10"
                : "bg-white/[0.02] border-white/5 hover:bg-white/5 text-gray-400 hover:text-amber-300"
            }`}
          >
            <div className="flex justify-between items-center text-xs font-bold">
              <span className="flex items-center gap-1.5">⚡ Exploratory (&lt;60%)</span>
              <span className="text-[10px] text-amber-400 font-mono">{dynamicAnalytics.exploratory.totalTrades} Trades</span>
            </div>
            <div className="text-lg font-bold font-outfit text-amber-400 mt-1">
              {dynamicAnalytics.exploratory.winRatePercent ? `${dynamicAnalytics.exploratory.winRatePercent.toFixed(1)}%` : "0.0%"} WR
              <span className={`text-xs ml-2 font-mono ${dynamicAnalytics.exploratory.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {dynamicAnalytics.exploratory.totalPnl >= 0 ? "+" : ""}₹{dynamicAnalytics.exploratory.totalPnl.toFixed(2)}
              </span>
            </div>
            <div className="text-[10px] text-amber-400/70 mt-0.5">High-Risk Paper Trades</div>
          </button>
        </div>
      </div>
      
      {/* Top Header Overview & Adaptive Machine Learning Analytics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Card 1: Total PnL & Win Rate */}
        <div className="card p-4 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col items-center text-center justify-between">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg mb-2 shadow-inner ${isNetProfit ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" : "bg-rose-500/10 border border-rose-500/20 text-rose-400"}`}>
            {isNetProfit ? "📈" : "📉"}
          </div>
          <div>
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              {selectedTier === "ALL" ? "Combined" : selectedTier} Net Realized P&L
            </div>
            <div className={`text-2xl font-bold font-outfit mt-1 flex items-baseline justify-center gap-2 ${isNetProfit ? "text-emerald-400" : "text-rose-400"}`}>
              {isNetProfit ? `+₹${netPnl.toFixed(2)}` : `-₹${Math.abs(netPnl).toFixed(2)}`}
              <span className="text-xs font-semibold text-gray-400">
                ({activeAnalytics?.winningTrades || 0}W / {activeAnalytics?.losingTrades || 0}L)
              </span>
            </div>
          </div>
        </div>

        {/* Card 2: Win Rate & Profit Factor */}
        <div className="card p-4 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col items-center text-center justify-between">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-lg mb-2 shadow-inner">
            🎯
          </div>
          <div>
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              {selectedTier === "ALL" ? "Combined" : selectedTier} Win Rate
            </div>
            <div className="text-2xl font-bold font-outfit text-white mt-1 flex items-baseline justify-center gap-2">
              {activeAnalytics?.winRatePercent ? `${activeAnalytics.winRatePercent.toFixed(1)}%` : "0.0%"}
              <span className="text-xs font-semibold text-indigo-400">
                PF: {activeAnalytics?.profitFactor ? activeAnalytics.profitFactor.toFixed(2) : "1.00"}
              </span>
            </div>
          </div>
        </div>

        {/* Card 3: Adaptive Target Calibration AI */}
        <div className="card p-4 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col items-center text-center justify-between">
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400 text-lg mb-2 shadow-inner">
            🧠
          </div>
          <div>
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Target 1 & 2 Accuracy</div>
            <div className="text-xs font-bold font-outfit text-emerald-400 mt-1 flex items-center justify-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              T1 Hit: {activeAnalytics?.target1HitRate ? `${activeAnalytics.target1HitRate.toFixed(0)}%` : "--"} | T2 Hit: {activeAnalytics?.target2HitRate ? `${activeAnalytics.target2HitRate.toFixed(0)}%` : "--"}
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">
              Call Win: {activeAnalytics?.callWinRate ? `${activeAnalytics.callWinRate.toFixed(0)}%` : "--"} | Put Win: {activeAnalytics?.putWinRate ? `${activeAnalytics.putWinRate.toFixed(0)}%` : "--"}
            </div>
          </div>
        </div>

        {/* Card 4: Sync Status & Controls */}
        <div className="card p-4 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col items-center text-center justify-between">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 text-lg mb-2 shadow-inner">
            ⚡
          </div>
          <div className="w-full">
            <div className="flex justify-between items-center text-[11px] text-gray-400 font-semibold px-1">
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
      </div>

      {/* Main Database Table Container */}
      {/* Database Container */}
      <div className="card rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden shadow-2xl">
        
        {/* Row 1: Primary Navigation Bar & Date Deck */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3.5 border-b border-white/10 bg-white/[0.02]">
          
          {/* Left: Main Sub-Tab Segmented Control */}
          <div className="flex items-center gap-1 p-1 bg-black/40 border border-white/10 rounded-xl backdrop-blur-md">
            <button
              onClick={() => setActiveSubTab("trades")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeSubTab === "trades"
                  ? "bg-emerald-500 text-black shadow-md font-extrabold"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <span>💼</span> Trades
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${activeSubTab === "trades" ? "bg-black/20 text-black font-bold" : "bg-white/10 text-gray-300"}`}>
                {filteredPaperTrades.length}
              </span>
            </button>

            <button
              onClick={() => setActiveSubTab("signals")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeSubTab === "signals"
                  ? "bg-indigo-500 text-white shadow-md font-extrabold"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <span>📋</span> Signals
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${activeSubTab === "signals" ? "bg-white/20 text-white font-bold" : "bg-white/10 text-gray-300"}`}>
                {filteredSignals.length}
              </span>
            </button>
          </div>

          {/* Right: Date Session Switcher & Export */}
          <div className="flex items-center gap-3">
            {(activeSubTab === "trades" || activeSubTab === "signals") && (
              <div className="flex items-center gap-1.5 p-1 bg-black/40 border border-white/10 rounded-xl">
                <button
                  onClick={() => setSelectedDate(todayDateStr)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    selectedDate === todayDateStr
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  Today ({todayDateFormatted})
                </button>

                <button
                  onClick={() => setSelectedDate("ALL")}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    selectedDate === "ALL"
                      ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-sm"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  All Dates
                </button>

                {/* Custom Glass Calendar Picker */}
                <CustomCalendarPicker
                  selectedDate={selectedDate}
                  todayDateStr={todayDateStr}
                  onSelectDate={setSelectedDate}
                  activeTradeDates={activeTradeDates}
                />
              </div>
            )}

            {activeSubTab === "trades" && (
              <button
                onClick={handleExportTradesCSV}
                className="text-xs font-bold py-1.5 px-3.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <span>📥</span> CSV
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Secondary Command Bar (View Mode on Left, Search & Filter Dropdown on Right) */}
        {(activeSubTab === "trades" || activeSubTab === "signals") && (
          <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3 border-b border-white/10 bg-white/[0.01]">
            
            {/* Left: View Mode Toggle */}
            <div>
              {activeSubTab === "trades" && (
                <div className="flex items-center gap-1 p-0.5 bg-black/40 border border-white/10 rounded-lg">
                  <button
                    onClick={() => setTradesViewMode("ledger")}
                    className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      tradesViewMode === "ledger"
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    <span>📋</span> Ledger ({dbTradesTotal})
                  </button>
                  <button
                    onClick={() => setTradesViewMode("pairs")}
                    className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      tradesViewMode === "pairs"
                        ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shadow-sm"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    <span>🔄</span> Cycles ({roundTripPairs.length})
                  </button>
                </div>
              )}
            </div>

            {/* Right: Search Box & Custom Filter Dropdown */}
            <div className="flex items-center gap-3 flex-1 justify-end max-w-lg">
              
              {/* Search Box */}
              <div className="relative flex-1 max-w-xs flex items-center">
                <span className="absolute left-3 text-gray-500 text-xs">🔍</span>
                <input
                  type="text"
                  placeholder="Search strike, reason, symbol..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl pl-8 pr-7 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 text-gray-500 hover:text-white text-xs cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Custom Dark Filter Dropdown */}
              <CustomFilterDropdown
                value={filterType}
                onChange={setFilterType}
                options={activeSubTab === "trades" ? tradeFilterOptions : signalFilterOptions}
              />
            </div>
          </div>
        )}

        {/* 1. Paper Trades Tab Content */}
        {activeSubTab === "trades" && (
          <div>
            <div className="overflow-x-auto max-h-[580px] overflow-y-auto">
              {tradesViewMode === "pairs" ? (
                /* Round-Trip Trade Cycles View */
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/[0.02] text-[11px] font-semibold text-gray-400 uppercase tracking-wider sticky top-0 backdrop-blur-md z-10">
                      <th className="py-3 px-4">Cycle ID</th>
                      <th className="py-3 px-4">Tier</th>
                      <th className="py-3 px-4">Strike</th>
                      <th className="py-3 px-4">Qty</th>
                      <th className="py-3 px-4">Entry Leg</th>
                      <th className="py-3 px-4">Exit Leg</th>
                      <th className="py-3 px-4">Duration</th>
                      <th className="py-3 px-4">Pos. Status</th>
                      <th className="py-3 px-4">R. P&L</th>
                      <th className="py-3 px-4">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-xs font-outfit">
                    {paginatedCycles.length > 0 ? (
                      paginatedCycles.map((pair) => {
                        const isProfit = (pair.pnl || 0) >= 0;
                        return (
                          <tr key={pair.id} className="hover:bg-white/[0.03] transition-colors">
                            <td className="py-3.5 px-4 font-mono font-bold text-indigo-400 whitespace-nowrap">
                              {pair.id}
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              {getTierBadge(pair.tier)}
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <div className="font-bold text-white">{pair.strike ? `NIFTY ${pair.strike}` : pair.symbol}</div>
                              <div className="text-[10px] text-gray-400 font-mono">{pair.symbol}</div>
                            </td>
                            <td className="py-3.5 px-4 font-mono font-semibold text-gray-300">
                              {pair.qty}x
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <div className="font-bold text-emerald-400">₹{pair.entryPrice.toFixed(2)}</div>
                              <div className="text-[10px] text-gray-400 font-mono">#{pair.entryTrade.id} @ {pair.entryTime}</div>
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              {pair.exitTrade ? (
                                <div>
                                  <div className="font-bold text-white">₹{pair.exitPrice?.toFixed(2)}</div>
                                  <div className="text-[10px] text-cyan-400 font-mono flex items-center gap-1 mt-0.5">
                                    <span className={`px-1.5 py-0.2 rounded border text-[9px] font-bold ${getBadgeClass(pair.exitType || '')}`}>
                                      {pair.exitType}
                                    </span>
                                    <span>#{pair.exitTrade.id}</span>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-amber-400 italic">Holding Active</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 font-mono text-gray-300 whitespace-nowrap">
                              {pair.durationMins ? `${pair.durationMins} min${pair.durationMins > 1 ? 's' : ''}` : "Active"}
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              {pair.status === "OPEN" ? (
                                <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border bg-amber-500/15 border-amber-500/40 text-amber-300 animate-pulse">
                                  🟢 OPEN
                                </span>
                              ) : (
                                <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border bg-emerald-500/10 border-emerald-500/20 text-emerald-400">
                                  ✅ CLOSED
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              {pair.status === "OPEN" ? (
                                <span className="text-gray-500 italic">Running MTM</span>
                              ) : pair.pnl !== undefined ? (
                                <div className={`font-bold ${isProfit ? "text-emerald-400" : "text-rose-400"}`}>
                                  {isProfit ? `+₹${pair.pnl.toFixed(2)}` : `-₹${Math.abs(pair.pnl).toFixed(2)}`}
                                  {pair.pnlPercent !== undefined && (
                                    <span className="block text-[10px] font-normal">
                                      ({pair.pnlPercent >= 0 ? "+" : ""}{pair.pnlPercent.toFixed(1)}%)
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-gray-500">—</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-gray-400 font-sans text-[11.5px] max-w-xs leading-relaxed">
                              {pair.exitReason || "Active position monitoring real-time ticks."}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={10} className="py-16 text-center text-gray-500 text-sm font-sans">
                          No trade cycles matching filter criteria.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : (
                /* All Ledger Transactions View */
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/[0.02] text-[11px] font-semibold text-gray-400 uppercase tracking-wider sticky top-0 backdrop-blur-md z-10">
                      <th className="py-3 px-4"># ID</th>
                      <th className="py-3 px-4">Date & Time</th>
                      <th className="py-3 px-4">Tier</th>
                      <th className="py-3 px-4">Action</th>
                      <th className="py-3 px-4">Strike</th>
                      <th className="py-3 px-4">Qty</th>
                      <th className="py-3 px-4">Exec. Price</th>
                      <th className="py-3 px-4">S/L</th>
                      <th className="py-3 px-4">Targets</th>
                      <th className="py-3 px-4">Inv. Capital</th>
                      <th className="py-3 px-4">Pos. Status</th>
                      <th className="py-3 px-4">R. P&L</th>
                      <th className="py-3 px-4">Confluence</th>
                      <th className="py-3 px-4">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-xs font-outfit">
                    {dbTrades.length > 0 ? (
                      dbTrades.map((t) => {
                        const link = tradeLinkages.get(t.id);
                        const hasPnl = t.pnl !== undefined && t.pnl !== null;
                        const isExit = !t.type.includes("BUY");
                        const isOpen = t.status === "OPEN" || (!hasPnl && !isExit);
                        const isProfit = hasPnl && t.pnl! >= 0;

                        return (
                          <tr key={t.id} className="hover:bg-white/[0.03] transition-colors">
                            <td className="py-3 px-4 text-gray-500 font-mono">#{t.id}</td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              {formatDateTimeSplit(t.datetime, t.timestamp)}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              {getTierBadge(t.tier)}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              <div className="flex flex-col items-start gap-1">
                                <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${getBadgeClass(t.type)}`}>
                                  {t.type}
                                </span>
                                {isExit && (link?.pairedId || t.parent_trade_id) && (
                                  <span className="text-[9.5px] font-mono text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                                    <span>🔗</span> Closes Buy #{link?.pairedId || t.parent_trade_id}
                                  </span>
                                )}
                                {!isExit && link?.pairedId && (
                                  <span className="text-[9.5px] font-mono text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                                    <span>➜</span> Exited by #{link.pairedId}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              <div className="font-bold text-white">{t.strike ? `NIFTY ${t.strike}` : t.symbol}</div>
                              <div className="text-[10px] text-gray-400 font-mono">{t.symbol}</div>
                            </td>
                            <td className="py-3 px-4 font-mono font-semibold text-gray-300">
                              {t.qty}x
                            </td>
                            <td className="py-3 px-4 text-white font-bold whitespace-nowrap">
                              <div>₹{t.price.toFixed(2)}</div>
                              {isExit && (t.entry_price || link?.entryPrice) && (
                                <div className="text-[10px] text-gray-400 font-mono font-normal">
                                  Entry: ₹{(t.entry_price || link?.entryPrice)?.toFixed(2)}
                                </div>
                              )}
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
                              {isOpen ? (
                                <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border bg-amber-500/15 border-amber-500/40 text-amber-300 animate-pulse">
                                  🟢 OPEN
                                </span>
                              ) : (
                                <div className="flex flex-col items-start">
                                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border bg-white/5 border-white/10 text-gray-400">
                                    CLOSED
                                  </span>
                                  {isExit && (link?.pairedId || t.parent_trade_id) && (
                                    <span className="text-[9.5px] text-gray-500 font-mono mt-0.5">
                                      Round-Trip #{link?.pairedId || t.parent_trade_id}➜#{t.id}
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              {isOpen ? (
                                <span className="text-gray-500 italic">Position Open</span>
                              ) : hasPnl ? (
                                <div className={`font-bold ${isProfit ? "text-emerald-400" : "text-rose-400"}`}>
                                  {isProfit ? `+₹${t.pnl!.toFixed(2)}` : `-₹${Math.abs(t.pnl!).toFixed(2)}`}
                                  {t.pnl_percent !== undefined && t.pnl_percent !== null && (
                                    <span className="block text-[10px] font-normal">
                                      ({t.pnl_percent >= 0 ? "+" : ""}{t.pnl_percent.toFixed(1)}%)
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-gray-500">—</span>
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
                              {isExit && (link?.pairedId || t.parent_trade_id) && (
                                <div className="text-cyan-400 text-[10px] font-mono font-semibold mb-0.5">
                                  🔗 Closes Buy #{link?.pairedId || t.parent_trade_id} @ ₹{(t.entry_price || link?.entryPrice || 0).toFixed(2)}
                                </div>
                              )}
                              {t.reasoning || "--"}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={14} className="py-16 text-center text-gray-500 text-sm font-sans">
                          {isDbTradesLoading ? "Executing SQLite query..." : `No ${selectedTier !== "ALL" ? selectedTier : ""} paper trades matching search/filter in database.`}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination Controls */}
            {tradesViewMode === "pairs" ? (
              <ModernPagination
                currentPage={cyclesPage}
                totalRecords={roundTripPairs.length}
                pageSize={cyclesLimit}
                onPageChange={setCyclesPage}
                onPageSizeChange={setCyclesLimit}
              />
            ) : (
              <ModernPagination
                currentPage={tradesPage}
                totalRecords={dbTradesTotal}
                pageSize={tradesLimit}
                onPageChange={setTradesPage}
                onPageSizeChange={setTradesLimit}
              />
            )}
          </div>
        )}

        {/* 2. Signals Tab Content */}
        {activeSubTab === "signals" && (
          <div>
            <div className="overflow-x-auto max-h-[580px] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.02] text-[11px] font-semibold text-gray-400 uppercase tracking-wider sticky top-0 backdrop-blur-md z-10">
                    <th className="py-3 px-4"># ID</th>
                    <th className="py-3 px-4">Date & Time</th>
                    <th className="py-3 px-4">Tier</th>
                    <th className="py-3 px-4">Signal Type</th>
                    <th className="py-3 px-4">Strike</th>
                    <th className="py-3 px-4">Entry</th>
                    <th className="py-3 px-4">S/L</th>
                    <th className="py-3 px-4">T1</th>
                    <th className="py-3 px-4">T2</th>
                    <th className="py-3 px-4">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-xs font-outfit">
                  {dbSignals.length > 0 ? (
                    dbSignals.map((s) => (
                      <tr key={s.id} className="hover:bg-white/[0.03] transition-colors">
                        <td className="py-3 px-4 text-gray-500 font-mono">#{s.id}</td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {formatDateTimeSplit(undefined, s.timestamp)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {getTierBadge(s.tier)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${getBadgeClass(s.type)}`}>
                            {s.type}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-bold text-white whitespace-nowrap">
                          {s.strike_price ? `${s.strike_price}` : "--"}
                        </td>
                        <td className="py-3 px-4 text-white whitespace-nowrap">
                          {s.entry_price ? `₹${s.entry_price.toFixed(2)}` : "--"}
                        </td>
                        <td className="py-3 px-4 text-rose-400 font-semibold whitespace-nowrap">
                          {s.stop_loss_price ? `₹${s.stop_loss_price.toFixed(2)}` : "--"}
                        </td>
                        <td className="py-3 px-4 text-emerald-400 whitespace-nowrap">
                          {s.target_price1 ? `₹${s.target_price1.toFixed(2)}` : "--"}
                        </td>
                        <td className="py-3 px-4 text-emerald-400 whitespace-nowrap">
                          {s.target_price2 ? `₹${s.target_price2.toFixed(2)}` : "--"}
                        </td>
                        <td className="py-3 px-4 text-gray-400 font-sans text-[11.5px] max-w-sm leading-relaxed">
                          {s.reasoning || "--"}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={10} className="py-16 text-center text-gray-500 text-sm font-sans">
                        {isDbSignalsLoading ? "Executing SQLite query..." : `No ${selectedTier !== "ALL" ? selectedTier : ""} advisory signals matching search/filter in database.`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <ModernPagination
              currentPage={signalsPage}
              totalRecords={dbSignalsTotal}
              pageSize={signalsLimit}
              onPageChange={setSignalsPage}
              onPageSizeChange={setSignalsLimit}
            />
          </div>
        )}

        {/* 2. Signals Tab Content is closed above */}

      </div>
    </div>
  );
};
