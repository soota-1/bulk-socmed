import { loadConfig } from "./config.js";
import { createWorkerSupabaseClient } from "./supabase.js";
import { runSchedulerCycle } from "./scheduler.js";

const LOOP_INTERVAL_MS = 30_000; // 30 seconds

async function main() {
  console.log("=== Penjadwal Video Pendek — Worker Daemon ===");
  let config;
  try {
    config = loadConfig();
    console.log(`[Config] Worker ID: ${config.workerId}, Host: ${config.hostName}`);
    console.log(`[Config] Supabase: ${config.supabaseUrl}`);
  } catch (err) {
    console.error(`[Fatal] Failed to load configuration: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const supabase = createWorkerSupabaseClient(config);

  console.log(`[Worker] Started daemon loop (interval: ${LOOP_INTERVAL_MS / 1000}s)`);

  let isRunning = false;

  const tick = async () => {
    if (isRunning) {
      console.log("[Worker] Previous cycle still running, skipping tick.");
      return;
    }
    isRunning = true;
    try {
      const summary = await runSchedulerCycle(supabase, config);
      if (summary.claimedCount > 0 || summary.errors.length > 0) {
        console.log(
          `[Cycle] Claimed: ${summary.claimedCount}, Processed: ${summary.processedCount}, Missed: ${summary.missedCount}, Errors: ${summary.errors.length}`
        );
        if (summary.errors.length > 0) {
          console.warn("[Cycle Errors]:", summary.errors);
        }
      }
    } catch (err) {
      console.error("[Cycle Fatal]:", err);
    } finally {
      isRunning = false;
    }
  };

  // Immediate first tick
  await tick();

  // Recurring loop
  const timer = setInterval(tick, LOOP_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n[Worker] Shutting down gracefully...");
    clearInterval(timer);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[Worker Fatal Startup]:", err);
  process.exit(1);
});
