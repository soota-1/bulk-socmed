import { addMinutes } from "date-fns";
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

export interface InstagramContainerOptions {
  caption: string;
  coverFilePath?: string;
  coverUrl?: string;
  accessToken?: string;
}

export interface InstagramApiClient {
  checkPublishingLimit(userId: string, accessToken?: string): Promise<{ remaining: number; quotaTotal: number }>;
  createContainer(userId: string, opts: InstagramContainerOptions): Promise<{ containerId: string; uploadUrl?: string }>;
  uploadMedia(uploadUrl: string, filePath: string): Promise<void>;
  checkContainerStatus(
    containerId: string,
    accessToken?: string
  ): Promise<{ status: "IN_PROGRESS" | "FINISHED" | "ERROR"; errorMessage?: string }>;
  publishMedia(
    userId: string,
    containerId: string,
    accessToken?: string
  ): Promise<{ mediaId: string; permalink?: string }>;
  getRecentMedia(userId: string, accessToken?: string): Promise<Array<{ id: string; caption?: string }>>;
}

export class InstagramPublisher implements Publisher {
  readonly platform = "instagram" as const;

  constructor(private readonly apiClient: InstagramApiClient) { }

  plan(dueAt: Date): PlannedTarget {
    // Reels preparation starts 10 minutes before due_at
    return { platform: "instagram", dispatch_at: addMinutes(dueAt, -10) };
  }

  async advance(ctx: StepContext): Promise<StepResult> {
    const { target, post, media, accessToken, externalAccountId, now } = ctx;

    if (!accessToken) {
      return createStepError("token_missing", "Token otorisasi Instagram tidak tersedia.", {
        isAuthError: true,
      });
    }

    if (!externalAccountId || externalAccountId === "me") {
      return createStepError(
        "ig_account_missing",
        "ID Akun Bisnis Instagram belum ditemukan. Pastikan IG Profesional sudah ditautkan ke Facebook Page dan hubungkan ulang di menu Koneksi.",
        { isAuthError: true }
      );
    }

    const userId = externalAccountId;
    const step = target.step;

    // 1. Check publishing limit
    if (!step || step === "check_limit") {
      try {
        const { remaining } = await this.apiClient.checkPublishingLimit(userId, accessToken);
        if (remaining <= 0) {
          return createStepError(
            "instagram_limit_exceeded",
            "Batas posting Instagram hari ini sudah tercapai (100 posting / 24 jam).",
            { isPermanent: true }
          );
        }
        return createStepSuccess("uploading", "create_container");
      } catch (err) {
        return createStepError("check_limit_error", err instanceof Error ? err.message : String(err));
      }
    }

    // 2. Create container
    if (step === "create_container") {
      try {
        const fullCaption =
          post.hashtags && !post.caption.includes(post.hashtags)
            ? `${post.caption}\n${post.hashtags}`
            : post.caption;

        let coverUrl: string | undefined;
        if (post.thumbnail_object_path) {
          try {
            if (isR2Configured() && (await headR2Object("thumbnails", post.thumbnail_object_path))) {
              coverUrl = await createR2SignedDownloadUrl({
                folder: "thumbnails",
                objectPath: post.thumbnail_object_path,
                expiresInSeconds: 3600,
              });
            } else if (ctx.supabase?.storage) {
              const { data: signed } = await ctx.supabase.storage
                .from("thumbnails")
                .createSignedUrl(post.thumbnail_object_path, 3600);
              if (signed?.signedUrl) {
                coverUrl = signed.signedUrl;
              }
            }
          } catch {
            // Non-blocking: proceed without cover_url if signing fails
          }
        }

        const { containerId, uploadUrl } = await this.apiClient.createContainer(userId, {
          caption: fullCaption,
          coverFilePath: media.thumbFilePath,
          ...(coverUrl ? { coverUrl } : {}),
          accessToken,
        });

        return createStepSuccess("uploading", "upload_video", {
          externalId: containerId,
          externalState: {
            ...target.external_state,
            upload_url: uploadUrl,
          },
        });
      } catch (err) {
        return createStepError("create_container_error", err instanceof Error ? err.message : String(err));
      }
    }

    // 3. Upload video to container
    if (step === "upload_video") {
      const uploadUrl = (target.external_state?.upload_url as string) || "";
      if (!uploadUrl) {
        return createStepError("missing_upload_url", "Upload URL Instagram tidak ditemukan.", { isPermanent: true });
      }

      try {
        await this.apiClient.uploadMedia(uploadUrl, media.videoFilePath);
        return createStepSuccess("uploading", "wait_finished", {
          externalId: target.external_id,
        });
      } catch (err) {
        return createStepError("upload_media_error", err instanceof Error ? err.message : String(err));
      }
    }

    // 4. Wait for container to be FINISHED
    if (step === "wait_finished") {
      if (!target.external_id) {
        return createStepError("missing_container_id", "Container ID Instagram tidak ditemukan.", { isPermanent: true });
      }

      try {
        const { status, errorMessage } = await this.apiClient.checkContainerStatus(target.external_id, accessToken);

        if (status === "IN_PROGRESS") {
          return createStepSuccess("uploading", "wait_finished", {
            delayMinutes: 1,
            externalId: target.external_id,
          });
        }

        if (status === "ERROR") {
          return createStepError("container_error", errorMessage || "Pengolahan kontainer Instagram gagal.", {
            isPermanent: true,
          });
        }

        // Status is FINISHED
        const dueAt = new Date(post.due_at);
        if (now < dueAt) {
          // Ready, but wait until due_at to publish
          return createStepSuccess("awaiting_platform", "wait_finished", {
            runAt: dueAt,
            externalId: target.external_id,
          });
        }

        // At or past due_at: advance to publish_requested atomic step
        return createStepSuccess("uploading", "publish_requested", {
          externalId: target.external_id,
        });
      } catch (err) {
        return createStepError("check_status_error", err instanceof Error ? err.message : String(err));
      }
    }

    // 5. Publish container
    if (step === "publish_requested") {
      if (!target.external_id) {
        return createStepError("missing_container_id", "Container ID Instagram tidak ditemukan.", { isPermanent: true });
      }

      try {
        const { mediaId, permalink } = await this.apiClient.publishMedia(userId, target.external_id, accessToken);

        return createStepSuccess("published", null, {
          externalId: mediaId,
          externalState: {
            ...target.external_state,
            permalink,
          },
        });
      } catch (err) {
        return createStepError("publish_media_error", err instanceof Error ? err.message : String(err));
      }
    }

    return createStepError("unknown_step", `Langkah Instagram tidak dikenali: ${step}`, { isPermanent: true });
  }

