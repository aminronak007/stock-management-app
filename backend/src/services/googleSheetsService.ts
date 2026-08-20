import { google } from "googleapis";
import * as fs from "fs";
import * as path from "path";
import { DatabaseService } from "../utils/database";

export interface TradeLogRow {
  type: string;
  tier: string;
  symbol: string;
  strike: number | string;
  qty: number;
  price: number;
  sl?: number;
  t1?: number;
  t2?: number;
  investedCapital: number;
  grossPnl?: number;
  fees?: number;
  netPnl?: number;
  reasoning: string;
}

export class GoogleSheetsService {
  private static oauth2Client: any = null;
  private static driveClient: any = null;
  private static sheetsClient: any = null;

  // In-memory caches to minimize Google Drive API roundtrips
  private static rootFolderId: string | null = null;
  private static yearFolderCache: { [year: string]: string } = {};
  private static monthSpreadsheetCache: { [key: string]: string } = {};
  private static verifiedTabs: Set<string> = new Set();

  /**
   * Initializes Google Auth using either OAuth2 (Client ID & Secret) or Service Account
   */
  public static async initializeAuth(): Promise<boolean> {
    try {
      // 1. Check for Direct Apps Script Webhook URL (Instant Zero-Config Connection)
      if (process.env.GOOGLE_SHEETS_WEBHOOK_URL) {
        console.log("[GoogleSheetsService] ✅ Google Apps Script Webhook URL detected and active.");
        return true;
      }

      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:8080/api/google/callback";

      // 2. Try OAuth2 flow if Client ID and Secret are provided
      if (clientId && clientSecret) {
        this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

        // Check if persistent refresh token exists in DB
        const db = DatabaseService.initialize();
        const row = db.prepare("SELECT value FROM settings WHERE key = 'GOOGLE_REFRESH_TOKEN'").get() as { value: string } | undefined;
        const refreshToken = row?.value || process.env.GOOGLE_REFRESH_TOKEN;

        if (refreshToken) {
          this.oauth2Client.setCredentials({ refresh_token: refreshToken });
          this.driveClient = google.drive({ version: "v3", auth: this.oauth2Client });
          this.sheetsClient = google.sheets({ version: "v4", auth: this.oauth2Client });
          console.log("[GoogleSheetsService] OAuth2 authenticated successfully with persistent refresh token.");
          return true;
        } else {
          console.log("[GoogleSheetsService] OAuth2 configured. Waiting for one-time user authorization via /api/google/auth");
          return false;
        }
      }

      // 3. Fallback: Check for Service Account Key file
      const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
      if (keyPath && fs.existsSync(keyPath)) {
        const auth = new google.auth.GoogleAuth({
          keyFile: keyPath,
          scopes: [
            "https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/spreadsheets"
          ]
        });
        const client = await auth.getClient();
        this.driveClient = google.drive({ version: "v3", auth: client as any });
        this.sheetsClient = google.sheets({ version: "v4", auth: client as any });
        console.log("[GoogleSheetsService] Service Account authenticated successfully.");
        return true;
      }

      return false;
    } catch (e: any) {
      console.error("[GoogleSheetsService] Auth initialization error:", e.message);
      return false;
    }
  }

  public static isConnected(): boolean {
    return !!(process.env.GOOGLE_SHEETS_WEBHOOK_URL || (this.driveClient && this.sheetsClient));
  }

