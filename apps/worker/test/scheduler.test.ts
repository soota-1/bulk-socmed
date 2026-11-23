import { describe, it, expect, vi } from "vitest";
import {
  isTargetMissed,
  executeTargetStep,
  runSchedulerCycle,
  processConnectionTests,
  type ClaimedTarget,
} from "../src/scheduler";
import type { Publisher, StepResult } from "../src/publishers/base";
import type { WorkerConfig } from "../src/config";

vi.mock("../src/media-cache", () => ({
  ensureMediaCache: vi.fn().mockResolvedValue({ videoFilePath: "C:/cache/mock.mp4" }),
  cleanMediaCache: vi.fn().mockResolvedValue(undefined),
}));

describe("scheduler — missed policy evaluation", () => {
  const now = new Date("2026-11-22T12:00:00Z");
  const graceMinutes = 120; // 2 hours

  it("returns false if dueAt is in the future", () => {
    const futureDue = new Date("2026-11-22T12:30:00Z");
    expect(isTargetMissed(futureDue, now, graceMinutes)).toBe(false);
  });

  it("returns false if dueAt is in the past but within grace period", () => {
    const pastWithinGrace = new Date("2026-11-22T11:30:00Z");
    expect(isTargetMissed(pastWithinGrace, now, graceMinutes)).toBe(false);
  });

  it("returns false if dueAt is exactly at grace period boundary", () => {
    const boundaryDue = new Date("2026-11-22T10:00:00Z");
    expect(isTargetMissed(boundaryDue, now, graceMinutes)).toBe(false);
  });

  it("returns true if dueAt exceeds grace period", () => {
    const pastExceeded = new Date("2026-11-22T09:59:00Z");
    expect(isTargetMissed(pastExceeded, now, graceMinutes)).toBe(true);
  });
});

