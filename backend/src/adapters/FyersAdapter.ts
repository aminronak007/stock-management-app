import { IBrokerAdapter, Candle, CompactTick, OptionChainItem } from "./IBrokerAdapter";
import { DatabaseService } from "../utils/database";

const fyers = require("fyers-api-v3");

export class FyersAdapter implements IBrokerAdapter {
  private accessToken: string | null = null;
  private tickCallbacks: ((tick: CompactTick) => void)[] = [];
  private subscribedSymbols: Set<string> = new Set();
  private latestTicks: { [symbol: string]: number } = {};
  private optionChainCache: { [symbol: string]: { data: OptionChainItem[]; expiryTime: number } } = {};
  
  // Real Fyers API clients
  private fyersClient: any = null;
  private dataSocket: any = null;
  private useLiveApi: boolean = false;
  
  public async initialize(): Promise<boolean> {
    console.log("[FyersAdapter] Initializing Fyers API v3...");
    const clientId = process.env.FYERS_CLIENT_ID;
    const secretKey = process.env.FYERS_SECRET_KEY;

    if (!clientId || !secretKey) {
      console.warn("[FyersAdapter] Credentials (CLIENT_ID / SECRET_KEY) missing in .env. Running in MOCK/SIMULATION mode.");
      this.useLiveApi = false;
      return false;
    }

    // Attempt to load token from SQLite cache
    const session = DatabaseService.getSession("FYERS");
    const now = Date.now();

    if (session && session.expires_at > now) {
      this.accessToken = session.access_token;
      console.log("[FyersAdapter] Valid cached session token loaded from database.");
    } else {
      console.warn("[FyersAdapter] No valid cached token found. Manual daily 2FA login required.");
      // In dry-run we fall back to mock token.
      this.accessToken = process.env.FYERS_ACCESS_TOKEN || "MOCK_TOKEN";
    }

    try {
      // Setup REST client
      this.fyersClient = new fyers.fyersModel();
      this.fyersClient.setAppId(clientId);
      this.fyersClient.setAccessToken(this.accessToken);
      
      // Test the credentials with a quick profile check
      const profile = await this.fyersClient.get_profile();
      if (profile && profile.s === "ok") {
        console.log(`[FyersAdapter] Live API Connected. User Name: ${profile.data?.name || "Ronak Amin"}`);
        this.useLiveApi = true;
        this.initializeWebSocket(clientId);
      } else {
        console.warn("[FyersAdapter] Daily session token has expired (SEBI 5:00 AM rule). Please click '🔒 AUTH BROKER' on the dashboard to login for today.");
        DatabaseService.clearSession("FYERS");
        this.accessToken = null;
        this.useLiveApi = false;
      }
    } catch (e) {
      console.warn("[FyersAdapter] Daily session token has expired (SEBI 5:00 AM rule). Please click '🔒 AUTH BROKER' on the dashboard to login for today.");
      DatabaseService.clearSession("FYERS");
      this.accessToken = null;
      this.useLiveApi = false;
    }

    return this.useLiveApi;
  }

