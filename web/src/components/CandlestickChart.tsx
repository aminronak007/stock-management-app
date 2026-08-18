import React, { useEffect, useRef, useState } from "react";

interface CandlestickChartProps {
  activeSymbol: string;
  currentPrice: number;
}

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Calculate EMA values across complete historical array
function calculateEMAValues(prices: number[], period: number): number[] {
  const ema: number[] = [];
  if (prices.length < period) return Array(prices.length).fill(0);
  
  const k = 2 / (period + 1);
  
  // First EMA is simple SMA
  let sum = 0;
  for (let i = 0; i < period; i++) sum += prices[i];
  let prevEma = sum / period;
  
  for (let i = 0; i < period - 1; i++) {
    ema.push(0);
  }
  ema.push(prevEma);
  
  for (let i = period; i < prices.length; i++) {
    const curEma = prices[i] * k + prevEma * (1 - k);
    ema.push(curEma);
    prevEma = curEma;
  }
  return ema;
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  activeSymbol,
  currentPrice
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [resolution, setResolution] = useState("5"); // default to 5-minute bars
  const [visibleCount, setVisibleCount] = useState(45); // zoom level (how many candles to show)
  const [offset, setOffset] = useState(0); // drag offset scroll index
  const [hoveredCandle, setHoveredCandle] = useState<Candle | null>(null);
  const [hoveredEma50, setHoveredEma50] = useState<number | null>(null);
  const [hoveredEma200, setHoveredEma200] = useState<number | null>(null);
  const [mouseCoords, setMouseCoords] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);

  // Fetch real historical candles from Fyers API
  useEffect(() => {
    let isSubscribed = true;
    const fetchHistory = async () => {
      try {
        const res = await fetch(`http://localhost:8080/api/history?symbol=${activeSymbol}&resolution=${resolution}`);
        if (!res.ok) throw new Error("History fetch failed");
        const data = await res.json();
        
        if (data && data.length > 0 && isSubscribed) {
          setCandles(data.map((c: any) => ({
            timestamp: c.timestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume || 0
          })));
          setOffset(0); // reset offset on timeframe/symbol shift
        }
      } catch (err) {
        console.warn("[CandlestickChart] Failed to load real history. Using local mock generator.", err);
        if (!isSubscribed) return;
        
        // Mock fallback if offline or no session key
        const mockCandles: Candle[] = [];
        let startPrice = activeSymbol.includes("NIFTY") ? 24350 : activeSymbol.includes("SENSEX") ? 78000 : 1100;
        let time = Date.now() - 100 * 5 * 60 * 1000;
        for (let i = 0; i < 120; i++) {
          const change = (Math.random() - 0.49) * (startPrice * 0.001);
          const open = startPrice;
          const close = startPrice + change;
          const high = Math.max(open, close) + Math.random() * (startPrice * 0.0003);
          const low = Math.min(open, close) - Math.random() * (startPrice * 0.0003);
          
          mockCandles.push({
            timestamp: time,
            open,
            high,
            low,
            close,
            volume: Math.floor(Math.random() * 80000) + 10000
          });
          startPrice = close;
          time += 5 * 60 * 1000;
        }
        setCandles(mockCandles);
        setOffset(0);
      }
    };
    fetchHistory();
    return () => { isSubscribed = false; };
  }, [activeSymbol, resolution]);

  // Update last candle with live price tick
  useEffect(() => {
    if (candles.length === 0 || currentPrice === 0) return;
    
    setCandles(prev => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      last.close = currentPrice;
      last.high = Math.max(last.high, currentPrice);
      last.low = Math.min(last.low, currentPrice);
      return copy;
    });
  }, [currentPrice]);

  // Scroll wheel zoom handler
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setVisibleCount(prev => {
      const change = e.deltaY > 0 ? 3 : -3;
      const next = prev + change;
      return Math.max(15, Math.min(180, next));
    });
  };

  // Mouse drag pan handler
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    setDragStartX(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || candles.length === 0) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const paddingLeft = 40;
    const paddingRight = 70;
    const chartWidth = canvas.width - paddingLeft - paddingRight;

    // Handle Drag / Panning offsets
    if (isDragging) {
      const deltaX = e.clientX - dragStartX;
      const step = chartWidth / visibleCount;
      const shift = Math.round(deltaX / step);
      if (shift !== 0) {
        setOffset(prev => Math.max(0, Math.min(candles.length - visibleCount, prev - shift)));
        setDragStartX(e.clientX);
      }
      return;
    }

    // Detect hovered candle indexes for Tooltip / HUD update
    if (x >= paddingLeft && x <= canvas.width - paddingRight) {
      const endIdx = candles.length - offset;
      const startIdx = Math.max(0, endIdx - visibleCount);
      const visibleCandles = candles.slice(startIdx, endIdx);

      const step = chartWidth / visibleCandles.length;
      const relativeX = x - paddingLeft;
      const idx = Math.floor(relativeX / step);

      if (idx >= 0 && idx < visibleCandles.length) {
        // Calculate EMAs to display live hover overlay values
        const allCloses = candles.map(c => c.close);
        const ema50Values = calculateEMAValues(allCloses, 50);
        const ema200Values = calculateEMAValues(allCloses, 200);

        const realIndex = startIdx + idx;
        setHoveredCandle(visibleCandles[idx]);
        setHoveredEma50(ema50Values[realIndex] || 0);
        setHoveredEma200(ema200Values[realIndex] || 0);
        setMouseCoords({ x, y });
        return;
      }
    }
    setMouseCoords(null);
    setHoveredCandle(null);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
    setMouseCoords(null);
    setHoveredCandle(null);
  };

  // Render chart canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const container = canvas.parentElement;
      if (!container) return;
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight || 350;
      draw();
    };

    const draw = () => {
      if (candles.length === 0) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const paddingTop = 30;
      const paddingBottom = 30;
      const paddingLeft = 40;
      const paddingRight = 70;
      const chartHeight = canvas.height - paddingTop - paddingBottom;
      const chartWidth = canvas.width - paddingLeft - paddingRight;

      // Slice the viewport window based on offset scroll position
      const endIdx = candles.length - offset;
      const startIdx = Math.max(0, endIdx - visibleCount);
      const visibleCandles = candles.slice(startIdx, endIdx);
      
      const prices = visibleCandles.flatMap(c => [c.low, c.high]);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const priceRange = maxPrice - minPrice || 1;

      const candleWidth = chartWidth / visibleCandles.length - 3;

      // 1. Draw Grid Lines & Y-Axis Prices
      ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
      ctx.lineWidth = 1;
      ctx.fillStyle = "#9ca3af";
      ctx.font = "10px Inter";
      ctx.textAlign = "center";

      for (let i = 0; i <= 4; i++) {
        const y = paddingTop + (chartHeight / 4) * i;
        ctx.beginPath();
        ctx.moveTo(paddingLeft, y);
        ctx.lineTo(canvas.width - paddingRight, y);
        ctx.stroke();

        const priceLabel = maxPrice - (priceRange / 4) * i;
        ctx.fillText(
          priceLabel.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
          canvas.width - 36,
          y + 3
        );
      }

      // 2. Draw Bottom Volume Bars (TradingView-style transparent bars at bottom 15%)
      const maxVol = Math.max(...visibleCandles.map(c => c.volume), 1);
      visibleCandles.forEach((candle, idx) => {
        const step = chartWidth / visibleCandles.length;
        const x = paddingLeft + idx * step + 1.5;
        const volHeight = (candle.volume / maxVol) * (chartHeight * 0.15); // scaled to 15% height
        const volY = paddingTop + chartHeight - volHeight;

        ctx.fillStyle = candle.close >= candle.open ? "rgba(16, 185, 129, 0.12)" : "rgba(244, 63, 94, 0.12)";
        ctx.fillRect(x, volY, candleWidth, volHeight);
      });

      // 3. Draw Candlesticks
      visibleCandles.forEach((candle, idx) => {
        const step = chartWidth / visibleCandles.length;
        const x = paddingLeft + idx * step + 1.5;

        const yOpen = paddingTop + chartHeight * (1 - (candle.open - minPrice) / priceRange);
        const yClose = paddingTop + chartHeight * (1 - (candle.close - minPrice) / priceRange);
        const yHigh = paddingTop + chartHeight * (1 - (candle.high - minPrice) / priceRange);
        const yLow = paddingTop + chartHeight * (1 - (candle.low - minPrice) / priceRange);

        const isBullish = candle.close >= candle.open;
        const candleColor = isBullish ? "#10b981" : "#f43f5e";

        // Draw wicks
        ctx.strokeStyle = candleColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + candleWidth / 2, yHigh);
        ctx.lineTo(x + candleWidth / 2, yLow);
        ctx.stroke();

        // Draw body
        ctx.fillStyle = candleColor;
        const bodyHeight = Math.max(Math.abs(yClose - yOpen), 1.5);
        const bodyY = Math.min(yOpen, yClose);
        ctx.fillRect(x, bodyY, candleWidth, bodyHeight);
      });

      // 4. Draw Indicators Overlay: EMA 50 (Indigo) and EMA 200 (Orange)
      const allCloses = candles.map(c => c.close);
      const ema50List = calculateEMAValues(allCloses, 50).slice(startIdx, endIdx);
      const ema200List = calculateEMAValues(allCloses, 200).slice(startIdx, endIdx);

      // Draw EMA 50 line
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = "#6366f1"; // Indigo
      ctx.beginPath();
      ema50List.forEach((val, idx) => {
        if (val === 0) return;
        const step = chartWidth / visibleCandles.length;
        const x = paddingLeft + idx * step + candleWidth / 2;
        const y = paddingTop + chartHeight * (1 - (val - minPrice) / priceRange);
        if (idx === 0 || ema50List[idx - 1] === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Draw EMA 200 line
      ctx.strokeStyle = "#f59e0b"; // Orange/Amber
      ctx.beginPath();
      ema200List.forEach((val, idx) => {
        if (val === 0) return;
        const step = chartWidth / visibleCandles.length;
        const x = paddingLeft + idx * step + candleWidth / 2;
        const y = paddingTop + chartHeight * (1 - (val - minPrice) / priceRange);
        if (idx === 0 || ema200List[idx - 1] === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // 5. Draw X-Axis Time Labels
      ctx.fillStyle = "#6b7280";
      ctx.textAlign = "center";
      const dateStep = Math.max(Math.floor(visibleCandles.length / 5), 1);
      
      visibleCandles.forEach((candle, idx) => {
        if (idx % dateStep === 0) {
          const step = chartWidth / visibleCandles.length;
          const x = paddingLeft + idx * step + candleWidth / 2;
          
          const timeStr = new Date(candle.timestamp).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
          });
          const dayStr = new Date(candle.timestamp).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric"
          });
          
          const label = resolution === "D" ? dayStr : timeStr;
          ctx.fillText(label, x, canvas.height - paddingBottom + 16);
        }
      });

      // 6. Draw Realtime LTP (Last Traded Price) Horizontal Tracking line
      const lastCandle = candles[candles.length - 1];
      if (lastCandle && offset === 0) {
        const ltpY = paddingTop + chartHeight * (1 - (lastCandle.close - minPrice) / priceRange);
        if (ltpY >= paddingTop && ltpY <= paddingTop + chartHeight) {
          ctx.save();
          ctx.strokeStyle = "rgba(99, 102, 241, 0.4)";
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(paddingLeft, ltpY);
          ctx.lineTo(canvas.width - paddingRight, ltpY);
          ctx.stroke();
          
          // Current price tag bubble (Indigo)
          ctx.fillStyle = "rgba(99, 102, 241, 1)";
          ctx.fillRect(canvas.width - 68, ltpY - 8, 64, 16);
          ctx.fillStyle = "white";
          ctx.font = "bold 9px Inter";
          ctx.textAlign = "center";
          ctx.fillText(lastCandle.close.toFixed(1), canvas.width - 36, ltpY + 3);
          ctx.restore();
        }
      }

      // 7. Draw Hover Crosshairs & axis tag bubbles
      if (hoveredCandle && mouseCoords) {
        const step = chartWidth / visibleCandles.length;
        const visibleIdx = visibleCandles.findIndex(c => c.timestamp === hoveredCandle.timestamp);
        if (visibleIdx === -1) return;

        const candleCenterX = paddingLeft + visibleIdx * step + candleWidth / 2;
        const mousePrice = maxPrice - ((mouseCoords.y - paddingTop) / chartHeight) * priceRange;

        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;

        // Vertical line tracking candle center
        ctx.beginPath();
        ctx.moveTo(candleCenterX, paddingTop);
        ctx.lineTo(candleCenterX, canvas.height - paddingBottom);
        ctx.stroke();

        // Horizontal line tracking y cursor
        ctx.beginPath();
        ctx.moveTo(paddingLeft, mouseCoords.y);
        ctx.lineTo(canvas.width - paddingRight, mouseCoords.y);
        ctx.stroke();
        ctx.restore();

        // Cursor price label (gray shadow box)
        ctx.fillStyle = "rgba(43, 45, 57, 0.95)";
        ctx.fillRect(canvas.width - 68, mouseCoords.y - 8, 64, 16);
        ctx.fillStyle = "white";
        ctx.font = "bold 9px Inter";
        ctx.textAlign = "center";
        ctx.fillText(mousePrice.toFixed(1), canvas.width - 36, mouseCoords.y + 3);

        // Cursor time label
        const bubbleTimeStr = new Date(hoveredCandle.timestamp).toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        });
        const bubbleDateStr = new Date(hoveredCandle.timestamp).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric"
        });
        const bubbleLabel = resolution === "D" ? bubbleDateStr : `${bubbleDateStr} ${bubbleTimeStr}`;
        ctx.fillStyle = "rgba(43, 45, 57, 0.95)";
        ctx.fillRect(candleCenterX - 45, canvas.height - paddingBottom + 4, 90, 16);
        ctx.fillStyle = "white";
        ctx.font = "bold 9px Inter";
        ctx.textAlign = "center";
        ctx.fillText(bubbleLabel, candleCenterX, canvas.height - paddingBottom + 15);
      }
    };

    window.addEventListener("resize", resize);
    resize();

    return () => window.removeEventListener("resize", resize);
  }, [candles, visibleCount, offset, hoveredCandle, mouseCoords, isDragging]);

  const cleanSymbolName = activeSymbol.split(":")[1] || activeSymbol;

  // Active HUD values
  const hudCandle = hoveredCandle || (candles.length > 0 ? candles[candles.length - 1] : null);
  
  const hudO = hudCandle ? hudCandle.open.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "--";
  const hudH = hudCandle ? hudCandle.high.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "--";
  const hudL = hudCandle ? hudCandle.low.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "--";
  const hudC = hudCandle ? hudCandle.close.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "--";
  const hudV = hudCandle ? hudCandle.volume.toLocaleString("en-IN") : "--";
  
  // EMA values for current HUD readout
  const activeEma50 = hoveredCandle ? hoveredEma50 : (candles.length > 0 ? calculateEMAValues(candles.map(c => c.close), 50).slice(-1)[0] : 0);
  const activeEma200 = hoveredCandle ? hoveredEma200 : (candles.length > 0 ? calculateEMAValues(candles.map(c => c.close), 200).slice(-1)[0] : 0);

  const isHudBullish = hudCandle ? hudCandle.close >= hudCandle.open : true;
  const hudColor = isHudBullish ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]";

  return (
    <div className="card chart-card flex-1">
      <div className="card-header flex justify-between items-center mb-1 pb-2.5 border-b border-white/5">
        <div className="flex flex-col gap-0.5">
          <h3 className="font-outfit text-sm font-semibold tracking-wider uppercase">
            {cleanSymbolName} <span className="text-xs text-[var(--color-text-secondary)] font-normal ml-2">{resolution === "D" ? "1-Day" : resolution === "60" ? "1-Hour" : `${resolution}-Min`} Interval</span>
          </h3>
          
          {/* Detailed Moneycontrol-style Readout Grid */}
          {hudCandle && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono mt-1 select-none">
              <span>O <strong className={hudColor}>{hudO}</strong></span>
              <span>H <strong className={hudColor}>{hudH}</strong></span>
              <span>L <strong className={hudColor}>{hudL}</strong></span>
              <span>C <strong className={hudColor}>{hudC}</strong></span>
              <span>V <strong className="text-gray-400">{hudV}</strong></span>
              
              {/* EMA overlay values */}
              {activeEma50 !== null && activeEma50 > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 font-semibold border border-indigo-500/20">
                  EMA(50): {activeEma50.toFixed(1)}
                </span>
              )}
              {activeEma200 !== null && activeEma200 > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 font-semibold border border-amber-500/20">
                  EMA(200): {activeEma200.toFixed(1)}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="chart-timeframes flex gap-1 bg-black/20 p-0.5 rounded-lg self-start">
          <button onClick={() => setResolution("1")} className={`time-btn text-[10px] font-medium px-2.5 py-0.5 rounded transition-all ${resolution === "1" ? "bg-white/10 text-white font-semibold" : "text-[var(--color-text-secondary)] hover:text-white"}`}>1m</button>
          <button onClick={() => setResolution("5")} className={`time-btn text-[10px] font-medium px-2.5 py-0.5 rounded transition-all ${resolution === "5" ? "bg-white/10 text-white font-semibold" : "text-[var(--color-text-secondary)] hover:text-white"}`}>5m</button>
          <button onClick={() => setResolution("15")} className={`time-btn text-[10px] font-medium px-2.5 py-0.5 rounded transition-all ${resolution === "15" ? "bg-white/10 text-white font-semibold" : "text-[var(--color-text-secondary)] hover:text-white"}`}>15m</button>
          <button onClick={() => setResolution("60")} className={`time-btn text-[10px] font-medium px-2.5 py-0.5 rounded transition-all ${resolution === "60" ? "bg-white/10 text-white font-semibold" : "text-[var(--color-text-secondary)] hover:text-white"}`}>1h</button>
          <button onClick={() => setResolution("D")} className={`time-btn text-[10px] font-medium px-2.5 py-0.5 rounded transition-all ${resolution === "D" ? "bg-white/10 text-white font-semibold" : "text-[var(--color-text-secondary)] hover:text-white"}`}>Daily (Lifetime)</button>
        </div>
      </div>
      <div className="canvas-container flex-1 w-full relative min-h-[350px] overflow-hidden">
        <canvas
          ref={canvasRef}
          id="candlestick-chart"
          className="w-full h-full min-h-[350px] cursor-grab active:cursor-grabbing"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        ></canvas>
      </div>
    </div>
  );
};
