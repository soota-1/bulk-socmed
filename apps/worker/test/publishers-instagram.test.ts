import { describe, it, expect, vi } from "vitest";
import { InstagramPublisher, type InstagramApiClient } from "../src/publishers/instagram";
import type { StepContext } from "../src/publishers/base";

describe("InstagramPublisher — Reels state machine & anti-duplicate guard", () => {
  const mockClient: InstagramApiClient = {
    checkPublishingLimit: vi.fn(),
    createContainer: vi.fn(),
    uploadMedia: vi.fn(),
    checkContainerStatus: vi.fn(),
    publishMedia: vi.fn(),
    getRecentMedia: vi.fn(),
  };

  const publisher = new InstagramPublisher(mockClient);

  const baseContext: StepContext = {
    target: {
      id: 2,
      post_id: 20,
      platform: "instagram",
      status: "scheduled",
      step: null,
      attempt_count: 0,
      external_id: null,
      external_state: {},
      idempotency_key: "20:instagram:v1",
    },
    post: {
      id: 20,
      title: "Instagram Reel",
      caption: "Resep nasi goreng 5 menit enak",
      hashtags: "#resep #masak",
      video_object_path: "path/to/reels.mp4",
      thumbnail_object_path: "path/to/cover.jpg",
      due_at: "2026-11-23T12:00:00.000Z",
    },
    now: new Date("2026-11-23T11:50:00.000Z"), // exactly 10 min before due_at
    accessToken: "mock_ig_access_token",
    externalAccountId: "ig_account_12345",
    media: {
      videoFilePath: "C:/cache/20/video.mp4",
      thumbFilePath: "C:/cache/20/thumbnail.jpg",
    },
    supabase: {} as any,
  };

  it("Step initial (check_limit): verifies limit and moves to create_container", async () => {
    vi.mocked(mockClient.checkPublishingLimit).mockResolvedValueOnce({ remaining: 95, quotaTotal: 100 });

    const result = await publisher.advance(baseContext);

    expect(mockClient.checkPublishingLimit).toHaveBeenCalledWith("ig_account_12345", "mock_ig_access_token");
    expect(result.nextStatus).toBe("uploading");
    expect(result.nextStep).toBe("create_container");
  });

  it("Step check_limit: fails permanently if remaining publishing limit is 0", async () => {
    vi.mocked(mockClient.checkPublishingLimit).mockResolvedValueOnce({ remaining: 0, quotaTotal: 100 });

    const result = await publisher.advance(baseContext);

    expect(result.nextStatus).toBe("failed");
    expect(result.error?.code).toBe("instagram_limit_exceeded");
    expect(result.error?.isPermanent).toBe(true);
  });

  it("Step create_container: creates container and advances to upload_video", async () => {
    vi.mocked(mockClient.createContainer).mockResolvedValueOnce({
      containerId: "container_999",
      uploadUrl: "https://rupload.facebook.com/reels/999",
    });

    const ctx: StepContext = {
      ...baseContext,
      target: {
        ...baseContext.target,
        status: "uploading",
        step: "create_container",
      },
    };

    const result = await publisher.advance(ctx);
    expect(mockClient.createContainer).toHaveBeenCalledWith("ig_account_12345", {
      caption: "Resep nasi goreng 5 menit enak\n#resep #masak",
      coverFilePath: "C:/cache/20/thumbnail.jpg",
      accessToken: "mock_yt_access_token" ? expect.any(String) : undefined,
    });
    expect(result.nextStatus).toBe("uploading");
    expect(result.nextStep).toBe("upload_video");
    expect(result.externalId).toBe("container_999");
    expect(result.externalState?.upload_url).toBe("https://rupload.facebook.com/reels/999");
  });

  it("Step create_container: passes signed coverUrl when thumbnail_object_path and storage exist", async () => {
    vi.mocked(mockClient.createContainer).mockResolvedValueOnce({
      containerId: "container_with_cover",
      uploadUrl: "https://rupload.facebook.com/reels/1000",
    });

    const mockSupabase = {
      storage: {
        from: vi.fn().mockReturnValue({
          createSignedUrl: vi.fn().mockResolvedValue({
            data: { signedUrl: "https://cdn.example.com/signed-cover.jpg" },
            error: null,
          }),
        }),
      },
    } as any;

    const ctx: StepContext = {
      ...baseContext,
      supabase: mockSupabase,
      target: {
        ...baseContext.target,
        status: "uploading",
        step: "create_container",
      },
    };

    const result = await publisher.advance(ctx);
    expect(mockClient.createContainer).toHaveBeenCalledWith("ig_account_12345", {
      caption: "Resep nasi goreng 5 menit enak\n#resep #masak",
      coverFilePath: "C:/cache/20/thumbnail.jpg",
      coverUrl: "https://cdn.example.com/signed-cover.jpg",
      accessToken: "mock_ig_access_token",
    });
    expect(result.externalId).toBe("container_with_cover");
  });

  it("Step upload_video: uploads file and advances to wait_finished", async () => {
    vi.mocked(mockClient.uploadMedia).mockResolvedValueOnce();

    const ctx: StepContext = {
      ...baseContext,
      target: {
        ...baseContext.target,
        status: "uploading",
        step: "upload_video",
        external_id: "container_999",
        external_state: { upload_url: "https://rupload.facebook.com/reels/999" },
      },
    };

    const result = await publisher.advance(ctx);
    expect(mockClient.uploadMedia).toHaveBeenCalledWith(
      "https://rupload.facebook.com/reels/999",
      "C:/cache/20/video.mp4"
    );
    expect(result.nextStatus).toBe("uploading");
    expect(result.nextStep).toBe("wait_finished");
  });

  it("Step wait_finished: waits if status is IN_PROGRESS", async () => {
    vi.mocked(mockClient.checkContainerStatus).mockResolvedValueOnce({ status: "IN_PROGRESS" });

    const ctx: StepContext = {
      ...baseContext,
      target: {
        ...baseContext.target,
        status: "uploading",
        step: "wait_finished",
        external_id: "container_999",
      },
    };

    const result = await publisher.advance(ctx);
    expect(result.nextStep).toBe("wait_finished");
    expect(result.delayMinutes).toBe(1);
  });

  it("Step wait_finished: on FINISHED before due_at, sets runAt = due_at", async () => {
    vi.mocked(mockClient.checkContainerStatus).mockResolvedValueOnce({ status: "FINISHED" });

    const ctx: StepContext = {
      ...baseContext,
      now: new Date("2026-11-23T11:55:00.000Z"), // 5 min before due_at
      target: {
        ...baseContext.target,
        status: "uploading",
        step: "wait_finished",
        external_id: "container_999",
      },
    };

    const result = await publisher.advance(ctx);
    expect(result.nextStatus).toBe("awaiting_platform");
    expect(result.nextStep).toBe("wait_finished");
    expect(result.runAt?.toISOString()).toBe("2026-11-23T12:00:00.000Z");
  });

  it("Step wait_finished: on FINISHED at or after due_at, advances to publish_requested", async () => {
    vi.mocked(mockClient.checkContainerStatus).mockResolvedValueOnce({ status: "FINISHED" });

    const ctx: StepContext = {
      ...baseContext,
      now: new Date("2026-11-23T12:00:05.000Z"), // At due_at
      target: {
        ...baseContext.target,
        status: "awaiting_platform",
        step: "wait_finished",
        external_id: "container_999",
      },
    };

    const result = await publisher.advance(ctx);
    expect(result.nextStatus).toBe("uploading");
    expect(result.nextStep).toBe("publish_requested");
  });

  it("Step publish_requested: executes media_publish and marks published", async () => {
    vi.mocked(mockClient.publishMedia).mockResolvedValueOnce({
      mediaId: "ig_media_77777",
      permalink: "https://instagram.com/reel/77777",
    });

    const ctx: StepContext = {
      ...baseContext,
      target: {
        ...baseContext.target,
        status: "uploading",
        step: "publish_requested",
        external_id: "container_999",
      },
    };

    const result = await publisher.advance(ctx);
    expect(mockClient.publishMedia).toHaveBeenCalledWith(
      "ig_account_12345",
      "container_999",
      "mock_ig_access_token"
    );
    expect(result.nextStatus).toBe("published");
    expect(result.externalId).toBe("ig_media_77777");
    expect(result.nextStep).toBe(null);
  });

  it("Reconcile on crash at publish_requested: verifies feed matches and resolves published", async () => {
    vi.mocked(mockClient.getRecentMedia).mockResolvedValueOnce([
      {
        id: "ig_media_77777",
        caption: "Resep nasi goreng 5 menit enak\n#resep #masak",
      },
    ]);

    const ctx: StepContext = {
      ...baseContext,
      target: {
        ...baseContext.target,
        status: "uploading",
        step: "publish_requested",
        external_id: "container_999",
      },
    };

    const result = await publisher.reconcile(ctx);
    expect(result.resolvedStatus).toBe("published");
    expect(result.externalId).toBe("ig_media_77777");
    expect(result.requiresManualCheck).toBeFalsy();
  });

  it("Reconcile on crash at publish_requested: flags manual check if inconclusive", async () => {
    vi.mocked(mockClient.getRecentMedia).mockResolvedValueOnce([
      {
        id: "different_media_1",
        caption: "Unrelated post",
      },
    ]);

    const ctx: StepContext = {
      ...baseContext,
      target: {
        ...baseContext.target,
        status: "uploading",
        step: "publish_requested",
        external_id: "container_999",
      },
    };

    const result = await publisher.reconcile(ctx);
    expect(result.resolvedStatus).toBe("failed");
    expect(result.requiresManualCheck).toBe(true);
  });
});
