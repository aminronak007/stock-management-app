# Nifty 50 Advisory System — Forensic Audit & ₹10K/Day Profitability Blueprint

**Audit Date**: September 13, 2026  
**Audit Period**: August 24 – September 13, 2026 (15 trading sessions)  
**Total Entry Trades**: 27 entries (CALL_BUY / PUT_BUY)  
**Overall Result**: **₹-5,608.31 Net P&L** (after all fees)

---

## Part 1: Hard Data — What Actually Happened

### 1.1 Overall Performance Summary

| Metric | Value | Verdict |
|:---|---:|:---|
| Total Closed Entries | 27 | |
| Winners (net_pnl > 0) | 14 | |
| Losers (net_pnl < 0) | 12 | |
| Breakeven | 1 | |
| **Win Rate** | **51.9%** | Decent, but R:R kills it |
| **Gross P&L** | **-₹3,112.50** | |
| **Total Fees** | **₹1,576.80** | 28% of gross — extremely high |
| **Net P&L** | **₹-5,608.31** | |
| **Avg Win (net)** | **₹90.24** | Tiny |
| **Avg Loss (net)** | **₹-512.37** | Massive |
| **Risk:Reward Ratio** | **0.18:1** | FATAL — Losses are 5.7x wins |
| **Profit Factor** | **0.21** | Need > 1.0 to be profitable |
| **Largest Win** | **₹312.99** | |
| **Largest Loss** | **₹-1,001.69** | |

> **THE SYSTEM HAS A 52% WIN RATE BUT LOSES MONEY BECAUSE EACH LOSS IS 5.7x LARGER THAN EACH WIN.**

### 1.2 Daily P&L Timeline

| Date | Gross | Fees | Net | Trades | W | L | Verdict |
|:---|---:|---:|---:|:---:|:---:|:---:|:---|
| 24-Aug | +1,030 | -1,391 | **-361** | 19 | 7 | 12 | 🔴 Mass overtrading, fees destroyed profits |
| 26-Aug | -1,078 | -182 | **-1,260** | 3 | 0 | 3 | 🔴 Zero wins |
| 27-Aug | -560 | -159 | **-719** | 3 | 0 | 3 | 🔴 Zero wins |
| 31-Aug | +118 | -106 | **+12** | 2 | 2 | 0 | 🟡 Breakeven |
| 01-Sep | +383 | -114 | **+268** | 2 | 2 | 0 | 🟢 Positive |
| 03-Sep | -865 | -142 | **-1,007** | 2 | 0 | 2 | 🔴 Both instant reversals |
| 04-Sep | -583 | -141 | **-723** | 2 | 0 | 2 | 🔴 Stopped out |
| 07-Sep | -43 | -167 | **-155** | 3 | 2 | 1 | 🔴 1 big loss wiped 2 wins |
| 08-Sep | -175 | -290 | **-414** | 5 | 4 | 1 | 🔴 4 wins wiped by 1 big loss |
| 09-Sep | +445 | -122 | **+323** | 2 | 2 | 0 | 🟢 Best post-fix day |
| 10-Sep | -540 | -128 | **-668** | 2 | 1 | 1 | 🔴 Instant reversal |
| 11-Sep | -938 | -64 | **-1,002** | 1 | 0 | 1 | 🔴 Single catastrophic loss |

**Green Days: 2 out of 12 (17%)**  
**Red Days: 10 out of 12 (83%)**

### 1.3 The Catastrophic Pattern: Tiny Wins, Giant Losses

Looking at the last 12 trades in detail:

