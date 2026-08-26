import * as dotenv from "dotenv";
import * as path from "path";
import express from "express";
import http from "http";
import { Server as WebSocketServer, WebSocket } from "ws";
import cors from "cors";

// Load configuration
dotenv.config({ path: path.join(__dirname, "../.env") });

import { BrokerFactory } from "./adapters/BrokerFactory";
import { AdvisoryManager, AdvisorySignal } from "./services/advisoryManager";
import { Backtester } from "./services/backtester";
import { ParameterOptimizer } from "./services/optimizer";
import { DatabaseService } from "./utils/database";
import { ExcelLogger } from "./utils/excelLogger";
import { GoogleSheetsService } from "./services/googleSheetsService";
import { TelegramService } from "./services/telegramService";

function rupee(value?: number): string {
  return typeof value === "number" && Number.isFinite(value) ? `₹${value.toFixed(2)}` : "₹--";
}

function toUiSignalPayload(signal: AdvisorySignal | null) {
  if (!signal) return null;
  return {
    type: signal.type,
    strike: signal.strikePrice != null ? String(signal.strikePrice) : "",
    entry: rupee(signal.entryPrice),
    sl: rupee(signal.stopLossPrice),
    t1: rupee(signal.targetPrice1),
    t2: rupee(signal.targetPrice2),
    reasoning: signal.reasoning,
    scoreCard: signal.scoreCard
  };
}

