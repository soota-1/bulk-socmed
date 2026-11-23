import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { ensureMediaCache, cleanMediaCache } from "../src/media-cache";

describe("media-cache — local disk caching and cleanup", () => {
  let tempCacheDir: string;

  beforeEach(async () => {
    tempCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "bulk-socmed-cache-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempCacheDir, { recursive: true, force: true }).catch(() => {});
  });

  function createMockSupabase(videoBlob: Blob, thumbBlob?: Blob) {
    const downloadMock = vi.fn().mockImplementation((pathStr: string) => {
      if (pathStr.includes("video")) {
        return Promise.resolve({ data: videoBlob, error: null });
      }
      if (pathStr.includes("thumb") && thumbBlob) {
        return Promise.resolve({ data: thumbBlob, error: null });
      }
      return Promise.resolve({ data: null, error: new Error("File not found") });
    });

    return {
      storage: {
        from: vi.fn().mockReturnValue({
          download: downloadMock,
        }),
      },
      _downloadMock: downloadMock,
    } as any;
  }

  it("downloads video and thumbnail to local cache directory", async () => {
    const videoData = new Blob(["fake video content bytes"], { type: "video/mp4" });
    const thumbData = new Blob(["fake thumb image bytes"], { type: "image/jpeg" });
    const supabase = createMockSupabase(videoData, thumbData);

    const result = await ensureMediaCache(
      supabase,
      42,
      "owner-1/upload-video/clip.mp4",
      "owner-1/upload-thumb/cover.jpg",
      tempCacheDir
    );

    expect(result.videoFilePath).toContain(path.join("42", "video.mp4"));
    expect(result.thumbFilePath).toContain(path.join("42", "thumbnail.jpg"));

    const videoExists = await fs.stat(result.videoFilePath);
    expect(videoExists.isFile()).toBe(true);

    const thumbExists = await fs.stat(result.thumbFilePath!);
    expect(thumbExists.isFile()).toBe(true);

    expect(supabase._downloadMock).toHaveBeenCalledTimes(2);
  });

  it("reuses existing cached files without downloading again", async () => {
    const videoData = new Blob(["fake video"], { type: "video/mp4" });
    const supabase = createMockSupabase(videoData);

    // First call: downloads
    await ensureMediaCache(supabase, 99, "path/video.mp4", null, tempCacheDir);
    expect(supabase._downloadMock).toHaveBeenCalledTimes(1);

    // Second call: reuses local file
    const secondResult = await ensureMediaCache(supabase, 99, "path/video.mp4", null, tempCacheDir);
    expect(supabase._downloadMock).toHaveBeenCalledTimes(1); // not called again
    expect(secondResult.thumbFilePath).toBeUndefined();
  });

  it("cleanMediaCache removes the post cache folder", async () => {
    const videoData = new Blob(["fake video"], { type: "video/mp4" });
    const supabase = createMockSupabase(videoData);

    const { videoFilePath } = await ensureMediaCache(supabase, 100, "video.mp4", null, tempCacheDir);
    const postDir = path.dirname(videoFilePath);

    const statBefore = await fs.stat(postDir);
    expect(statBefore.isDirectory()).toBe(true);

    await cleanMediaCache(100, tempCacheDir);

    await expect(fs.stat(postDir)).rejects.toThrow();
  });
});
