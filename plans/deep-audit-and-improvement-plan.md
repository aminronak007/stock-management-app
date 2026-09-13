# Deep Forensic Audit & Profitability Improvement Plan

**Audit Period**: August 24, 2026 – September 10, 2026  
**Total Trades Analyzed**: 45 entries, 48 exits  
**Overall Result**: **₹-8,608.31 NET LOSS** across 12 trading days

---

## Part 1: Empirical Trade Performance Breakdown

### 1.1 Daily PnL Summary

| Date | Trades | Wins | Losses | Daily PnL | Verdict |
|:---|:---:|:---:|:---:|---:|:---|
| 24-Aug | 19 | 7 | 12 | -1,268.83 | Mass overtrading (19 trades!) |
| 26-Aug | 3 | 0 | 3 | -1,259.23 | Zero wins |
| 27-Aug | 3 | 0 | 3 | -719.26 | Zero wins |
| 28-Aug | 3 | 0 | 3 | -748.98 | Zero wins |
| 31-Aug | 2 | 2 | 0 | +11.90 | Tiny profit |
| 01-Sep | 2 | 2 | 0 | +268.16 | Best green day |
| 03-Sep | 2 | 0 | 2 | -1,006.78 | Heavy loss |
| 04-Sep | 2 | 0 | 2 | -723.09 | Both stopped out |
| 07-Sep | 3 | 2 | 1 | +176.41 | Green |
| 08-Sep | 5 | 4 | 1 | -85.47 | 4 wins but 1 big loss wiped them |
| 09-Sep | 3 | 3 | 0 | +663.58 | Best day |
| 10-Sep | 1 | 0 | 1 | -665.13 | Bank Nifty divergence trap |

**Green Days**: 4 out of 12 (33%)  
**Red Days**: 8 out of 12 (67%)

### 1.2 Strategy Setup Analysis

| Setup Type | Trades | Wins | Losses | Win Rate | Total PnL |
|:---|:---:|:---:|:---:|:---:|---:|
| ORB_BREAKOUT | 31 | 9 | 22 | 29.0% | -5,076.33 |
| VWAP_PULLBACK | 9 | 6 | 3 | 66.7% | +206.64 |
| TRAP_REVERSAL | 5 | 2 | 3 | 40.0% | -738.62 |

**CRITICAL**: ORB_BREAKOUT is responsible for 100% of account losses. It has a 29% win rate.

### 1.3 Direction Bias Analysis

| Direction | Trades | Wins | Losses | Win Rate | Total PnL |
|:---|:---:|:---:|:---:|:---:|---:|
| CALL_BUY | 9 | 1 | 8 | 11.1% | -2,657.93 |
| PUT_BUY | 36 | 16 | 20 | 44.4% | -2,950.38 |

**CALL_BUY has an 11.1% win rate** — 8 out of 9 CALL trades lost money.

### 1.4 Confluence Score Analysis

| Score Bucket | Trades | Wins | Losses | Win Rate | Total PnL |
|:---|:---:|:---:|:---:|:---:|---:|
| 90-100 | 10 | 5 | 5 | 50.0% | -2,154.33 |
| 80-89 | 15 | 7 | 8 | 46.7% | -1,157.06 |
| 70-79 | 7 | 1 | 6 | 14.3% | -1,615.93 |
| Below 70 | 13 | 4 | 9 | 30.8% | -680.99 |

Even highest-scoring trades (90-100) are losing Rs.2,154. The scoring system is broken.

### 1.5 Execution Quality Analysis

| Metric | Value | Interpretation |
|:---|:---:|:---|
| Peak never moved above entry | 13/45 (28.9%) | Nearly 1/3 of trades immediately went against us |
| Breakeven ever locked | 8/45 (17.8%) | Only 18% ever reached +1.0R protection |
| Target 1 ever hit | 3/45 (6.7%) | Only 7% of trades hit Target 1 |
| Max consecutive loss streak | 11 trades | Zero trading edge |

---

## Part 2: Critical Code Bugs Identified

### Bug 1: Opening Drive Is Mathematically Impossible
**File**: advisoryManager.ts (L776-777 vs L942)

During 09:15-09:30 AM, line 776 sets orbHigh = Max(orbHigh, tick.ltp). Then
evaluateBreakoutSignals checks spot > orbHigh + buffer. Since orbHigh >= spot
was just set, the condition spot > spot + 5 is ALWAYS FALSE. Opening Drive
strategy can NEVER trigger from real-time ticks.

### Bug 2: ADX Always Returns Fallback 15.0
**File**: advisoryManager.ts (L1286) & indicators.ts (L236)

