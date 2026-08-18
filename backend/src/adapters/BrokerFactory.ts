import { IBrokerAdapter } from "./IBrokerAdapter";
import { FyersAdapter } from "./FyersAdapter";
import { KiteAdapter } from "./KiteAdapter";

export class BrokerFactory {
  private static instance: IBrokerAdapter | null = null;

  public static getAdapter(): IBrokerAdapter {
    if (this.instance) {
      return this.instance;
    }

    const provider = (process.env.BROKER_PROVIDER || "FYERS").toUpperCase();

    if (provider === "FYERS") {
      this.instance = new FyersAdapter();
    } else if (provider === "KITE") {
      this.instance = new KiteAdapter();
    } else {
      throw new Error(`Unsupported broker provider: ${provider}`);
    }

    return this.instance;
  }
}
