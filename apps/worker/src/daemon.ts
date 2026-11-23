import path from "node:path";
import fs from "node:fs/promises";
import { differenceInMinutes } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDateWib } from "@bulk-socmed/shared";
import type { WorkerConfig } from "./config";
import { runSchedulerCycle, type CycleSummary } from "./scheduler";
import { runMaintenanceCycle } from "./maintenance";
import { exportDailyBackup } from "./backup";
import { createProductionPublishers } from "./publishers/clients";
import type { Platform, Publisher } from "./publishers/base";

export interface DaemonOptions {
  intervalMs?: number;
  publishers?: Partial<Record<Platform, Publisher>>;
  logDir?: string;
  enableMaintenance?: boolean;
  enableBackup?: boolean;
}

export class Daemon {
  private timer: NodeJS.Timeout | null = null;
  private isTickRunning = false;
  private isStopping = false;
  private lastMaintenanceAt: Date | null = null;
  private lastBackupDate: string | null = null;
  private readonly intervalMs: number;
  private readonly publishers: Partial<Record<Platform, Publisher>>;
  private readonly logFilePath: string;
  private readonly enableMaintenance: boolean;
  private readonly enableBackup: boolean;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly config: WorkerConfig,
    options?: DaemonOptions
  ) {
    this.intervalMs = options?.intervalMs ?? 30_000;
    this.publishers = options?.publishers ?? createProductionPublishers();
    this.enableMaintenance = options?.enableMaintenance ?? true;
    this.enableBackup = options?.enableBackup ?? true;

    const logDir = options?.logDir ?? path.resolve(process.cwd(), "data/logs");
    this.logFilePath = path.join(logDir, "worker.log");
  }

  private async log(msg: string, level: "INFO" | "WARN" | "ERROR" = "INFO") {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level}] ${msg}\n`;

    if (level === "ERROR") {
      console.error(line.trim());
    } else if (level === "WARN") {
      console.warn(line.trim());
    } else {
      console.log(line.trim());
    }

    try {
      await fs.mkdir(path.dirname(this.logFilePath), { recursive: true });
      await fs.appendFile(this.logFilePath, line, "utf8");
    } catch {
      // Best effort file logging
    }
  }

  /**
   * Run one single iteration of the daemon:
   * 1. Run scheduler cycle (heartbeat, claim, execute target steps, test requests)
   * 2. Periodic maintenance (hourly)
   * 3. Daily backup (once per calendar day)
   */
  async tick(now = new Date()): Promise<CycleSummary> {
    if (this.isStopping) {
      return { claimedCount: 0, missedCount: 0, processedCount: 0, errors: [] };
    }

    if (this.isTickRunning) {
      await this.log("Previous tick still running, skipping iteration.", "WARN");
      return { claimedCount: 0, missedCount: 0, processedCount: 0, errors: ["tick_in_flight"] };
    }

    this.isTickRunning = true;
    let summary: CycleSummary = {
      claimedCount: 0,
      missedCount: 0,
      processedCount: 0,
      errors: [],
    };

    try {
      // 1. Scheduler cycle
      summary = await runSchedulerCycle(this.supabase, this.config, now, this.publishers);

      if (summary.claimedCount > 0 || summary.errors.length > 0) {
        await this.log(
          `Cycle finished: Claimed=${summary.claimedCount}, Processed=${summary.processedCount}, Missed=${summary.missedCount}, Errors=${summary.errors.length}`
        );
        for (const err of summary.errors) {
          await this.log(`Cycle error: ${err}`, "ERROR");
        }
      }

      // 2. Hourly maintenance cycle
      if (this.enableMaintenance) {
        const shouldRunMaintenance =
          !this.lastMaintenanceAt || differenceInMinutes(now, this.lastMaintenanceAt) >= 60;

        if (shouldRunMaintenance) {
          this.lastMaintenanceAt = now;
          const maint = await runMaintenanceCycle(this.supabase, this.config, now);
          await this.log(
            `Maintenance: Cleaned=${maint.mediaCleanedCount}, Refreshed=${maint.tokensRefreshedCount}, Pruned=${maint.eventsPrunedCount}`
          );
        }
      }

      // 3. Daily JSON backup
      if (this.enableBackup) {
        const currentDateStr = formatDateWib(now);
        if (this.lastBackupDate !== currentDateStr) {
          this.lastBackupDate = currentDateStr;
          const backupRes = await exportDailyBackup(this.supabase, now);
          await this.log(
            `Daily backup completed for ${backupRes.dateStr}: ${backupRes.filesWritten.length} tables backed up, ${backupRes.prunedCount} old backups rotated.`
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.log(`Fatal tick error: ${msg}`, "ERROR");
      summary.errors.push(msg);
    } finally {
      this.isTickRunning = false;
    }

    return summary;
  }

  /**
   * Start recurring daemon timer.
   */
  start(): void {
    this.isStopping = false;
    this.log(`Daemon started (interval: ${this.intervalMs / 1000}s, workerId: ${this.config.workerId})`);

    // Immediate initial execution
    this.tick().catch(() => {});

    // Schedule loop
    this.timer = setInterval(() => {
      this.tick().catch(() => {});
    }, this.intervalMs);
  }

  /**
   * Graceful stop: clears interval and waits for in-flight tick to finish.
   */
  async stop(timeoutMs = 15_000): Promise<void> {
    this.isStopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const startWait = Date.now();
    while (this.isTickRunning && Date.now() - startWait < timeoutMs) {
      await new Promise((r) => setTimeout(r, 100));
    }

    await this.log("Daemon stopped gracefully.");
  }
}