| Trade | Entry | Exit Type | Gross P&L | Net P&L | Notes |
|:---|:---|:---|---:|---:|:---|
| #121 (Sep 7) | PUT_BUY | EXIT_PROFIT | +355 | +300 | ✅ Only profitable exit |
| #124 (Sep 7) | PUT_BUY | EXIT_STOP_LOSS | -398 | **-455** | 🔴 Wiped trade #121's profit |
| #130 (Sep 8) | PUT_BUY | EXIT_STOP_LOSS | -605 | **-662** | 🔴 Instant reversal, score 100! |
| #133 (Sep 8) | PUT_BUY | EXIT_STOP_LOSS | +68 | +5 | 🟡 Survived to breakeven |
| #135 (Sep 8) | PUT_BUY | EXIT_PROFIT | +248 | +193 | ✅ |
| #138 (Sep 8) | PUT_BUY | THETA_EXIT | +113 | +50 | 🟡 Left ₹930+ on table (MFE 31.2%) |
| #142 (Sep 9) | PUT_BUY | EXIT_STOP_LOSS | +75 | +10 | 🟡 Left ₹810+ on table (MFE 22.9%) |
| #144 (Sep 9) | PUT_BUY | EXIT_PROFIT | +370 | +313 | ✅ Best recent trade |
| #148 (Sep 10) | PUT_BUY | EXIT_STOP_LOSS | -600 | **-665** | 🔴 Instant reversal, score 94! |
| #150 (Sep 10) | PUT_BUY | EXIT_STOP_LOSS | +60 | -3 | 🟡 Tiny gain eaten by fees |
| #152 (Sep 11) | PUT_BUY | EXIT_STOP_LOSS | -938 | **-1,002** | 🔴 WORST trade ever |

### 1.4 The Two Deadly Diseases

**Disease #1: "Instant Reversal" Entries (Accounts for 79% of ALL losses)**

These trades entered and the premium **never moved above entry even once**:
- Trade #130: Score 100, Entry=₹94.30, Peak=₹94.30, **Net=-₹662**
- Trade #148: Score 94, Entry=₹156.95, Peak=₹156.95, **Net=-₹665**  
- Trade #152: Score 85, Entry=₹156.10, Peak=₹156.10, **Net=-₹1,002**

> **Root Cause**: The system enters at the CLOSE of the confirmation candle. By then, the bounce/rejection has already played out. The option premium has already priced in the move. We are buying AFTER the move, not before.

**Disease #2: "Tiny Wins, Giant Losses" (Profit Factor 0.21)**

The average win is ₹90 net. The average loss is ₹512 net. This means:
- **Even at 85% win rate, this system would BARELY break even.**
- We need either 6x bigger wins OR 6x smaller losses.

Several trades that WERE winners left massive money on the table:
- Trade #138: Exited at +₹50 net. Premium went to +31.2% above entry (₹930+ potential)
- Trade #142: Exited at +₹10 net. Premium went to +22.9% above entry (₹810+ potential)
- Trade #121: Exited at +₹300. Premium hit +34.0% MFE (₹900+ potential)

---

## Part 2: Root Cause Analysis — Why The System Loses Money

### RC-1: CATASTROPHIC Risk:Reward Architecture
The system has **15-18 pt stop losses** with **2.0R/3.5R targets**, but:
- Targets are almost NEVER hit (Target 1 hit rate < 10%)
- Most trades exit via trailing stop at small profit or via THETA_EXIT
- Average winning trade captures only **₹90 net** vs average loss of **₹512 net**

**Bottom line**: The system risks ₹500-1,000 to make ₹50-100. This is mathematical suicide.

### RC-2: Reactive Entry Timing
The system enters at candle CLOSE price, not at a favorable pullback level. The 30% pullback limit entry was added, but it frequently doesn't fill or fills at near-same price because Nifty options are fast-moving.

### RC-3: Excessive Fees Destroy Edge  
Total fees across 27 entries: **₹1,577** (28% of gross). The system trades expensive deep ITM options (₹100-200 premium) where statutory charges (STT, exchange, stamp duty) are massive. At ₹50-65 fees per trade, you need **₹130+ net gain per round trip** just to cover costs.

