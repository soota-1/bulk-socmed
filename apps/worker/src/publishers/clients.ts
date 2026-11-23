import type { YouTubeApiClient, YouTubeUploadOptions } from "./youtube";
import type { InstagramApiClient, InstagramContainerOptions } from "./instagram";
import type { BufferApiClient, BufferCreatePostOptions } from "./tiktok-buffer";
import { YouTubePublisher } from "./youtube";
import { InstagramPublisher } from "./instagram";
import { TikTokBufferPublisher } from "./tiktok-buffer";
import type { Platform, Publisher } from "./base";
import fs from "node:fs/promises";

/**
 * Standard HTTP client for YouTube Data API v3.
 */
export class StandardYouTubeApiClient implements YouTubeApiClient {
  async uploadVideo(opts: YouTubeUploadOptions): Promise<{ videoId: string; uploadUri?: string }> {
    const fileBytes = await fs.readFile(opts.videoFilePath);

    // Initial upload initiation request
    const initRes = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(fileBytes.length),
          "X-Upload-Content-Type": "video/mp4",
        },
        body: JSON.stringify({
          snippet: {
            title: opts.title,
            description: opts.description,
          },
          status: {
            privacyStatus: "private",
            publishAt: opts.publishAt,
            selfDeclaredMadeForKids: false,
          },
        }),
      }
    );

    const uploadUri = initRes.headers.get("Location");
    if (!uploadUri) {
      const errText = await initRes.text();
      throw new Error(`Failed to initiate YouTube resumable upload: ${errText}`);
    }

    // Upload bytes
    const uploadRes = await fetch(uploadUri, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(fileBytes.length),
      },
      body: fileBytes,
    });

    const data = await uploadRes.json();
    if (!uploadRes.ok || !data.id) {
      throw new Error(`YouTube video upload failed: ${data.error?.message || "Unknown error"}`);
    }

    return { videoId: data.id, uploadUri };
  }

  async checkProcessing(videoId: string, accessToken?: string): Promise<{ status: "processing" | "succeeded" | "failed" }> {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=processingDetails&id=${videoId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await res.json();
    const details = data.items?.[0]?.processingDetails;
    if (details?.processingStatus === "succeeded") return { status: "succeeded" };
    if (details?.processingStatus === "failed") return { status: "failed" };
    return { status: "processing" };
  }

  async setThumbnail(videoId: string, thumbFilePath: string, accessToken?: string): Promise<void> {
    const bytes = await fs.readFile(thumbFilePath);
    const res = await fetch(
      `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "image/jpeg",
        },
        body: bytes,
      }
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to set thumbnail: ${err}`);
    }
  }

  async checkPrivacy(videoId: string, accessToken?: string): Promise<{ privacyStatus: "private" | "public" | "unlisted" }> {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=status&id=${videoId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await res.json();
    const privacy = data.items?.[0]?.status?.privacyStatus ?? "private";
    return { privacyStatus: privacy };
  }

  async updateVideo(
    videoId: string,
    meta: { title?: string; description?: string; publishAt?: string },
    accessToken?: string
  ): Promise<void> {
    await fetch("https://www.googleapis.com/youtube/v3/videos?part=snippet,status", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: videoId,
        snippet: {
          title: meta.title,
          description: meta.description,
        },
        status: meta.publishAt ? { privacyStatus: "private", publishAt: meta.publishAt } : undefined,
      }),
    });
  }

  async deleteVideo(videoId: string, accessToken?: string): Promise<void> {
    await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${videoId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }
}

/**
 * Standard HTTP client for Instagram Graph API.
 */
