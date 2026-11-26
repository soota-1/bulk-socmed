import type { YouTubeApiClient, YouTubeUploadOptions } from "./youtube";
import type { InstagramApiClient, InstagramContainerOptions } from "./instagram";
import type { BufferApiClient, BufferCreatePostOptions } from "./tiktok-buffer";
import type { TikTokApiClient, TikTokInitVideoOptions, TikTokCreatorInfo } from "./tiktok";
import { YouTubePublisher } from "./youtube";
import { InstagramPublisher } from "./instagram";
import { TikTokBufferPublisher } from "./tiktok-buffer";
import { TikTokPublisher } from "./tiktok";
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

    const data: any = await uploadRes.json();
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
    const data: any = await res.json();
    const details = data.items?.[0]?.processingDetails;
    if (details?.processingStatus === "succeeded") return { status: "succeeded" };
    if (details?.processingStatus === "failed") return { status: "failed" };
    return { status: "processing" };
  }

  async setThumbnail(videoId: string, thumbFilePath: string, accessToken?: string): Promise<void> {
    const bytes = await fs.readFile(thumbFilePath);
    const contentType = thumbFilePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    const res = await fetch(
      `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": contentType,
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
    const data: any = await res.json();
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
    const data: any = await res.json();
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
    if (opts.coverUrl) {
      params.set("cover_url", opts.coverUrl);
    }

    const res = await fetch(`https://graph.facebook.com/v19.0/${userId}/media?${params.toString()}`, {
      method: "POST",
    });
    const data: any = await res.json();
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
    const data: any = await res.json();
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
    const data: any = await res.json();
    if (!res.ok || !data.id) {
      throw new Error(`Failed to publish Instagram media: ${data.error?.message || "Publish failed"}`);
    }
    return { mediaId: data.id };
  }

  async getRecentMedia(userId: string, accessToken?: string): Promise<Array<{ id: string; caption?: string }>> {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${userId}/media?fields=id,caption&limit=5&access_token=${accessToken}`
    );
    const data: any = await res.json();
    return data.data ?? [];
  }
}

/**
 * Standard HTTP client for Buffer API (TikTok).
 * Supports modern Buffer GraphQL API (https://api.buffer.com) and fallback to legacy REST.
 */
export class StandardBufferApiClient implements BufferApiClient {
  async createPost(opts: BufferCreatePostOptions): Promise<{ postId: string }> {
    // 1. Try modern GraphQL createPost mutation
    try {
      const mutation = {
        query: `
          mutation CreateBufferVideoPost($input: CreatePostInput!) {
            createPost(input: $input) {
              ... on PostActionSuccess {
                post {
                  id
                  status
                }
              }
              ... on MutationError {
                message
              }
            }
          }
        `,
        variables: {
          input: {
            text: opts.text,
            channelId: opts.channelId,
            schedulingType: "notification",
            mode: "addToQueue",
            assets: [
              {
                video: {
                  url: opts.videoUrl,
                },
              },
            ],
          },
        },
      };

      const gqlRes = await fetch("https://api.buffer.com", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify(mutation),
      });

      if (gqlRes.ok) {
        const gqlData: any = await gqlRes.json();
        const result = gqlData.data?.createPost;
        if (result?.post?.id) {
          return { postId: result.post.id };
        }
        if (result?.message) {
          throw new Error(result.message);
        }
      }
    } catch (gqlErr: any) {
      if (gqlErr.message && !gqlErr.message.includes("fetch")) {
        throw new Error(`Buffer GraphQL error: ${gqlErr.message}`);
      }
    }

    // 2. Fallback to legacy REST updates/create.json
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
    const data: any = await res.json();
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
    try {
      const gqlRes = await fetch("https://api.buffer.com", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query: `
            query GetPostStatus($id: ID!) {
              post(input: { id: $id }) {
                id
                status
              }
            }
          `,
          variables: { id: postId },
        }),
      });

      if (gqlRes.ok) {
        const gqlData: any = await gqlRes.json();
        const status = gqlData.data?.post?.status?.toLowerCase();
        if (status === "sent" || status === "published") return { status: "sent" };
        if (status === "failed" || status === "error") return { status: "error" };
        return { status: "pending" };
      }
    } catch {
      // Fallback to REST
    }

    const res = await fetch(`https://api.bufferapp.com/1/updates/${postId}.json?access_token=${apiKey}`);
    const data: any = await res.json();
    const status = data.status;
    if (status === "sent") return { status: "sent" };
    if (status === "failed" || status === "error") return { status: "error", error: data.error };
    return { status: "pending" };
  }
}

