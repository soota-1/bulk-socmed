import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { addHours } from "date-fns";
import type { PlannedTarget } from "@bulk-socmed/shared";
import {
  type Publisher,
  type StepContext,
  type StepResult,
  type ReconcileResult,
  createStepSuccess,
  createStepError,
} from "./base";

export interface TikTokCreatorInfo {
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
}

export interface TikTokInitVideoOptions {
  title: string;
  privacyLevel: string;
  videoSize: number;
  chunkSize: number;
  totalChunkCount: number;
  accessToken: string;
}

export interface TikTokApiClient {
  getCreatorInfo(accessToken: string): Promise<TikTokCreatorInfo>;
  initVideoUpload(
    opts: TikTokInitVideoOptions
  ): Promise<{ publishId: string; uploadUrl: string; mode?: "direct" | "direct_self_only" | "inbox_draft" }>;
  uploadVideoFile(
    uploadUrl: string,
    filePath: string,
    videoSize: number,
    chunkSize: number,
    totalChunkCount?: number
  ): Promise<void>;
  checkPublishStatus(
    publishId: string,
    accessToken: string
  ): Promise<{
    status:
      | "PROCESSING_DOWNLOAD"
      | "PROCESSING_UPLOAD"
      | "PUBLISH_COMPLETE"
      | "SEND_TO_USER_INBOX"
      | "SUCCESS"
      | "FAILED";
    failReason?: string;
  }>;
}

const MAX_SINGLE_CHUNK_BYTES = 64 * 1024 * 1024; // 64 MB max single chunk
const MULTI_CHUNK_SIZE_BYTES = 32 * 1024 * 1024; // 32 MB per chunk for multi-chunk

export class TikTokPublisher implements Publisher {
  readonly platform = "tiktok" as const;

  constructor(private readonly apiClient: TikTokApiClient) {}

  plan(dueAt: Date, now: Date): PlannedTarget {
    // Schedule upload immediately so TikTok processes and holds the schedule
    return { platform: "tiktok", dispatch_at: new Date(now) };
  }