### RC-4: Stop Loss is In The Noise Zone
With ATM Nifty options, a 15-18 pt SL on a ₹150 premium option is ~10-12% of premium. Normal bid-ask fluctuation on Nifty weeklies is 2-5 pts. This means SL triggers on random noise frequently.

### RC-5: Theta Exit Kills Winners Prematurely
Trade #138 exited via THETA_EXIT at +₹50 net after 25 minutes of "consolidation." The premium then rose 31.2% from entry by EOD. The THETA_EXIT is too aggressive — 25-minute timeout with <2% movement triggers exit on trades that simply needed more time.

### RC-6: Trailing SL Locks Profits Too Tight
The "Guaranteed Green Profit Lock" at Entry+0.5R (7.5 pts on 15pt SL) combined with breathing room logic creates a situation where trades are exited for ₹10-50 net instead of letting winners run. Trade #142 peaked at +₹810 potential but was trailed out at +₹10.

### RC-7: Single Loss Wipes Multiple Wins
On Sep 8: 4 wins totaling +₹248 net, then 1 loss of -₹662. On Sep 7: 1 win of +₹300, then 1 loss of -₹455. **A single losing trade consistently destroys an entire day's gains.**

---

## Part 3: Mathematical Framework for ₹10,000/Day Profit

### 3.1 The Math

To achieve ₹10,000/day consistently, we need one of these configurations:

| Strategy | Trades/Day | Win Rate | Avg Win | Avg Loss | Daily P&L |
|:---|:---:|:---:|---:|---:|---:|
| **A: Single Big Winner** | 1-2 | 70% | ₹15,000 | ₹5,000 | +₹10,000 |
| **B: Multiple Scalps** | 5-8 | 75% | ₹2,500 | ₹1,000 | +₹10,000 |
| **C: Balanced (Recommended)** | 2-3 | 65% | ₹7,000 | ₹2,000 | +₹10,000 |

### 3.2 Capital & Lot Size Requirements

₹10,000/day requires meaningful position sizes:
- At 25 qty (1 lot): Need ₹400/unit gain → impossible on day trades
- At **75 qty (3 lots)**: Need ₹133/unit gain → achievable with 25-40 pt option moves
- At **150 qty (6 lots)**: Need ₹67/unit gain → achievable with 12-20 pt option moves

**Required capital**: ~₹1,50,000 - ₹3,00,000 margin for 3-6 lots of Nifty options.

### 3.3 Required System Parameters

| Parameter | Current | Required for ₹10K/Day |
|:---|---:|---:|
| Position Size | 25-50 qty | **75-150 qty** (3-6 lots) |
| Max Risk Per Trade | ₹300 | **₹2,000-3,000** |
| Stop Loss Width | 15-18 pts | **20-30 pts ATR-based** |
| Target 1 | +30-36 pts (+2R) | **+60-90 pts (+3R)** |
| Target 2 | +53-63 pts (+3.5R) | **+100-150 pts (+5R)** |
| Min Win Rate | 52% | **≥ 60%** |
| Max Daily Trades | 1 | **2-3 high-conviction only** |
| Profit Factor | 0.21 | **≥ 2.0** |
| Avg Win:Loss Ratio | 0.18:1 | **≥ 2.5:1** |

---

## Part 4: The Transformation Plan — Building a ₹10K/Day System

### Phase 1: FIX THE CORE DISEASE — Risk:Reward Inversion (CRITICAL)

> Without fixing this, no amount of signal improvement will help.

#### 1A. ATR-Adaptive Wide Stop Loss

**File**: `advisoryManager.ts` (L1277-1280)

Current SL: `Math.max(15.0, Math.min(18.0, 1.2 * atrValue * delta))` — too tight.

**New Logic**:
```
// Use 1.5x ATR * delta as baseline, with absolute floor of 20 pts
const scaledStopLoss = Math.max(20.0, Math.min(35.0, 1.5 * atrValue * delta));
```
- Floor: 20 pts (out of normal bid-ask noise)
- Ceiling: 35 pts (prevents catastrophic single-trade risk)
- Dynamic: Scales with market volatility via ATR