  private initializeWebSocket(clientId: string): void {
    if (!this.accessToken) return;
    
    console.log("[FyersAdapter] Establishing live WebSocket stream...");
    
    try {
      this.dataSocket = fyers.fyersDataSocket.getInstance(
        `${clientId}:${this.accessToken}`,
        "./",
        true
      );

      this.dataSocket.on("connect", () => {
        console.log("[FyersAdapter] WebSocket Connected successfully.");
        try {
          if (this.dataSocket.FullMode) {
            this.dataSocket.mode(this.dataSocket.FullMode);
          }
          if (this.subscribedSymbols.size > 0) {
            this.dataSocket.subscribe(Array.from(this.subscribedSymbols), false, 1);
          }
        } catch (e) {
          console.warn("[FyersAdapter] Error setting socket mode:", e);
        }
      });

      this.dataSocket.on("message", (message: any) => {
        if (!message) return;

        let payload = message;
        if (typeof message === "string") {
          try {
            payload = JSON.parse(message);
          } catch {
            return;
          }
        }

        // Unpack if wrapped in .data or .d
        if (payload && payload.data) {
          payload = payload.data;
        } else if (payload && payload.d) {
          payload = payload.d;
        }

        const processItem = (item: any) => {
          if (!item || typeof item !== "object") return;

          // Extract LTP from several possible fields
          const ltp = item.ltp ?? item.iv ?? item.ic ?? item.last_price ?? item.lp ?? item.cmd?.c ?? 0;
          const netChangePercent = item.chp ?? item.cng ?? item.nc ?? item.cmd?.chp ?? 0;
          const volume = item.vol ?? item.v ?? item.volume ?? 0;
          const bidPrice = item.bid ?? item.bp ?? item.bidPrice ?? ltp;
          const askPrice = item.ask ?? item.ap ?? item.askPrice ?? ltp;

          const tsSeconds = item.tvalue ?? item.ltt ?? item.tt ?? null;
          const timestamp = tsSeconds ? Number(tsSeconds) * 1000 : Date.now();

          const rawSym = item.symbol ?? item.tk ?? item.ts ?? item.name ?? item.cmd?.n ?? "UNKNOWN";
          if (rawSym === "UNKNOWN") return;

          const symbol = this.normalizeFyersSymbol(String(rawSym));

          const tick: CompactTick = {
            symbol,
            ltp: Number(ltp || 0),
            netChangePercent: Number(netChangePercent || 0),
            volume: Number(volume || 0),
            bidPrice: Number(bidPrice || ltp || 0),
            askPrice: Number(askPrice || ltp || 0),
            timestamp
          };

          if (tick.ltp > 0) {
            this.latestTicks[tick.symbol] = tick.ltp;
            this.tickCallbacks.forEach(cb => cb(tick));
          }
        };

        if (Array.isArray(payload)) {
          payload.forEach(processItem);
        } else if (typeof payload === "object") {
          processItem(payload);
        }
      });

      this.dataSocket.on("error", (err: any) => {
        console.error("[FyersAdapter] WebSocket Error:", err);
      });

      this.dataSocket.on("close", () => {
        console.warn("[FyersAdapter] WebSocket Connection Closed.");
      });

      this.dataSocket.connect();
      try {
        if (typeof this.dataSocket.autoreconnect === "function") {
          this.dataSocket.autoreconnect();
        }
      } catch {}

      // Start fallback quotes polling loop
      this.startQuotesPolling();
    } catch (e) {
      console.error("[FyersAdapter] WebSocket client failed to launch.", e);
    }
  }

  private quotesPollingTimer: NodeJS.Timeout | null = null;
  private startQuotesPolling(): void {
    if (this.quotesPollingTimer) return;

    this.quotesPollingTimer = setInterval(async () => {
      if (!this.useLiveApi || !this.fyersClient || this.subscribedSymbols.size === 0) return;
      try {
        const symbolsArray = Array.from(this.subscribedSymbols);
        const res = await this.fyersClient.getQuotes({ symbols: symbolsArray.join(",") });
        if (res && res.s === "ok" && Array.isArray(res.d)) {
          res.d.forEach((item: any) => {
            const rawSym = item.n || item.name || item.symbol || item.v?.symbol;
            if (!rawSym) return;
            const symbol = this.normalizeFyersSymbol(rawSym);
            const ltp = item.v?.lp ?? item.v?.last_price ?? item.lp ?? 0;
            const chp = item.v?.chp ?? item.chp ?? 0;
            const volume = item.v?.volume ?? item.v?.vol ?? 0;
            const bid = item.v?.bid ?? ltp;
            const ask = item.v?.ask ?? ltp;

            if (ltp > 0) {
              const tick: CompactTick = {
                symbol,
                ltp: Number(ltp),
                netChangePercent: Number(chp),
                volume: Number(volume),
                bidPrice: Number(bid),
                askPrice: Number(ask),
                timestamp: Date.now()
              };
              this.tickCallbacks.forEach(cb => cb(tick));
            }
          });
        }
      } catch (err: any) {
        // Silent catch
      }
    }, 2500);
  }

