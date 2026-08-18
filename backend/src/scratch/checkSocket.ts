import * as dotenv from "dotenv";
import * as path from "path";
import { DatabaseService } from "../utils/database";

const fyers = require("fyers-api-v3");

dotenv.config({ path: path.join(__dirname, "../../.env") });

async function check() {
  const clientId = process.env.FYERS_CLIENT_ID;
  const session = DatabaseService.getSession("FYERS");
  
  if (!clientId || !session) {
    console.error("Missing clientId or cached session token.");
    return;
  }
  
  console.log("Client ID:", clientId);
  console.log("Token length:", session.access_token.length);
  
  const token = `${clientId}:${session.access_token}`;
  console.log("Attempting to decode token using fyers JWT helper or starting socket...");
  
  try {
    const socket = fyers.fyersDataSocket.getInstance(token, "./", true);
    console.log("Socket instance retrieved successfully:", !!socket);
  } catch (e: any) {
    console.error("FAILED WITH ERROR:", e);
    console.error("Error Stack:", e.stack);
  }
}

check();
