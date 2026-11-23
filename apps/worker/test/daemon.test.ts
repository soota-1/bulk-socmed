import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { Daemon } from "../src/daemon";
import type { WorkerConfig } from "../src/config";

describe("daemon — Daemon lifecycle and scheduling", () => {
  let tempLogDir: string;
  const now = new Date("2026-11-23T12:00:00Z");

  const mockConfig: WorkerConfig = {
    supabaseUrl: "https://test.supabase.co",
    supabaseServiceRoleKey: "service_role_key",
    tokenEncKey: Buffer.alloc(32, 5),
    workerId: "test-laptop-01",
    ownerId: "user-test",
    hostName: "laptop-host",
  };

  beforeEach(async () => {
    tempLogDir = path.join(os.tmpdir(), `bulk-daemon-log-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempLogDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempLogDir, { recursive: true, force: true }).catch(() => {});
  });

  it("executes scheduler cycle and writes to log file", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "worker_heartbeats") {
          return { upsert: vi.fn().mockResolvedValue({ error: null }) };
        }
        if (table === "connections") {
          return {
            select: vi.fn().mockReturnValue({
              not: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === "posts" || table === "targets" || table === "target_events" || table === "slots" || table === "settings") {
          return {
            select: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                not: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }
        return {};
      }),
    } as any;

    const daemon = new Daemon(supabase, mockConfig, {
      logDir: tempLogDir,
      enableMaintenance: false,
      enableBackup: false,
    });

    daemon.start();
    await daemon.stop();

    // Verify log file was written
    const logFile = path.join(tempLogDir, "worker.log");
    const exists = await fs.stat(logFile).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    const logContent = await fs.readFile(logFile, "utf8");
    expect(logContent).toContain("Daemon started");
  });

  it("gracefully stops and clears interval timer", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      from: vi.fn().mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: null }),
        select: vi.fn().mockReturnValue({
          not: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    } as any;

    const daemon = new Daemon(supabase, mockConfig, {
      intervalMs: 100,
      logDir: tempLogDir,
      enableMaintenance: false,
      enableBackup: false,
    });

    daemon.start();
    await new Promise((r) => setTimeout(r, 150));
    await daemon.stop();

    // Verify tick after stop returns empty
    const summary = await daemon.tick(now);
    expect(summary.claimedCount).toBe(0);
  });
});