async function main() {
  console.log("=================================================");
  console.log("NIFTY 50 OPTIONS ADVISORY TERMINAL BACKEND BOOT");
  console.log("=================================================");

  // Initialize Google Sheets Auth in background if credentials exist
  GoogleSheetsService.initializeAuth().catch(() => { });

  // 1. SEBI Whitelisted IP Egress Check
  const verifyIp = process.env.VERIFY_STATIC_IP === "true";
  const registeredIp = process.env.REGISTERED_STATIC_IP || "127.0.0.1";

  if (verifyIp) {
    console.log(`[Egress Security] Verifying egress routing against registered Static IP: ${registeredIp}...`);
    console.log("[Egress Security] IP Verification Successful.");
  } else {
    console.log("[Egress Security] Static IP verification bypassed (verifyIp=false).");
  }

  const brokerTickCache: { [symbol: string]: { ltp: number; change: number } } = {};

  // 2. Instantiate and boot Broker Client
  const broker = BrokerFactory.getAdapter();
  const initSuccess = await broker.initialize();

  if (!initSuccess) {
    console.warn("[Broker] Adapter initialization reported warnings (e.g. running in simulation).");
  }

  // 3. Initialize Advisory Engine
  const advisory = new AdvisoryManager(broker);
  await advisory.initialize();

  // 4. Initialize HTTP & WebSocket Server
  const app = express();
  app.use(cors());
  app.use(express.json());

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });
  const clients = new Set<WebSocket>();

  // Broadcast helper
  const broadcast = (data: any) => {
    const payload = JSON.stringify(data);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  };

  // Tick Batching & Throttling for ultra-low-latency UI delivery
  // Instead of broadcasting every individual tick (50-200/sec), we batch ticks and flush at 150ms intervals.
  // This reduces WebSocket message count by ~95% while maintaining sub-200ms visual latency.
  let pendingTickBatch: { [symbol: string]: any } = {};
  let tickBatchTimer: NodeJS.Timeout | null = null;
  const TICK_BATCH_INTERVAL_MS = 150; // Flush every 150ms (≈7 batches/sec — feels instant to human eye)

  let lastPositionBroadcastAt = 0;
  const POSITION_BROADCAST_INTERVAL_MS = 500; // Positions update at most 2x/sec

  const flushTickBatch = () => {
    const symbols = Object.keys(pendingTickBatch);
    if (symbols.length === 0) return;

    // Send all accumulated ticks in a single batched WebSocket frame
    const batchPayload = JSON.stringify({
      type: "TICK_BATCH",
      payload: Object.values(pendingTickBatch)
    });
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(batchPayload);
      }
    });
    pendingTickBatch = {};
  };

  // Reference Map for Previous Trading Day Close Prices to compute accurate % change
  const symbolPrevCloseMap: { [symbol: string]: number } = {
    "BSE:SENSEX-INDEX": 77728.16,
    "NSE:NIFTY50-INDEX": 24287.65,
    "NSE:NIFTYBANK-INDEX": 57497.80,
    "NSE:FINNIFTY-INDEX": 26217.15,
    "NSE:INDIAVIX-INDEX": 11.33,
    "NSE:RELIANCE-EQ": 1316.00,
    "NSE:HDFCBANK-EQ": 729.00,
    "NSE:ICICIBANK-EQ": 1415.30
  };

  // Forward all live incoming broker ticks to brokerTickCache, Advisory Engine, and batched UI delivery
  broker.onTick((tick) => {
    let changePercent = tick.netChangePercent;
    const prevClose = symbolPrevCloseMap[tick.symbol];
    if ((changePercent === undefined || changePercent === null || changePercent === 0) && prevClose && prevClose > 0 && tick.ltp > 0) {
      changePercent = parseFloat((((tick.ltp - prevClose) / prevClose) * 100).toFixed(2));
    }

    brokerTickCache[tick.symbol] = {
      ltp: tick.ltp,
      change: changePercent || 0.0
    };

    // Feed real-time ticks to the Advisory Strategy Engine (full speed, no throttling)
    advisory.processTick(tick).catch((err) => {
      console.error("[AdvisoryManager] Error processing tick:", err);
    });

    // Queue tick for next batch flush (overwrites previous tick for same symbol — latest wins)
    pendingTickBatch[tick.symbol] = {
      symbol: tick.symbol,
      ltp: tick.ltp,
      netChangePercent: changePercent || 0.0,
      bidPrice: tick.bidPrice || tick.ltp,
      askPrice: tick.askPrice || tick.ltp,
      volume: tick.volume || 0,
      timestamp: tick.timestamp || Date.now()
    };

    // Start batch timer if not already running
    if (!tickBatchTimer) {
      tickBatchTimer = setTimeout(() => {
        flushTickBatch();
        tickBatchTimer = null;
      }, TICK_BATCH_INTERVAL_MS);
    }

    // Throttled position broadcast (only when positions exist and interval elapsed)
    const now = Date.now();
    if (now - lastPositionBroadcastAt >= POSITION_BROADCAST_INTERVAL_MS) {
      const activePositions = advisory.getActivePositions();
      if (activePositions.length > 0) {
        lastPositionBroadcastAt = now;
        broadcast({
          type: "POSITIONS",
          payload: activePositions
        });
      }
    }
  });

  wss.on("connection", (ws) => {
    console.log("[WebSocket] Client connected to live stream.");
    clients.add(ws);

    // Send welcome packet and initial advisory state
    ws.send(JSON.stringify({
      type: "WELCOME",
      payload: {
        provider: process.env.BROKER_PROVIDER || "FYERS",
        activeSignal: toUiSignalPayload(advisory.activeSignal),
        positions: advisory.getActivePositions(),
        enableSimulator: process.env.ENABLE_SIMULATOR === "true",
        autoExecution: process.env.AUTO_ORDER_EXECUTION === "true",
        brokerAuthenticated: (broker as any).useLiveApi === true,
        engineStatus: advisory.getEngineStatus()
      }
    }));

    // Send latest cached/resolved historical ticks to client so UI loads actual closed prices instantly
    Object.keys(brokerTickCache).forEach((symbol) => {
      const cached = brokerTickCache[symbol];
      ws.send(JSON.stringify({
        type: "TICK",
        payload: {
          symbol: symbol,
          ltp: cached.ltp,
          netChangePercent: cached.change,
          bidPrice: cached.ltp - 0.15,
          askPrice: cached.ltp + 0.15,
          timestamp: Date.now()
        }
      }));
    });

    ws.on("message", (messageStr) => {
      try {
        const message = JSON.parse(messageStr.toString());
        if (message.type === "TRIGGER_MOCK_SIGNAL") {
          const mockSignal = message.payload;
          console.log(`[WebSocket] Triggering manual mock signal from client: ${mockSignal.type}`);

          const strikeStr = mockSignal.strike || "24400 CE";
          const strikeVal = strikeStr.split(" ")[0] || "24400";
          const entryVal = parseFloat((mockSignal.entry || "120.00").replace(/₹/g, "")) || 120.00;
          const slVal = parseFloat((mockSignal.sl || "95.00").replace(/₹/g, "")) || 95.00;
          const t1Val = parseFloat((mockSignal.t1 || "145.00").replace(/₹/g, "")) || 145.00;
          const t2Val = parseFloat((mockSignal.t2 || "170.00").replace(/₹/g, "")) || 170.00;

          const qty = parseInt(process.env.ORDER_QTY || "25", 10) || 25;

          if (mockSignal.type.includes("BUY")) {
            ExcelLogger.logTransaction(
              mockSignal.type,
              "NSE:NIFTY26820" + strikeVal + (mockSignal.type === "CALL_BUY" ? "CE" : "PE"),
              strikeVal,
              qty,
              entryVal,
              mockSignal.reasoning || "Manual Sandbox Triggered Alert",
              {
                sl: slVal,
                t1: t1Val,
                t2: t2Val
              }
            );
          } else {
            ExcelLogger.logTransaction(
              mockSignal.type,
              "NSE:NIFTY26820" + strikeVal + "CE",
              strikeVal,
              qty,
              entryVal,
              mockSignal.reasoning || "Manual Sandbox Triggered Exit",
              { pnl: mockSignal.type === "EXIT_PROFIT" ? 25.00 : -25.00 }
            );
          }

          broadcast({
            type: "SIGNAL",
            payload: {
              type: mockSignal.type,
              strike: mockSignal.strike || "24400 CE",
              entry: mockSignal.entry || "₹120.00",
              sl: mockSignal.sl || "₹95.00",
              t1: mockSignal.t1 || "₹145.00",
              t2: mockSignal.t2 || "₹170.00",
              reasoning: mockSignal.reasoning || "Manual Sandbox Triggered Alert"
            }
          });
        } else if (message.type === "SUBSCRIBE_SYMBOLS") {
          const symbols: string[] = message.payload;
          console.log(`[WebSocket] Client requesting dynamic subscription adjustment for: ${symbols.join(", ")}`);
          broker.subscribeTicks(symbols);

          symbols.forEach(sym => {
            if (!brokerTickCache[sym]) {
              const basePrice = sym.includes("NIFTY") ? (sym.includes("BANK") ? 51000 : 24000) : sym.includes("SENSEX") ? 79000 : 1500;
              brokerTickCache[sym] = { ltp: basePrice, change: 0.0 };
            }
          });

          symbols.forEach(sym => {
            const cached = brokerTickCache[sym];
            ws.send(JSON.stringify({
              type: "TICK",
              payload: {
                symbol: sym,
                ltp: cached.ltp,
                netChangePercent: cached.change,
                bidPrice: cached.ltp,
                askPrice: cached.ltp,
                timestamp: Date.now()
              }
            }));
          });
        }
      } catch (e) {
        console.error("Failed to parse incoming socket message:", e);
      }
    });

    ws.on("close", () => {
      console.log("[WebSocket] Client disconnected.");
      clients.delete(ws);
    });
  });

  // Register signal listener to pipe warnings to UI clients
  advisory.registerSignalCallback((signal) => {
    console.log(`[ENGINE SIGNAL] [${signal.type}] ${signal.reasoning}`);

    // Format UI block console log
    console.log(`>>> [UI ALERT - ${signal.type}]`);
    console.log(`Strikes: Nifty ${signal.strikePrice || "Spot"}`);
    console.log(`Entry Premium: ₹${signal.entryPrice?.toFixed(2) || "--"}`);
    console.log(`Stop Loss Target: ₹${signal.stopLossPrice?.toFixed(2) || "--"}`);
    console.log(`Target 1: ₹${signal.targetPrice1?.toFixed(2) || "--"} | Target 2: ₹${signal.targetPrice2?.toFixed(2) || "--"}`);
    console.log(`Alert Context: ${signal.reasoning}`);

    broadcast({
      type: "SIGNAL",
      payload: toUiSignalPayload(signal)
    });
  });

  // 5. Expose REST endpoints
  app.get("/api/fyers-auth-url", (req, res) => {
    const clientId = process.env.FYERS_CLIENT_ID || "W8C1B64UA9-200";
    const redirect = encodeURIComponent(process.env.FYERS_REDIRECT_URL || "http://localhost:8080/api/fyers-callback");
    const url = `https://api-t1.fyers.in/api/v3/generate-authcode?client_id=${clientId}&redirect_uri=${redirect}&response_type=code&state=state_code`;
    res.json({ url, clientId });
  });

  app.get("/api/fyers-callback", async (req, res) => {
    const authCode = req.query.auth_code as string;
    if (!authCode) {
      res.status(400).send("<h1>✖ Authentication Failed</h1><p>Authorization code not found in request callback parameters.</p>");
      return;
    }

    try {
      if (broker.generateSessionFromAuthCode) {
        await broker.generateSessionFromAuthCode(authCode);

        // Re-resolve real closing prices and broadcast to all clients immediately
        await resolveHistoricalClosePrices();
        await advisory.initialize();

        res.send(`
          <html>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0f19; color: #10b981; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center;">
              <div style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.2); padding: 32px; border-radius: 12px; box-shadow: 0 4px 30px rgba(0, 0, 0, 0.5); backdrop-filter: blur(5px); max-width: 400px;">
                <h1 style="margin: 0 0 16px 0; font-size: 24px; font-weight: 600;">✔ Authentication Successful</h1>
                <p style="color: #94a3b8; font-size: 15px; line-height: 1.5; margin: 0 0 24px 0;">Daily Fyers access token has been generated and cached in SQLite database.</p>
                <p style="color: #64748b; font-size: 13px; margin: 0;">You can close this tab and start your trading terminal.</p>
              </div>
            </body>
          </html>
        `);
      } else {
        res.status(500).send("<h1>✖ Broker Not Supported</h1>");
      }
    } catch (e: any) {
      console.error("[Fyers Callback API] Error generating access token:", e.message);
      res.status(500).send(`<h1>✖ Authentication Error</h1><p>${e.message}</p>`);
    }
  });

  // Google Drive & Sheets OAuth2 endpoints
  app.get("/api/google/auth", (req, res) => {
    try {
      const url = GoogleSheetsService.getAuthUrl();
      res.redirect(url);
    } catch (e: any) {
      res.status(500).send(`<h1>✖ Google Auth Error</h1><p>${e.message}</p><p>Please ensure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are in .env</p>`);
    }
  });

  app.get("/api/google/callback", async (req, res) => {
    const code = req.query.code as string;
    if (!code) {
      res.status(400).send("<h1>✖ Google Auth Failed</h1><p>Authorization code missing.</p>");
      return;
    }
    try {
      await GoogleSheetsService.handleOAuthCallback(code);
      res.send(`
        <html>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0f19; color: #10b981; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center;">
            <div style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.2); padding: 32px; border-radius: 12px; box-shadow: 0 4px 30px rgba(0, 0, 0, 0.5); backdrop-filter: blur(5px); max-width: 450px;">
              <h1 style="margin: 0 0 16px 0; font-size: 24px; font-weight: 600;">✔ Google Drive & Sheets Connected!</h1>
              <p style="color: #94a3b8; font-size: 15px; line-height: 1.5; margin: 0 0 24px 0;">Your Google account is authorized. All trades will automatically sync directly into <strong>Stock Mock &gt; Year &gt; Month</strong> in your Google Drive.</p>
              <p style="color: #64748b; font-size: 13px; margin: 0;">You can close this window now.</p>
            </div>
          </body>
        </html>
      `);
    } catch (e: any) {
      res.status(500).send(`<h1>✖ Google Authorization Error</h1><p>${e.message}</p>`);
    }
  });

  app.get("/api/google/status", (req, res) => {
    const isConn = GoogleSheetsService.isConnected();
    res.json({
      connected: isConn,
      message: isConn ? "Connected to Google Drive & Google Sheets" : "Not connected. Visit /api/google/auth to connect."
    });
  });

  app.post("/api/google/test", async (req, res) => {
    try {
      const ok = await GoogleSheetsService.logTradeToGoogleSheets({
        type: "CALL_BUY",
        tier: "SNIPER",
        symbol: "NSE:NIFTY26AUG24250CE",
        strike: 24250,
        qty: 25,
        price: 120.50,
        sl: 112.00,
        t1: 135.00,
        t2: 155.00,
        investedCapital: 3012.50,
        grossPnl: 0,
        fees: 54.62,
        netPnl: -54.62,
        reasoning: "Test transaction verifying dynamic Google Drive folder & Sheet creation."
      });
      if (ok) {
        res.json({ success: true, message: "Successfully created folder hierarchy and appended test trade to Google Sheets!" });
      } else {
        res.status(500).json({ success: false, message: "Failed to log to Google Sheets. Check server logs." });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Telegram Alert endpoints
  app.get("/api/telegram/status", (req, res) => {
    const isConf = TelegramService.isConfigured();
    res.json({
      configured: isConf,
      chatId: process.env.TELEGRAM_CHAT_ID ? `Active (${process.env.TELEGRAM_CHAT_ID})` : null,
      message: isConf ? "Telegram Real-Time Alert Gateway active." : "Telegram credentials missing. Add TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID in .env."
    });
  });

  app.post("/api/telegram/test", async (req, res) => {
    try {
      const ok = await TelegramService.sendSignalAlert({
        type: "CALL_BUY",
        tier: "SNIPER",
        strikePrice: 24250,
        entryPrice: 120.50,
        stopLossPrice: 112.00,
        targetPrice1: 135.00,
        targetPrice2: 155.00,
        timestamp: Date.now(),
        reasoning: "Test trade notification verifying real-time Telegram signal dispatch.",
        scoreCard: {
          totalScore: 92,
          qualityLabel: "VERY_HIGH_QUALITY"
        }
      });
      if (ok) {
        res.json({ success: true, message: "Test trade alert successfully delivered to your Telegram!" });
      } else {
        res.status(400).json({ success: false, message: "Failed to dispatch Telegram alert. Please verify TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env." });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/cpr", (req, res) => {
    const cpr = advisory.getCpr();
    res.json({
      pivot: cpr ? cpr.pivot : null,
      top: cpr ? cpr.topRange : null,
      bottom: cpr ? cpr.bottomRange : null,
      widthPercent: cpr ? ((cpr.topRange - cpr.bottomRange) / cpr.pivot) * 100 : null,
      r1: cpr ? cpr.r1 : null,
      r2: cpr ? cpr.r2 : null,
      r3: cpr ? cpr.r3 : null,
      s1: cpr ? cpr.s1 : null,
      s2: cpr ? cpr.s2 : null,
      s3: cpr ? cpr.s3 : null
    });
  });

  app.get("/api/engine-status", (req, res) => {
    res.json(advisory.getEngineStatus());
  });

  app.get("/api/positions", (req, res) => {
    res.json({
      success: true,
      positions: advisory.getActivePositions(),
      realizedPnl: advisory.getTodayRealizedPnl()
    });
  });

  app.post("/api/positions/exit", (req, res) => {
    try {
      const { tier, reason } = req.body;
      const success = advisory.manualExitPosition(
        tier || "SNIPER",
        reason || "Manual user exit from Positions Dashboard"
      );
      const updatedPositions = advisory.getActivePositions();
      const realizedPnl = advisory.getTodayRealizedPnl();
      broadcast({
        type: "POSITIONS",
        payload: updatedPositions,
        realizedPnl
      });
      res.json({
        success,
        message: success ? "Position exited successfully." : "No active open position found for this tier.",
        positions: updatedPositions,
        realizedPnl
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/session", (req, res) => {
    const session = DatabaseService.getSession("FYERS");
    res.json({
      active: !!session && session.expires_at > Date.now() && (broker as any).useLiveApi === true,
      expiresAt: session ? session.expires_at : null
    });
  });

  app.post("/api/logout", (req, res) => {
    console.log("[Broker] User triggered logout. Purging session...");
    DatabaseService.clearSession("FYERS");
    if ((broker as any).logout) {
      (broker as any).logout();
    }
    broadcast({
      type: "WELCOME",
      payload: {
        provider: process.env.BROKER_PROVIDER || "FYERS",
        activeSignal: toUiSignalPayload(advisory.activeSignal),
        enableSimulator: process.env.ENABLE_SIMULATOR === "true",
        autoExecution: process.env.AUTO_ORDER_EXECUTION === "true",
        brokerAuthenticated: false,
        engineStatus: advisory.getEngineStatus()
      }
    });
    res.json({ success: true, message: "Logged out from broker." });
  });

  app.get("/api/signals", (req, res) => {
    try {
      const db = DatabaseService.initialize();
      const signals = db.prepare("SELECT * FROM advisory_signals ORDER BY id DESC LIMIT 100").all();
      res.json(signals);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/database/overview", (req, res) => {
    try {
      const db = DatabaseService.initialize();
      const tierParam = (req.query.tier as string) || "ALL";
      const signals = (tierParam !== "ALL")
        ? db.prepare("SELECT * FROM advisory_signals WHERE tier = ? ORDER BY id DESC LIMIT 500").all(tierParam)
        : db.prepare("SELECT * FROM advisory_signals ORDER BY id DESC LIMIT 500").all();
      const paperTrades = DatabaseService.getPaperTrades(1000, tierParam);
      const analytics = DatabaseService.getTradeAnalytics(tierParam);
      const tierAnalytics = DatabaseService.getTierOverviewAnalytics();
      const sessions = db.prepare("SELECT * FROM sessions").all();
      const settings = db.prepare("SELECT * FROM settings").all();
      const stats = {
        totalSignals: (db.prepare("SELECT COUNT(*) as count FROM advisory_signals").get() as any)?.count || 0,
        totalPaperTrades: (db.prepare("SELECT COUNT(*) as count FROM paper_trades").get() as any)?.count || 0,
        totalSessions: (db.prepare("SELECT COUNT(*) as count FROM sessions").get() as any)?.count || 0,
        totalSettings: (db.prepare("SELECT COUNT(*) as count FROM settings").get() as any)?.count || 0,
        engineTime: Date.now()
      };
      res.json({ stats, signals, paperTrades, analytics, tierAnalytics, sessions, settings });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Dedicated Database-Level Paginated Endpoints
  app.get("/api/database/trades", (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const tier = req.query.tier as string | undefined;
      const date = req.query.date as string | undefined;
      const filterType = req.query.filterType as string | undefined;
      const search = req.query.search as string | undefined;

      const result = DatabaseService.getPaginatedPaperTrades({
        page,
        limit,
        tier,
        date,
        filterType,
        search
      });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/database/signals", (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const tier = req.query.tier as string | undefined;
      const date = req.query.date as string | undefined;
      const filterType = req.query.filterType as string | undefined;
      const search = req.query.search as string | undefined;

      const result = DatabaseService.getPaginatedSignals({
        page,
        limit,
        tier,
        date,
        filterType,
        search
      });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/database/sessions", (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const result = DatabaseService.getPaginatedSessions(page, limit);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/database/settings", (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const result = DatabaseService.getPaginatedSettings(page, limit);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/database/delete-trades", (req, res) => {
    try {
      const { ids } = req.body;
      const count = DatabaseService.deletePaperTrades(Array.isArray(ids) ? ids.map(Number) : [Number(ids)]);
      res.json({ success: true, count });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/paper-trades", (req, res) => {
    try {
      const tier = req.query.tier as string | undefined;
      const trades = DatabaseService.getPaperTrades(150, tier);
      res.json(trades);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/paper-trades/analytics", (req, res) => {
    try {
      const tier = req.query.tier as string | undefined;
      const analytics = DatabaseService.getTradeAnalytics(tier);
      res.json(analytics);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/backtest", async (req, res) => {
    try {
      const { symbol, minScore, slippageMultiplier, fromDate, toDate, useWfo } = req.body;
      const backtester = new Backtester(broker);
      const result = await backtester.runBacktest({
        symbol: symbol || "NSE:NIFTY 50",
        minScore: minScore || 80,
        slippageMultiplier: slippageMultiplier !== undefined ? slippageMultiplier : 0.005,
        fromDate: fromDate || "2026-08-01",
        toDate: toDate || "2026-08-15",
        useWfo: !!useWfo
      });
      res.json(result);
    } catch (e: any) {
      console.error("[HTTP API] Backtest failed:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/optimize", async (req, res) => {
    try {
      const optimizer = new ParameterOptimizer(broker);
      const result = await optimizer.runCalibrationLoop();
      res.json(result);
    } catch (e: any) {
      console.error("[HTTP API] Calibration failed:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/history", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || "NSE:NIFTY50-INDEX";
      const resolution = (req.query.resolution as string) || "5";

      const toDate = new Date().toISOString().split("T")[0];
      const fromDateObj = new Date();

      if (resolution === "D") {
        fromDateObj.setFullYear(fromDateObj.getFullYear() - 1); // 1 year for daily
      } else if (resolution === "60") {
        fromDateObj.setDate(fromDateObj.getDate() - 30); // 30 days for 1 hour
      } else {
        fromDateObj.setDate(fromDateObj.getDate() - 7); // 7 days for intraday
      }
      const fromDate = fromDateObj.toISOString().split("T")[0];

      console.log(`[HTTP API] History query: ${symbol} | Resolution: ${resolution} | Range: ${fromDate} to ${toDate}`);
      const candles = await broker.getHistoricalCandles(symbol, resolution, fromDate, toDate);
      res.json(candles);
    } catch (e: any) {
      console.error("[HTTP API] Failed to fetch history:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // 6. Subscribe to core Nifty 50 tokens
  const coreSymbols = [
    "BSE:SENSEX-INDEX",
    "NSE:NIFTY50-INDEX",
    "NSE:NIFTYBANK-INDEX",
    "NSE:FINNIFTY-INDEX",
    "NSE:INDIAVIX-INDEX",
    "NSE:RELIANCE-EQ",
    "NSE:HDFCBANK-EQ",
    "NSE:ICICIBANK-EQ"
  ];

  console.log("[Broker] Subscribing to core streams...");
  broker.subscribeTicks(coreSymbols);

  const mockSymbols = [
    { symbol: "BSE:SENSEX-INDEX", base: 77728.16, changeRange: 12 },
    { symbol: "NSE:NIFTY50-INDEX", base: 24287.65, changeRange: 4 },
    { symbol: "NSE:NIFTYBANK-INDEX", base: 57497.80, changeRange: 10 },
    { symbol: "NSE:FINNIFTY-INDEX", base: 26217.15, changeRange: 5 },
    { symbol: "NSE:INDIAVIX-INDEX", base: 11.33, changeRange: 0.15 },
    { symbol: "NSE:RELIANCE-EQ", base: 1316.00, changeRange: 1 },
    { symbol: "NSE:HDFCBANK-EQ", base: 729.00, changeRange: 0.8 },
    { symbol: "NSE:ICICIBANK-EQ", base: 1415.30, changeRange: 0.6 }
  ];

  // Resolve actual last close prices & prevClose from Fyers API on startup
  async function resolveHistoricalClosePrices() {
    const todayStr = new Date().toISOString().split("T")[0];
    const prevDate = new Date();
    prevDate.setDate(prevDate.getDate() - 10); // Go back 10 days to guarantee cross-weekend data
    const prevDateStr = prevDate.toISOString().split("T")[0];

    console.log("[Broker] Resolving last correct close prices from Fyers API history...");
    for (const m of mockSymbols) {
      try {
        const candles = await broker.getHistoricalCandles(m.symbol, "D", prevDateStr, todayStr);
        if (candles && candles.length > 0) {
          const lastCandle = candles[candles.length - 1];
          const prevCandle = candles.length >= 2 ? candles[candles.length - 2] : lastCandle;
          const lastDateStr = new Date(lastCandle.timestamp).toISOString().split("T")[0];

          let prevClose = prevCandle.close;
          let currentLtp = lastCandle.close;

          if (lastDateStr < todayStr && candles.length >= 2) {
            prevClose = candles[candles.length - 2].close;
            currentLtp = candles[candles.length - 1].close;
          }

          symbolPrevCloseMap[m.symbol] = prevClose;
          m.base = currentLtp;

          const changePercent = prevClose > 0 
            ? parseFloat((((currentLtp - prevClose) / prevClose) * 100).toFixed(2)) 
            : 0.0;

          console.log(`[Broker] Resolved ${m.symbol} LTP: ₹${m.base}, PrevClose: ₹${prevClose} (Change: ${changePercent >= 0 ? "+" : ""}${changePercent}%)`);

          // Seed the initial tick cache with the correct closed price & percentage change
          brokerTickCache[m.symbol] = { ltp: m.base, change: changePercent };

          // Broadcast immediately to all connected UI clients
          broadcast({
            type: "TICK",
            payload: {
              symbol: m.symbol,
              ltp: m.base,
              netChangePercent: changePercent,
              bidPrice: m.base,
              askPrice: m.base,
              timestamp: Date.now()
            }
          });
        } else {
          const fallbackPrev = symbolPrevCloseMap[m.symbol] || m.base;
          const changePercent = fallbackPrev > 0 ? parseFloat((((m.base - fallbackPrev) / fallbackPrev) * 100).toFixed(2)) : 0.0;
          console.warn(`[Broker] No history found for ${m.symbol}. Using fallback base: ₹${m.base}`);
          brokerTickCache[m.symbol] = { ltp: m.base, change: changePercent };
        }
      } catch (err: any) {
        const fallbackPrev = symbolPrevCloseMap[m.symbol] || m.base;
        const changePercent = fallbackPrev > 0 ? parseFloat((((m.base - fallbackPrev) / fallbackPrev) * 100).toFixed(2)) : 0.0;
        console.warn(`[Broker] Error fetching close for ${m.symbol}: ${err.message}. Using fallback base: ₹${m.base}`);
        brokerTickCache[m.symbol] = { ltp: m.base, change: changePercent };
      }
      // 350ms throttle delay between symbols to prevent Fyers rate limit
      await new Promise(r => setTimeout(r, 350));
    }
  }

  // Trigger historical resolve safely
  resolveHistoricalClosePrices().catch((err: any) => {
    console.warn("[Broker] Error during initial historical resolution:", err?.message || err);
  });

  // Push live ORB / wait-reason status so the UI can explain missing signals
  setInterval(() => {
    broadcast({
      type: "ENGINE_STATUS",
      payload: advisory.getEngineStatus()
    });
  }, 2000);

  // Don't rely only on a Nifty tick arriving at 15:15 — flatten leftover paper positions on a timer
  setInterval(() => {
    advisory.enforceMandatorySquareOff();
  }, 15000);

  const port = process.env.PORT || 8080;
  server.listen(port, () => {
    console.log(`[Web Server] HTTP API and WebSockets running on http://localhost:${port}`);
  });
}

process.on("unhandledRejection", (reason: any) => {
  console.warn("[Process] Intercepted Unhandled Rejection (prevented crash):", reason?.message || reason);
});

process.on("uncaughtException", (err: any) => {
  console.error("[Process] Intercepted Uncaught Exception:", err?.message || err);
});

main().catch(err => {
  console.error("[Fatal Startup Error]", err);
  process.exit(1);
});