  async reconcile(ctx: StepContext): Promise<ReconcileResult> {
    const { target, post, accessToken, externalAccountId } = ctx;
    const userId = externalAccountId ?? "me";

    // Critical recovery: worker crashed during or right after publish_requested
    if (target.step === "publish_requested") {
      try {
        const recent = await this.apiClient.getRecentMedia(userId, accessToken);
        const expectedCaption = post.caption.trim();

        // Check if latest media caption matches
        const matched = recent.find((m) => m.caption?.includes(expectedCaption.slice(0, 50)));

        if (matched) {
          return {
            resolvedStatus: "published",
            externalId: matched.id,
            notes: "Pulih otomatis: Video ditemukan di feed Instagram",
          };
        }

        // Inconclusive: do NOT retry blindly to avoid double post!
        return {
          resolvedStatus: "failed",
          requiresManualCheck: true,
          notes: "Pekerja mati saat memanggil publish. Periksa akun Instagram Anda secara manual sebelum mencoba lagi.",
        };
      } catch (err) {
        return {
          resolvedStatus: "failed",
          requiresManualCheck: true,
          notes: `Gagal rekonsiliasi Instagram: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    return { resolvedStatus: "scheduled" };
  }

  async applyChanges(): Promise<void> {
    // Instagram container cannot be altered via Graph API after creation
  }

  async cancel(): Promise<void> {
    // Unfinished Instagram containers expire automatically after 24 hours
  }
}