  public static getAuthUrl(): string {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:8080/api/google/callback";

    if (!clientId || !clientSecret) {
      throw new Error("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET missing in .env");
    }

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    return oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/spreadsheets"
      ]
    });
  }

  public static async handleOAuthCallback(code: string): Promise<boolean> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:8080/api/google/callback";

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const { tokens } = await oauth2.getToken(code);

    if (tokens.refresh_token) {
      const db = DatabaseService.initialize();
      db.prepare(`
        INSERT INTO settings (key, value) VALUES ('GOOGLE_REFRESH_TOKEN', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(tokens.refresh_token);
      console.log("[GoogleSheetsService] Persistent refresh token saved into database settings.");
    }

    oauth2.setCredentials(tokens);
    this.oauth2Client = oauth2;
    this.driveClient = google.drive({ version: "v3", auth: this.oauth2Client });
    this.sheetsClient = google.sheets({ version: "v4", auth: this.oauth2Client });
    return true;
  }

  /**
   * Finds or creates a Google Drive Folder dynamically
   */
  private static async getOrCreateFolder(folderName: string, parentFolderId?: string): Promise<string> {
    if (!this.driveClient) throw new Error("Google Drive client not connected.");

    let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${folderName}' and trashed = false`;
    if (parentFolderId) {
      query += ` and '${parentFolderId}' in parents`;
    }

    const res = await this.driveClient.files.list({
      q: query,
      fields: "files(id, name)",
      spaces: "drive"
    });

    if (res.data.files && res.data.files.length > 0) {
      return res.data.files[0].id;
    }

    // Folder doesn't exist, create it dynamically
    console.log(`[GoogleSheetsService] Creating Google Drive folder: "${folderName}"...`);
    const fileMetadata: any = {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder"
    };
    if (parentFolderId) {
      fileMetadata.parents = [parentFolderId];
    }

    const created = await this.driveClient.files.create({
      requestBody: fileMetadata,
      fields: "id"
    });

    return created.data.id;
  }

  /**
   * Finds or creates a Google Spreadsheet file dynamically inside the given folder
   */
  private static async getOrCreateSpreadsheet(spreadsheetName: string, parentFolderId: string): Promise<string> {
    if (!this.driveClient || !this.sheetsClient) throw new Error("Google API clients not connected.");

    const query = `mimeType = 'application/vnd.google-apps.spreadsheet' and name = '${spreadsheetName}' and '${parentFolderId}' in parents and trashed = false`;
    const res = await this.driveClient.files.list({
      q: query,
      fields: "files(id, name)",
      spaces: "drive"
    });

    if (res.data.files && res.data.files.length > 0) {
      return res.data.files[0].id;
    }

    // Spreadsheet doesn't exist, create it dynamically
    console.log(`[GoogleSheetsService] Creating Google Spreadsheet: "${spreadsheetName}"...`);
    const fileMetadata = {
      name: spreadsheetName,
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [parentFolderId]
    };

    const created = await this.driveClient.files.create({
      requestBody: fileMetadata,
      fields: "id"
    });

    return created.data.id;
  }

  /**
   * Ensures the date-based tab (e.g. "20 Aug") exists inside the spreadsheet with styled headers
   */
  private static async ensureDateSheetTab(spreadsheetId: string, tabName: string): Promise<void> {
    const cacheKey = `${spreadsheetId}_${tabName}`;
    if (this.verifiedTabs.has(cacheKey)) return;

    if (!this.sheetsClient) throw new Error("Google Sheets client not connected.");

    // Retrieve sheets list
    const meta = await this.sheetsClient.spreadsheets.get({ spreadsheetId });
    const sheets = meta.data.sheets || [];
    const exists = sheets.some((s: any) => s.properties.title === tabName);

    const headers = [
      "Timestamp",
      "Type",
      "Tier",
      "Symbol",
      "Strike",
      "Qty",
      "Price",
      "StopLoss",
      "Target1",
      "Target2",
      "InvestedCapital",
      "GrossPnL",
      "Fees",
      "NetPnL",
      "Reasoning"
    ];

    if (!exists) {
      console.log(`[GoogleSheetsService] Adding daily tab "${tabName}" to spreadsheet...`);
      // If Sheet1 exists and is the only empty sheet, we can rename it or add a new tab
      const isDefaultOnly = sheets.length === 1 && sheets[0].properties.title === "Sheet1";

      if (isDefaultOnly) {
        await this.sheetsClient.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                updateSheetProperties: {
                  properties: { sheetId: sheets[0].properties.sheetId, title: tabName },
                  fields: "title"
                }
              }
            ]
          }
        });
      } else {
        await this.sheetsClient.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: { title: tabName }
                }
              }
            ]
          }
        });
      }

      // Write Header Row to Row 1
      await this.sheetsClient.spreadsheets.values.update({
        spreadsheetId,
        range: `'${tabName}'!A1:O1`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [headers]
        }
      });
    }

    this.verifiedTabs.add(cacheKey);
  }

  /**
   * Appends a trade row dynamically to Stock Mock -> YYYY -> Month -> Date Tab
   */
  public static async logTradeToGoogleSheets(trade: TradeLogRow): Promise<boolean> {
    // 1. If Webhook URL is configured, dispatch directly via Google Apps Script Webhook
    const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
    if (webhookUrl && webhookUrl.startsWith("http")) {
      try {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(trade)
        });
        const text = await response.text();
        console.log(`[GoogleSheetsService] ✅ Trade logged directly to Google Drive & Sheets via Webhook!`);
        return true;
      } catch (err: any) {
        console.error("[GoogleSheetsService] Error sending to Apps Script Webhook:", err.message);
        return false;
      }
    }

    if (!this.isConnected()) {
      const initialized = await this.initializeAuth();
      if (!initialized) return false;
    }

    try {
      const now = new Date();
      const yearStr = now.getFullYear().toString();
      const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];
      const monthStr = monthNames[now.getMonth()];
      
      const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const dateTabStr = `${now.getDate()} ${shortMonths[now.getMonth()]}`;

      // 1. Get or Create "Stock Mock" Root Folder
      if (!this.rootFolderId) {
        this.rootFolderId = await this.getOrCreateFolder("Stock Mock");
      }

      // 2. Get or Create Year Folder (e.g. "2026")
      if (!this.yearFolderCache[yearStr]) {
        this.yearFolderCache[yearStr] = await this.getOrCreateFolder(yearStr, this.rootFolderId);
      }
      const yearFolderId = this.yearFolderCache[yearStr];

      // 3. Get or Create Month Spreadsheet (e.g. "August")
      const monthKey = `${yearStr}_${monthStr}`;
      if (!this.monthSpreadsheetCache[monthKey]) {
        this.monthSpreadsheetCache[monthKey] = await this.getOrCreateSpreadsheet(monthStr, yearFolderId);
      }
      const spreadsheetId = this.monthSpreadsheetCache[monthKey];

      // 4. Ensure Date Sheet Tab (e.g. "20 Aug") exists with headers
      await this.ensureDateSheetTab(spreadsheetId, dateTabStr);

      // 5. Append Trade Row
      const timestampStr = now.toLocaleString("en-IN");
      const rowValues = [
        timestampStr,
        trade.type,
        trade.tier,
        trade.symbol,
        String(trade.strike),
        trade.qty,
        trade.price.toFixed(2),
        trade.sl ? trade.sl.toFixed(2) : "",
        trade.t1 ? trade.t1.toFixed(2) : "",
        trade.t2 ? trade.t2.toFixed(2) : "",
        trade.investedCapital.toFixed(2),
        trade.grossPnl !== undefined ? trade.grossPnl.toFixed(2) : "",
        trade.fees !== undefined ? trade.fees.toFixed(2) : "",
        trade.netPnl !== undefined ? trade.netPnl.toFixed(2) : "",
        trade.reasoning
      ];

      await this.sheetsClient.spreadsheets.values.append({
        spreadsheetId,
        range: `'${dateTabStr}'!A:O`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [rowValues]
        }
      });

      console.log(`[GoogleSheetsService] ✅ Trade logged directly to Google Sheets: Stock Mock > ${yearStr} > ${monthStr} > [${dateTabStr}]`);
      return true;
    } catch (e: any) {
      console.error("[GoogleSheetsService] Failed to append trade row to Google Sheets:", e.message);
      return false;
    }
  }
}
