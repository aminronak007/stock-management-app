# Options Advisory Terminal - Daily Operational Guide

Follow this checklist **every morning** between **9:00 AM and 9:15 AM IST** (before the market opens) to authenticate your broker session and prepare the automated strategy engine.

---

## 🛠️ Step 1: Generate Daily Fyers Token (9:00 AM - 9:10 AM)
Fyers API security guidelines expire all authentication tokens daily. You must generate a fresh token before starting:

1. Open your terminal window and navigate to the `backend` folder.
2. Execute the token generator script:
   ```bash
   npm run generate:token
   ```
3. Open the printed authorization link in your web browser.
4. Log in with your **Fyers client ID, Password, TOTP (authenticator code), and PIN**.
5. Once redirected, look at your browser's address bar. **Copy the entire URL** (or the authorization code after `auth_code=`).
6. Paste it back into your terminal and hit **Enter**.
7. Confirm that the terminal displays: 
   `✔ SUCCESS: Daily Access Token generated and saved successfully to database cache!`

---

## ⚙️ Step 2: Set Trade Execution Mode
Verify how you want the terminal to behave today by checking `backend/.env`:

* **Virtual Paper Trading (Recommended to start)**
  Keep the safety switch set to `false`. The terminal will generate signals and record simulated trades in your spreadsheet ledger **without using real money**:
  ```env
  AUTO_ORDER_EXECUTION=false
  ORDER_QTY=25
  ```
* **Auto-Live Execution**
  Set to `true` to route actual orders automatically to your Fyers account as soon as signals confirm:
  ```env
  AUTO_ORDER_EXECUTION=true
  ORDER_QTY=25
  ```

---

## 🚀 Step 3: Launch the Services (9:10 AM)
Start both terminal components. 

1. **Start Backend Server**:
   In your `backend` terminal, execute:
   ```bash
   npm run dev
   ```
   *(Verify it prints: `Live API Connected. User Name: RONAK HARESHBHAI AMIN` & `Daily CPR calculated`)*.

2. **Start Frontend Client**:
   In your `web` terminal, execute:
   ```bash
   npm run dev
   ```

3. **Open Dashboard**:
   Open your web browser and navigate to: **[http://localhost:3000](http://localhost:3000)**.
   * Verify the **ROUTING** card matches your mode (`AUTO-LIVE` or `PAPER-ONLY`).
   * Verify **SYSTEM STATE** reads `ACTIVE` (which confirms successful WebSocket connection).

---

## 📊 Step 4: End-of-Day Journal Review (3:35 PM)
At the end of the trading session, review your trades inside your auto-generated spreadsheet:
* Navigate to the project root directory: `stock-management-app/Stock Mock/`
* Open the daily folder (e.g. `Monday_YYYY-MM-DD/`) and double-click **`ledger.csv`**.
* The sheet logs your entry and exit times, strike contracts, capital invested, and realized profits/losses.
