# Options Advisory Terminal - Daily Operational Guide

Follow this operational checklist **every morning** between **9:00 AM and 9:15 AM IST** (before the market opens) to authenticate your broker session and start your automated trading terminal.

---

## 🛠️ Step 1: Generate Daily Fyers Token (9:00 AM - 9:10 AM)
Fyers API access tokens are valid for 24 hours per SEBI security guidelines. Generate a fresh token before market open:

1. Open your terminal in the `backend` folder.
2. Run the interactive token generator:
   ```bash
   npm run generate:token
   ```
3. Open the printed authorization link in your web browser.
4. Log in with your **Fyers Client ID, Password, TOTP (authenticator code), and PIN**.
5. Once redirected, **copy the entire redirect URL** (or the authorization code after `auth_code=`).
6. Paste it back into your terminal and hit **Enter**.
7. Confirm the terminal displays: 
   `✔ SUCCESS: Daily Access Token generated and saved successfully to database cache!`

---

## ⚙️ Step 2: Verify Execution Mode & Alerts in `backend/.env`
Check your `backend/.env` settings:

```ini
# Real Market Paper-Trading Mode (Zero Capital Risk)
AUTO_ORDER_EXECUTION=false
ORDER_QTY=50
MIN_SIGNAL_SCORE=75

# Cloud Ledger (Google Drive > Stock Mock > Year > Month > Date Tab)
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/.../exec

# Real-Time Mobile Push Alerts (< 300ms latency)
TELEGRAM_BOT_TOKEN=8811629603:AAHvJltYcKyWUO-DT1ch2wDltsRpQCmj5QE
TELEGRAM_CHAT_ID=7134217382
```

---

## 🚀 Step 3: Launch Terminal Services (9:10 AM)

1. **Start Backend Server**:
   ```bash
   cd backend
   npm run dev
   ```
   *(Verify it prints: `Live API Connected`, `Daily CPR calculated`, `Telegram Real-Time Alert Gateway active`)*.

2. **Start Frontend Dashboard**:
   ```bash
   cd web
   npm run dev
   ```

3. **Open Dashboard**:
   Navigate to **[http://localhost:3000](http://localhost:3000)** (or port 5173/3000):
   * Verify **SYSTEM STATE** reads `ACTIVE` (WebSocket streaming live ticks).
   * Verify **ROUTING** displays `PAPER-ONLY` with real market tick evaluation.

---

## 📱 Step 4: During the Trading Session (9:15 AM - 3:30 PM)

* **Telegram Push Alerts**: You will receive instant phone notifications when:
  * 🎯 **Entry Triggered**: Strike, Entry Price, Stop Loss, Target 1, Target 2, Confluence Score.
  * 💰 **Target 1 Achieved (+1.25R)**: 50% lot booked at market, SL moved to breakeven for remaining Trend Runner.
  * 🚀 **Runner Trailing**: Dynamic ATR cushion updates as the runner participates in macro trend expansions.
  * 🔒 **Exit Confirmation**: Full Target 2 achieved, Theta exit, or Stop Loss.
* **3:15 PM Universal Square-Off**: The terminal automatically closes any open paper position before market close.

---

## 📊 Step 5: End-of-Day Journal Review (3:35 PM)
All trades are logged **100% directly to your Google Drive**:
* Open Google Drive $\rightarrow$ `Stock Mock` $\rightarrow$ `2026` $\rightarrow$ `[Month]` $\rightarrow$ Select today's tab.
* Review your trades with **gross P&L, statutory taxes & brokerage deductions (~₹54.60/lot), net realized returns, and post-exit MFE analytics**.
