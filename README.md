# Nifty 50 Algorithmic Trading Desktop Terminal: Component & Process Architecture

This document outlines the high-performance architectural design of the internal, single-user algorithmic trading desktop terminal. The terminal is engineered as an **advisory and analytical system** that streams Nifty 50 index data, computes indicators, and outputs real-time entry/exit price targets and option hedge strike recommendations for manual trading.

---

## 1. Quantitative Options Calculations & Models

Unlike spot index trading, options are dynamic, decaying instruments sensitive to time, volatility, and price acceleration. The background compute workers implement the following quantitative physics.

### Black-Scholes Greeks Risk Models
The analytical engine computes options Greeks in real-time to filter strikes and flag structural decay risks:
*   **Delta ($\Delta$):** Measures price sensitivity relative to a 1-point move in Nifty spot.
    *   *System Rule:* For high-probability morning momentum buying, the system filters option chains to suggest exclusively At-The-Money (ATM) contracts with a Delta range between $0.48 \text{ and } 0.55$.
*   **Gamma ($\Gamma$):** Measures the rate of change of Delta.
    *   *System Rule:* On Weekly Expiry Days (Thursdays), the engine monitors Gamma acceleration. A spike in Gamma at breakout points triggers high-priority momentum buy alerts for near-the-money options.
*   **Theta ($\Theta$):** The rate of time-decay of option premiums.
    *   *System Rule (12-Min Consolidation Exit):* If a Nifty spot entry enters a consolidation pattern (defined as a squeeze where Bollinger Bands narrow and spot moves less than $0.15\%$ for longer than 12 minutes), the background worker outputs a prominent "Theta Risk Exit" alert to protect premium capital.
*   **Vega & Implied Volatility ($IV$):** Measures pricing sensitivity to volatility shifts.
    *   *System Rule (IV Percentile Cap):* The system computes a rolling 30-day Implied Volatility Percentile ($IVP$). If $IVP > 75\%$, the engine locks buying advisory signals to prevent "IV Crush" (premium deflation) and shifts recommendations exclusively to hedged credit spreads (writing spreads). If $IVP < 30\%$, it recommends debit spreads (buying spreads).

### Target-Setting Volatility Geometry (IV Cones)
Rather than placing arbitrary target levels, the engine calculates volatility-adjusted cones using the daily India VIX or ATM option implied volatility ($IV_{ATM}$):
$$\text{Expected Intraday Range} = \text{Nifty Spot Price} \times \frac{IV_{ATM}}{\sqrt{365}}$$
*   **Target 1 (Conservative Boundary):** Calculated as Nifty Spot $\pm 0.5 \times \text{Expected Intraday Range}$.
*   **Target 2 (Volatile Boundary):** Calculated as Nifty Spot $\pm 1.0 \times \text{Expected Intraday Range}$.

### Expiry Day Max Pain Strike Analysis (Exhaustion Pivot)
*   **Max Pain Theory:** On Weekly/Monthly Expiry Days (Thursdays), the underlying index price historically tends to gravitate toward the strike price where option buyers stand to lose the maximum premium value (and option writers incur the minimum pain).
*   **Execution:** Every 60 seconds on Expiry Day, the compute worker recalculates the cumulative loss at each strike across the option chain. The **Max Pain Strike** is plotted on the UI as a magnetic price zone. As 02:00 PM IST approaches, breakouts away from this strike are treated with low confidence unless accompanied by significant heavyweight stock volume.

---

## 2. Live Option Chain & Correlative Data Analytics

The background data worker scrapes or streams NSE Nifty Option Chain data, India VIX indices, and heavyweight stocks.

### Open Interest (OI) Accumulation & Multi-Strike Crossovers
*   **Support/Resistance Lines:** Established by tracking the strike experiencing the largest positive change in Call/Put Open Interest between **09:15 AM and 09:30 AM**.
*   **Multi-Strike OI Crossover:** The engine tracks the aggregate Put OI vs. Call OI at the ATM, ATM+50, and ATM-50 strikes. When Put OI crosses above Call OI, the system flags a **Bullish Trend Shift** (short-sellers covering Call positions and writing Puts).

