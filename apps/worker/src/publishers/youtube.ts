import type { PlannedTarget } from "@bulk-socmed/shared";
import {
  type Publisher,
  type StepContext,
  type StepResult,
  type ReconcileResult,
  createStepSuccess,
  createStepError,
} from "./base";

export interface YouTubeUploadOptions {
  title: string;
  description: string;
  publishAt: string;
  videoFilePath: string;
  accessToken: string;
}

export interface YouTubeApiClient {
  uploadVideo(opts: YouTubeUploadOptions): Promise<{ videoId: string; uploadUri?: string }>;
  checkProcessing(videoId: string, accessToken?: string): Promise<{ status: "processing" | "succeeded" | "failed" }>;
  setThumbnail(videoId: string, thumbFilePath: string, accessToken?: string): Promise<void>;
  checkPrivacy(videoId: string, accessToken?: string): Promise<{ privacyStatus: "private" | "public" | "unlisted" }>;
  updateVideo(
    videoId: string,
    meta: { title?: string; description?: string; publishAt?: string },
    accessToken?: string
  ): Promise<void>;
  deleteVideo(videoId: string, accessToken?: string): Promise<void>;
}

export class YouTubePublisher implements Publisher {
  readonly platform = "youtube" as const;

  constructor(private readonly apiClient: YouTubeApiClient) {}

  plan(dueAt: Date, now: Date): PlannedTarget {
    // Schedule upload immediately so YouTube processes and holds the schedule
    return { platform: "youtube", dispatch_at: new Date(now) };
  }

  async advance(ctx: StepContext): Promise<StepResult> {
    const { target, post, media, accessToken, now } = ctx;

    if (!accessToken) {
      return createStepError("token_missing", "Token otorisasi YouTube tidak tersedia.", {
        isAuthError: true,
      });
    }

    const step = target.step;

    // 1. Initial upload step
    if (!step || step === "fetch_media" || step === "upload") {
      // If video was already uploaded, move straight to wait_processing
      if (target.external_id) {
        return createStepSuccess("uploading", "wait_processing", {
          externalId: target.external_id,
        });
      }

      try {
        const title = post.title?.trim() || post.caption.split("\n")[0]?.slice(0, 100) || "Untitled Short";
        const description =
          post.hashtags && !post.caption.includes(post.hashtags)
            ? `${post.caption}\n${post.hashtags}`
            : post.caption;

        const { videoId } = await this.apiClient.uploadVideo({
          title,
          description,
          publishAt: post.due_at,
          videoFilePath: media.videoFilePath,
          accessToken,
        });

        return createStepSuccess("uploading", "wait_processing", {
          externalId: videoId,
          delayMinutes: 1,
        });
      } catch (err) {
        return createStepError("youtube_upload_error", err instanceof Error ? err.message : String(err));
      }
    }

    // 2. Wait for processing to finish
    if (step === "wait_processing") {
      if (!target.external_id) {
        return createStepError("missing_external_id", "Video ID YouTube tidak ditemukan.", { isPermanent: true });
      }

      try {
        const { status } = await this.apiClient.checkProcessing(target.external_id, accessToken);

        if (status === "processing") {
          return createStepSuccess("uploading", "wait_processing", {
            delayMinutes: 1,
            externalId: target.external_id,
          });
        }

        if (status === "failed") {
          return createStepError("video_processing_failed", "Pemrosesan video oleh YouTube gagal.", {
            isPermanent: true,
          });
        }

        // Processing succeeded
        if (media.thumbFilePath) {
          return createStepSuccess("uploading", "set_thumbnail", {
            externalId: target.external_id,
          });
        }

        // No custom thumbnail, ready for scheduled publication
        return createStepSuccess("awaiting_platform", "await_publish", {
          externalId: target.external_id,
        });
      } catch (err) {
        return createStepError("check_processing_error", err instanceof Error ? err.message : String(err));
      }
    }

    // 3. Set custom thumbnail
    if (step === "set_thumbnail") {
      if (!target.external_id || !media.thumbFilePath) {
        return createStepSuccess("awaiting_platform", "await_publish", {
          externalId: target.external_id,
        });
      }

      try {
        await this.apiClient.setThumbnail(target.external_id, media.thumbFilePath, accessToken);
        return createStepSuccess("awaiting_platform", "await_publish", {
          externalId: target.external_id,
        });
      } catch (err) {
        return createStepError("set_thumbnail_error", err instanceof Error ? err.message : String(err));
      }
    }

    // 4. Await publication at due_at
    if (step === "await_publish") {
      if (!target.external_id) {
        return createStepError("missing_external_id", "Video ID YouTube tidak ditemukan.", { isPermanent: true });
      }

      const dueAt = new Date(post.due_at);
      if (now < dueAt) {
        return createStepSuccess("awaiting_platform", "await_publish", {
          runAt: dueAt,
          externalId: target.external_id,
        });
      }

      // Past due_at: verify video is public
      try {
        const { privacyStatus } = await this.apiClient.checkPrivacy(target.external_id, accessToken);
        if (privacyStatus === "public") {
          return createStepSuccess("published", null, {
            externalId: target.external_id,
          });
        }

        // Give YouTube another 1-2 minutes to switch to public
        return createStepSuccess("awaiting_platform", "await_publish", {
          delayMinutes: 1,
          externalId: target.external_id,
        });
      } catch (err) {
        return createStepError("check_privacy_error", err instanceof Error ? err.message : String(err));
      }
    }

    return createStepError("unknown_step", `Langkah YouTube tidak dikenali: ${step}`, { isPermanent: true });
  }

  async reconcile(ctx: StepContext): Promise<ReconcileResult> {
    const { target, accessToken } = ctx;
    if (!target.external_id) {
      return { resolvedStatus: "scheduled" };
    }

    try {
      const { privacyStatus } = await this.apiClient.checkPrivacy(target.external_id, accessToken);
      if (privacyStatus === "public") {
        return { resolvedStatus: "published", externalId: target.external_id };
      }
      return { resolvedStatus: "scheduled", externalId: target.external_id };
    } catch (err) {
      return {
        resolvedStatus: "failed",
        requiresManualCheck: true,
        notes: `Gagal verifikasi status YouTube: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async applyChanges(ctx: StepContext): Promise<void> {
    const { target, post, media, accessToken } = ctx;
    if (!target.external_id || !accessToken) return;

    const title = post.title?.trim() || post.caption.split("\n")[0]?.slice(0, 100);
    const description = post.hashtags ? `${post.caption}\n${post.hashtags}` : post.caption;

    await this.apiClient.updateVideo(
      target.external_id,
      { title, description, publishAt: post.due_at },
      accessToken
    );

    if (media.thumbFilePath) {
      await this.apiClient.setThumbnail(target.external_id, media.thumbFilePath, accessToken);
    }
  }

  async cancel(ctx: StepContext): Promise<void> {
    const { target, accessToken } = ctx;
    if (!target.external_id || !accessToken) return;

    await this.apiClient.deleteVideo(target.external_id, accessToken);
  }
}
