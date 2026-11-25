import { differenceInMinutes } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_GRACE_MINUTES, type Platform, type TargetStatus } from "@bulk-socmed/shared";
import type { WorkerConfig } from "./config";
import { sendHeartbeat } from "./heartbeat";
import { ensureMediaCache, type CachedMedia } from "./media-cache";
import { decryptToken, encryptToken, parseByteaPayload } from "./crypto";
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
  tokenOrApiKey?: string,
  connectionExternalAccountId?: string
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

  const extState = (target.external_state ?? {}) as Record<string, unknown>;
  const overrideTitle =
    typeof extState.override_title === "string" && extState.override_title.trim().length > 0
      ? extState.override_title.trim()
      : post.title;
  const overrideCaption =
    typeof extState.override_caption === "string" && extState.override_caption.trim().length > 0
      ? extState.override_caption.trim()
      : post.caption;
  const overrideHashtags =
    typeof extState.override_hashtags === "string"
      ? extState.override_hashtags
      : post.hashtags ?? "";

  const stepPost: StepPost = {
    id: post.id,
    title: overrideTitle,
    caption: overrideCaption,
    hashtags: overrideHashtags,
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
      target.external_state?.profile_id ??
      connectionExternalAccountId) as string | undefined,
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
 * Process pending connection test requests triggered by the web UI.
 */
