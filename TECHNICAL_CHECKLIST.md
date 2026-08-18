# Technical Prerequisites & Dependencies Checklist

This document details the software stack selection, dependencies, and integration parameters for the Nifty 50 Algorithmic Trading Desktop Terminal.

---

## 1. Broker API Integration Evaluation

Evaluating the two most popular retail APIs in India for systematic trading: **Zerodha Kite Connect** vs. **Fyers API**.

| Parameter | Zerodha Kite Connect API | Fyers API v3 | Architect Recommendation |
| :--- | :--- | :--- | :--- |
| **Subscription Cost** | **₹2,000/month** for execution API + **₹2,000/month** for historical data API (Total: ₹4,000/month). | **Zero cost** (₹0/month) for both trading and historical access. | **Fyers API** for initial development and personal setups. |
| **API SDK & Language Support** | High-quality, stable official Node.js SDK (`kiteconnect`). | Node.js SDK available (`fyers-api-v3`), and fully supported for WebSockets. | **Zerodha** has a cleaner SDK design, but Fyers is highly usable. |
| **WebSocket Feed** | Custom binary protocol. Delivers lightweight ticks (LTP, volume, depth). Highly reliable under peak load. | Protobuf/JSON format. Streams ticks, depth, and order state updates dynamically. | Both support high-frequency option ticks. |
| **Rate Limits** | 3 requests/sec for order operations. 200 requests/minute for historical candles. | 10 requests/sec for orders. Flexible endpoints for historical requests. | **Fyers** offers slightly more relaxed throughput. |
| **Static IP Requirement** | Strictly enforced. Whitelisted IP must be registered in the Kite Developer console. | Strictly enforced for API apps. Egress calls must resolve to the whitelisted IP. | Both require static IP configuration for live trading. |
| **Session Lifecycle** | Daily auth token validation. Required to log in manually via browser redirect once per day. | Daily auth token validation. Access tokens are valid for 24 hours. | Identical flow. Daily login is mandatory at start of session. |

### Scalability Bridge: Broker Abstraction Interface
To support seamless scaling from the zero-cost Fyers API to Kite Connect, we require a Broker Abstraction Wrapper:
- [ ] Define the TypeScript interface `IBrokerAdapter` in `backend/adapters/IBrokerAdapter.ts`.
- [ ] Implement `FyersAdapter` implementing `IBrokerAdapter` utilizing the `fyers-api-v3` library.
- [ ] Implement `KiteAdapter` implementing `IBrokerAdapter` utilizing the `kiteconnect` library.
- [ ] Set up factory class `BrokerFactory` that reads `process.env.BROKER_PROVIDER` to return the active adapter.

---

## 2. Options Hedging & Targets Advisory Checklist

To enable hedged options targets (e.g. Bull Call Spread, Bear Put Spread, Iron Condor) on Nifty 50, the calculations module must handle strike calculations and target math:

- [ ] **Option Chain Parsing:**
  - [ ] Implement function to retrieve Nifty 50 option chain symbols and premiums based on current LTP.
  - [ ] Implement automated identification of active Weekly and Monthly contract expiries.
- [ ] **Strike Selection Logic:**
  - [ ] Implement strike rounding logic to identify At-The-Money (ATM) strike (rounded to nearest 50 points).
  - [ ] Implement strike offset selection ($ATM \pm 50$, $ATM \pm 100$, $ATM \pm 150$) for hedging/protection legs.
- [ ] **Targets & Stop Loss Generator:**
  - [ ] Implement mathematical calculator for ATR-based target boundaries (Target 1: $1.5 \times ATR$, Target 2: $3 \times ATR$).
  - [ ] Implement trailing stop-loss formula ($2 \times ATR$ trailing the swing high/low of index LTP).
  - [ ] Implement real-time comparisons: check index LTP against calculated targets every 100ms.
- [ ] **UI Manual Execution Advisor:**
  - [ ] Create UI panel displaying option recommendations (Strikes, Current Bid/Ask Premiums).
  - [ ] Build a checklist overlay on the UI displaying the SEBI margin-optimal manual sequence (e.g., "Step 1: Buy [Long Strike] -> Step 2: Sell [Short Strike]").
  - [ ] Implement persistent visual and audio alert triggers the millisecond a stop-loss or target boundary is crossed.

---

## 3. Quantitative Options Math & Physics Validation

Verify the mathematical modules executing inside the worker threads:

- [ ] **Black-Scholes Options Greeks Engine:**
  - [ ] Implement calculations for $d_1$, $d_2$, Cumulative Normal Distribution, and the subsequent option Greeks:
    *   Delta ($\Delta$): Confirm ATM options filter for $0.48 \le \Delta \le 0.55$.
    *   Gamma ($\Gamma$): Implement Expiry Day (Thursday) monitor to check for rate of delta acceleration.
    *   Theta ($\Theta$): Write 12-minute sideways consolidation timer (forces warning if spot changes $< 0.15\%$ in a 12-minute window).
    *   Vega / Implied Volatility ($IV$): Calculate the 30-day Implied Volatility Percentile ($IVP$). If $IVP > 75\%$, lock option buying recommendations and suggest credit spreads.
- [ ] **Intraday Range Volatility Cone:**
  - [ ] Implement expected daily range calculation: $\text{Spot} \times \frac{IV_{ATM}}{\sqrt{365}}$.
  - [ ] Render upper and lower target boundaries dynamically on the UI charts.