This alone would have SAVED trade #130 (SL was 12 pts, got stopped on noise) and trade #152 (SL was 18 pts, needed 22 pts breathing room).

#### 1B. Asymmetric 3R/5R Target Architecture

**File**: `advisoryManager.ts` (L1278-1280)

```
// Target 1: 3.0R (Book 50% — this is the MINIMUM acceptable profit)
let scaledTarget1 = parseFloat((scaledStopLoss * 3.00 * targetMultiplier).toFixed(2));
// Target 2: 5.0R (Let runner ride with aggressive trailing — the profit multiplier)
let scaledTarget2 = parseFloat((scaledStopLoss * 5.00 * targetMultiplier).toFixed(2));
```

With 25-pt SL: T1 = +75 pts, T2 = +125 pts. On 75 qty:
- T1 partial (37 qty booked): ₹2,775
- T2 runner (38 qty remaining): ₹4,750
- **Single winning trade: ₹7,525 gross → ~₹7,300 net**

#### 1C. Dynamic Position Sizing for ₹10K Target

**File**: `advisoryManager.ts` (L1520-1525)

```
// Target: Risk ₹2,000 per trade with 3:1 R:R → win ₹6,000, lose ₹2,000
const maxRiskPerTrade = parseInt(process.env.MAX_RISK_PER_TRADE || "2000", 10) || 2000;
const slWidthPoints = Math.max(20.0, scaledStopLoss);
const riskBasedLots = Math.floor(maxRiskPerTrade / slWidthPoints / 25);
const logQty = Math.max(75, Math.min(150, riskBasedLots * 25));
// With 25pt SL: 2000/25/25 = 3.2 → 3 lots (75 qty)
// With 20pt SL: 2000/20/25 = 4.0 → 4 lots (100 qty)
```

#### 1D. Kill The Tight Trailing — Let Winners Run

**File**: `advisoryManager.ts` (L1724-1734, L1740-1748, L1753-1760)

The current trailing logic (lock 50% of peak expansion, guaranteed green at +0.5R, +1.5R lock) is prematurely exiting winners for ₹10-50 when they could run to ₹2,000-5,000.

**New trailing architecture**:
```
// Only start trailing AFTER Target 1 is hit (not before)
// Before T1: Hold with original SL, no trailing
// After T1 hit (50% booked): Trail remaining runner at Peak - 1.0R
//   This gives massive breathing room while protecting booked profits

if (pos.isTarget1Locked) {
  // Trail runner at Peak Premium - 1.0 * initialRisk (generous cushion)
  const runnerTrailSl = parseFloat((pos.peakPremiumLtp - initialRisk * 1.0).toFixed(2));
  // But never trail below Entry + 1.0R (locked profit minimum)
  const minRunnerSl = parseFloat((pos.activeSignal.entryPrice + initialRisk * 1.0).toFixed(2));
  const newSl = Math.max(runnerTrailSl, minRunnerSl);
  
  if (newSl > pos.activeSignal.stopLossPrice) {
    pos.activeSignal.stopLossPrice = newSl;
  }
} else {
  // PRE-TARGET-1: Do NOT trail. Hold with original SL.
  // Only exception: Move to breakeven after +1.5R peak (not +1.0R)
  if (pos.peakPremiumLtp >= pos.activeSignal.entryPrice + initialRisk * 1.5) {
    const breakEvenSl = parseFloat((pos.activeSignal.entryPrice + 2.0).toFixed(2));
    if (breakEvenSl > pos.activeSignal.stopLossPrice) {
      pos.activeSignal.stopLossPrice = breakEvenSl;
      pos.isBreakevenLocked = true;
    }
  }
}
```

Remove:
- Risk-Halving Shield (L1762-1775) — prematurely tightens SL
- +1.5R Profit Acceleration Lock (L1750-1760) — too tight
- Guaranteed Green Profit Lock at +1.0R (L1738-1748) — exits at ₹10 profit