  // Normalize human-friendly Fyers/HSM symbols into internal symbol keys used by the app
  private normalizeFyersSymbol(raw: string): string {
    const s = raw.trim();
    // Common mappings for indices
    const map: { [k: string]: string } = {
      "Nifty 50": "NSE:NIFTY50-INDEX",
      "Nifty Bank": "NSE:NIFTYBANK-INDEX",
      "India VIX": "NSE:INDIAVIX-INDEX",
      "Nifty Fin Service": "NSE:FINNIFTY-INDEX",
      "SENSEX": "BSE:SENSEX-INDEX"
    };

    if (map[s]) return map[s];

    // If already looks like an NSE symbol or contains NSE/KW prefixes, return as-is
    if (s.includes("NSE:") || s.includes("BSE:") || s.includes("-INDEX") || s.includes("-EQ")) {
      return s;
    }

    // Fallback: uppercase and remove spaces to attempt a generic conversion
    const normalized = s.replace(/\s+/g, "").toUpperCase();
    // Common heuristic: NIFTY50 -> NSE:NIFTY50-INDEX
    if (/NIFTY/.test(normalized) && !normalized.includes("NSE:")) return `NSE:${normalized}-INDEX`;

    return s;
  }

  public getAccessToken(): string | null {
    return this.accessToken;
  }

  public logout(): void {
    this.accessToken = null;
    this.useLiveApi = false;
    if (this.dataSocket) {
      try {
        this.dataSocket.close();
      } catch {}
    }
    if (this.quotesPollingTimer) {
      clearInterval(this.quotesPollingTimer);
      this.quotesPollingTimer = null;
    }
    DatabaseService.clearSession("FYERS");
    console.log("[FyersAdapter] User session cleared and broker disconnected.");
  }

  public subscribeTicks(symbols: string[]): void {
    symbols.forEach(symbol => this.subscribedSymbols.add(symbol));
    console.log(`[FyersAdapter] Subscribed ticks for: ${symbols.join(", ")}`);
    
    if (this.useLiveApi && this.dataSocket) {
      try {
        this.dataSocket.subscribe(symbols, false, 1);
        if (this.dataSocket.FullMode) {
          this.dataSocket.mode(this.dataSocket.FullMode);
        }
      } catch (err) {
        console.error("[FyersAdapter] Error in dataSocket.subscribe:", err);
      }
    }
  }

  public unsubscribeTicks(symbols: string[]): void {
    symbols.forEach(symbol => this.subscribedSymbols.delete(symbol));
    console.log(`[FyersAdapter] Unsubscribed ticks for: ${symbols.join(", ")}`);
    
    if (this.useLiveApi && this.dataSocket) {
      try {
        this.dataSocket.unsubscribe(symbols, false, 1);
      } catch (err) {
        console.error("[FyersAdapter] Error in dataSocket.unsubscribe:", err);
      }
    }
  }

  public onTick(callback: (tick: CompactTick) => void): void {
    this.tickCallbacks.push(callback);
  }

  public simulateTick(tick: CompactTick): void {
    if (this.subscribedSymbols.has(tick.symbol)) {
      this.tickCallbacks.forEach(cb => cb(tick));
    }
  }