- [ ] **Open Interest (OI) Analyzer:**
  - [ ] Parse weekly option chain OI data from the broker client every 60 seconds.
  - [ ] Calculate the Change in OI from 9:15 AM to 9:30 AM to establish and draw intraday support and resistance horizontal lines.
  - [ ] Track aggregate Put OI vs. Call OI at ATM, ATM+50, and ATM-50 strikes. Trigger Crossover Alerts on trend shifts.
- [ ] **Put-Call Ratio (PCR) Monitor:**
  - [ ] Calculate PCR = $\frac{\text{Total Put OI}}{\text{Total Call OI}}$ every 60 seconds.
  - [ ] Halt Put buy recommendations if $PCR < 0.60$ (Bullish Reversal Alert).
  - [ ] Halt Call buy recommendations if $PCR > 1.35$ (Bearish Reversal Alert).
- [ ] **India VIX Momentum Correlation Filter:**
  - [ ] Track VIX movements alongside Nifty spot.
  - [ ] Implement inverse correlation confirmation for trend strength verification.
  - [ ] Implement dynamic ATR trailing stop adjustment (widening to $2.0 \times ATR$) when VIX spikes $> 8\%$.
- [ ] **Expiry Day Max Pain Strike Calculator:**
  - [ ] Implement Expiry Day (Thursday) loop calculating pain points across strikes.
  - [ ] Output Max Pain Strike magnetic lines on the dashboard.
- [ ] **Opening Range Breakout (ORB) Trigger:**
  - [ ] Log High and Low of Nifty 50 index spot for the first 5 and 15 minutes of the trading day.
  - [ ] Validate body-close breakout triggers against ORB bounds.
- [ ] **VWAP & Volume-Weighted Momentum Filter:**
  - [ ] Implement 3-minute interval VWAP equation.
  - [ ] Restrict Call targets to Spot > VWAP and 3-minute volume $> 2\times$ rolling 20-period volume moving average.
- [ ] **Nifty Heavyweights Directional Filter:**
  - [ ] Subscribe to live feeds of HDFC Bank, Reliance, and ICICI Bank.
  - [ ] Implement directional checks: block Call recommendations unless at least 2 of the top 3 heavyweights share the spot index trend.
- [ ] **Central Pivot Range (CPR) Calculator:**
  - [ ] Calculate daily Pivot, Bottom Central (BC), and Top Central (TC) levels.
  - [ ] Classify days as "Consolidation Day" (opens inside CPR) vs. "Trending Day" (opens outside CPR) to adjust active strategies.
- [ ] **Option Premium RSI Exhaustion Watcher:**
  - [ ] Calculate a 9-period RSI on the option premium prices.
  - [ ] Trigger profit-booking alerts if option premium 1-minute RSI $> 82$ and volume begins to decline.
- [ ] **Breakeven Profit Locker:**
  - [ ] Dynamically move active alert stop-losses to the exact entry price point when the option premium moves 1:1 risk-to-reward ratio in favor of the trade.
- [ ] **3:15 PM IST Hard Alarm:**
  - [ ] Initialize system clock monitor. Force warning screen/sound at exactly 15:15:00 IST.

---

## 4. Time-Series Storage Engine: DuckDB vs. SQLite

For a single-user local trading desktop, installing heavy database servers is unnecessary. We utilize a **hybrid embedded storage model**.

### Storage Checklist
- [ ] Install `better-sqlite3` (pre-compiled native addon, requires Electron rebuild).
- [ ] Install `@duckdb/duckdb-wasm` or native Node DuckDB bindings.
- [ ] Configure database schemas:
    - [ ] `sqlite`: `settings`, `sessions`, `advisory_signals`, `user_actions`.
    - [ ] `duckdb`: `nifty50_ticks`, `nifty50_1min_candles`, `nifty50_5min_candles`.
- [ ] Write a worker service that continuously flushes buffered ticks from RAM into DuckDB every 5 seconds.

---

## 5. Analysis Execution Vector: Deterministic Math vs. LLM MCP

The trading engine executes on a dual-path pipeline: deterministic indicators for risk/price action, and LLM reasoning for sentiment and context synthesis.

### Deterministic Calculation Engine
*   **Formulas to implement in JS/TS utility module:**
    *   $EMA_{20}$, $SMA_{50}$, $SMA_{200}$
    *   14-period RSI (Relative Strength Index)
    *   12, 26, 9 MACD (Moving Average Convergence Divergence)
    *   14-period ATR (Average True Range) for trailing risk bands

### Asynchronous LLM Engine (via Antigravity MCP)
*   **Model Selection:** **Gemini 2.5 Flash** (fast response, low cost) or **Gemini 1.5 Pro / Claude 3.5 Sonnet** (deep reasoning).
*   **Prompting Flow (at 09:15:05 AM):**
    *   Sends Nifty hourly candle sequence, pre-market gap size, and indicator data to LLM.
    *   Expects structured output (`{ bias: 'BUY' | 'SELL' | 'HOLD', reasoning: string }`).

### Calculation Vector Checklist
- [ ] Implement mathematical functions for EMA, RSI, and ATR in a dedicated utility module: [indicators.ts](file:///d:/Web-Development/My-Projects/stock-management-app/backend/utils/indicators.ts).
- [ ] Configure local MCP client in Node.js backend.
- [ ] Set up Gemini API Client with secure key validation.
- [ ] Design robust fallback logic: if the LLM request fails or timeouts (exceeding 3 seconds), default the 9:15 AM bias to `HOLD` (safety-first execution).
