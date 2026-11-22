import { describe, it, expect } from "vitest";
import { UploadRequestSchema, PostCreateSchema } from "../src/validation";

describe("UploadRequestSchema", () => {
  it("accepts valid video upload request", () => {
    const result = UploadRequestSchema.safeParse({
      kind: "video",
      filename: "klip_tips.mp4",
      size_bytes: 10 * 1024 * 1024, // 10 MB
      content_type: "video/mp4",
      metadata: { duration_ms: 28000, width: 1080, height: 1920 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects video over 50 MB", () => {
    const result = UploadRequestSchema.safeParse({
      kind: "video",
      filename: "big.mp4",
      size_bytes: 51 * 1024 * 1024, // 51 MB
      content_type: "video/mp4",
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error)).toContain("size_bytes");
  });

  it("rejects thumbnail over 8 MB", () => {
    const result = UploadRequestSchema.safeParse({
      kind: "thumbnail",
      filename: "thumb.jpg",
      size_bytes: 9 * 1024 * 1024, // 9 MB
      content_type: "image/jpeg",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unsupported content type for video", () => {
    const result = UploadRequestSchema.safeParse({
      kind: "video",
      filename: "clip.avi",
      size_bytes: 5 * 1024 * 1024,
      content_type: "video/avi",
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid thumbnail", () => {
    const result = UploadRequestSchema.safeParse({
      kind: "thumbnail",
      filename: "thumb.jpg",
      size_bytes: 2 * 1024 * 1024,
      content_type: "image/jpeg",
    });
    expect(result.success).toBe(true);
  });
});

describe("PostCreateSchema — caption & title validation", () => {
  const base = {
    video_upload_id: "550e8400-e29b-41d4-a716-446655440000",
    caption: "Konten keren",
    schedule: { type: "next_free" as const },
  };

  it("accepts valid post with caption", () => {
    const result = PostCreateSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("rejects empty caption", () => {
    const result = PostCreateSchema.safeParse({ ...base, caption: "" });
    expect(result.success).toBe(false);
  });

  it("rejects title over 100 characters", () => {
    const result = PostCreateSchema.safeParse({ ...base, title: "a".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("accepts title exactly 100 characters", () => {
    const result = PostCreateSchema.safeParse({ ...base, title: "a".repeat(100) });
    expect(result.success).toBe(true);
  });
});