  async advance(ctx: StepContext): Promise<StepResult> {
    const { target, post, media, accessToken, now } = ctx;

    if (!accessToken) {
      return createStepError("token_missing", "Token otorisasi TikTok tidak tersedia. Hubungkan ulang akun TikTok di menu Koneksi.", {
        isAuthError: true,
      });
    }

    const step = target.step;

    // 1. Step: init_upload
    if (!step || step === "init_upload" || step === "window_check") {
      if (target.external_id) {
        return createStepSuccess("uploading", "wait_status", {
          externalId: target.external_id,
        });
      }

      try {
        const fileStat = await fs.stat(media.videoFilePath);
        const videoSize = fileStat.size;

        if (videoSize <= 0) {
          return createStepError("invalid_file", "Ukuran file video TikTok kosong (0 byte).", { isPermanent: true });
        }

        // Fetch creator info to get dynamic privacy_level_options (non-fatal if using inbox draft mode)
        let privacyLevel = "SELF_ONLY";
        try {
          const creator = await this.apiClient.getCreatorInfo(accessToken);
          const options = creator.privacy_level_options ?? [];

          // Pick preferred privacy level (prioritize PUBLIC_TO_EVERYONE, fallback MUTUAL_FOLLOW_FRIENDS, fallback SELF_ONLY)
          if (options.includes("PUBLIC_TO_EVERYONE")) {
            privacyLevel = "PUBLIC_TO_EVERYONE";
          } else if (options.includes("MUTUAL_FOLLOW_FRIENDS")) {
            privacyLevel = "MUTUAL_FOLLOW_FRIENDS";
          } else if (options.length > 0 && options[0]) {
            privacyLevel = options[0];
          }
        } catch {
          // Fallback safely to SELF_ONLY
        }

        let chunkSize = videoSize;
        let totalChunkCount = 1;

        if (videoSize > MAX_SINGLE_CHUNK_BYTES) {
          chunkSize = MULTI_CHUNK_SIZE_BYTES;
          totalChunkCount = Math.floor(videoSize / chunkSize);
        }

        const fullCaption =
          post.hashtags && !post.caption.includes(post.hashtags)
            ? `${post.caption}\n${post.hashtags}`
            : post.caption;

        const { publishId, uploadUrl, mode } = await this.apiClient.initVideoUpload({
          title: fullCaption,
          privacyLevel,
          videoSize,
          chunkSize,
          totalChunkCount,
          accessToken,
        });

        return createStepSuccess("uploading", "upload_chunks", {
          externalId: publishId,
          externalState: {
            ...target.external_state,
            upload_url: uploadUrl,
            chunk_size: chunkSize,
            total_chunk_count: totalChunkCount,
            video_size: videoSize,
            publish_mode: mode ?? "direct",
          },
        });
      } catch (err) {
        return createStepError("tiktok_init_error", err instanceof Error ? err.message : String(err));
      }
    }

    // 2. Step: upload_chunks
    if (step === "upload_chunks") {
      const uploadUrl = (target.external_state?.upload_url as string) || "";
      if (!uploadUrl) {
        return createStepError("missing_upload_url", "Upload URL TikTok tidak ditemukan.", { isPermanent: true });
      }

      try {
        const fileStat = await fs.stat(media.videoFilePath);
        const videoSize = fileStat.size;
        const chunkSize =
          (target.external_state?.chunk_size as number) ||
          (videoSize > MAX_SINGLE_CHUNK_BYTES ? MULTI_CHUNK_SIZE_BYTES : videoSize);
        const totalChunkCount =
          (target.external_state?.total_chunk_count as number) ||
          (videoSize > MAX_SINGLE_CHUNK_BYTES ? Math.floor(videoSize / chunkSize) : 1);

        await this.apiClient.uploadVideoFile(
          uploadUrl,
          media.videoFilePath,
          videoSize,
          chunkSize,
          totalChunkCount
        );

        return createStepSuccess("awaiting_platform", "wait_status", {
          externalId: target.external_id,
          delayMinutes: 1,
        });
      } catch (err) {
        return createStepError("tiktok_upload_error", err instanceof Error ? err.message : String(err));
      }
    }

    // 3. Step: wait_status
    if (step === "wait_status" || step === "await_publish") {
      if (!target.external_id) {
        return createStepError("missing_publish_id", "ID publikasi TikTok tidak ditemukan.", { isPermanent: true });
      }

      try {
        const { status, failReason } = await this.apiClient.checkPublishStatus(target.external_id, accessToken);

        if (
          status === "SUCCESS" ||
          status === "PUBLISH_COMPLETE" ||
          status === "SEND_TO_USER_INBOX"
        ) {
          return createStepSuccess("published", null, {
            externalId: target.external_id,
          });
        }

        if (status === "FAILED") {
          return createStepError("tiktok_publish_failed", failReason || "Pemrosesan video oleh TikTok gagal.", {
            isPermanent: true,
          });
        }

        // Still processing (PROCESSING_DOWNLOAD / PROCESSING_UPLOAD)
        return createStepSuccess("awaiting_platform", "wait_status", {
          delayMinutes: 1,
          externalId: target.external_id,
        });
      } catch (err) {
        return createStepError("tiktok_status_error", err instanceof Error ? err.message : String(err));
      }
    }

    return createStepError("unknown_step", `Langkah TikTok tidak dikenali: ${step}`, { isPermanent: true });
  }

  async reconcile(ctx: StepContext): Promise<ReconcileResult> {
    const { target, accessToken } = ctx;
    if (!target.external_id || !accessToken) {
      return { resolvedStatus: "scheduled" };
    }

    try {
      const { status } = await this.apiClient.checkPublishStatus(target.external_id, accessToken);
      if (
        status === "SUCCESS" ||
        status === "PUBLISH_COMPLETE" ||
        status === "SEND_TO_USER_INBOX"
      ) {
        return { resolvedStatus: "published", externalId: target.external_id };
      }
      return { resolvedStatus: "scheduled", externalId: target.external_id };
    } catch (err) {
      return {
        resolvedStatus: "failed",
        requiresManualCheck: true,
        notes: `Gagal verifikasi status TikTok: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async applyChanges(): Promise<void> {
    // Post update after creation is not supported by TikTok Content Posting API
  }

  async cancel(): Promise<void> {
    // Unfinished video uploads are cleaned automatically by TikTok
  }
}
