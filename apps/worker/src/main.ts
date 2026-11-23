import { loadConfig } from "./config";
import { createWorkerSupabaseClient } from "./supabase";
import { Daemon } from "./daemon";

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
  const daemon = new Daemon(supabase, config);

  // Graceful shutdown handling
  let isShuttingDown = false;
  const handleShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[Worker] Received ${signal}, shutting down gracefully...`);
    await daemon.stop(15_000);
    process.exit(0);
  };

  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));

  // Start the daemon loop
  daemon.start();
}

main().catch((err) => {
  console.error("[Worker Fatal Startup]:", err);
  process.exit(1);
});
