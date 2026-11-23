import path from "node:path";
import fs from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDateWib } from "@bulk-socmed/shared";

export const DEFAULT_BACKUP_DIR = path.resolve(process.cwd(), "data/backups");
export const MAX_BACKUP_COPIES = 7;

export const CORE_TABLES = [
  "posts",
  "targets",
  "target_events",
  "slots",
  "settings",
  "connections",
] as const;

export interface BackupResult {
  dateStr: string;
  backupPath: string;
  filesWritten: string[];
  prunedCount: number;
}

/**
 * Export core application tables into daily JSON backup files and rotate older backups.
 * Note: connection_secrets is intentionally NEVER exported for zero-credential-leak security.
 */
export async function exportDailyBackup(
  supabase: SupabaseClient,
  now = new Date(),
  backupDir = DEFAULT_BACKUP_DIR,
  maxCopies = MAX_BACKUP_COPIES
): Promise<BackupResult> {
  const dateStr = formatDateWib(now);
  const targetDir = path.join(backupDir, dateStr);

  await fs.mkdir(targetDir, { recursive: true });

  const filesWritten: string[] = [];

  // 1. Export each core table
  for (const table of CORE_TABLES) {
    const { data, error } = await supabase.from(table).select("*");
    if (error) {
      throw new Error(`Gagal mengekspor tabel ${table}: ${error.message}`);
    }

    const filePath = path.join(targetDir, `${table}.json`);
    await fs.writeFile(filePath, JSON.stringify(data ?? [], null, 2), "utf8");
    filesWritten.push(`${table}.json`);
  }

  // 2. Rotate older backups (keep last maxCopies)
  let prunedCount = 0;
  try {
    const entries = await fs.readdir(backupDir, { withFileTypes: true });
    const backupFolders = entries
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort(); // Lexicographical sort works for YYYY-MM-DD

    if (backupFolders.length > maxCopies) {
      const foldersToRemove = backupFolders.slice(0, backupFolders.length - maxCopies);
      for (const folder of foldersToRemove) {
        const removePath = path.join(backupDir, folder);
        await fs.rm(removePath, { recursive: true, force: true });
        prunedCount++;
      }
    }
  } catch {
    // Rotation failure should not fail the backup
  }

  return {
    dateStr,
    backupPath: targetDir,
    filesWritten,
    prunedCount,
  };
}
