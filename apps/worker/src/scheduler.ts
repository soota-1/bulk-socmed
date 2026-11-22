import { differenceInMinutes } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_GRACE_MINUTES } from "@bulk-socmed/shared";
import type { WorkerConfig } from "./config.js";
import { sendHeartbeat } from "./heartbeat.js";

/**
 * Check whether a target's dueAt has passed beyond the allowable grace period.
 * If true, the target must be marked 'missed' and NOT posted automatically.
 */
export function isTargetMissed(
  dueAt: Date,
  now: Date,
  graceMinutes = DEFAULT_GRACE_MINUTES
): boolean {
  if (dueAt >= now) {
    return false;
  }
  const diff = differenceInMinutes(now, dueAt);
  return diff > graceMinutes;
}

export interface ClaimedTarget {
  id: number;
  owner_id: string;
  post_id: number;
  platform: "youtube" | "instagram" | "tiktok";
  status: string;
  step: string | null;
  pending_action: string | null;
  run_at: string | null;
  planned_dispatch_at: string | null;
  external_id: string | null;
  external_state: Record<string, unknown>;
  idempotency_key: string;
}

export interface CycleSummary {
  claimedCount: number;
  missedCount: number;
  processedCount: number;
  errors: string[];
}

/**
 * Claim targets ready for processing from Supabase via claim_targets RPC.
 */
export async function claimTargets(
  supabase: SupabaseClient,
  workerId: string,
  limit = 5,
  leaseSeconds = 900 // 15 minutes
): Promise<ClaimedTarget[]> {
  const { data, error } = await supabase.rpc("claim_targets", {
    p_worker: workerId,
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  });

  if (error) {
    throw new Error(`claim_targets RPC failed: ${error.message}`);
  }

  return (data as ClaimedTarget[]) ?? [];
}

/**
 * Run one single scheduler iteration.
 */
export async function runSchedulerCycle(
  supabase: SupabaseClient,
  config: WorkerConfig,
  now = new Date()
): Promise<CycleSummary> {
  const summary: CycleSummary = {
    claimedCount: 0,
    missedCount: 0,
    processedCount: 0,
    errors: [],
  };

  // 1. Send Heartbeat if ownerId is configured
  if (config.ownerId) {
    await sendHeartbeat(supabase, config.workerId, config.ownerId, config.hostName);
  }

  // 2. Claim targets
  let targets: ClaimedTarget[] = [];
  try {
    targets = await claimTargets(supabase, config.workerId);
    summary.claimedCount = targets.length;
  } catch (err) {
    summary.errors.push(err instanceof Error ? err.message : String(err));
    return summary;
  }

  // 3. Process claimed targets
  for (const target of targets) {
    try {
      // Check if post due_at is missed (fetch post due_at)
      const { data: post, error: postErr } = await supabase
        .from("posts")
        .select("due_at, caption, title, video_object_path, thumbnail_object_path")
        .eq("id", target.post_id)
        .single();

      if (postErr || !post) {
        summary.errors.push(`Post ${target.post_id} not found: ${postErr?.message}`);
        continue;
      }

      const dueAt = new Date(post.due_at);
      if (isTargetMissed(dueAt, now)) {
        // Mark as missed
        await supabase
          .from("targets")
          .update({
            status: "missed",
            last_error_code: "target_missed",
            last_error_message: `Terlewat: jam tayang (${post.due_at}) melewati batas toleransi keterlambatan.`,
            run_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", target.id);

        await supabase.from("target_events").insert({
          target_id: target.id,
          event: "status_change",
          from_status: target.status,
          to_status: "missed",
          detail: { reason: "grace_period_exceeded", due_at: post.due_at },
        });

        summary.missedCount++;
        continue;
      }

      // Handle pending_action if present (retry, cancel, sync_changes)
      if (target.pending_action) {
        // Concrete publisher handlers will be plugged in Phase 3
        summary.processedCount++;
        continue;
      }

      summary.processedCount++;
    } catch (err) {
      summary.errors.push(`Target ${target.id} error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return summary;
}
