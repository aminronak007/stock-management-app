# Nifty 50 Algorithmic Trading Desktop Terminal: Component & Process Architecture

An enterprise-grade, single-user algorithmic trading terminal for Nifty 50 Index Options (NSE FnO). Engineered with quantitative options physics, 10-factor confluence scoring, real-time live WebSocket tick streaming, sub-second Telegram push alerts, dynamic ATR breathing cushion, 50% partial profit booking + trend runner architecture, and direct-to-cloud Google Drive accounting.

---

## 1. Quantitative Options Calculations & Models

### Black-Scholes Greeks Risk Models
The analytical engine computes options Greeks in real-time to filter strikes and manage structural risks:
*   **Delta ($\Delta$):** Measures price sensitivity relative to a 1-point move in Nifty spot. The system filters for At-The-Money (ATM) and Near-ITM contracts with Delta between $0.46 \text{ and } 0.65$.
*   **Gamma ($\Gamma$):** Monitors acceleration on Weekly Expiry Days.
*   **Theta ($\Theta$):** Models intraday time decay (~2.5%/hr). Exits positions if spot consolidates without progress.
*   **Vega & Implied Volatility ($IV$):** Restricts long options during extreme IV percentiles to prevent IV crush.

### Volatility Target Geometry & Dynamic Trailing Cushion
Calculates expected moves using Nifty 14-period ATR and Option Delta:
$$\text{Base SL} = \text{clamp}(6.0, 14.0, 1.2 \times \text{ATR} \times \Delta)$$
$$\text{Target 1} = \text{Entry} + (\text{Base SL} \times 1.25 \times \text{TargetMultiplier})$$
$$\text{Target 2} = \text{Entry} + (\text{Base SL} \times 2.50 \times \text{TargetMultiplier})$$
$$\text{MinBreathingRoom} = \max(8.0, \min(15.0, 1.2 \times \text{ATR} \times \Delta))$$

---

## 2. 10-Factor Confluence Scoring Matrix (0–100 Points)

Every trade setup is evaluated across 10 independent quantitative dimensions before any signal is generated:

```
[Raw Trigger (ORB / VWAP Pullback / Mean Reversion)]
                   │
                   ▼
┌────────────────────────────────────────────────────────┐
│            10-Factor Confluence Engine                 │
│                                                        │
│ 1. Market Structure (ORB Breakout + CPR Clear) [20 pts]│
│ 2. VWAP & Volume Acceleration (> 1.3x Avg Vol) [15 pts]│
│ 3. Heavyweight Alignment (HDFC + RIL + ICICI)  [15 pts]│
│ 4. Option Chain Structure (0.60 <= PCR <= 1.35)[15 pts]│
│ 5. Volatility Optimal Band (12 <= VIX <= 18)   [10 pts]│
│ 6. Market Regime Alignment (Trend vs Range)    [10 pts]│
│ 7. Option Premium RSI Momentum (52 < RSI < 78) [10 pts]│
│ 8. GIFT Nifty International Sentiment          [ 5 pts]│
│ 9. Risk-to-Reward Ratio (RR >= 1.50)           [ 5 pts]│
│ 10. Autonomous Gemini AI Risk Officer Gate     [Audit] │
└────────────────────────────────────────────────────────┘
                   │
                   ▼
  Score >= 75 -> [SNIPER TIER] Official Signal Triggered!
```

*   **False Breakout Trap Filter:** Resets score to **0** if spot re-enters ORB or heavyweight momentum diverges 100%.
*   **Counter-Trend Penalty:** **-15 points** if moving against 50/200 EMA.
*   **Adaptive Midday Lunch Filter:** Pauses standard setups between 11:45 AM and 1:15 PM unless score is $\ge 88/100$ with volume expansion.

---

## 3. Position Management & Trend Runner Architecture

1. **50% Partial Booking:** Upon reaching Target 1 (+1.25R), 50% of the lot is booked at market.
2. **Trend Runner Mode:** Stop Loss on the remaining 50% runner moves to Cost (Entry + ₹1.00) and trails at 50% of peak expansion while respecting the dynamic ATR breathing cushion.
3. **Smart Cooldown:** 2-minute cooldown on green exits allows high-conviction continuation re-entry.
4. **Post-Exit Intelligence Tracker:** Measures Maximum Favorable Excursion (MFE) across 120 minutes post-exit.

---

## 4. Real-Time Telegram Alerts Subsystem

All official **SNIPER** trade alerts are delivered to your phone in **< 300ms** via IPv4 HTTPS sockets:
*   🎯 **Trade Entry**: Action (Call/Put), Strike, Entry Price, Stop Loss, Target 1, Target 2, Risk per Lot, Confluence Score.
*   💰 **Target 1 Achieved**: Alert on 50% lot booked + Runner activated.
*   🚀 **Runner Updates**: Real-time high-watermark trailing stop advancements.
*   🔒 **Target 2 / Exit**: Alert on full target completion, theta timeout, or square-off.

---

## 5. Direct-to-Cloud Google Drive Accounting

Local `.csv` files have been completely eliminated. All trade transactions are streamed directly to your Google Drive:
*   **Dynamic Hierarchy**: Automatically creates `My Drive > Stock Mock > [Year] > [Month] > [Date Tab]`.
*   **Professional Formatting**: Frozen headers, dark slate theme, auto-filters, and custom column widths.
*   **Indian FnO Statutory Deductions**: Every trade deducts Brokerage (₹40 round-trip), STT (0.125%), Exchange Fee (0.0505%), GST (18%), and Stamp Duty (~₹54.60/lot).

---

## 6. System Execution Modes

| Mode | `AUTO_ORDER_EXECUTION` | Behavior |
| :--- | :---: | :--- |
| **Paper-Trading (Active)** | `false` | Real live market tick evaluation; 0 broker funds at risk. Google Sheets + Telegram active. |
| **Auto-Live Execution** | `true` | Routes orders directly to broker account upon SNIPER signal confirmation. |