  public async getHistoricalCandles(
    symbol: string,
    resolution: string,
    fromDate: string,
    toDate: string
  ): Promise<Candle[]> {
    if (this.useLiveApi && this.fyersClient) {
      const fetchFromFyers = async (): Promise<Candle[] | null> => {
        const params = {
          symbol: symbol,
          resolution: resolution,
          date_format: "1",
          range_from: fromDate,
          range_to: toDate,
          cont_flag: "1"
        };
        const res = await this.fyersClient.getHistory(params);
        if (res && res.s === "ok" && Array.isArray(res.candles)) {
          return res.candles.map((c: any) => ({
            timestamp: c[0] * 1000,
            open: c[1],
            high: c[2],
            low: c[3],
            close: c[4],
            volume: c[5]
          }));
        }
        return null;
      };

      try {
        console.log(`[FyersAdapter] Fetching real historical data for: ${symbol}`);
        const candles = await fetchFromFyers();
        if (candles) return candles;
      } catch (err: any) {
        if (err?.message?.includes("limit") || typeof err === "string" && err.includes("limit")) {
          // Rate limit backoff: wait 400ms and retry once
          await new Promise(r => setTimeout(r, 400));
          try {
            const retryCandles = await fetchFromFyers();
            if (retryCandles) return retryCandles;
          } catch {}
        }
        console.warn(`[FyersAdapter] Historical data query rejected for ${symbol}:`, err?.message || err);
      }
    }

    // Accurate realistic market baselines
    const getSymbolBasePrice = (sym: string): number => {
      if (sym.includes("SENSEX")) return 77728.16;
      if (sym.includes("NIFTYBANK") || sym.includes("BANKNIFTY")) return 57497.80;
      if (sym.includes("FINNIFTY")) return 26217.15;
      if (sym.includes("INDIAVIX") || sym.includes("VIX")) return 11.33;
      if (sym.includes("NIFTY")) return 24287.65;
      if (sym.includes("RELIANCE")) return 1316.00;
      if (sym.includes("HDFCBANK")) return 729.00;
      if (sym.includes("ICICIBANK")) return 1415.30;
      if (sym.includes("TCS")) return 4180.00;
      if (sym.includes("SBIN")) return 840.00;
      return 1500.00;
    };

    const mockCandles: Candle[] = [];
    const basePrice = getSymbolBasePrice(symbol);
    let currentPrice = basePrice;
    let time = new Date(fromDate).getTime();
    const volatilityStep = basePrice > 10000 ? 15 : (basePrice < 50 ? 0.05 : 1.5);
    
    for (let i = 0; i < 100; i++) {
      const change = (Math.random() - 0.49) * volatilityStep;
      const open = currentPrice;
      const close = currentPrice + change;
      const high = Math.max(open, close) + Math.random() * (volatilityStep * 0.3);
      const low = Math.min(open, close) - Math.random() * (volatilityStep * 0.3);
      mockCandles.push({
        timestamp: time,
        open: parseFloat(open.toFixed(2)),
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        close: parseFloat(close.toFixed(2)),
        volume: Math.floor(Math.random() * 10000)
      });
      currentPrice = close;
      time += 60 * 1000;
    }
    return mockCandles;
  }

  public async getOptionChain(underlying: string): Promise<OptionChainItem[]> {
    const cached = this.optionChainCache[underlying];
    const now = Date.now();
    if (cached && cached.expiryTime > now && cached.data.length > 0) {
      return cached.data;
    }

    if (this.useLiveApi && this.fyersClient) {
      try {
        console.log(`[FyersAdapter] Fetching real Option Chain for: ${underlying}`);
        const params = {
          symbol: underlying,
          strikecount: 10
        };
        
        const res = await this.fyersClient.getOptionChain(params);
        if (res && res.s === "ok" && res.data && Array.isArray(res.data.optionsChain)) {
          const expiry = res.data.expiry;
          const chain = res.data.optionsChain.map((opt: any) => ({
            strikePrice: opt.strikePrice,
            expiryDate: expiry,
            underlyingSymbol: underlying,
            call: {
              symbol: opt.callSymbol,
              ltp: opt.callLtp,
              openInterest: opt.callOi,
              changeOpenInterest: opt.callOiChange,
              volume: opt.callVolume,
              impliedVolatility: opt.callIv
            },
            put: {
              symbol: opt.putSymbol,
              ltp: opt.putLtp,
              openInterest: opt.putOi,
              changeOpenInterest: opt.putOiChange,
              volume: opt.putVolume,
              impliedVolatility: opt.putIv
            }
          }));

          // Cache for 3 seconds to prevent rate limiting
          this.optionChainCache[underlying] = {
            data: chain,
            expiryTime: now + 3000
          };
          return chain;
        }
      } catch (err: any) {
        console.warn(`[FyersAdapter] Option chain query rejected for ${underlying}:`, err?.message || err);
      }
    }

    // Option Chain Fallback centered around current live spot price
    const spot = this.latestTicks[underlying] || (underlying.includes("BANK") ? 57200 : 24250);
    const strikeInterval = underlying.includes("BANK") ? 100 : 50;
    const baseStrike = Math.round(spot / strikeInterval) * strikeInterval;
    const options: OptionChainItem[] = [];
    const expiry = "2026-08-20";

    for (let strike = baseStrike - (strikeInterval * 6); strike <= baseStrike + (strikeInterval * 6); strike += strikeInterval) {
      const distanceFromSpot = strike - spot;
      const callLtp = Math.max(5, 140 - distanceFromSpot * 0.55 + (Math.random() - 0.5) * 5);
      const putLtp = Math.max(5, 140 + distanceFromSpot * 0.55 + (Math.random() - 0.5) * 5);
      options.push({
        strikePrice: strike,
        expiryDate: expiry,
        underlyingSymbol: underlying,
        call: {
          symbol: `${underlying}${expiry}C${strike}`,
          ltp: parseFloat(callLtp.toFixed(2)),
          openInterest: Math.floor(Math.random() * 2000000),
          changeOpenInterest: Math.floor((Math.random() - 0.3) * 500000),
          volume: Math.floor(Math.random() * 50000),
          impliedVolatility: 13.5 + Math.random() * 2
        },
        put: {
          symbol: `${underlying}${expiry}P${strike}`,
          ltp: parseFloat(putLtp.toFixed(2)),
          openInterest: Math.floor(Math.random() * 2000000),
          changeOpenInterest: Math.floor((Math.random() - 0.3) * 500000),
          volume: Math.floor(Math.random() * 50000),
          impliedVolatility: 14.0 + Math.random() * 2
        }
      });
    }
    return options;
  }

