import { describe, it, expect, vi } from "vitest";
import { YouTubePublisher, type YouTubeApiClient } from "../src/publishers/youtube";
import type { StepContext } from "../src/publishers/base";

describe("YouTubePublisher — Shorts state machine", () => {
  const mockClient: YouTubeApiClient = {
    uploadVideo: vi.fn(),
    checkProcessing: vi.fn(),
    setThumbnail: vi.fn(),
    checkPrivacy: vi.fn(),
    updateVideo: vi.fn(),
    deleteVideo: vi.fn(),
  };

  const publisher = new YouTubePublisher(mockClient);

  const baseContext: StepContext = {
    target: {
      id: 1,
      post_id: 10,
      platform: "youtube",
      status: "scheduled",
      step: null,
      attempt_count: 0,
      external_id: null,
      external_state: {},
      idempotency_key: "10:youtube:v1",
    },
    post: {
      id: 10,
      title: "Klip Tips YouTube Shorts",
      caption: "Deskripsi lengkap video shorts",
      hashtags: "#tips #shorts",
      video_object_path: "path/to/video.mp4",
      thumbnail_object_path: "path/to/thumb.jpg",
      due_at: "2026-11-23T23:00:00.000Z",
    },
    now: new Date("2026-11-23T10:00:00.000Z"),
    accessToken: "mock_yt_access_token",
    media: {
      videoFilePath: "C:/cache/10/video.mp4",
      thumbFilePath: "C:/cache/10/thumbnail.jpg",
    },
    supabase: {} as any,
  };

  it("Step initial: uploads video as private with publishAt scheduled", async () => {
    vi.mocked(mockClient.uploadVideo).mockResolvedValueOnce({
      videoId: "yt_video_123",
      uploadUri: "https://youtube.com/upload/123",
    });

    const result = await publisher.advance(baseContext);

    expect(mockClient.uploadVideo).toHaveBeenCalledWith({
      title: "Klip Tips YouTube Shorts",
      description: "Deskripsi lengkap video shorts\n#tips #shorts",
      publishAt: "2026-11-23T23:00:00.000Z",
      videoFilePath: "C:/cache/10/video.mp4",
      accessToken: "mock_yt_access_token",
    });

    expect(result.nextStatus).toBe("uploading");
    expect(result.nextStep).toBe("wait_processing");
    expect(result.externalId).toBe("yt_video_123");
  });

  it("Step wait_processing: delays if processing not yet finished", async () => {
    vi.mocked(mockClient.checkProcessing).mockResolvedValueOnce({ status: "processing" });

    const ctx: StepContext = {
      ...baseContext,
      target: {
        ...baseContext.target,
        status: "uploading",
        step: "wait_processing",
        external_id: "yt_video_123",
      },
    };

    const result = await publisher.advance(ctx);
    expect(result.nextStatus).toBe("uploading");
    expect(result.nextStep).toBe("wait_processing");
    expect(result.delayMinutes).toBe(1);
  });

  it("Step wait_processing: advances to set_thumbnail when succeeded", async () => {
    vi.mocked(mockClient.checkProcessing).mockResolvedValueOnce({ status: "succeeded" });

    const ctx: StepContext = {
      ...baseContext,
      target: {
        ...baseContext.target,
        status: "uploading",
        step: "wait_processing",
        external_id: "yt_video_123",
      },
    };

    const result = await publisher.advance(ctx);
    expect(result.nextStatus).toBe("uploading");
    expect(result.nextStep).toBe("set_thumbnail");
  });

  it("Step set_thumbnail: uploads custom thumbnail and moves to awaiting_platform", async () => {
    vi.mocked(mockClient.setThumbnail).mockResolvedValueOnce();

    const ctx: StepContext = {
      ...baseContext,
      target: {
        ...baseContext.target,
        status: "uploading",
        step: "set_thumbnail",
        external_id: "yt_video_123",
      },
    };

    const result = await publisher.advance(ctx);
    expect(mockClient.setThumbnail).toHaveBeenCalledWith(
      "yt_video_123",
      "C:/cache/10/thumbnail.jpg",
      "mock_yt_access_token"
    );
    expect(result.nextStatus).toBe("awaiting_platform");
    expect(result.nextStep).toBe("await_publish");
  });

  it("Step await_publish: marks published once due_at is passed and video is public", async () => {
    vi.mocked(mockClient.checkPrivacy).mockResolvedValueOnce({ privacyStatus: "public" });

    const ctx: StepContext = {
      ...baseContext,
      now: new Date("2026-11-23T23:05:00.000Z"), // Past due_at
      target: {
        ...baseContext.target,
        status: "awaiting_platform",
        step: "await_publish",
        external_id: "yt_video_123",
      },
    };

    const result = await publisher.advance(ctx);
    expect(result.nextStatus).toBe("published");
    expect(result.nextStep).toBe(null);
  });

  it("cancel deletes the video from YouTube", async () => {
    const ctx: StepContext = {
      ...baseContext,
      target: {
        ...baseContext.target,
        external_id: "yt_video_123",
      },
    };

    await publisher.cancel(ctx);
    expect(mockClient.deleteVideo).toHaveBeenCalledWith("yt_video_123", "mock_yt_access_token");
  });
});
