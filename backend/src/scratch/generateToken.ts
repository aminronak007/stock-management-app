import * as dotenv from "dotenv";
import * as path from "path";
import * as readline from "readline";
import { DatabaseService } from "../utils/database";

const fyers = require("fyers-api-v3");

// Load config
dotenv.config({ path: path.join(__dirname, "../../.env") });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function main() {
  console.log("==================================================");
  console.log("FYERS DAILY ACCESS TOKEN GENERATOR");
  console.log("==================================================\n");

  const clientId = process.env.FYERS_CLIENT_ID;
  const secretKey = process.env.FYERS_SECRET_KEY;
  const redirectUrl = process.env.FYERS_REDIRECT_URL || "http://127.0.0.1:5173/fyers-callback";

  if (!clientId || !secretKey) {
    console.error("Error: Please set FYERS_CLIENT_ID and FYERS_SECRET_KEY in your backend/.env file first!\n");
    rl.close();
    return;
  }

  // Generate authorization URL
  // Fyers v3 auth url structure:
  const authUrl = `https://api-t1.fyers.in/api/v3/generate-authcode?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUrl)}&response_type=code&state=state_code`;

  console.log("1. Open the following URL in your web browser and log in with your Fyers credentials & TOTP:");
  console.log(`\n\x1b[36m${authUrl}\x1b[0m\n`);
  
  console.log("2. After successful 2FA login, you will be redirected to your Redirect URL.");
  console.log("   The address bar will contain a query parameter 'auth_code=...'.");
  console.log("   Example redirect: http://127.0.0.1:5173/fyers-callback?auth_code=XXXXXX&state=state_code\n");

  rl.question("3. Paste the 'auth_code' value (or the entire redirected URL) here: ", async (input) => {
    let authCode = input.trim();
    
    // Auto-extract auth_code if they paste the full URL
    if (authCode.includes("auth_code=")) {
      const match = authCode.match(/auth_code=([^&]+)/);
      if (match) {
        authCode = match[1];
      }
    }

    if (!authCode) {
      console.error("Error: Authorization code cannot be empty!");
      rl.close();
      return;
    }

    console.log(`\nExchanging authorization code: [${authCode.substring(0, 10)}...] for daily access token...`);

    try {
      const fyersClient = new fyers.fyersModel();
      fyersClient.setAppId(clientId);
      fyersClient.setRedirectUrl(redirectUrl);

      const response = await fyersClient.generate_access_token({
        client_id: clientId,
        secret_key: secretKey,
        auth_code: authCode
      });

      if (response && response.s === "ok") {
        const token = response.access_token;
        const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 Hours validity cache

        // Save token to transactional SQLite store
        DatabaseService.saveSession("FYERS", token, expiresAt);
        
        console.log("\n\x1b[32m✔ SUCCESS: Daily Access Token generated and saved successfully to database cache!\x1b[0m");
        console.log("You can now close this script and run the backend terminal directly.\n");
      } else {
        console.error("\n\x1b[31m✖ ERROR: Fyers returned an authentication error:\x1b[0m", response.message || response);
      }
    } catch (e) {
      console.error("\n\x1b[31m✖ ERROR: Failed to request access token exchange:\x1b[0m", e);
    } finally {
      rl.close();
    }
  });
}

main();
