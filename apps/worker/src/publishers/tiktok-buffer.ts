import { addHours, differenceInSeconds, subDays } from "date-fns";
import type { PlannedTarget } from "@bulk-socmed/shared";
import {
  createR2SignedDownloadUrl,
  headR2Object,
  isR2Configured,
} from "@bulk-socmed/shared/r2";
import {
  type Publisher,
  type StepContext,
  type StepResult,
  type ReconcileResult,
  createStepSuccess,
  createStepError,
} from "./base";

export interface BufferCreatePostOptions {
  channelId: string;
  text: string;
  dueAt: string;
  videoUrl: string;
  apiKey: string;
}

export interface BufferApiClient {
  createPost(opts: BufferCreatePostOptions): Promise<{ postId: string }>;
  getPostStatus(
    postId: string,
    apiKey: string
  ): Promise<{ status: "pending" | "sent" | "error"; error?: string }>;
}

export class TikTokBufferPublisher implements Publisher {
  readonly platform = "tiktok" as const;

  constructor(private readonly apiClient: BufferApiClient) {}

  plan(dueAt: Date, now: Date): PlannedTarget {
    // Initial plan: start dispatch cycle now (rolling window evaluated in advance)
    return { platform: "tiktok", dispatch_at: new Date(now) };
  }

  async advance(ctx: StepContext): Promise<StepResult> {
    const { target, post, apiKey, externalAccountId, now, supabase } = ctx;

    if (!apiKey) {
      return createStepError("api_key_missing", "API Key Buffer tidak ditemukan.", {
        isAuthError: true,
      });
    }

    const channelId = externalAccountId || (target.external_state?.buffer_channel_id as string);
    if (!channelId) {
      return createStepError("channel_id_missing", "Channel TikTok di Buffer belum dipilih.", {
        isPermanent: true,
      });
    }

    const step = target.step;
    const dueAt = new Date(post.due_at);
    const windowDays = (target.external_state?.window_days as number) || 2;

    // 1. Rolling window check & generate signed URL
    if (!step || step === "window_check") {
      const windowStart = subDays(dueAt, windowDays);

      // Outside rolling window: hold until window opens
      if (now < windowStart) {
        return createStepSuccess("scheduled", "window_check", {
          runAt: windowStart,
        });
      }

      // Inside rolling window: generate Signed URL valid until due_at + 6 hours
      try {
        const expiryTime = addHours(dueAt, 6);
        const expiresInSeconds = Math.max(differenceInSeconds(expiryTime, now), 6 * 3600);

        let signedUrl: string | undefined;
        if (isR2Configured() && (await headR2Object("videos", post.video_object_path))) {
          signedUrl = await createR2SignedDownloadUrl({
            folder: "videos",
            objectPath: post.video_object_path,
            expiresInSeconds,
          });
        } else {
          const { data, error } = await supabase.storage
            .from("videos")
            .createSignedUrl(post.video_object_path, expiresInSeconds);

          if (error || !data?.signedUrl) {
            return createStepError(
              "storage_sign_error",
              `Gagal membuat signed URL untuk Buffer: ${error?.message}`
            );
          }
          signedUrl = data.signedUrl;
        }

        return createStepSuccess("uploading", "create_post", {
          externalState: {
            ...target.external_state,
            signed_url: signedUrl,
          },
        });
      } catch (err) {
        return createStepError("sign_url_error", err instanceof Error ? err.message : String(err));
      }
    }

    // 2. Create post in Buffer
    if (step === "create_post") {
      if (target.external_id) {
        return createStepSuccess("awaiting_platform", "await_publish", {
          externalId: target.external_id,
        });
      }

      const signedUrl = target.external_state?.signed_url as string;
      if (!signedUrl) {
        return createStepError("missing_signed_url", "Signed URL video tidak ditemukan.", {
          isPermanent: true,
        });
      }

      try {
        const text =
          post.hashtags && !post.caption.includes(post.hashtags)
            ? `${post.caption}\n${post.hashtags}`
            : post.caption;

        const { postId } = await this.apiClient.createPost({
          channelId,
          text,
          dueAt: post.due_at,
          videoUrl: signedUrl,
          apiKey,
        });

        return createStepSuccess("awaiting_platform", "await_publish", {
          externalId: postId,
        });
      } catch (err) {
        return createStepError("buffer_create_post_error", err instanceof Error ? err.message : String(err));
      }
    }

    // 3. Await publish
    if (step === "await_publish") {
      if (!target.external_id) {
        return createStepError("missing_external_id", "ID posting Buffer tidak ditemukan.", {
          isPermanent: true,
        });
      }

      // If due_at is still in the future, wait until due_at
      if (now < dueAt) {
        return createStepSuccess("awaiting_platform", "await_publish", {
          runAt: dueAt,
          externalId: target.external_id,
        });
      }

      // Past due_at: poll Buffer post status
      try {
        const { status, error } = await this.apiClient.getPostStatus(target.external_id, apiKey);

        if (status === "sent") {
          return createStepSuccess("published", null, {
            externalId: target.external_id,
          });
        }

        if (status === "error") {
          return createStepError("buffer_publish_error", error || "Buffer gagal menerbitkan posting ke TikTok.", {
            isPermanent: true,
          });
        }

        // Still pending/processing in Buffer, check again in 1 minute
        return createStepSuccess("awaiting_platform", "await_publish", {
          delayMinutes: 1,
          externalId: target.external_id,
        });
      } catch (err) {
        return createStepError("check_buffer_status_error", err instanceof Error ? err.message : String(err));
      }
    }

    return createStepError("unknown_step", `Langkah TikTok tidak dikenali: ${step}`, { isPermanent: true });
  }

  async reconcile(ctx: StepContext): Promise<ReconcileResult> {
    const { target, apiKey } = ctx;
    if (!target.external_id || !apiKey) {
      return { resolvedStatus: "scheduled" };
    }

    try {
      const { status } = await this.apiClient.getPostStatus(target.external_id, apiKey);
      if (status === "sent") {
        return { resolvedStatus: "published", externalId: target.external_id };
      }
      return { resolvedStatus: "scheduled", externalId: target.external_id };
    } catch (err) {
      return {
        resolvedStatus: "failed",
        requiresManualCheck: true,
        notes: `Gagal verifikasi status Buffer: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async applyChanges(): Promise<void> {
    // If post update supported by Buffer API
  }

  async cancel(): Promise<void> {
    // If post deletion supported by Buffer API
  }
}