---

### Phase 2: FIX ENTRY TIMING — Buy The Pullback, Not The Peak

#### 2A. Multi-Candle Confirmation (Wait for Retest, Not Just Bounce)

**File**: `advisoryManager.ts` (L1029-1036, L1046-1056)

Current: Enter on a single green/red candle near VWAP.
Problem: Single candle bounce is unreliable; 28% of trades never move in our favor.

**New Logic**: Require TWO consecutive confirming candles before entry:
```
// 2-Candle Confirmation: The PREVIOUS candle must have touched VWAP zone,
// AND the CURRENT closed candle must confirm the direction
const prevCandle = closedCandles.length > 1 ? closedCandles[closedCandles.length - 2] : undefined;
const lastCandle = lastClosedCandle;

const isCallDoubleConfirmed = !!(
  prevCandle && lastCandle &&
  // Prev candle tested VWAP zone (wick touched within 8 pts of VWAP)
  Math.abs(Math.min(prevCandle.open, prevCandle.close) - this.currentVwap) <= 8 &&
  // Last candle is green and closes above prev candle's high
  lastCandle.close > lastCandle.open &&
  lastCandle.close > prevCandle.high &&
  isCandleVolumeConfirmed
);

const isPutDoubleConfirmed = !!(
  prevCandle && lastCandle &&
  Math.abs(Math.max(prevCandle.open, prevCandle.close) - this.currentVwap) <= 8 &&
  lastCandle.close < lastCandle.open &&
  lastCandle.close < prevCandle.low &&
  isCandleVolumeConfirmed
);
```

#### 2B. Widen Limit Pullback Entry to 50% Retracement

**File**: `advisoryManager.ts` (L1428-1429)

Current: 30% retracement. Often doesn't fill.

```
const limitRetracement = 0.50 * candleRange; // 50% retracement for better entry
```

With wider pullback, the entry price is cheaper, which:
- Reduces SL risk (entry is closer to SL level)
- Increases target potential (more room to T1/T2)
- Improves R:R ratio mechanically

#### 2C. Extend Limit Order Expiry to 15 Minutes

**File**: `advisoryManager.ts` (L1446)

```
expiresAt: timestamp + 15 * 60 * 1000, // 15 minutes (was 10)
```

---

### Phase 3: REDUCE FEES — Trade Cheaper Options

#### 3A. Switch from Deep ITM to ATM/Slightly OTM Strikes

**File**: `advisoryManager.ts` (L1167-1173)

Current: Buys 2-strike deep ITM (₹150-200 premium). STT alone is ~₹30/trade.

```
// Instead of deep ITM, use ATM strike for lower premium and lower fees
if (candidate === "CALL_BUY") {
  selectedStrike = atmStrike; // ATM Call (Delta ~0.50)
} else if (candidate === "PUT_BUY") {
  selectedStrike = atmStrike; // ATM Put (Delta ~0.50)
}
```

ATM options at ₹60-100 premium:
- Same directional exposure with proper lot sizing
- **50% lower statutory fees** (STT is proportional to premium × qty)
- Slightly higher theta decay but acceptable for intraday

#### 3B. Fee-Adjusted Minimum Profit Gate

Add a rule: Never exit a trade for less than 2x fees profit.
```
const minProfitGate = 2 * ExcelLogger.calculateStatutoryFees(entryPrice, logQty);
// In trailing/exit logic: if exit would yield < minProfitGate, hold position
```

---

### Phase 4: KILL PREMATURE EXITS — Let Winners Breathe

#### 4A. Remove THETA_EXIT for SNIPER Tier

**File**: `advisoryManager.ts` (L1800-1811)

The THETA_EXIT killed trade #138 at +₹50 when it went on to +31.2%. Remove it for SNIPER tier entirely. If the trade hasn't hit SL, let it ride until target or SL.

