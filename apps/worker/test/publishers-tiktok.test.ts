import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TikTokPublisher, type TikTokApiClient } from "../src/publishers/tiktok";
import type { StepContext } from "../src/publishers/base";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("TikTokPublisher — Direct Upload via Content Posting API v2", () => {
  let tempDir: string;
  let dummyVideoPath: string;

  const mockApiClient: TikTokApiClient = {
    getCreatorInfo: vi.fn(),
    initVideoUpload: vi.fn(),
    uploadVideoFile: vi.fn(),
    checkPublishStatus: vi.fn(),
  };

  const publisher = new TikTokPublisher(mockApiClient);

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tiktok-publisher-test-"));
    dummyVideoPath = path.join(tempDir, "video.mp4");
    await fs.writeFile(dummyVideoPath, Buffer.alloc(1024, "A"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  const createBaseContext = (overrides?: Partial<StepContext>): StepContext => ({
    target: {
      id: 3,
      post_id: 30,
      platform: "tiktok",
      status: "scheduled",
      step: null,
      attempt_count: 0,
      external_id: null,
      external_state: {},
      idempotency_key: "30:tiktok:v1",
    },
    post: {
      id: 30,
      title: "TikTok Video Title",
      caption: "Review produk keren",
      hashtags: "#fyp #viral",
      video_object_path: "owner-1/vid-30/clip.mp4",
      thumbnail_object_path: null,
      due_at: "2026-11-26T12:00:00.000Z",
    },
    now: new Date("2026-11-25T12:00:00.000Z"),
    accessToken: "valid_tiktok_access_token",
    media: {
      videoFilePath: dummyVideoPath,
    },
    supabase: {} as any,
    ...overrides,
  });

  it("plan: schedules dispatch immediately at current time", () => {
    const now = new Date("2026-11-25T10:00:00.000Z");
    const dueAt = new Date("2026-11-26T10:00:00.000Z");
    const planned = publisher.plan(dueAt, now);

    expect(planned.platform).toBe("tiktok");
    expect(planned.dispatch_at.toISOString()).toBe(now.toISOString());
  });

  it("advance: returns token_missing error if accessToken is not provided", async () => {
    const ctx = createBaseContext({ accessToken: undefined });
    const result = await publisher.advance(ctx);

    expect(result.error?.code).toBe("token_missing");
    expect(result.error?.isAuthError).toBe(true);
  });

  it("advance step init_upload: queries creator_info and initializes video upload", async () => {
    vi.mocked(mockApiClient.getCreatorInfo).mockResolvedValueOnce({
      creator_username: "testcreator",
      privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
    });

    vi.mocked(mockApiClient.initVideoUpload).mockResolvedValueOnce({
      publishId: "v_pub_tiktok_123",
      uploadUrl: "https://open-upload.tiktok.com/upload/v1",
    });

    const ctx = createBaseContext();
    const result = await publisher.advance(ctx);

    expect(mockApiClient.getCreatorInfo).toHaveBeenCalledWith("valid_tiktok_access_token");
    expect(mockApiClient.initVideoUpload).toHaveBeenCalledWith({
      title: "Review produk keren\n#fyp #viral",
      privacyLevel: "PUBLIC_TO_EVERYONE",
      videoSize: 1024,
      chunkSize: 1024,
      totalChunkCount: 1,
      accessToken: "valid_tiktok_access_token",
    });

    expect(result.nextStatus).toBe("uploading");
    expect(result.nextStep).toBe("upload_chunks");
    expect(result.externalId).toBe("v_pub_tiktok_123");
    expect(result.externalState?.upload_url).toBe("https://open-upload.tiktok.com/upload/v1");
    expect(result.externalState?.total_chunk_count).toBe(1);
  });

  it("advance step init_upload: calculates totalChunkCount with Math.floor for videos > 64 MB", async () => {
    const largeVideoPath = path.join(tempDir, "large-video.mp4");
    const hundredMb = 100 * 1024 * 1024;
    const fh = await fs.open(largeVideoPath, "w");
    await fh.truncate(hundredMb);
    await fh.close();

    vi.mocked(mockApiClient.getCreatorInfo).mockResolvedValueOnce({
      creator_username: "testcreator",
      privacy_level_options: ["PUBLIC_TO_EVERYONE"],
    });

    vi.mocked(mockApiClient.initVideoUpload).mockResolvedValueOnce({
      publishId: "v_pub_large_123",
      uploadUrl: "https://open-upload.tiktok.com/upload/v1",
    });

    const ctx = createBaseContext({
      media: { videoFilePath: largeVideoPath },
    });
    const result = await publisher.advance(ctx);

    const expectedChunkSize = 32 * 1024 * 1024;
    const expectedChunkCount = Math.floor(hundredMb / expectedChunkSize); // 3

    expect(mockApiClient.initVideoUpload).toHaveBeenCalledWith({
      title: "Review produk keren\n#fyp #viral",
      privacyLevel: "PUBLIC_TO_EVERYONE",
      videoSize: hundredMb,
      chunkSize: expectedChunkSize,
      totalChunkCount: expectedChunkCount,
      accessToken: "valid_tiktok_access_token",
    });

    expect(result.nextStatus).toBe("uploading");
    expect(result.nextStep).toBe("upload_chunks");
    expect(result.externalState?.total_chunk_count).toBe(expectedChunkCount);
  });

  it("advance step upload_chunks: uploads file bytes directly to upload_url", async () => {
    vi.mocked(mockApiClient.uploadVideoFile).mockResolvedValueOnce();

    const ctx = createBaseContext({
      target: {
        id: 3,
        post_id: 30,
        platform: "tiktok",
        status: "uploading",
        step: "upload_chunks",
        attempt_count: 0,
        external_id: "v_pub_tiktok_123",
        external_state: {
          upload_url: "https://open-upload.tiktok.com/upload/v1",
          chunk_size: 1024,
          video_size: 1024,
        },
        idempotency_key: "30:tiktok:v1",
      },
    });

    const result = await publisher.advance(ctx);

    expect(mockApiClient.uploadVideoFile).toHaveBeenCalledWith(
      "https://open-upload.tiktok.com/upload/v1",
      dummyVideoPath,
      1024,
      1024,
      1
    );

    expect(result.nextStatus).toBe("awaiting_platform");
    expect(result.nextStep).toBe("wait_status");
    expect(result.externalId).toBe("v_pub_tiktok_123");
  });

  it("advance step wait_status: keeps awaiting_platform when PROCESSING_UPLOAD", async () => {
    vi.mocked(mockApiClient.checkPublishStatus).mockResolvedValueOnce({
      status: "PROCESSING_UPLOAD",
    });

    const ctx = createBaseContext({
      target: {
        id: 3,
        post_id: 30,
        platform: "tiktok",
        status: "awaiting_platform",
        step: "wait_status",
        attempt_count: 0,
        external_id: "v_pub_tiktok_123",
        external_state: {},
        idempotency_key: "30:tiktok:v1",
      },
    });

    const result = await publisher.advance(ctx);

    expect(mockApiClient.checkPublishStatus).toHaveBeenCalledWith("v_pub_tiktok_123", "valid_tiktok_access_token");
    expect(result.nextStatus).toBe("awaiting_platform");
    expect(result.nextStep).toBe("wait_status");
  });

  it("advance step wait_status: transitions to published when SUCCESS", async () => {
    vi.mocked(mockApiClient.checkPublishStatus).mockResolvedValueOnce({
      status: "SUCCESS",
    });

    const ctx = createBaseContext({
      target: {
        id: 3,
        post_id: 30,
        platform: "tiktok",
        status: "awaiting_platform",
        step: "wait_status",
        attempt_count: 0,
        external_id: "v_pub_tiktok_123",
        external_state: {},
        idempotency_key: "30:tiktok:v1",
      },
    });

    const result = await publisher.advance(ctx);

    expect(result.nextStatus).toBe("published");
    expect(result.nextStep).toBeNull();
    expect(result.externalId).toBe("v_pub_tiktok_123");
  });

  it("advance step wait_status: reports permanent error when FAILED", async () => {
    vi.mocked(mockApiClient.checkPublishStatus).mockResolvedValueOnce({
      status: "FAILED",
      failReason: "Video violates guidelines",
    });

    const ctx = createBaseContext({
      target: {
        id: 3,
        post_id: 30,
        platform: "tiktok",
        status: "awaiting_platform",
        step: "wait_status",
        attempt_count: 0,
        external_id: "v_pub_tiktok_123",
        external_state: {},
        idempotency_key: "30:tiktok:v1",
      },
    });

    const result = await publisher.advance(ctx);

    expect(result.error?.code).toBe("tiktok_publish_failed");
    expect(result.error?.message).toBe("Video violates guidelines");
    expect(result.error?.isPermanent).toBe(true);
  });

  it("reconcile: returns published if status check returns SUCCESS", async () => {
    vi.mocked(mockApiClient.checkPublishStatus).mockResolvedValueOnce({
      status: "SUCCESS",
    });

    const ctx = createBaseContext({
      target: {
        id: 3,
        post_id: 30,
        platform: "tiktok",
        status: "awaiting_platform",
        step: "wait_status",
        attempt_count: 0,
        external_id: "v_pub_tiktok_123",
        external_state: {},
        idempotency_key: "30:tiktok:v1",
      },
    });

    const result = await publisher.reconcile(ctx);
    expect(result.resolvedStatus).toBe("published");
    expect(result.externalId).toBe("v_pub_tiktok_123");
  });

  it("advance step wait_status: transitions to published when PUBLISH_COMPLETE or SEND_TO_USER_INBOX", async () => {
    for (const status of ["PUBLISH_COMPLETE", "SEND_TO_USER_INBOX"] as const) {
      vi.mocked(mockApiClient.checkPublishStatus).mockResolvedValueOnce({ status });

      const ctx = createBaseContext({
        target: {
          id: 3,
          post_id: 30,
          platform: "tiktok",
          status: "awaiting_platform",
          step: "wait_status",
          attempt_count: 0,
          external_id: "v_pub_tiktok_123",
          external_state: {},
          idempotency_key: "30:tiktok:v1",
        },
      });

      const result = await publisher.advance(ctx);
      expect(result.nextStatus).toBe("published");
      expect(result.nextStep).toBeNull();
    }
  });
});