calculateCandleADX(this.indexCandles.slice(-25), 14) — function requires
period x 2 = 28 candles but only receives 25. It ALWAYS returns fallback 15.0,
causing every ADX < 18 check to trigger false "choppy market" penalties.

### Bug 3: Trailing SL Uses Math.min Instead of Math.max
**File**: advisoryManager.ts (L1567)

Uses Math.min which forces trailing stop DOWN to Entry + 1.00 even when trade
has moved significantly in profit. Should be Math.max to protect accumulated gains.

### Bug 4: No Candlestick Confirmation for VWAP Pullback
**File**: advisoryManager.ts (L963-969)

VWAP pullback triggers immediately when spot is within 25 pts of VWAP without
verifying the candle actually bounced. This enters into falling red knives.

### Bug 5: Net Change Gate Uses Previous Day Close
**File**: quantitativeEngine.ts (L518-528)

Banking Divergence Veto checks bnfNetChange (% vs yesterday close). On gap-up
days where market sells off intraday, bnfNetChange remains positive, vetoing
valid PUT entries during actual downtrends. Needs intraday VWAP-relative change.

### Bug 6: Score Gate Blocks BALANCED and EXPLORATORY Tiers
**File**: advisoryManager.ts (L1264 vs L1335-1339)

minScoreThreshold = 82 early-return blocks evaluation before BALANCED (60-74)
or EXPLORATORY (<60) tiers can be reached. These tiers can never execute.

### Bug 7: Synthetic Delta Mismatch (0.80 vs 0.50)
**File**: advisoryManager.ts (L1096 vs L1524)

Deep ITM strikes with delta ~0.80 are purchased, but fallback risk model
uses hardcoded deltaMultiplier = 0.50. Causes PnL distortion and
premature/delayed stop-loss triggers.

---

## Part 3: Improvement Plan

### Phase 1: Critical Bug Fixes (Immediate)

1. Fix ADX slice bug (L1286): Change .slice(-25) to .slice(-30)
2. Fix Trailing SL Math.min -> Math.max (L1567)
3. Add candlestick bounce confirmation for VWAP Pullback (L963-969)
4. Fix synthetic delta to match actual strike selection delta (L1524)
5. Fix Net Change Gate to use intraday VWAP-relative change (L518-528)

### Phase 2: Strategy Architecture Overhaul

1. KILL ORB_BREAKOUT permanently (31 trades, 22 losses, -Rs.5,076)
2. Implement proper pullback confirmation:
   - Spot touches 20-EMA / VWAP zone
   - Completed 5m candle confirms bounce direction
   - Volume on bounce candle >= 1.0x of 5-bar average
3. Add VWAP slope filter (only allow CALLs when VWAP rising, PUTs when falling)
4. Reduce max daily trades from 5 to 2

### Phase 3: Risk Management Overhaul

1. Widen initial stop-loss from 7-12 pts to 15-18 pts (reduce noise stops)
2. Increase Target 1 to +2.0R (was +1.25R — only 6.7% hit rate proves it's too tight)
3. Increase Target 2 to +3.5R (was +2.5R)
4. Fix trailing stop mechanism:
   - At +1.0R: SL to Entry + 3.00 (not 1.50, fees eat 1.50)
   - At +1.5R: SL to Entry + 1.0R
   - At +2.0R: Book 50%, trail remainder with 0.5R cushion
5. Remove premature structural VWAP invalidation exit (10-pt buffer too tight)
6. Cap max daily loss at Rs.800

### Phase 4: Confluence Scoring Rebuild

1. Remove bonus point inflation (up to +60 pts bypass pillar framework)
2. Cap totalScore at weighted pillar sum only (max 100)
3. Add regime-weighted scoring:
   - TREND_UP: CALL +10, PUT -20
   - TREND_DOWN: PUT +10, CALL -20
   - RANGE: All momentum -15
4. Increase minimum score threshold from 82 to 88

### Phase 5: Inter-Market Intelligence Enhancement

1. Replace heavyweightsNetChange (prev-day close) with intraday VWAP deviation
2. Add Nifty Futures Premium/Discount tracking
3. Add India VIX intraday trend gate:
   - VIX rising >3%: Only PUT entries
   - VIX falling >3%: Only CALL entries
   - VIX spike >5%: No entries

---

## Expected Impact

| Metric | Current | Target |
|:---|:---:|:---:|
| Win Rate | 37.8% | >= 55% |
| Daily Trade Count | 2-19 | Max 2 |
| ORB_BREAKOUT Losses | -5,076 | 0 (disabled) |
| Peak Never Moved | 28.9% | < 10% |
| Target 1 Hit Rate | 6.7% | >= 25% |
| Max Consecutive Losses | 11 | <= 3 |
| Green Days | 33% | >= 60% |
