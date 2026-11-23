import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { exportDailyBackup, CORE_TABLES } from "../src/backup";

describe("backup — exportDailyBackup", () => {
  let tempBackupDir: string;
  const now = new Date("2026-11-23T12:00:00Z");

  beforeEach(async () => {
    tempBackupDir = path.join(os.tmpdir(), `bulk-backup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempBackupDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempBackupDir, { recursive: true, force: true }).catch(() => {});
  });

  it("exports all 6 core tables to JSON files and never queries connection_secrets", async () => {
    const queriedTables: string[] = [];

    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        queriedTables.push(table);
        return {
          select: vi.fn().mockResolvedValue({
            data: [{ id: 1, sample: `${table}_data` }],
            error: null,
          }),
        };
      }),
    } as any;

    const result = await exportDailyBackup(supabase, now, tempBackupDir, 7);

    expect(result.dateStr).toBe("2026-11-23");
    expect(result.filesWritten).toHaveLength(CORE_TABLES.length);
    expect(queriedTables).toEqual(expect.arrayContaining([...CORE_TABLES]));
    expect(queriedTables).not.toContain("connection_secrets");

    // Verify files on disk
    for (const table of CORE_TABLES) {
      const filePath = path.join(result.backupPath, `${table}.json`);
      const content = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(content);
      expect(parsed).toEqual([{ id: 1, sample: `${table}_data` }]);
    }
  });

  it("rotates older backups when folder count exceeds maxCopies (e.g. 2)", async () => {
    // Create pre-existing backup folders
    await fs.mkdir(path.join(tempBackupDir, "2026-11-20"), { recursive: true });
    await fs.mkdir(path.join(tempBackupDir, "2026-11-21"), { recursive: true });
    await fs.mkdir(path.join(tempBackupDir, "2026-11-22"), { recursive: true });

    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    } as any;

    // Export new backup for 2026-11-23 with maxCopies = 2
    const result = await exportDailyBackup(supabase, now, tempBackupDir, 2);

    expect(result.prunedCount).toBe(2); // 2026-11-20 and 2026-11-21 removed

    const remaining = await fs.readdir(tempBackupDir);
    expect(remaining.sort()).toEqual(["2026-11-22", "2026-11-23"]);
  });
});
