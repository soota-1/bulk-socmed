import { differenceInDays, differenceInHours, subDays } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptToken, decryptToken, type Platform } from "@bulk-socmed/shared";
import type { WorkerConfig } from "./config";
import { cleanMediaCache } from "./media-cache";

export interface MaintenanceSummary {
  mediaCleanedCount: number;
  tokensRefreshedCount: number;
  eventsPrunedCount: number;
  errors: string[];
}

export interface TokenRefresher {
  (
    platform: Platform,
    refreshToken: string
  ): Promise<{ accessToken: string; expiresInSeconds: number }>;
}

const TERMINAL_STATUSES = new Set(["published", "cancelled", "failed", "missed"]);

/**
 * Clean up storage files and local cache for posts where all targets have reached
 * terminal statuses and the retention period has passed.
 */
export async function cleanExpiredPostMedia(
  supabase: SupabaseClient,
  now = new Date(),
  mediaRetentionDays = 3
): Promise<number> {
  // Query posts that have media stored
  const { data: posts, error } = await supabase
    .from("posts")
    .select("id, video_object_path, thumbnail_object_path, due_at, updated_at, targets(id, status, published_at, updated_at)")
    .neq("video_object_path", "")
    .not("video_object_path", "is", null);

  if (error || !posts) return 0;

  let cleanedCount = 0;

  for (const post of posts) {
    const targets = (post.targets as any[]) ?? [];
    if (targets.length === 0) continue;

    // Check if ALL targets are in terminal status
    const allTerminal = targets.every((t) => TERMINAL_STATUSES.has(t.status));
    if (!allTerminal) continue;

    // Determine latest activity time
    const timestamps = targets
      .map((t) => new Date(t.published_at || t.updated_at || post.due_at).getTime())
      .concat(new Date(post.updated_at || post.due_at).getTime());
    const maxTime = new Date(Math.max(...timestamps));

    const diffDays = differenceInDays(now, maxTime);
    if (diffDays >= mediaRetentionDays) {
      // 1. Remove video from Supabase Storage
      if (post.video_object_path) {
        await supabase.storage.from("videos").remove([post.video_object_path]);
      }

      // 2. Remove thumbnail from Supabase Storage if present
      if (post.thumbnail_object_path) {
        await supabase.storage.from("thumbnails").remove([post.thumbnail_object_path]);
      }

      // 3. Remove local cache directory
      await cleanMediaCache(post.id);

      // 4. Update post to indicate media is cleaned
      await supabase
        .from("posts")
        .update({
          video_object_path: "",
          thumbnail_object_path: null,
          updated_at: now.toISOString(),
        })
        .eq("id", post.id);

      // 5. Log audit event
      if (targets[0]) {
        await supabase.from("target_events").insert({
          target_id: targets[0].id,
          event: "media_cleaned",
          detail: { retention_days: mediaRetentionDays, post_id: post.id },
        });
      }

      cleanedCount++;
    }
  }

  return cleanedCount;
}

/**
 * Auto-refresh OAuth tokens that are expiring within 24 hours.
 */
