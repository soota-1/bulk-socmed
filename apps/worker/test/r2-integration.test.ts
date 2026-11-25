import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

vi.mock("@bulk-socmed/shared/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bulk-socmed/shared/r2")>();
  return {
    ...actual,
    isR2Configured: vi.fn().mockReturnValue(true),
    downloadR2Object: vi.fn(),
    headR2Object: vi.fn(),
    createR2SignedDownloadUrl: vi.fn(),
  };
});

import * as r2Module from "@bulk-socmed/shared/r2";
import { ensureMediaCache } from "../src/media-cache";
import { TikTokBufferPublisher } from "../src/publishers/tiktok-buffer";

describe("Worker R2 storage integration", () => {
  let tempCacheDir: string;

  beforeEach(async () => {
    tempCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "bulk-socmed-r2-test-"));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempCacheDir, { recursive: true, force: true }).catch(() => {});
  });

  it("ensureMediaCache downloads video and thumbnail from R2 when configured", async () => {
    vi.mocked(r2Module.downloadR2Object)
      .mockResolvedValueOnce(Buffer.from("r2 video payload"))
      .mockResolvedValueOnce(Buffer.from("r2 thumb payload"));

    const mockSupabase = { storage: { from: vi.fn() } } as any;

    const cached = await ensureMediaCache(
      mockSupabase,
      77,
      "u1/up1/clip.mp4",
      "u1/up2/cover.png",
      tempCacheDir
    );

    expect(r2Module.downloadR2Object).toHaveBeenCalledWith("videos", "u1/up1/clip.mp4");
    expect(r2Module.downloadR2Object).toHaveBeenCalledWith("thumbnails", "u1/up2/cover.png");
    expect(mockSupabase.storage.from).not.toHaveBeenCalled();

    const vidBuf = await fs.readFile(cached.videoFilePath, "utf8");
    const thumbBuf = await fs.readFile(cached.thumbFilePath!, "utf8");
    expect(vidBuf).toBe("r2 video payload");
    expect(thumbBuf).toBe("r2 thumb payload");
  });

  it("ensureMediaCache falls back to Supabase Storage when R2 returns NoSuchKey", async () => {
    const notFoundErr = Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
    vi.mocked(r2Module.downloadR2Object).mockRejectedValueOnce(notFoundErr);

    const downloadMock = vi.fn().mockResolvedValueOnce({
      data: new Blob(["supabase legacy video"]),
      error: null,
    });
    const mockSupabase = {
      storage: { from: vi.fn().mockReturnValue({ download: downloadMock }) },
    } as any;

    const cached = await ensureMediaCache(
      mockSupabase,
      78,
      "u1/legacy/old.mp4",
      null,
      tempCacheDir
    );

    expect(downloadMock).toHaveBeenCalledWith("u1/legacy/old.mp4");
    expect(await fs.readFile(cached.videoFilePath, "utf8")).toBe("supabase legacy video");
  });

  it("TikTokBufferPublisher signs R2 URL when object exists in R2", async () => {
    vi.mocked(r2Module.headR2Object).mockResolvedValueOnce(true);
    vi.mocked(r2Module.createR2SignedDownloadUrl).mockResolvedValueOnce(
      "https://acc.r2.cloudflarestorage.com/bucket/videos/u1/clip.mp4?X-Amz-Signature=123"
    );

    const publisher = new TikTokBufferPublisher({
      createPost: vi.fn(),
      getPostStatus: vi.fn(),
    });

    const result = await publisher.advance({
      target: {
        id: 1,
        post_id: 50,
        platform: "tiktok",
        status: "scheduled",
        step: null,
        attempt_count: 0,
        external_id: null,
        external_state: {},
        idempotency_key: "50:tiktok:v1",
      },
      post: {
        id: 50,
        title: "TikTok Test",
        caption: "R2 video",
        hashtags: "#fyp",
        video_object_path: "u1/clip.mp4",
        due_at: "2026-11-26T12:00:00.000Z",
      },
      now: new Date("2026-11-25T12:00:00.000Z"),
      apiKey: "buffer-key",
      externalAccountId: "chan-1",
      media: { videoFilePath: "C:/cache/50/video.mp4" },
      supabase: { storage: { from: vi.fn() } } as any,
    });

    expect(result.nextStatus).toBe("uploading");
    expect(result.nextStep).toBe("create_post");
    expect(result.externalState?.signed_url).toContain("r2.cloudflarestorage.com");
  });
});