describe("scheduler — executeTargetStep integration", () => {
  const now = new Date("2026-11-23T12:00:00Z");

  const baseTarget: ClaimedTarget = {
    id: 5,
    owner_id: "user-1",
    post_id: 15,
    platform: "youtube",
    status: "scheduled",
    step: null,
    pending_action: null,
    run_at: "2026-11-23T12:00:00Z",
    planned_dispatch_at: "2026-11-23T12:00:00Z",
    external_id: null,
    external_state: {},
    idempotency_key: "15:youtube:v1",
  };

  const basePost = {
    id: 15,
    title: "Video YouTube",
    caption: "Deskripsi",
    hashtags: "",
    video_object_path: "user-1/vid/v.mp4",
    thumbnail_object_path: null,
    due_at: "2026-11-24T12:00:00Z",
  };

  function createMockSupabase() {
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    const insertMock = vi.fn().mockResolvedValue({ error: null });

    return {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "targets") {
          return { update: updateMock };
        }
        if (table === "target_events") {
          return { insert: insertMock };
        }
        return { select: vi.fn() };
      }),
      _updateMock: updateMock,
      _insertMock: insertMock,
    } as any;
  }

  it("advances step successfully and updates target in database", async () => {
    const supabase = createMockSupabase();

    const mockPublisher: Publisher = {
      platform: "youtube",
      plan: vi.fn(),
      advance: vi.fn().mockResolvedValueOnce({
        nextStatus: "uploading",
        nextStep: "wait_processing",
        externalId: "yt_new_vid_123",
      } as StepResult),
      reconcile: vi.fn(),
      applyChanges: vi.fn(),
      cancel: vi.fn(),
    };

    const media = { videoFilePath: "C:/cache/15/video.mp4" };

    await executeTargetStep(supabase, baseTarget, basePost, media, mockPublisher, now, "token_123");

    expect(mockPublisher.advance).toHaveBeenCalled();
    expect(supabase._updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "uploading",
        step: "wait_processing",
        external_id: "yt_new_vid_123",
        lease_owner: null,
        lease_until: null,
      })
    );
    expect(supabase._insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        target_id: 5,
        event: "status_change",
        to_status: "uploading",
      })
    );
  });

  it("handles permanent error: updates status to failed", async () => {
    const supabase = createMockSupabase();

    const mockPublisher: Publisher = {
      platform: "youtube",
      plan: vi.fn(),
      advance: vi.fn().mockResolvedValueOnce({
        nextStatus: "failed",
        nextStep: null,
        error: {
          code: "file_corrupt",
          message: "Format video rusak.",
          isPermanent: true,
        },
      } as StepResult),
      reconcile: vi.fn(),
      applyChanges: vi.fn(),
      cancel: vi.fn(),
    };

    const media = { videoFilePath: "C:/cache/15/video.mp4" };

    await executeTargetStep(supabase, baseTarget, basePost, media, mockPublisher, now, "token_123");

    expect(supabase._updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        last_error_code: "file_corrupt",
        last_error_message: "Format video rusak.",
        run_at: null,
      })
    );
  });

  it("handles auth error: sets hold_reason to needs_reauth", async () => {
    const supabase = createMockSupabase();

    const mockPublisher: Publisher = {
      platform: "youtube",
      plan: vi.fn(),
      advance: vi.fn().mockResolvedValueOnce({
        nextStatus: "scheduled",
        nextStep: null,
        error: {
          code: "token_revoked",
          message: "Akses dicabut.",
          isAuthError: true,
        },
      } as StepResult),
      reconcile: vi.fn(),
      applyChanges: vi.fn(),
      cancel: vi.fn(),
    };

    const media = { videoFilePath: "C:/cache/15/video.mp4" };

    await executeTargetStep(supabase, baseTarget, basePost, media, mockPublisher, now, "token_123");

    expect(supabase._updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        hold_reason: "needs_reauth",
        last_error_code: "token_revoked",
      })
    );
  });

  it("handles cancel action: invokes publisher.cancel and marks target cancelled", async () => {
    const supabase = createMockSupabase();

    const mockPublisher: Publisher = {
      platform: "youtube",
      plan: vi.fn(),
      advance: vi.fn(),
      reconcile: vi.fn(),
      applyChanges: vi.fn(),
      cancel: vi.fn().mockResolvedValueOnce(undefined),
    };

    const cancelTarget: ClaimedTarget = {
      ...baseTarget,
      pending_action: "cancel",
      external_id: "yt_to_delete_999",
    };

    const media = { videoFilePath: "C:/cache/15/video.mp4" };

    await executeTargetStep(supabase, cancelTarget, basePost, media, mockPublisher, now, "token_123");

    expect(mockPublisher.cancel).toHaveBeenCalled();
    expect(supabase._updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "cancelled",
        pending_action: null,
        lease_owner: null,
      })
    );
  });

  it("handles transient error: schedules retry with backoff on first attempt", async () => {
    const supabase = createMockSupabase();

    const mockPublisher: Publisher = {
      platform: "youtube",
      plan: vi.fn(),
      advance: vi.fn().mockResolvedValueOnce({
        nextStatus: "scheduled",
        nextStep: null,
        error: {
          code: "rate_limit",
          message: "Rate limited by YouTube API",
          isPermanent: false,
        },
      } as StepResult),
      reconcile: vi.fn(),
      applyChanges: vi.fn(),
      cancel: vi.fn(),
    };

    const media = { videoFilePath: "C:/cache/15/video.mp4" };

    await executeTargetStep(supabase, baseTarget, basePost, media, mockPublisher, now, "token_123");

    expect(supabase._updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt_count: 1,
        last_error_code: "rate_limit",
        run_at: "2026-11-23T12:01:00.000Z", // +1 min
        lease_owner: null,
      })
    );
    expect(supabase._insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        target_id: 5,
        event: "retry_scheduled",
      })
    );
  });

  it("handles transient error: marks as failed when attempt reaches max (3)", async () => {
    const supabase = createMockSupabase();

    const mockPublisher: Publisher = {
      platform: "youtube",
      plan: vi.fn(),
      advance: vi.fn().mockResolvedValueOnce({
        nextStatus: "scheduled",
        nextStep: null,
        error: {
          code: "network_timeout",
          message: "Network timeout repeatedly",
        },
      } as StepResult),
      reconcile: vi.fn(),
      applyChanges: vi.fn(),
      cancel: vi.fn(),
    };

    const targetAtMaxAttempt: ClaimedTarget = {
      ...baseTarget,
      attempt_count: 2, // will become 3
    };

    const media = { videoFilePath: "C:/cache/15/video.mp4" };

    await executeTargetStep(supabase, targetAtMaxAttempt, basePost, media, mockPublisher, now, "token_123");

    expect(supabase._updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        attempt_count: 3,
        last_error_code: "network_timeout",
        run_at: null,
        lease_owner: null,
      })
    );
    expect(supabase._insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        target_id: 5,
        event: "error",
        to_status: "failed",
      })
    );
  });

  it("handles sync_changes action: invokes publisher.applyChanges and clears pending_action", async () => {
    const supabase = createMockSupabase();

    const mockPublisher: Publisher = {
      platform: "youtube",
      plan: vi.fn(),
      advance: vi.fn(),
      reconcile: vi.fn(),
      applyChanges: vi.fn().mockResolvedValueOnce(undefined),
      cancel: vi.fn(),
    };

    const syncTarget: ClaimedTarget = {
      ...baseTarget,
      pending_action: "sync_changes",
    };

    const media = { videoFilePath: "C:/cache/15/video.mp4" };

    await executeTargetStep(supabase, syncTarget, basePost, media, mockPublisher, now, "token_123");

    expect(mockPublisher.applyChanges).toHaveBeenCalled();
    expect(supabase._updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pending_action: null,
        lease_owner: null,
      })
    );
  });

  it("handles retry action: resets target to scheduled and clears error fields", async () => {
    const supabase = createMockSupabase();

    const mockPublisher: Publisher = {
      platform: "youtube",
      plan: vi.fn(),
      advance: vi.fn(),
      reconcile: vi.fn(),
      applyChanges: vi.fn(),
      cancel: vi.fn(),
    };

    const retryTarget: ClaimedTarget = {
      ...baseTarget,
      status: "failed",
      pending_action: "retry",
    };

    const media = { videoFilePath: "C:/cache/15/video.mp4" };

    await executeTargetStep(supabase, retryTarget, basePost, media, mockPublisher, now, "token_123");

    expect(supabase._updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "scheduled",
        step: null,
        pending_action: null,
        last_error_code: null,
        last_error_message: null,
        hold_reason: null,
        attempt_count: 0,
      })
    );
  });

  it("sets published_at and clears run_at when target transitions to published", async () => {
    const supabase = createMockSupabase();

    const mockPublisher: Publisher = {
      platform: "youtube",
      plan: vi.fn(),
      advance: vi.fn().mockResolvedValueOnce({
        nextStatus: "published",
        nextStep: null,
        externalId: "yt_published_123",
      } as StepResult),
      reconcile: vi.fn(),
      applyChanges: vi.fn(),
      cancel: vi.fn(),
    };

    const media = { videoFilePath: "C:/cache/15/video.mp4" };

    await executeTargetStep(supabase, baseTarget, basePost, media, mockPublisher, now, "token_123");

    expect(supabase._updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "published",
        step: null,
        published_at: now.toISOString(),
        run_at: null,
        lease_owner: null,
      })
    );
  });
});

