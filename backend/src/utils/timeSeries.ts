import * as fs from "fs";
import * as path from "path";
import { CompactTick } from "../adapters/IBrokerAdapter";

export class TimeSeriesService {
  private static buffer: CompactTick[] = [];
  private static bufferLimit = 50; // Flush every 50 ticks
  private static ticksLogPath: string = "";

  public static initialize(): void {
    const dataDir = path.join(__dirname, "../../data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.ticksLogPath = path.join(dataDir, "ticks.csv");
    
    // Create ticks CSV header if not exists
    if (!fs.existsSync(this.ticksLogPath)) {
      fs.writeFileSync(
        this.ticksLogPath,
        "timestamp,symbol,ltp,netChangePercent,volume,bidPrice,askPrice\n"
      );
    }
    console.log(`[TimeSeries] Time series logger initialized. Target file: ${this.ticksLogPath}`);
  }

  /**
   * Appends incoming ticks to buffer and flushes to storage periodically
   */
  public static appendTick(tick: CompactTick): void {
    this.buffer.push(tick);
    if (this.buffer.length >= this.bufferLimit) {
      this.flush();
    }
  }

  public static flush(): void {
    if (this.buffer.length === 0) return;

    console.log(`[TimeSeries] Flushing ${this.buffer.length} ticks to local time-series file...`);
    const rows = this.buffer.map(tick => {
      return `${tick.timestamp},${tick.symbol},${tick.ltp},${tick.netChangePercent},${tick.volume},${tick.bidPrice},${tick.askPrice}`;
    }).join("\n") + "\n";

    fs.appendFileSync(this.ticksLogPath, rows);
    this.buffer = [];
  }
}