export class StandardInstagramApiClient implements InstagramApiClient {
  async checkPublishingLimit(userId: string, accessToken?: string): Promise<{ remaining: number; quotaTotal: number }> {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${userId}/content_publishing_limit?fields=config,quota_usage&access_token=${accessToken}`
    );
    const data = await res.json();
    const quotaTotal = data.config?.quota_total ?? 25;
    const usage = data.data?.[0]?.quota_usage ?? 0;
    return { remaining: Math.max(0, quotaTotal - usage), quotaTotal };
  }

  async createContainer(userId: string, opts: InstagramContainerOptions): Promise<{ containerId: string; uploadUrl?: string }> {
    const params = new URLSearchParams({
      media_type: "REELS",
      upload_type: "resumable",
      caption: opts.caption,
      access_token: opts.accessToken || "",
    });

    const res = await fetch(`https://graph.facebook.com/v19.0/${userId}/media?${params.toString()}`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok || !data.id) {
      throw new Error(`Failed to create Instagram Reels container: ${data.error?.message || "Unknown error"}`);
    }

    return { containerId: data.id, uploadUrl: data.uri };
  }

  async uploadMedia(uploadUrl: string, filePath: string): Promise<void> {
    const fileBytes = await fs.readFile(filePath);
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        offset: "0",
        file_size: String(fileBytes.length),
      },
      body: fileBytes,
    });
    if (!res.ok) {
      throw new Error("Failed to upload bytes to Instagram container uploadUrl");
    }
  }

  async checkContainerStatus(
    containerId: string,
    accessToken?: string
  ): Promise<{ status: "IN_PROGRESS" | "FINISHED" | "ERROR"; errorMessage?: string }> {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${containerId}?fields=status_code&access_token=${accessToken}`
    );
    const data = await res.json();
    const code = data.status_code;
    if (code === "FINISHED") return { status: "FINISHED" };
    if (code === "ERROR") return { status: "ERROR", errorMessage: data.error?.message || "Container error" };
    return { status: "IN_PROGRESS" };
  }

  async publishMedia(
    userId: string,
    containerId: string,
    accessToken?: string
  ): Promise<{ mediaId: string; permalink?: string }> {
    const params = new URLSearchParams({
      creation_id: containerId,
      access_token: accessToken || "",
    });
    const res = await fetch(`https://graph.facebook.com/v19.0/${userId}/media_publish?${params.toString()}`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok || !data.id) {
      throw new Error(`Failed to publish Instagram media: ${data.error?.message || "Publish failed"}`);
    }
    return { mediaId: data.id };
  }

  async getRecentMedia(userId: string, accessToken?: string): Promise<Array<{ id: string; caption?: string }>> {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${userId}/media?fields=id,caption&limit=5&access_token=${accessToken}`
    );
    const data = await res.json();
    return data.data ?? [];
  }
}

/**
 * Standard HTTP client for Buffer API (TikTok).
 */
export class StandardBufferApiClient implements BufferApiClient {
  async createPost(opts: BufferCreatePostOptions): Promise<{ postId: string }> {
    const res = await fetch("https://api.bufferapp.com/1/updates/create.json", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        access_token: opts.apiKey,
        "profile_ids[]": opts.channelId,
        text: opts.text,
        scheduled_at: opts.dueAt,
        "media[video]": opts.videoUrl,
      }),
    });
    const data = await res.json();
    const update = data.updates?.[0];
    if (!res.ok || !update?.id) {
      throw new Error(`Buffer createPost failed: ${data.message || "Unknown error"}`);
    }
    return { postId: update.id };
  }

  async getPostStatus(
    postId: string,
    apiKey: string
  ): Promise<{ status: "pending" | "sent" | "error"; error?: string }> {
    const res = await fetch(`https://api.bufferapp.com/1/updates/${postId}.json?access_token=${apiKey}`);
    const data = await res.json();
    const status = data.status;
    if (status === "sent") return { status: "sent" };
    if (status === "failed" || status === "error") return { status: "error", error: data.error };
    return { status: "pending" };
  }
}

/**
 * Create production-ready publishers map.
 */
export function createProductionPublishers(): Record<Platform, Publisher> {
  return {
    youtube: new YouTubePublisher(new StandardYouTubeApiClient()),
    instagram: new InstagramPublisher(new StandardInstagramApiClient()),
    tiktok: new TikTokBufferPublisher(new StandardBufferApiClient()),
  };
}
