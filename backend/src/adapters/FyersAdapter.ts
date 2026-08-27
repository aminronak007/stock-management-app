import { IBrokerAdapter, Candle, CompactTick, OptionChainItem } from "./IBrokerAdapter";
import { DatabaseService } from "../utils/database";
import * as path from "path";
import * as fs from "fs";

const fyers = require("fyers-api-v3");

export class FyersAdapter implements IBrokerAdapter {
  private accessToken: string | null = null;
  private tickCallbacks: ((tick: CompactTick) => void)[] = [];
  private subscribedSymbols: Set<string> = new Set();
  private latestTicks: { [symbol: string]: number } = {};
  private optionChainCache: { [symbol: string]: { data: OptionChainItem[]; expiryTime: number; fetchedAt: number } } = {};
  private optionChainInflight: { [symbol: string]: Promise<OptionChainItem[]> } = {};
  private optionChainBackoffUntil: { [symbol: string]: number } = {};
  private historyCache: { [key: string]: { candles: Candle[]; expiry: number } } = {};
  private historyInflight: Map<string, Promise<Candle[]>> = new Map();
  private static readonly OPTION_CHAIN_TTL_MS = 30_000;
  private static readonly OPTION_CHAIN_STALE_MS = 5 * 60_000;
  private static readonly OPTION_CHAIN_BACKOFF_MS = 30_000;
  
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
      const logsDir = path.join(__dirname, "../../logs");
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      this.dataSocket = fyers.fyersDataSocket.getInstance(
        `${clientId}:${this.accessToken}`,
        logsDir,
        false
      );

      if (typeof this.dataSocket.removeAllListeners === "function") {
        this.dataSocket.removeAllListeners("connect");
        this.dataSocket.removeAllListeners("message");
        this.dataSocket.removeAllListeners("error");
        this.dataSocket.removeAllListeners("close");
      }

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
          const ltp = Number(item.ltp ?? item.iv ?? item.ic ?? item.last_price ?? item.lp ?? item.cmd?.c ?? 0);
          const prevClosePrice = Number(item.prev_close_price ?? item.prevClose ?? item.cmd?.prev_close_price ?? 0);
          
          let netChange = Number(item.ch ?? item.cng ?? item.cmd?.ch ?? 0);
          let netChangePercent = Number(item.chp ?? item.cmd?.chp ?? item.nc ?? 0);

          if (netChange === 0 && prevClosePrice > 0 && ltp > 0) {
            netChange = parseFloat((ltp - prevClosePrice).toFixed(2));
          }
          if (netChangePercent === 0 && prevClosePrice > 0 && ltp > 0) {
            netChangePercent = parseFloat((((ltp - prevClosePrice) / prevClosePrice) * 100).toFixed(2));
          }

          const volume = Number(item.vol ?? item.v ?? item.volume ?? 0);
          const bidPrice = Number(item.bid ?? item.bp ?? item.bidPrice ?? ltp);
          const askPrice = Number(item.ask ?? item.ap ?? item.askPrice ?? ltp);

          const tsSeconds = item.tvalue ?? item.ltt ?? item.tt ?? null;
          const timestamp = tsSeconds ? Number(tsSeconds) * 1000 : Date.now();

          const rawSym = item.symbol ?? item.tk ?? item.ts ?? item.name ?? item.cmd?.n ?? "UNKNOWN";
          if (rawSym === "UNKNOWN") return;

          const symbol = this.normalizeFyersSymbol(String(rawSym));

          const tick: CompactTick = {
            symbol,
            ltp,
            netChange: netChange || undefined,
            netChangePercent,
            prevClose: prevClosePrice > 0 ? prevClosePrice : undefined,
            volume,
            bidPrice,
            askPrice,
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
    } catch (e) {
      console.error("[FyersAdapter] WebSocket client failed to launch.", e);
    }
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
    const cacheKey = `${symbol}_${resolution}_${fromDate}_${toDate}`;
    const now = Date.now();
    const cached = this.historyCache[cacheKey];

    if (cached && cached.expiry > now && cached.candles.length > 0) {
      return cached.candles;
    }

    const inflight = this.historyInflight.get(cacheKey);
    if (inflight) {
      return inflight;
    }