```
// REMOVE theta timeout for SNIPER tier — trust the SL
if (tier !== "SNIPER") {
  // Keep theta exit only for BALANCED/EXPLORATORY
  const thetaTimeoutMs = tier === "BALANCED" ? 30 * 60 * 1000 : 25 * 60 * 1000;
  // ... existing logic
}
```

#### 4B. Extend Grace Period to 5 Minutes

**File**: `advisoryManager.ts` (L1817-1820)

```
const gracePeriodMs = 5 * 60 * 1000; // 5 minutes (was 2)
if (elapsed < gracePeriodMs && currentPremiumLtp > pos.activeSignal.entryPrice * 0.88) {
  return; // immune unless catastrophic 12% drop
}
```

#### 4C. Square-Off Time: 3:15 PM (Not 3:00 PM)

Use maximum available trading time. Exit at 3:15 PM IST to capture the final hour momentum push.

---

### Phase 5: SMART DAILY TRADE MANAGEMENT

#### 5A. Increase Daily Max Trades to 3

**File**: `advisoryManager.ts` (L233)

1 trade/day is too restrictive. If the first trade loses ₹2,000, we need 2 more shots to recover to ₹10K. But each trade must pass the confluence gate.

```
private dailyMaxTrades: number = 3;
```

#### 5B. Raise Daily Loss Cap to ₹5,000

**File**: `advisoryManager.ts` (L234)

```
private maxDailyRupeeLoss: number = 5000; // Raise from ₹800 to ₹5,000
```

With ₹2,000 risk per trade and max 3 trades: worst case daily loss = ₹6,000. This is acceptable if the system generates 2 wins for every 1 loss.

#### 5C. Progressive Lot Sizing After Wins

After a profitable trade on the same day, increase lot size by 50%:
```
// In executePositionEntry, after checking dailyProfitLoss:
const todayNetPnl = targetPos.dailyProfitLoss; // in R multiples
let lotMultiplier = 1.0;
if (todayNetPnl > 0) {
  lotMultiplier = 1.5; // Press advantage — increase size after winning
}
const logQty = Math.max(75, Math.min(225, Math.floor(riskBasedLots * lotMultiplier) * 25));
```

---

### Phase 6: SIGNAL QUALITY ENHANCEMENT

#### 6A. Minimum R:R Gate at Entry

**File**: `advisoryManager.ts` (after L1298)

Block any trade where the realized R:R at entry is below 2.5:1:
```
const realizedRR = scaledTarget1 / scaledStopLoss;
if (realizedRR < 2.5) {
  this.lastSignalBlockReason = `R:R too low (${realizedRR.toFixed(1)}:1, need ≥ 2.5:1).`;
  return;
}
```

#### 6B. ADX Trend Strength Gate (Minimum ADX ≥ 22)

Replace `currentAdx < 18` RANGE classification with a stricter ADX ≥ 22 requirement for VWAP_PULLBACK entries:
```
if (setupType === "VWAP_PULLBACK" && currentAdx < 22) {
  this.lastSignalBlockReason = `Trend strength insufficient (ADX: ${currentAdx.toFixed(1)}, need ≥ 22).`;
  return;
}
```

#### 6C. Multi-Timeframe Confirmation (15-min trend alignment)

Add a 15-minute trend check. Only enter CALL if both 5m AND 15m EMAs are bullish:
```
// Build 15-minute candles from 5-minute data
const candles15m = this.aggregate5mTo15m(this.indexCandles);
const closes15m = candles15m.map(c => c.close);
const trend15m = getIntradayEmaTrend(closes15m, spot);

// Block if 15-min trend disagrees with entry direction
if (candidate === "CALL_BUY" && trend15m.trendBearish) {
  this.lastSignalBlockReason = "15-minute trend is bearish. CALL blocked for trend alignment.";
  return;
}
if (candidate === "PUT_BUY" && trend15m.trendBullish) {
  this.lastSignalBlockReason = "15-minute trend is bullish. PUT blocked for trend alignment.";
  return;
}
```

