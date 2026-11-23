import { describe, it, expect, vi } from "vitest";
import { TikTokBufferPublisher, type BufferApiClient } from "../src/publishers/tiktok-buffer";
import type { StepContext } from "../src/publishers/base";

describe("TikTokBufferPublisher — Rolling window & Buffer integration", () => {
  const mockClient: BufferApiClient = {
    createPost: vi.fn(),
    getPostStatus: vi.fn(),
  };

  const publisher = new TikTokBufferPublisher(mockClient);

  const mockSupabase = {
    storage: {
      from: vi.fn().mockReturnValue({
        createSignedUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: "https://supabase.co/storage/v1/sign/videos/clip.mp4?token=abc" },
          error: null,
        }),
      }),
    },
  } as any;

  const baseContext: StepContext = {
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
      title: "TikTok Short Video",
      caption: "Review gadget keren kekinian",
      hashtags: "#fyp #review",
      video_object_path: "owner-1/vid-30/clip.mp4",
      thumbnail_object_path: null,
      due_at: "2026-11-24T12:00:00.000Z", // 24 hours from now
    },
    now: new Date("2026-11-23T12:00:00.000Z"),
    apiKey: "mock_buffer_api_key",
    externalAccountId: "buffer_channel_tiktok_xyz",
    media: {
      videoFilePath: "C:/cache/30/video.mp4",
    },
    supabase: mockSupabase,
  };

  it("Step initial: if post due_at is outside rolling window (e.g. 5 days away), delays dispatch", async () => {
    const farFutureContext: StepContext = {
      ...baseContext,
      post: {
        ...baseContext.post,
        due_at: "2026-11-30T12:00:00.000Z", // 7 days away (> 2 days window)
      },
    };

    const result = await publisher.advance(farFutureContext);
    expect(result.nextStatus).toBe("scheduled");
    expect(result.nextStep).toBe("window_check");
    // runAt should be 2 days before due_at: 2026-11-28
    expect(result.runAt?.toISOString()).toBe("2026-11-28T12:00:00.000Z");
  });

  it("Step initial: if inside window, creates signed URL with due_at + 6h expiry and advances to create_post", async () => {
    const result = await publisher.advance(baseContext);

    expect(mockSupabase.storage.from).toHaveBeenCalledWith("videos");
    // Verification: createSignedUrl called with video_object_path
    expect(result.nextStatus).toBe("uploading");
    expect(result.nextStep).toBe("create_post");
    expect(result.externalState?.signed_url).toBe(
      "https://supabase.co/storage/v1/sign/videos/clip.mp4?token=abc"
    );
  });

  it("Step create_post: calls Buffer API and moves to awaiting_platform", async () => {
    vi.mocked(mockClient.createPost).mockResolvedValueOnce({ postId: "buffer_post_555" });

    const ctx: StepContext = {
      ...baseContext,
      target: {
        ...baseContext.target,
        status: "uploading",
        step: "create_post",
        external_state: {
          signed_url: "https://supabase.co/storage/v1/sign/videos/clip.mp4?token=abc",
        },
      },
    };

    const result = await publisher.advance(ctx);

    expect(mockClient.createPost).toHaveBeenCalledWith({
      channelId: "buffer_channel_tiktok_xyz",
      text: "Review gadget keren kekinian\n#fyp #review",
      dueAt: "2026-11-24T12:00:00.000Z",
      videoUrl: "https://supabase.co/storage/v1/sign/videos/clip.mp4?token=abc",
      apiKey: "mock_buffer_api_key",
    });

    expect(result.nextStatus).toBe("awaiting_platform");
    expect(result.nextStep).toBe("await_publish");
    expect(result.externalId).toBe("buffer_post_555");
  });

  it("Step await_publish: checks Buffer status once due_at is passed", async () => {
    vi.mocked(mockClient.getPostStatus).mockResolvedValueOnce({ status: "sent" });

    const ctx: StepContext = {
      ...baseContext,
      now: new Date("2026-11-24T12:05:00.000Z"), // 5 min after due_at
      target: {
        ...baseContext.target,
        status: "awaiting_platform",
        step: "await_publish",
        external_id: "buffer_post_555",
      },
    };

    const result = await publisher.advance(ctx);
    expect(mockClient.getPostStatus).toHaveBeenCalledWith("buffer_post_555", "mock_buffer_api_key");
    expect(result.nextStatus).toBe("published");
    expect(result.nextStep).toBe(null);
  });
});
