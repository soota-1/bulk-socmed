import { describe, it, expect, vi } from "vitest";
import {
  cleanExpiredPostMedia,
  refreshExpiringTokens,
  pruneOldEvents,
  runMaintenanceCycle,
} from "../src/maintenance";
import type { WorkerConfig } from "../src/config";

describe("maintenance — cleanExpiredPostMedia", () => {
  const now = new Date("2026-11-23T12:00:00Z");

  it("cleans media when all targets are terminal and age >= retention days (3)", async () => {
    const mockPost = {
      id: 10,
      video_object_path: "user-1/vid.mp4",
      thumbnail_object_path: "user-1/thumb.jpg",
      due_at: "2026-11-19T12:00:00Z", // 4 days ago
      updated_at: "2026-11-19T12:00:00Z",
      targets: [
        { id: 1, status: "published", published_at: "2026-11-19T12:05:00Z" },
        { id: 2, status: "published", published_at: "2026-11-19T12:05:00Z" },
      ],
    };

    const removeMock = vi.fn().mockResolvedValue({ error: null });
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    const insertMock = vi.fn().mockResolvedValue({ error: null });

    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "posts") {
          return {
            select: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                not: vi.fn().mockResolvedValue({ data: [mockPost], error: null }),
              }),
            }),
            update: updateMock,
          };
        }
        if (table === "target_events") {
          return { insert: insertMock };
        }
        return {};
      }),
      storage: {
        from: vi.fn().mockReturnValue({
          remove: removeMock,
        }),
      },
    } as any;

    const cleaned = await cleanExpiredPostMedia(supabase, now, 3);

    expect(cleaned).toBe(1);
    expect(removeMock).toHaveBeenCalledWith(["user-1/vid.mp4"]);
    expect(removeMock).toHaveBeenCalledWith(["user-1/thumb.jpg"]);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        video_object_path: "",
        thumbnail_object_path: null,
      })
    );
  });

  it("does not clean media if any target is still active", async () => {
    const mockPost = {
      id: 11,
      video_object_path: "user-1/vid2.mp4",
      thumbnail_object_path: null,
      due_at: "2026-11-19T12:00:00Z",
      updated_at: "2026-11-19T12:00:00Z",
      targets: [
        { id: 3, status: "published" },
        { id: 4, status: "uploading" }, // Still active!
      ],
    };

    const updateMock = vi.fn();
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          neq: vi.fn().mockReturnValue({
            not: vi.fn().mockResolvedValue({ data: [mockPost], error: null }),
          }),
        }),
        update: updateMock,
      }),
      storage: { from: vi.fn() },
    } as any;

    const cleaned = await cleanExpiredPostMedia(supabase, now, 3);

    expect(cleaned).toBe(0);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("maintenance — refreshExpiringTokens", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  const encKey = Buffer.alloc(32, 3);

  const mockConfig: WorkerConfig = {
    supabaseUrl: "https://test.supabase.co",
    supabaseServiceRoleKey: "service_role_key",
    tokenEncKey: encKey,
    workerId: "test-worker",
    hostName: "test-host",
  };

  it("refreshes token expiring within 24 hours", async () => {
    const mockConn = {
      id: 5,
      platform: "youtube",
      token_expires_at: "2026-11-23T18:00:00Z", // 6 hours remaining
      owner_id: "user-1",
      connection_secrets: {
        refresh_token_enc: Buffer.from("mock_refresh_enc"),
      },
    };

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "connections") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  not: vi.fn().mockResolvedValue({ data: [mockConn], error: null }),
                }),
              }),
            }),
            update: updateMock,
          };
        }
        if (table === "connection_secrets") {
          return { update: updateMock };
        }
        return {};
      }),
    } as any;

    vi.spyOn(await import("@bulk-socmed/shared"), "decryptToken").mockReturnValue("mock_refresh_token");

    const customRefresher = vi.fn().mockResolvedValue({
      accessToken: "new_refreshed_access_token",
      expiresInSeconds: 7200,
    });

    const refreshed = await refreshExpiringTokens(supabase, mockConfig, now, customRefresher);

    expect(refreshed).toBe(1);
    expect(customRefresher).toHaveBeenCalledWith("youtube", "mock_refresh_token");
    expect(updateMock).toHaveBeenCalled();
  });
});

describe("maintenance — pruneOldEvents & runMaintenanceCycle", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  const encKey = Buffer.alloc(32, 4);

  const mockConfig: WorkerConfig = {
    supabaseUrl: "https://test.supabase.co",
    supabaseServiceRoleKey: "service_role_key",
    tokenEncKey: encKey,
    workerId: "test-worker",
    hostName: "test-host",
  };

  it("prunes audit events older than 180 days", async () => {
    const deleteMock = vi.fn().mockReturnValue({
      lt: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [{ id: 1 }, { id: 2 }], error: null }),
      }),
    });

    const supabase = {
      from: vi.fn().mockReturnValue({
        delete: deleteMock,
      }),
    } as any;

    const pruned = await pruneOldEvents(supabase, now, 180);
    expect(pruned).toBe(2);
  });

  it("runs full maintenance cycle and returns summary", async () => {
    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "posts") {
          return {
            select: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                not: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === "connections") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  not: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          };
        }
        if (table === "target_events") {
          return {
            delete: vi.fn().mockReturnValue({
              lt: vi.fn().mockReturnValue({
                select: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }
        return {};
      }),
    } as any;

    const summary = await runMaintenanceCycle(supabase, mockConfig, now);
    expect(summary.mediaCleanedCount).toBe(0);
    expect(summary.tokensRefreshedCount).toBe(0);
    expect(summary.eventsPrunedCount).toBe(0);
    expect(summary.errors).toHaveLength(0);
  });
});