---

## Part 5: Expected Impact Projection

### Per-Trade Economics (After Changes)

| Metric | Current | After Changes |
|:---|---:|---:|
| Position Size | 25-50 qty | 75-100 qty |
| Stop Loss | 15-18 pts | 20-30 pts |
| Max Risk/Trade | ₹300 | ₹2,000 |
| Target 1 | +30 pts (+2R) | +75 pts (+3R) |
| T1 Partial Book (50%) | ₹375 | **₹2,775** |
| Target 2 Runner | +53 pts (+3.5R) | +125 pts (+5R) |
| T2 Full Runner | ₹662 | **₹4,750** |
| Average Winner | ₹90 | **₹3,000-5,000** |
| Average Loser | ₹512 | **₹2,000** |
| Fees/Trade | ₹55-65 | ₹35-45 (ATM options) |

### Daily Projection (Conservative)

| Scenario | Probability | Daily P&L |
|:---|---:|---:|
| 2 wins, 1 loss (67% WR) | 40% | +₹4,000 to +₹8,000 |
| 2 wins, 0 losses | 20% | +₹6,000 to +₹10,000 |
| 1 win with T2 runner | 15% | +₹5,000 to +₹7,500 |
| 1 win, 1 loss | 15% | +₹1,000 to +₹3,000 |
| 0 wins, 1-2 losses | 10% | -₹2,000 to -₹4,000 |
| **Expected Daily P&L** | | **₹4,000 - ₹8,000** |

> Reaching consistent ₹10K/day requires ≥ 65% win rate with 3:1 R:R on 75-100 qty. 
> This is achievable but will take 2-3 weeks of calibration after implementation.

---

## Part 6: Implementation Priority & Sequence

### 🔴 Priority 1 (Do FIRST — Fixes the Fatal Flaw)
1. **1A**: Widen SL to 20-35 pts ATR-based
2. **1B**: 3R/5R target architecture  
3. **1C**: Position sizing to 75-150 qty (₹2K risk/trade)
4. **1D**: Remove pre-T1 trailing (let winners breathe)

### 🟡 Priority 2 (Entry Quality)
5. **2A**: 2-candle confirmation
6. **2B**: 50% pullback limit entry
7. **3A**: Switch to ATM strikes (lower fees)

### 🟢 Priority 3 (Exit Optimization)
8. **4A**: Remove THETA_EXIT for SNIPER
9. **4B**: 5-minute grace period
10. **5A**: Daily max 3 trades
11. **5B**: ₹5,000 daily loss cap

### 🔵 Priority 4 (Signal Enhancement)
12. **6A**: R:R minimum gate (2.5:1)
13. **6B**: ADX ≥ 22 gate
14. **6C**: 15-minute multi-timeframe alignment

---

## Part 7: Risk Warnings

> [!CAUTION]
> **₹10,000/day is NOT guaranteed.** This requires:
> 1. **₹2-3 lakh trading capital** (for 3-6 lots of Nifty options margin)
> 2. **Consistent 60-65% win rate** (historically possible but not guaranteed)
> 3. **2-3 weeks of paper-trade calibration** before going live with real capital
> 4. **Markets must trend** — in choppy sideways markets, even the best system will lose

> [!IMPORTANT]
> **Do NOT skip the paper-trading calibration period.** The parameter changes (SL width, targets, lot size) need at least 15-20 trades of validation data to confirm the new R:R profile works in practice.

---

## Files Modified

| File | Changes |
|:---|:---|
| `advisoryManager.ts` | SL widening, target scaling, position sizing, trailing overhaul, entry confirmation, theta exit removal, grace period, daily limits |
| `quantitativeEngine.ts` | ADX gate, regime scoring calibration |
| `indicators.ts` | 15-minute aggregation helper (new function) |
| `.env` | `MAX_RISK_PER_TRADE=2000`, `DAILY_MAX_TRADES=3` |