/**
 * Standard HTTP client for TikTok Content Posting API v2 (Direct Upload).
 */
export class StandardTikTokApiClient implements TikTokApiClient {
  async getCreatorInfo(accessToken: string): Promise<TikTokCreatorInfo> {
    const res = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({}),
    });

    const data: any = await res.json();
    if (!res.ok || (data.error && data.error.code !== "ok")) {
      throw new Error(`Gagal mengambil creator_info TikTok: ${data.error?.message || res.statusText}`);
    }

    return {
      creator_username: data.data?.creator_username,
      creator_nickname: data.data?.creator_nickname,
      privacy_level_options: data.data?.privacy_level_options ?? ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
      comment_disabled: data.data?.comment_disabled,
      duet_disabled: data.data?.duet_disabled,
      stitch_disabled: data.data?.stitch_disabled,
      max_video_post_duration_sec: data.data?.max_video_post_duration_sec,
    };
  }

  async initVideoUpload(opts: TikTokInitVideoOptions): Promise<{ publishId: string; uploadUrl: string }> {
    const payload = {
      post_info: {
        title: opts.title,
        privacy_level: opts.privacyLevel,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: opts.videoSize,
        chunk_size: opts.chunkSize,
        total_chunk_count: opts.totalChunkCount,
      },
    };

    const res = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(payload),
    });

    const data: any = await res.json();
    if (!res.ok || (data.error && data.error.code !== "ok") || !data.data?.upload_url) {
      throw new Error(
        `Inisialisasi video TikTok gagal: ${data.error?.message || `HTTP ${res.status} ${res.statusText}`}`
      );
    }

    return {
      publishId: data.data.publish_id,
      uploadUrl: data.data.upload_url,
    };
  }

  async uploadVideoFile(
    uploadUrl: string,
    filePath: string,
    videoSize: number,
    chunkSize: number,
    totalChunkCount = 1
  ): Promise<void> {
    const fileHandle = await fs.open(filePath, "r");
    try {
      for (let i = 0; i < totalChunkCount; i++) {
        const start = i * chunkSize;
        // The final chunk absorbs any trailing bytes (up to 128 MB max as per TikTok spec)
        const end = i === totalChunkCount - 1 ? videoSize - 1 : start + chunkSize - 1;
        const length = end - start + 1;
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await fileHandle.read(buffer, 0, length, start);

        const chunkData = bytesRead === length ? buffer : buffer.subarray(0, bytesRead);

        const res = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": "video/mp4",
            "Content-Range": `bytes ${start}-${end}/${videoSize}`,
            "Content-Length": String(chunkData.length),
          },
          body: chunkData,
        });

        // TikTok chunk uploads return 200/201 or 308 (resume incomplete) on success
        if (!res.ok && res.status !== 308) {
          const errText = await res.text();
          throw new Error(
            `Gagal mengunggah chunk ${i + 1}/${totalChunkCount} video TikTok (${start}-${end}/${videoSize}): HTTP ${res.status} ${errText}`
          );
        }
      }
    } finally {
      await fileHandle.close();
    }
  }

  async checkPublishStatus(
    publishId: string,
    accessToken: string
  ): Promise<{ status: "PROCESSING_DOWNLOAD" | "PROCESSING_UPLOAD" | "SUCCESS" | "FAILED"; failReason?: string }> {
    const res = await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({ publish_id: publishId }),
    });

    const data: any = await res.json();
    if (!res.ok || (data.error && data.error.code !== "ok")) {
      throw new Error(`Pengecekan status TikTok gagal: ${data.error?.message || `HTTP ${res.status}`}`);
    }

    return {
      status: data.data?.status || "PROCESSING_UPLOAD",
      failReason: data.data?.fail_reason,
    };
  }
}

/**
 * Create production-ready publishers map.
 */
export function createProductionPublishers(): Record<Platform, Publisher> {
  return {
    youtube: new YouTubePublisher(new StandardYouTubeApiClient()),
    instagram: new InstagramPublisher(new StandardInstagramApiClient()),
    tiktok: new TikTokPublisher(new StandardTikTokApiClient()),
  };
}