  public async placeOptionOrder(
    symbol: string,
    qty: number,
    direction: "BUY" | "SELL",
    type: "LIMIT" | "MARKET",
    price?: number
  ): Promise<string> {
    if (!this.useLiveApi || !this.fyersClient) {
      const mockOrderId = `MOCK_FYERS_ORD_${Math.floor(Math.random() * 900000) + 100000}`;
      console.log(`[FyersAdapter PAPER TRADE] Simulated routing ${direction} order for ${qty}x ${symbol} (Type: ${type}, Price: ${price || "MARKET"}). OrderID: ${mockOrderId}`);
      return mockOrderId;
    }

    try {
      const orderParams = {
        symbol: symbol,
        qty: qty,
        type: type === "LIMIT" ? 1 : 2,
        side: direction === "BUY" ? 1 : -1,
        productType: "INTRADAY",
        limitPrice: type === "LIMIT" ? (price || 0) : 0,
        stopPrice: 0,
        validity: "DAY",
        disclosedQty: 0,
        offlineOrder: "False"
      };

      console.log(`[FyersAdapter API] Submitting order to Fyers for ${qty}x ${symbol} | Side: ${direction}`);
      const res = await this.fyersClient.place_order(orderParams);
      if (res && res.s === "ok") {
        console.log(`[FyersAdapter API] Order placed successfully. Fyers ID: ${res.id}`);
        return res.id;
      } else {
        throw new Error(res ? res.message : "Fyers order placement failed.");
      }
    } catch (e: any) {
      console.error("[FyersAdapter API] Order placement failed:", e.message);
      throw e;
    }
  }

  public async generateSessionFromAuthCode(authCode: string): Promise<boolean> {
    const clientId = process.env.FYERS_CLIENT_ID;
    const secretKey = process.env.FYERS_SECRET_KEY;
    const redirectUrl = process.env.FYERS_REDIRECT_URL || "http://localhost:8080/api/fyers-callback";

    if (!clientId || !secretKey) {
      throw new Error("Credentials missing.");
    }

    try {
      const fyersClient = new fyers.fyersModel();
      fyersClient.setAppId(clientId);
      fyersClient.setRedirectUrl(redirectUrl);

      console.log(`[FyersAdapter] Exchanging authorization code: [${authCode.substring(0, 8)}...]`);
      const response = await fyersClient.generate_access_token({
        client_id: clientId,
        secret_key: secretKey,
        auth_code: authCode
      });

      if (response && response.s === "ok") {
        this.accessToken = response.access_token;
        const now = new Date();
        const next5am = new Date(now);
        if (now.getHours() >= 5) {
          next5am.setDate(next5am.getDate() + 1);
        }
        next5am.setHours(5, 30, 0, 0);
        DatabaseService.saveSession("FYERS", this.accessToken!, next5am.getTime());
        
        // Re-setup REST client and WebSocket
        this.fyersClient = new fyers.fyersModel();
        this.fyersClient.setAppId(clientId);
        this.fyersClient.setAccessToken(this.accessToken);
        this.useLiveApi = true;
        this.initializeWebSocket(clientId);
        console.log("[FyersAdapter] Daily access token resolved and saved successfully via callback endpoint.");
        return true;
      } else {
        throw new Error(response.message || "Invalid auth code");
      }
    } catch (e: any) {
      console.error("[FyersAdapter] Token exchange failed:", e.message);
      throw e;
    }
  }
}