describe("scheduler — runSchedulerCycle integration", () => {
  const now = new Date("2026-11-23T12:00:00Z");

  const mockConfig: WorkerConfig = {
    supabaseUrl: "https://test.supabase.co",
    supabaseServiceRoleKey: "service_role_key",
    tokenEncKey: Buffer.alloc(32, 1),
    workerId: "test-worker",
    hostName: "test-host",
  };

  it("claims target, processes via publisher, and returns summary", async () => {
    const mockTarget: ClaimedTarget = {
      id: 10,
      owner_id: "user-test",
      post_id: 20,
      platform: "youtube",
      status: "scheduled",
      step: null,
      pending_action: null,
      run_at: "2026-11-23T12:00:00Z",
      planned_dispatch_at: "2026-11-23T12:00:00Z",
      external_id: null,
      external_state: {},
      idempotency_key: "20:youtube:v1",
    };

    const mockPost = {
      id: 20,
      title: "Test Video",
      caption: "Test Caption",
      hashtags: "#shorts",
      video_object_path: "user-test/vid.mp4",
      thumbnail_object_path: null,
      due_at: "2026-11-24T12:00:00Z",
    };

    const mockPublisher: Publisher = {
      platform: "youtube",
      plan: vi.fn(),
      advance: vi.fn().mockResolvedValueOnce({
        nextStatus: "uploading",
        nextStep: "wait_processing",
        externalId: "yt_cycle_123",
      } as StepResult),
      reconcile: vi.fn(),
      applyChanges: vi.fn(),
      cancel: vi.fn(),
    };

    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: [mockTarget], error: null }),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "posts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: mockPost, error: null }),
              }),
            }),
          };
        }
        if (table === "connections") {
          return {
            select: vi.fn().mockReturnValue({
              not: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === "targets") {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === "target_events") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      }),
    } as any;

    const summary = await runSchedulerCycle(supabase, mockConfig, now, {
      youtube: mockPublisher,
    });

    expect(summary.claimedCount).toBe(1);
    expect(summary.processedCount).toBe(1);
    expect(summary.missedCount).toBe(0);
    expect(summary.errors).toHaveLength(0);
    expect(mockPublisher.advance).toHaveBeenCalled();
  });
});

describe("scheduler — processConnectionTests", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  const encKey = Buffer.alloc(32, 2);

  const mockConfig: WorkerConfig = {
    supabaseUrl: "https://test.supabase.co",
    supabaseServiceRoleKey: "service_role_key",
    tokenEncKey: encKey,
    workerId: "test-worker",
    ownerId: "user-1",
    hostName: "test-host",
  };

  it("processes pending connection test successfully", async () => {
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    const mockConn = {
      id: 1,
      platform: "youtube",
      test_requested_at: "2026-11-23T11:59:00Z",
      last_test: null,
      owner_id: "user-1",
      connection_secrets: {
        access_token_enc: Buffer.from("dummy_enc"),
      },
    };

    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          not: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [mockConn], error: null }),
          }),
        }),
        update: updateMock,
      }),
    } as any;

    const customTester = vi.fn().mockResolvedValue(true);
    // Mock decryptToken behavior by passing custom tester
    vi.spyOn(await import("../src/crypto"), "decryptToken").mockReturnValue("decrypted_token");

    const tested = await processConnectionTests(supabase, mockConfig, now, customTester);

    expect(tested).toBe(1);
    expect(customTester).toHaveBeenCalledWith("youtube", "decrypted_token");
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        last_test: {
          at: now.toISOString(),
          ok: true,
          error: null,
        },
      })
    );
  });
});