export async function processConnectionTests(
  supabase: SupabaseClient,
  config: WorkerConfig,
  now = new Date(),
  customTester?: (platform: Platform, tokenOrKey: string) => Promise<boolean>
): Promise<number> {
  let query = supabase
    .from("connections")
    .select("id, platform, test_requested_at, last_test, owner_id, connection_secrets(access_token_enc, api_key_enc)")
    .not("test_requested_at", "is", null);

  if (config.ownerId) {
    query = query.eq("owner_id", config.ownerId);
  }

  const { data: conns, error } = await query;
  if (error || !conns) return 0;

  let testedCount = 0;

  for (const conn of conns) {
    const lastTestAt = conn.last_test?.at ? new Date(conn.last_test.at) : null;
    const reqAt = new Date(conn.test_requested_at);

    // If test was already completed after requested_at, skip
    if (lastTestAt && lastTestAt >= reqAt) {
      continue;
    }

    // Decrypt token
    const secrets = Array.isArray(conn.connection_secrets)
      ? conn.connection_secrets[0]
      : (conn.connection_secrets as any);

    const enc = secrets?.access_token_enc ?? secrets?.api_key_enc;
    if (!enc) {
      await supabase
        .from("connections")
        .update({
          last_test: {
            at: now.toISOString(),
            ok: false,
            error: { code: "missing_credentials", message: "Kredensial tidak ditemukan." },
          },
          updated_at: now.toISOString(),
        })
        .eq("id", conn.id);
      testedCount++;
      continue;
    }

    try {
      const buf = parseByteaPayload(enc);
      const tokenOrKey = decryptToken(buf, config.tokenEncKey);

      let ok = true;
      let errorObj: { code: string; message: string } | null = null;

      if (customTester) {
        ok = await customTester(conn.platform as Platform, tokenOrKey);
      }

      await supabase
        .from("connections")
        .update({
          last_test: {
            at: now.toISOString(),
            ok,
            error: errorObj,
          },
          updated_at: now.toISOString(),
        })
        .eq("id", conn.id);

      testedCount++;
    } catch (testErr) {
      await supabase
        .from("connections")
        .update({
          last_test: {
            at: now.toISOString(),
            ok: false,
            error: {
              code: "test_error",
              message: testErr instanceof Error ? testErr.message : String(testErr),
            },
          },
          updated_at: now.toISOString(),
        })
        .eq("id", conn.id);
      testedCount++;
    }
  }

  return testedCount;
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

  // 2. Process pending connection test requests
  try {
    await processConnectionTests(supabase, config, now);
  } catch (testErr) {
    summary.errors.push(`Connection tests error: ${testErr instanceof Error ? testErr.message : String(testErr)}`);
  }

  // 3. Claim targets
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
      let connectionExternalAccountId: string | undefined;
      try {
        const { data: conn } = await supabase
          .from("connections")
          .select("id, status, external_account_id, details, token_expires_at, connection_secrets(access_token_enc, refresh_token_enc, api_key_enc)")
          .eq("owner_id", target.owner_id)
          .eq("platform", target.platform)
          .maybeSingle();

        if (conn && conn.status !== "disabled") {
          connectionExternalAccountId =
            conn.external_account_id ??
            (conn.details as any)?.buffer_channel_id ??
            undefined;

          if (conn.connection_secrets) {
            const secrets = Array.isArray(conn.connection_secrets)
              ? conn.connection_secrets[0]
              : (conn.connection_secrets as any);

            const enc = secrets?.access_token_enc ?? secrets?.api_key_enc;
            if (enc) {
              const buf = parseByteaPayload(enc);
              tokenOrApiKey = decryptToken(buf, config.tokenEncKey);
            }

            // Auto-refresh expired/expiring YouTube access token on demand
            if (
              target.platform === "youtube" &&
              secrets?.refresh_token_enc &&
              conn.token_expires_at &&
              new Date(conn.token_expires_at).getTime() <= now.getTime() + 5 * 60 * 1000
            ) {
              try {
                const rBuf = parseByteaPayload(secrets.refresh_token_enc);
                const refreshToken = decryptToken(rBuf, config.tokenEncKey);
                const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
                  method: "POST",
                  headers: { "Content-Type": "application/x-www-form-urlencoded" },
                  body: new URLSearchParams({
                    client_id: process.env.GOOGLE_CLIENT_ID || "",
                    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
                    refresh_token: refreshToken,
                    grant_type: "refresh_token",
                  }),
                });
                if (refreshRes.ok) {
                  const refreshData: any = await refreshRes.json();
                  if (typeof refreshData?.access_token === "string" && refreshData.access_token.length > 0) {
                    const renewedToken: string = refreshData.access_token;
                    tokenOrApiKey = renewedToken;
                    const newAccessEnc = encryptToken(renewedToken, config.tokenEncKey);
                    const newExpiresAt = new Date(
                      now.getTime() + (refreshData.expires_in ?? 3600) * 1000
                    ).toISOString();
                    await supabase
                      .from("connection_secrets")
                      .update({ access_token_enc: newAccessEnc, updated_at: now.toISOString() })
                      .eq("connection_id", conn.id);
                    await supabase
                      .from("connections")
                      .update({
                        token_expires_at: newExpiresAt,
                        status: "active",
                        updated_at: now.toISOString(),
                      })
                      .eq("id", conn.id);
                  }
                }
              } catch (refreshErr) {
                summary.errors.push(
                  `YouTube token refresh failed for conn ${conn.id}: ${
                    refreshErr instanceof Error ? refreshErr.message : String(refreshErr)
                  }`
                );
              }
            } else if (
              target.platform === "tiktok" &&
              secrets?.refresh_token_enc &&
              conn.token_expires_at &&
              new Date(conn.token_expires_at).getTime() <= now.getTime() + 5 * 60 * 1000
            ) {
              try {
                const rBuf = parseByteaPayload(secrets.refresh_token_enc);
                const refreshToken = decryptToken(rBuf, config.tokenEncKey);
                const clientKey = process.env.TIKTOK_CLIENT_KEY || process.env.TIKTOK_CLIENT_ID || "";
                const clientSecret = process.env.TIKTOK_CLIENT_SECRET || "";
                const refreshRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
                  method: "POST",
                  headers: { "Content-Type": "application/x-www-form-urlencoded" },
                  body: new URLSearchParams({
                    client_key: clientKey,
                    client_secret: clientSecret,
                    grant_type: "refresh_token",
                    refresh_token: refreshToken,
                  }),
                });
                if (refreshRes.ok) {
                  const refreshData: any = await refreshRes.json();
                  if (typeof refreshData?.access_token === "string" && refreshData.access_token.length > 0) {
                    const renewedToken: string = refreshData.access_token;
                    tokenOrApiKey = renewedToken;
                    const newAccessEnc = encryptToken(renewedToken, config.tokenEncKey);
                    const newRefreshEnc = refreshData.refresh_token
                      ? encryptToken(refreshData.refresh_token, config.tokenEncKey)
                      : undefined;
                    const newExpiresAt = new Date(
                      now.getTime() + (refreshData.expires_in ?? 86400) * 1000
                    ).toISOString();
                    const secretsUpdate: Record<string, unknown> = {
                      access_token_enc: newAccessEnc,
                      updated_at: now.toISOString(),
                    };
                    if (newRefreshEnc) {
                      secretsUpdate.refresh_token_enc = newRefreshEnc;
                    }
                    await supabase
                      .from("connection_secrets")
                      .update(secretsUpdate)
                      .eq("connection_id", conn.id);
                    await supabase
                      .from("connections")
                      .update({
                        token_expires_at: newExpiresAt,
                        status: "active",
                        updated_at: now.toISOString(),
                      })
                      .eq("id", conn.id);
                  }
                }
              } catch (refreshErr) {
                summary.errors.push(
                  `TikTok token refresh failed for conn ${conn.id}: ${
                    refreshErr instanceof Error ? refreshErr.message : String(refreshErr)
                  }`
                );
              }
            }
          }
        }
      } catch (secErr) {
        summary.errors.push(
          `Failed to resolve credentials for ${target.platform} target ${target.id}: ${
            secErr instanceof Error ? secErr.message : String(secErr)
          }`
        );
      }

      // Execute target step
      await executeTargetStep(
        supabase,
        target,
        post,
        media,
        publisher,
        now,
        tokenOrApiKey,
        connectionExternalAccountId
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