### Put-Call Ratio (PCR) Boundaries
Derived as $\text{Total Put OI} / \text{Total Call OI}$:
*   **Extreme Oversold ($PCR < 0.60$):** Signals downside exhaustion. Halts Put buying targets; prepares bullish reversal alerts.
*   **Extreme Overbought ($PCR > 1.35$):** Signals upside exhaustion. Halts Call buying targets; prepares bearish reversal alerts.

### India VIX Correlation Check (Volatility Momentum)
*   **Inverse Correlation Rule:** Typically, Nifty and India VIX are inversely correlated (VIX rises when Nifty falls).
*   **System Action:** If Nifty is falling and VIX spikes $>5\%$ intraday, the downward trend is confirmed with high institutional conviction, and Put buying signals are unlocked. If Nifty breaks out upwards but VIX spikes $>8\%$, it flags a "High-Fear Rally" and widens the trailing stop-loss multiplier from $1.5\times$ to $2.0 \times ATR$ to prevent early stops due to volatility swings.

---

## 3. High-Probability Execution Techniques (The Trade Entry)

The terminal computes entry triggers using combined price action, volume anchors, and index weight filters:

```
[Market Open 09:15 IST] ──► [Track First 5/15 Min Range (ORB)]
                                    │
       ┌────────────────────────────┴────────────────────────────┐
       ▼                                                         ▼
[Close Above ORB High]                                 [Close Below ORB Low]
  - Filter: Spot > VWAP                                  - Filter: Spot < VWAP
  - Filter: Volume > 2x Moving Avg                       - Filter: Volume > 2x Moving Avg
  - Filter: Heavyweight Correlation                      - Filter: Heavyweight Correlation
       │                                                         │
       ▼                                                         ▼
[Output Call Option Target]                            [Output Put Option Target]
```

1.  **Opening Range Breakout (ORB):** First 5-minute or 15-minute candle breakout.
2.  **VWAP & Volume-Weighted Momentum Mapping:** 3-minute interval VWAP filter.
3.  **Central Pivot Range (CPR) Filter:** Calculates CPR bounds to flag consolidation vs. trending days.
4.  **Nifty Heavyweight Momentum Filter (False Breakout Protection):**
    *   Nifty 50 is a cap-weighted index dominated by HDFC Bank (~11%), Reliance Industries (~9.5%), and ICICI Bank (~7.5%).
    *   *System Rule:* When Nifty spot triggers an ORB breakout, the compute worker evaluates the 3-minute trend of the top 3 heavyweights. A Call buy recommendation is **blocked** unless at least 2 of the top 3 heavyweight stocks share a positive intraday trend (LTP > VWAP), preventing false breakout traps.

---

## 4. Algorithmic Risk Management & Exit Mechanics

The terminal provides real-time trailing metrics to protect capital:
*   **ATR Trailing Stop-Loss:** Sets initial stop at $1.5 \times ATR$ below the entry trigger (5-min chart), trailing the spot.
*   **Breakeven Profit Locker:** Moves active alerts stop-loss to the exact entry price point (risk-free) once option premium gains reach a 1:1 risk-to-reward ratio.
*   **Option Premium RSI Exhaustion (Exit Booster):**
    *   *Mechanism:* The engine calculates a 9-period RSI on the *option premium* price itself (not the index spot).
    *   *System Rule:* If the option premium's 1-minute RSI shoots above $82$ during a momentum spike and volume begins to decline relative to the previous 3 candles, the system flashes a "Profit Booking Target reached (Overbought Premium)" alert to protect gains before instant mean reversion.
*   **Universal Time Square-Off Alert:** Hard alarm at **03:15 PM IST** to warn user to close positions.

---

## 5. Unified Broker Abstraction Layer (Kite/Fyers Scalability)

To enable a zero-cost model initially with the flexibility to scale to Zerodha Kite Connect, the backend implements a **Broker Adapter Pattern** focused on market data, option chains, and historical sequences.

```
                    ┌─────────────────────────┐
                    │  Strategy Engine (Core) │
                    └────────────┬────────────┘
                                 │ Uses
                                 ▼
                     ┌───────────────────────┐
                     │   «IBrokerAdapter»    │
                     └───────────┬───────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
     ┌───────────────────────┐       ┌───────────────────────┐
     │     FyersAdapter      │       │     KiteAdapter       │
     │   (Zero-Cost SDK)     │       │   (Kite Connect API)  │
     └───────────────────────┘       └───────────────────────┘
```
#   s t o c k - m a n a g e m e n t - a p p  
 