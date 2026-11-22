import type { SupabaseClient } from "@supabase/supabase-js";

const STARTED_AT = new Date().toISOString();
const WORKER_VERSION = "0.0.1";

export async function sendHeartbeat(
  supabase: SupabaseClient,
  workerId: string,
  ownerId: string,
  hostName?: string
): Promise<void> {
  const { error } = await supabase.from("worker_heartbeats").upsert(
    {
      worker_id: workerId,
      owner_id: ownerId,
      last_tick_at: new Date().toISOString(),
      started_at: STARTED_AT,
      version: WORKER_VERSION,
      host_name: hostName ?? null,
    },
    { onConflict: "worker_id" }
  );

  if (error) {
    console.error(`[Heartbeat] Failed to send heartbeat: ${error.message}`);
  }
}