    const fetchPromise = (async (): Promise<Candle[]> => {
      try {
        const ttlMs = resolution === "D" ? 300_000 : 15_000;

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
            if (candles && candles.length > 0) {
              this.historyCache[cacheKey] = { candles, expiry: now + ttlMs };
              return candles;
            }
          } catch (err: any) {
            const errMsg = String(err?.message || err || "").toLowerCase();
            const isTransientNetErr = 
              errMsg.includes("limit") || 
              errMsg.includes("econnreset") || 
              errMsg.includes("etimedout") ||
              errMsg.includes("socket");

            if (isTransientNetErr) {
              await new Promise(r => setTimeout(r, 400));
              try {
                const retryCandles = await fetchFromFyers();
                if (retryCandles && retryCandles.length > 0) {
                  this.historyCache[cacheKey] = { candles: retryCandles, expiry: now + ttlMs };
                  return retryCandles;
                }
              } catch {}
            }
            console.warn(`[FyersAdapter] Historical data query rejected for ${symbol}:`, err?.message || err);
          }

          if (cached && cached.candles.length > 0) {
            return cached.candles;
          }

          return [];
        }

        const dbQuote = DatabaseService.getMarketQuote(symbol);
        const ltp = dbQuote ? dbQuote.ltp : 0;
        const prevClose = dbQuote ? dbQuote.prev_close : ltp;

        const mockCandles: Candle[] = [];
        let time = new Date(fromDate).getTime();

        if (resolution === "D") {
          const prevTime = time;
          const todayTime = time + 24 * 60 * 60 * 1000;
          if (prevClose > 0) {
            mockCandles.push({
              timestamp: prevTime,
              open: prevClose,
              high: prevClose + 10,
              low: prevClose - 10,
              close: prevClose,
              volume: dbQuote?.volume || 500000
            });
          }
          if (ltp > 0) {
            mockCandles.push({
              timestamp: todayTime,
              open: prevClose > 0 ? prevClose : ltp,
              high: Math.max(prevClose, ltp) + 15,
              low: Math.min(prevClose, ltp) - 15,
              close: ltp,
              volume: dbQuote?.volume || 650000
            });
          }
        } else {
          if (ltp > 0) {
            const count = 75; // 75 5-minute candles = 9:15 AM to 3:30 PM
            let currentPrice = prevClose > 0 ? prevClose : ltp;
            const volatility = ltp > 10000 ? 12 : (ltp < 100 ? 0.3 : 2.5);

            for (let i = 0; i < count; i++) {
              const open = currentPrice;
              // Drift toward target ltp as time progresses
              const progress = (i + 1) / count;
              const targetPath = (prevClose > 0 ? prevClose : ltp) + (ltp - (prevClose > 0 ? prevClose : ltp)) * progress;
              const noise = (Math.sin(i * 0.4) * volatility) + ((Math.random() - 0.5) * volatility * 0.8);
              let close = i === count - 1 ? ltp : targetPath + noise;
              const high = Math.max(open, close) + Math.random() * (volatility * 0.6);
              const low = Math.min(open, close) - Math.random() * (volatility * 0.6);
              const volume = Math.floor(Math.random() * 25000) + 5000;

              mockCandles.push({
                timestamp: time,
                open: parseFloat(open.toFixed(2)),
                high: parseFloat(high.toFixed(2)),
                low: parseFloat(low.toFixed(2)),
                close: parseFloat(close.toFixed(2)),
                volume
              });
              currentPrice = close;
              time += 5 * 60 * 1000;
            }
          }
        }
        this.historyCache[cacheKey] = { candles: mockCandles, expiry: now + ttlMs };
        return mockCandles;
      } finally {
        this.historyInflight.delete(cacheKey);
      }
    })();

    this.historyInflight.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  public async getQuotes(symbols: string[]): Promise<{ [symbol: string]: CompactTick }> {
    const result: { [symbol: string]: CompactTick } = {};
    const now = Date.now();

    // 1. If live API is connected, query real Fyers API quotes directly
    if (this.useLiveApi && this.fyersClient) {
      try {
        const response = await this.fyersClient.getQuotes(symbols);
        if (response && response.s === "ok" && Array.isArray(response.d)) {
          for (const item of response.d) {
            const sym = item.n || item.symbol || item.v?.symbol;
            if (!sym) continue;
            const ltp = item.v?.lp ?? item.lp ?? item.ltp ?? 0;
            const prevClose = item.v?.prev_close_price ?? item.prev_close_price ?? ltp;
            const netChange = item.v?.ch ?? item.ch ?? (prevClose > 0 ? ltp - prevClose : 0);
            const netChangePercent = item.v?.chp ?? item.chp ?? (prevClose > 0 ? (netChange / prevClose) * 100 : 0);
            const volume = item.v?.volume ?? item.volume ?? 0;

            const tick: CompactTick = {
              symbol: sym,
              ltp,
              prevClose,
              netChange: parseFloat(netChange.toFixed(2)),
              netChangePercent: parseFloat(netChangePercent.toFixed(2)),
              volume,
              bidPrice: ltp,
              askPrice: ltp,
              timestamp: now
            };

            // Dynamically persist to SQLite database so restarts never lose exact prices
            DatabaseService.upsertMarketQuote({
              symbol: sym,
              ltp,
              prevClose,
              netChange: tick.netChange || 0,
              netChangePercent: tick.netChangePercent,
              volume,
              updatedAt: now
            });

            result[sym] = tick;
          }
          return result;
        }
      } catch (err: any) {
        console.warn("[FyersAdapter] Error in live getQuotes, loading from database:", err?.message || err);
      }
    }

    // 2. Query SQLite database for saved real market quotes
    for (const sym of symbols) {
      const dbQuote = DatabaseService.getMarketQuote(sym);
      if (dbQuote) {
        result[sym] = {
          symbol: sym,
          ltp: dbQuote.ltp,
          prevClose: dbQuote.prev_close,
          netChange: dbQuote.net_change,
          netChangePercent: dbQuote.net_change_percent,
          volume: dbQuote.volume || 0,
          bidPrice: dbQuote.ltp,
          askPrice: dbQuote.ltp,
          timestamp: dbQuote.updated_at
        };
      }
    }

    return result;
  }

  /**
   * Fyers v3 returns one row per option leg (CE/PE) with snake_case fields.
   * Group those rows into strike-level call/put pairs for the advisory engine.
   */
  private parseFyersOptionsChain(
    optionsChain: any[],
    expiry: string,
    underlying: string
  ): OptionChainItem[] {
    const emptyLeg = () => ({
      symbol: "",
      ltp: 0,
      openInterest: 0,
      changeOpenInterest: 0,
      volume: 0,
      impliedVolatility: 0
    });

    const strikeMap = new Map<number, OptionChainItem>();

    for (const opt of optionsChain) {
      // Legacy paired-row format (kept for compatibility if API shape changes back)
      if (opt.callLtp !== undefined || opt.callSymbol) {
        const strike = Number(opt.strikePrice ?? opt.strike_price);
        if (!Number.isFinite(strike) || strike <= 0) continue;
        strikeMap.set(strike, {
          strikePrice: strike,
          expiryDate: expiry,
          underlyingSymbol: underlying,
          call: {
            symbol: opt.callSymbol || "",
            ltp: Number(opt.callLtp || 0),
            openInterest: Number(opt.callOi || 0),
            changeOpenInterest: Number(opt.callOiChange || 0),
            volume: Number(opt.callVolume || 0),
            impliedVolatility: Number(opt.callIv || 0)
          },
          put: {
            symbol: opt.putSymbol || "",
            ltp: Number(opt.putLtp || 0),
            openInterest: Number(opt.putOi || 0),
            changeOpenInterest: Number(opt.putOiChange || 0),
            volume: Number(opt.putVolume || 0),
            impliedVolatility: Number(opt.putIv || 0)
          }
        });
        continue;
      }

      const strike = Number(opt.strike_price ?? opt.strikePrice);
      if (!Number.isFinite(strike) || strike <= 0) continue;

      const optionType = String(opt.option_type ?? opt.optionType ?? "").toUpperCase();
      if (optionType !== "CE" && optionType !== "PE") continue;

      if (!strikeMap.has(strike)) {
        strikeMap.set(strike, {
          strikePrice: strike,
          expiryDate: expiry,
          underlyingSymbol: underlying,
          call: emptyLeg(),
          put: emptyLeg()
        });
      }

      const entry = strikeMap.get(strike)!;
      const leg = optionType === "CE" ? entry.call : entry.put;
      leg.symbol = opt.symbol || leg.symbol;
      leg.ltp = Number(opt.ltp ?? opt.fp ?? 0);
      leg.openInterest = Number(opt.oi ?? opt.openInterest ?? 0);
      leg.changeOpenInterest = Number(opt.oich ?? opt.oiChange ?? opt.changeOpenInterest ?? 0);
      leg.volume = Number(opt.volume ?? 0);
      leg.impliedVolatility = Number(opt.iv ?? opt.impliedVolatility ?? 0);
    }

    return Array.from(strikeMap.values()).sort((a, b) => a.strikePrice - b.strikePrice);
  }

  private resolveFyersChainExpiry(chainData: any): string {
    if (chainData.expiry) return String(chainData.expiry);

    const expiryRows = chainData.expiryData;
    if (Array.isArray(expiryRows) && expiryRows.length > 0) {
      const weekly = expiryRows.find((row: any) => row.expiry_flag === "W");
      if (weekly?.date) return weekly.date;
      if (expiryRows[0]?.date) return expiryRows[0].date;
    }

    return "";
  }

  public async getOptionChain(underlying: string): Promise<OptionChainItem[]> {
    const now = Date.now();
    const cached = this.optionChainCache[underlying];
    if (cached && cached.expiryTime > now && cached.data.length > 0) {
      return cached.data;
    }

    const inflight = this.optionChainInflight[underlying];
    if (inflight) {
      return inflight;
    }

    const backoffUntil = this.optionChainBackoffUntil[underlying] || 0;
    if (now < backoffUntil && cached && cached.data.length > 0) {
      return cached.data;
    }

    if (this.useLiveApi && this.fyersClient) {
      const fetchPromise = this.fetchLiveOptionChain(underlying).finally(() => {
        delete this.optionChainInflight[underlying];
      });
      this.optionChainInflight[underlying] = fetchPromise;
      return fetchPromise;
    }

    // Option Chain Fallback ONLY for offline simulated/sandbox mode
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

  private isOptionChainRateLimited(res: any, err?: any): boolean {
    const nested = res?.Error || res?.data?.Error || {};
    const message = String(
      err?.message ||
      res?.message ||
      nested.message ||
      res?.data?.message ||
      ""
    ).toLowerCase();
    const code = res?.code ?? nested.code ?? res?.data?.code;
    return (
      code === 429 ||
      message.includes("request limit") ||
      message.includes("rate limit") ||
      message.includes("error 1015")
    );
  }

  private serveStaleOptionChain(underlying: string, reason: string): OptionChainItem[] {
    const cached = this.optionChainCache[underlying];
    const now = Date.now();
    if (cached && cached.data.length > 0 && now - cached.fetchedAt <= FyersAdapter.OPTION_CHAIN_STALE_MS) {
      console.warn(`[FyersAdapter] ${reason}. Serving stale option chain for ${underlying}.`);
      return cached.data;
    }
    return [];
  }

  private async fetchLiveOptionChain(underlying: string): Promise<OptionChainItem[]> {
    const now = Date.now();
    try {
      console.log(`[FyersAdapter] Fetching real Option Chain for: ${underlying}`);
      const res = await this.fyersClient.getOptionChain({
        symbol: underlying,
        strikecount: 10
      });

      if (this.isOptionChainRateLimited(res)) {
        this.optionChainBackoffUntil[underlying] = now + FyersAdapter.OPTION_CHAIN_BACKOFF_MS;
        return this.serveStaleOptionChain(underlying, "Option chain rate-limited");
      }

      const chainPayload = res?.data;
      const optionsChain = chainPayload?.optionsChain;
      const isOk = res && (res.s === "ok" || chainPayload?.code === 200 || res?.code === 200);

      if (isOk && Array.isArray(optionsChain) && optionsChain.length > 0) {
        const expiry = this.resolveFyersChainExpiry(chainPayload);
        const chain = this.parseFyersOptionsChain(optionsChain, expiry, underlying);

        if (chain.length > 0) {
          this.optionChainCache[underlying] = {
            data: chain,
            expiryTime: now + FyersAdapter.OPTION_CHAIN_TTL_MS,
            fetchedAt: now
          };
          this.optionChainBackoffUntil[underlying] = 0;
          return chain;
        }

        console.warn(`[FyersAdapter] Option chain parsed to 0 strikes for ${underlying}.`);
      }
    } catch (err: any) {
      if (this.isOptionChainRateLimited(null, err)) {
        this.optionChainBackoffUntil[underlying] = now + FyersAdapter.OPTION_CHAIN_BACKOFF_MS;
        return this.serveStaleOptionChain(underlying, "Option chain rate-limited");
      }
      console.warn(`[FyersAdapter] Option chain query rejected for ${underlying}:`, err?.message || err);
      return this.serveStaleOptionChain(underlying, "Option chain query failed");
    }

    return this.serveStaleOptionChain(underlying, "Option chain unavailable");
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
