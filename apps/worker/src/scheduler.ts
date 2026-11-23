import { differenceInMinutes } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_GRACE_MINUTES, type Platform, type TargetStatus } from "@bulk-socmed/shared";
import type { WorkerConfig } from "./config";
import { sendHeartbeat } from "./heartbeat";
import { ensureMediaCache, type CachedMedia } from "./media-cache";
import { decryptToken } from "./crypto";
import type {
  Publisher,
  StepContext,
  StepTarget,
  StepPost,
} from "./publishers/base";

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
  platform: Platform;
  status: string;
  step: string | null;
  pending_action: string | null;
  run_at: string | null;
  planned_dispatch_at: string | null;
  attempt_count?: number;
  external_id: string | null;
  external_state: Record<string, unknown>;
  idempotency_key: string;
}

export interface TargetPostData {
  id: number;
  title: string | null;
  caption: string;
  hashtags?: string;
  video_object_path: string;
  thumbnail_object_path?: string | null;
  due_at: string;
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
 * Execute one single step or action for a claimed target using the platform's publisher.
 */
export async function executeTargetStep(
  supabase: SupabaseClient,
  target: ClaimedTarget,
  post: TargetPostData,
  media: CachedMedia,
  publisher: Publisher,
  now: Date,
  tokenOrApiKey?: string
): Promise<void> {
  const stepTarget: StepTarget = {
    id: target.id,
    post_id: target.post_id,
    platform: target.platform,
    status: target.status as TargetStatus,
    step: target.step,
    attempt_count: target.attempt_count ?? 0,
    external_id: target.external_id,
    external_state: target.external_state ?? {},
    idempotency_key: target.idempotency_key,
  };

  const stepPost: StepPost = {
    id: post.id,
    title: post.title,
    caption: post.caption,
    hashtags: post.hashtags ?? "",
    video_object_path: post.video_object_path,
    thumbnail_object_path: post.thumbnail_object_path ?? null,
    due_at: post.due_at,
  };

  const ctx: StepContext = {
    target: stepTarget,
    post: stepPost,
    now,
    accessToken: tokenOrApiKey,
    apiKey: tokenOrApiKey,
    externalAccountId: (target.external_state?.channel_id ??
      target.external_state?.account_id ??
      target.external_state?.profile_id) as string | undefined,
    media,
    supabase,
  };

  // 1. Handle pending_action: cancel
  if (target.pending_action === "cancel") {
    await publisher.cancel(ctx);

    await supabase
      .from("targets")
      .update({
        status: "cancelled",
        pending_action: null,
        lease_owner: null,
        lease_until: null,
        updated_at: now.toISOString(),
      })
      .eq("id", target.id);

    await supabase.from("target_events").insert({
      target_id: target.id,
      event: "cancelled",
      from_status: target.status,
      to_status: "cancelled",
      detail: { reason: "cancelled_by_user" },
    });
    return;
  }

  // 2. Handle pending_action: sync_changes
  if (target.pending_action === "sync_changes") {
    await publisher.applyChanges(ctx);

    await supabase
      .from("targets")
      .update({
        pending_action: null,
        lease_owner: null,
        lease_until: null,
        updated_at: now.toISOString(),
      })
      .eq("id", target.id);

    await supabase.from("target_events").insert({
      target_id: target.id,
      event: "sync_changes",
      detail: { applied: true },
    });
    return;
  }

  // 3. Handle pending_action: retry
  if (target.pending_action === "retry") {
    await supabase
      .from("targets")
      .update({
        status: "scheduled",
        step: null,
        pending_action: null,
        last_error_code: null,
        last_error_message: null,
        hold_reason: null,
        attempt_count: 0,
        run_at: now.toISOString(),
        lease_owner: null,
        lease_until: null,
        updated_at: now.toISOString(),
      })
      .eq("id", target.id);

    await supabase.from("target_events").insert({
      target_id: target.id,
      event: "retry",
      from_status: target.status,
      to_status: "scheduled",
      detail: { reason: "retry_requested" },
    });
    return;
  }

  // 4. Advance publisher step
  const result = await publisher.advance(ctx);

  // Handle errors
  if (result.error) {
    if (result.error.isPermanent) {
      await supabase
        .from("targets")
        .update({
          status: "failed",
          last_error_code: result.error.code,
          last_error_message: result.error.message,
          run_at: null,
          lease_owner: null,
          lease_until: null,
          updated_at: now.toISOString(),
        })
        .eq("id", target.id);

      await supabase.from("target_events").insert({
        target_id: target.id,
        event: "error",
        from_status: target.status,
        to_status: "failed",
        detail: { error: result.error },
      });
      return;
    }

    if (result.error.isAuthError) {
      await supabase
        .from("targets")
        .update({
          hold_reason: "needs_reauth",
          last_error_code: result.error.code,
          last_error_message: result.error.message,
          lease_owner: null,
          lease_until: null,
          updated_at: now.toISOString(),
        })
        .eq("id", target.id);

      await supabase.from("target_events").insert({
        target_id: target.id,
        event: "hold",
        detail: { hold_reason: "needs_reauth", error: result.error },
      });
      return;
    }

    // Transient error: retry with exponential backoff [1, 5, 15] minutes
    const currentAttempt = target.attempt_count ?? 0;
    const newAttempt = currentAttempt + 1;
    const backoffSchedule = [1, 5, 15];

    if (newAttempt >= 3) {
      await supabase
        .from("targets")
        .update({
          status: "failed",
          attempt_count: newAttempt,
          last_error_code: result.error.code,
          last_error_message: result.error.message,
          run_at: null,
          lease_owner: null,
          lease_until: null,
          updated_at: now.toISOString(),
        })
        .eq("id", target.id);

      await supabase.from("target_events").insert({
        target_id: target.id,
        event: "error",
        from_status: target.status,
        to_status: "failed",
        detail: { error: result.error, attempt: newAttempt },
      });
    } else {
      const delayMin = backoffSchedule[newAttempt - 1] ?? 15;
      const nextRunAt = new Date(now.getTime() + delayMin * 60000).toISOString();

      await supabase
        .from("targets")
        .update({
          attempt_count: newAttempt,
          last_error_code: result.error.code,
          last_error_message: result.error.message,
          run_at: nextRunAt,
          lease_owner: null,
          lease_until: null,
          updated_at: now.toISOString(),
        })
        .eq("id", target.id);

      await supabase.from("target_events").insert({
        target_id: target.id,
        event: "retry_scheduled",
        detail: { error: result.error, attempt: newAttempt, next_run_at: nextRunAt },
      });
    }
    return;
  }

  // Handle successful advance
  const runAtIso = result.runAt
    ? result.runAt.toISOString()
    : result.delayMinutes
    ? new Date(now.getTime() + result.delayMinutes * 60000).toISOString()
    : now.toISOString();

  const updateData: Record<string, unknown> = {
    status: result.nextStatus,
    step: result.nextStep,
    lease_owner: null,
    lease_until: null,
    updated_at: now.toISOString(),
  };

  if (result.externalId !== undefined) {
    updateData.external_id = result.externalId;
  }
  if (result.externalState) {
    updateData.external_state = {
      ...target.external_state,
      ...result.externalState,
    };
  }

  if (result.nextStatus === "published") {
    updateData.published_at = now.toISOString();
    updateData.run_at = null;
  } else {
    updateData.run_at = runAtIso;
  }

  await supabase
    .from("targets")
    .update(updateData)
    .eq("id", target.id);

  await supabase.from("target_events").insert({
    target_id: target.id,
    event: result.nextStatus !== target.status ? "status_change" : "step_done",
    from_status: target.status,
    to_status: result.nextStatus,
    detail: {
      step: result.nextStep,
      external_id: result.externalId,
      delay_minutes: result.delayMinutes,
    },
  });
}

/**
 * Run one single scheduler iteration.
 */
export async function runSchedulerCycle(
  supabase: SupabaseClient,
  config: WorkerConfig,
  now = new Date(),
  publishers?: Partial<Record<Platform, Publisher>>
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
      // Fetch post details
      const { data: post, error: postErr } = await supabase
        .from("posts")
        .select("id, due_at, caption, title, hashtags, video_object_path, thumbnail_object_path")
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
            lease_owner: null,
            lease_until: null,
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

      // Check publisher
      const publisher = publishers?.[target.platform];
      if (!publisher) {
        summary.errors.push(`No publisher configured for platform: ${target.platform}`);
        continue;
      }

      // Ensure media cache
      let media: CachedMedia;
      try {
        media = await ensureMediaCache(
          supabase,
          post.id,
          post.video_object_path,
          post.thumbnail_object_path
        );
      } catch (cacheErr) {
        summary.errors.push(
          `Media cache failed for post ${post.id}: ${
            cacheErr instanceof Error ? cacheErr.message : String(cacheErr)
          }`
        );
        continue;
      }

      // Resolve token/key if available
      let tokenOrApiKey: string | undefined;
      try {
        const { data: conn } = await supabase
          .from("connections")
          .select("id, external_account_id, connection_secrets(access_token_enc, api_key_enc)")
          .eq("owner_id", target.owner_id)
          .eq("platform", target.platform)
          .maybeSingle();

        if (conn && conn.connection_secrets) {
          const secrets = Array.isArray(conn.connection_secrets)
            ? conn.connection_secrets[0]
            : (conn.connection_secrets as any);

          const enc = secrets?.access_token_enc ?? secrets?.api_key_enc;
          if (enc) {
            const buf =
              typeof enc === "string"
                ? enc.startsWith("\\x")
                  ? Buffer.from(enc.slice(2), "hex")
                  : Buffer.from(enc, "base64")
                : Buffer.from(enc);
            tokenOrApiKey = decryptToken(buf, config.tokenEncKey);
          }
        }
      } catch {
        // Fallback if secrets cannot be decrypted
      }

      // Execute target step
      await executeTargetStep(
        supabase,
        target,
        post,
        media,
        publisher,
        now,
        tokenOrApiKey
      );

      summary.processedCount++;
    } catch (err) {
      summary.errors.push(
        `Target ${target.id} error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return summary;
}
