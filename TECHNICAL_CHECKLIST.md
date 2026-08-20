# Technical Prerequisites & Dependencies Checklist

This document details the software architecture, dependency specifications, and completed feature validation for the Nifty 50 Algorithmic Trading Desktop Terminal.

---

## 1. Broker API Integration & Abstraction Layer
- [x] **Broker Abstraction Interface (`IBrokerAdapter`)**: Unified interface for market ticks, historical data, option chains, order placement, and WebSocket subscriptions.
- [x] **Fyers API v3 Integration (`FyersAdapter`)**: Zero-cost market data, historical 5-minute candles, and live Protobuf/JSON WebSocket streaming.
- [x] **Broker Factory (`BrokerFactory`)**: Reads `BROKER_PROVIDER=FYERS` to dynamically instantiate the active broker adapter.
- [x] **Dynamic Option Tick Subscription**: Active ATM option contracts (`NSE:NIFTY...`) are dynamically subscribed to live WebSocket streams upon signal entry and unsubscribed on exit.

---

## 2. Quantitative Options Engine & Greeks
- [x] **Black-Scholes-Merton Engine (`Greeks`)**: Exact mathematical calculations for $d_1$, $d_2$, Cumulative Normal Distribution, $\Delta$, $\Theta$, $\Gamma$, $\text{Vega}$, and Intraday Expected Range Cones.
- [x] **ATM Strike Selection**: Dynamic strike rounding to nearest 50 points based on live Spot price.
- [x] **Central Pivot Range (`CPR`)**: Frank Ochoa Pivot, Bottom Central (BC), Top Central (TC), classical Support ($S_1-S_3$), and Resistance ($R_1-R_3$).
- [x] **Technical Indicator Library (`Indicators`)**:
  - [x] 14-period Wilder's Average True Range (ATR).
  - [x] 14-period Relative Strength Index (RSI) computed from 5m candles.
  - [x] Exponential Moving Averages (EMA 50, EMA 200).
  - [x] Volume-Weighted Average Price (VWAP).

---

## 3. Confluence Scoring & Signal Gatekeeping
- [x] **8-Factor Confluence Engine (`QuantitativeEngine`)**:
  - Market Structure (20 pts): Spot breakout of ORB bounds + CPR clearance.
  - VWAP & Momentum (15 pts): Spot alignment + Volume spike $> 1.3\times$ avg volume.
  - Heavyweight Confirmation (15 pts): Reliance, HDFC Bank, and ICICI Bank intraday trend alignment.
  - Options Structure & PCR (15 pts): Put-Call Ratio boundaries ($0.60 \le PCR \le 1.35$) and OI buildup.
  - Volatility Bands (10 pts): India VIX optimal trading band ($12 \le \text{VIX} \le 18$) and ATR $> 8$ pts.
  - Market Regime Alignment (10 pts): Trend vs Breakout classification.
  - Option Premium RSI (10 pts): Momentum acceleration check ($52 < RSI < 78$).
  - Risk / Reward Ratio (5 pts): $RR \ge 1.50$.
- [x] **Anti-Trap Penalties**:
  - False Breakout Trap Filter: Resets score to **0 (NO_TRADE)** if price re-enters ORB or heavyweights diverge 100%.
  - Counter-Trend Penalty: **-15 points** if trading against 50/200 EMA.
  - Lunch Dead Zone: Hard blocks signal generation between **11:30 AM and 1:30 PM IST**.

---

## 4. Execution & Risk Safeguards
- [x] **3-Tier Execution Framework**:
  - **SNIPER (Score $\ge 80$)**: Official signals with UI audio alerts, Telegram push notifications, and Google Sheets cloud logging.
  - **BALANCED (Score 60–74)**: Background paper trading for statistical validation.
  - **EXPLORATORY (Score 45–59)**: Aggressive experimental paper trading.
- [x] **Breakeven Profit Locker**: Moves Stop Loss to Entry Price when position reaches **+1R gain** (Risk = ₹0.00).
- [x] **Target 1 Trailing Step-up**: Trailing stop advances to secure +0.5R profit upon crossing Target 1.
- [x] **Theta Decay Bailout**: Force-exits position if sideways chop lasts **> 12 minutes**.
- [x] **Daily Loss Circuit Breaker**: Trading halts after **-2.0R** cumulative loss to prevent revenge trading.
- [x] **Universal 3:15 PM IST Hard Square-Off**: Automatic position liquidation before market close.

---

## 5. Cloud Sync, Accounting & Real-Time Alerts
- [x] **Direct-to-Cloud Google Sheets Logging (`GoogleSheetsService`)**:
  - Dynamic folder creation: `My Drive > Stock Mock > [Year] > [Month] > [Date Tab]`.
  - Dark header styling, frozen row 1, auto-filters across columns A–O, and custom column widths.
  - 100% removal of local CSV files and disk folders.
- [x] **Real-Time Telegram Push Alerts (`TelegramService`)**:
  - Instant sub-300ms trade delivery via IPv4 HTTPS socket.
  - High-priority push notifications for Entry, Breakeven Lock, Target Hit, and Square-Off.
- [x] **Statutory FnO Taxation Model (`ExcelLogger`)**:
  - Automatic deduction of Brokerage (₹40 round-trip), STT (0.125%), Exchange Fee (0.0505%), GST (18%), Stamp Duty, and SEBI charges (~₹54.60/lot).
- [x] **Walk-Forward Backtesting Engine (`Backtester`)**:
  - Mathematical Sharpe and Sortino ratios computed from statistical return series ($\sigma_R, \sigma_d$).
  - Monte Carlo 1,000-path ruin simulation.