export async function refreshExpiringTokens(
  supabase: SupabaseClient,
  config: WorkerConfig,
  now = new Date(),
  customRefresher?: TokenRefresher
): Promise<number> {
  const { data: conns, error } = await supabase
    .from("connections")
    .select("id, platform, token_expires_at, owner_id, connection_secrets(refresh_token_enc)")
    .eq("status", "active")
    .in("platform", ["youtube", "instagram"])
    .not("token_expires_at", "is", null);

  if (error || !conns) return 0;

  let refreshedCount = 0;

  for (const conn of conns) {
    if (!conn.token_expires_at) continue;

    const expiresAt = new Date(conn.token_expires_at);
    const hoursRemaining = differenceInHours(expiresAt, now);

    // Refresh if expiring within 24 hours or already expired
    if (hoursRemaining > 24) continue;

    const secrets = Array.isArray(conn.connection_secrets)
      ? conn.connection_secrets[0]
      : (conn.connection_secrets as any);

    const refreshEnc = secrets?.refresh_token_enc;
    if (!refreshEnc) continue;

    try {
      const buf =
        typeof refreshEnc === "string"
          ? refreshEnc.startsWith("\\x")
            ? Buffer.from(refreshEnc.slice(2), "hex")
            : Buffer.from(refreshEnc, "base64")
          : Buffer.from(refreshEnc);
      const refreshToken = decryptToken(buf, config.tokenEncKey);

      let newAccessToken = "";
      let expiresInSeconds = 3600;

      if (customRefresher) {
        const result = await customRefresher(conn.platform as Platform, refreshToken);
        newAccessToken = result.accessToken;
        expiresInSeconds = result.expiresInSeconds;
      } else {
        // Production refresh call
        if (conn.platform === "youtube") {
          const res = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: process.env.GOOGLE_CLIENT_ID || "",
              client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
              refresh_token: refreshToken,
              grant_type: "refresh_token",
            }),
          });
          const data = await res.json();
          if (!res.ok || !data.access_token) {
            throw new Error(data.error_description || "YouTube refresh failed");
          }
          newAccessToken = data.access_token;
          expiresInSeconds = data.expires_in ?? 3600;
        } else {
          // Instagram / Meta token refresh
          const res = await fetch(
            `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${
              process.env.META_CLIENT_ID || ""
            }&client_secret=${process.env.META_CLIENT_SECRET || ""}&fb_exchange_token=${refreshToken}`
          );
          const data = await res.json();
          if (!res.ok || !data.access_token) {
            throw new Error(data.error?.message || "Instagram refresh failed");
          }
          newAccessToken = data.access_token;
          expiresInSeconds = data.expires_in ?? 5184000;
        }
      }

      // Re-encrypt new access token
      const accessEnc = encryptToken(newAccessToken, config.tokenEncKey);
      const newExpiresAt = new Date(now.getTime() + expiresInSeconds * 1000).toISOString();

      // Update secrets and connection
      await supabase
        .from("connection_secrets")
        .update({
          access_token_enc: accessEnc,
          updated_at: now.toISOString(),
        })
        .eq("connection_id", conn.id);

      await supabase
        .from("connections")
        .update({
          token_expires_at: newExpiresAt,
          updated_at: now.toISOString(),
        })
        .eq("id", conn.id);

      refreshedCount++;
    } catch {
      // Mark needs_reauth on permanent failure
      await supabase
        .from("connections")
        .update({
          status: "needs_reauth",
          updated_at: now.toISOString(),
        })
        .eq("id", conn.id);

      await supabase
        .from("targets")
        .update({
          hold_reason: "needs_reauth",
          updated_at: now.toISOString(),
        })
        .eq("owner_id", conn.owner_id)
        .eq("platform", conn.platform)
        .in("status", ["scheduled", "uploading", "awaiting_platform"]);
    }
  }

  return refreshedCount;
}

/**
 * Prune old audit events beyond eventRetentionDays.
 */
export async function pruneOldEvents(
  supabase: SupabaseClient,
  now = new Date(),
  eventRetentionDays = 180
): Promise<number> {
  const cutoff = subDays(now, eventRetentionDays).toISOString();

  const { data, error } = await supabase
    .from("target_events")
    .delete()
    .lt("created_at", cutoff)
    .select("id");

  if (error || !data) return 0;
  return data.length;
}

/**
 * Run one complete maintenance cycle.
 */
export async function runMaintenanceCycle(
  supabase: SupabaseClient,
  config: WorkerConfig,
  now = new Date(),
  customRefresher?: TokenRefresher
): Promise<MaintenanceSummary> {
  const summary: MaintenanceSummary = {
    mediaCleanedCount: 0,
    tokensRefreshedCount: 0,
    eventsPrunedCount: 0,
    errors: [],
  };

  try {
    summary.mediaCleanedCount = await cleanExpiredPostMedia(supabase, now);
  } catch (err) {
    summary.errors.push(`Media cleanup error: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    summary.tokensRefreshedCount = await refreshExpiringTokens(
      supabase,
      config,
      now,
      customRefresher
    );
  } catch (err) {
    summary.errors.push(`Token refresh error: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    summary.eventsPrunedCount = await pruneOldEvents(supabase, now);
  } catch (err) {
    summary.errors.push(`Event prune error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return summary;
}
