# Nifty 50 Algorithmic Trading Desktop Terminal: Component & Process Architecture

An enterprise-grade, single-user algorithmic trading terminal for Nifty 50 Index Options (NSE FnO). Engineered with quantitative options physics, 8-factor confluence scoring, real-time live WebSocket tick streaming, sub-second Telegram push alerts, and direct-to-cloud Google Drive accounting.

---

## 1. Quantitative Options Calculations & Models

### Black-Scholes Greeks Risk Models
The analytical engine computes options Greeks in real-time to filter strikes and manage structural risks:
*   **Delta ($\Delta$):** Measures price sensitivity relative to a 1-point move in Nifty spot. The system filters for At-The-Money (ATM) contracts with Delta between $0.48 \text{ and } 0.55$.
*   **Gamma ($\Gamma$):** Monitors acceleration on Weekly Expiry Days (Thursdays).
*   **Theta ($\Theta$):** Models intraday time decay (~2.5%/hr). Exits positions if spot moves $< 0.15\%$ for longer than **12 minutes**.
*   **Vega & Implied Volatility ($IV$):** Restricts long options during high IV percentiles to prevent IV crush.

### Volatility Target Geometry (IV Cones)
Calculates expected daily moves using the formula:
$$\text{Expected Intraday Range} = \text{Spot Price} \times \frac{IV_{ATM}}{\sqrt{365}}$$
*   **Target 1 (Conservative Boundary):** Spot $\pm 0.5 \times \text{Expected Intraday Range}$.
*   **Target 2 (Volatile Boundary):** Spot $\pm 1.0 \times \text{Expected Intraday Range}$.

---

## 2. 8-Factor Confluence Scoring Matrix (0–100 Points)

Every trade setup is evaluated across 8 independent quantitative dimensions before any signal is generated:

```
[Raw Breakout Trigger (ORB 9:15 - 9:30 AM)]
                   │
                   ▼
┌────────────────────────────────────────────────────────┐
│             8-Factor Confluence Engine                 │
│                                                        │
│ 1. Market Structure (ORB Breakout + CPR Clear) [20 pts]│
│ 2. VWAP & Volume Acceleration (> 1.3x Avg Vol) [15 pts]│
│ 3. Heavyweight Alignment (HDFC + RIL + ICICI)  [15 pts]│
│ 4. Option Chain Structure (0.60 <= PCR <= 1.35)[15 pts]│
│ 5. Volatility Optimal Band (12 <= VIX <= 18)   [10 pts]│
│ 6. Market Regime Alignment (Trend vs Range)    [10 pts]│
│ 7. Option Premium RSI Momentum (52 < RSI < 78) [10 pts]│
│ 8. Risk-to-Reward Ratio (RR >= 1.50)           [ 5 pts]│
└────────────────────────────────────────────────────────┘
                   │
                   ▼
  Score >= 80 -> [SNIPER TIER] Official Signal Triggered!
```

*   **False Breakout Trap Filter:** Resets score to **0** if spot re-enters ORB or heavyweight momentum diverges 100%.
*   **Counter-Trend Penalty:** **-15 points** if moving against 50/200 EMA.
*   **Lunch Dead Zone (11:30 AM - 1:30 PM):** Hard block on all new trade entries.

---

## 3. Real-Time Telegram Alerts Subsystem

All official **SNIPER** trade alerts are delivered to your phone in **< 300ms** via IPv4 HTTPS sockets:
*   🎯 **Trade Entry**: Action (Call/Put), Strike, Entry Price, Stop Loss, Target 1, Target 2, Risk per Lot, Confluence Score.
*   🔒 **Breakeven Profit Lock**: Alert when Stop Loss is stepped up to Entry Price at +1R gain (Risk = ₹0.00).
*   💰 **Target Achieved / Exit**: Alert on Target 1/2 hit, Theta exit, or 3:15 PM mandatory square-off.

---

## 4. 100% Direct-to-Cloud Google Drive Accounting

Local `.csv` files have been completely eliminated. All trade transactions are streamed directly to your Google Drive:
*   **Dynamic Hierarchy**: Automatically creates `My Drive > Stock Mock > [Year] > [Month] > [Date Tab]`.
*   **Professional Formatting**: Frozen headers, dark slate theme, auto-filters across columns A–O, and custom column widths.
*   **Indian FnO Statutory Deductions**: Every trade deducts Brokerage (₹40 round-trip), STT (0.125%), Exchange Fee (0.0505%), GST (18%), and Stamp Duty (~₹54.60/lot).

---

## 5. System Execution Modes

| Mode | `AUTO_ORDER_EXECUTION` | Behavior |
| :--- | :---: | :--- |
| **Paper-Trading (Active)** | `false` | Real live market tick evaluation; 0 broker funds at risk. Google Sheets + Telegram active. |
| **Auto-Live Execution** | `true` | Routes orders directly to broker account upon SNIPER signal confirmation. |