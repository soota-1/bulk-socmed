/**
 * Pre-flight Environment Doctor & Diagnostic Script.
 * Verifies Supabase credentials, encryption keys, and connectivity before running the worker.
 *
 * Run via: pnpm tsx scripts/doctor.ts
 */

import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { parseEncryptionKey } from "../packages/shared/src/crypto";

dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../apps/web/.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../apps/worker/.env") });
dotenv.config();

interface CheckItem {
  name: string;
  ok: boolean;
  message: string;
}

async function runDoctor() {
  console.log("==================================================");
  console.log("  Bulk Socmed — Pre-flight Environment Doctor   ");
  console.log("==================================================\n");

  const results: CheckItem[] = [];

  // 1. Check Node.js version
  const nodeVer = process.version;
  const major = parseInt(nodeVer.slice(1).split(".")[0], 10);
  results.push({
    name: "Node.js Version",
    ok: major >= 18,
    message: major >= 18 ? `${nodeVer} (OK >= 18.0.0)` : `${nodeVer} (Diperlukan Node.js 18+)`,
  });

  // 2. Check Supabase URL & Service Role Key
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  results.push({
    name: "SUPABASE_URL",
    ok: !!supabaseUrl && supabaseUrl.startsWith("https://"),
    message: supabaseUrl ? supabaseUrl : "Belum diisi di .env",
  });

  results.push({
    name: "SUPABASE_SERVICE_ROLE_KEY",
    ok: !!serviceRoleKey && serviceRoleKey.length > 20,
    message: serviceRoleKey ? "Tersedia (dirahasiakan)" : "Belum diisi di .env",
  });

  // 3. Check TOKEN_ENC_KEY (32 bytes AES-256)
  const tokenKey = process.env.TOKEN_ENC_KEY;
  let keyValid = false;
  let keyMsg = "Belum diisi di .env (harus 64 karakter hex)";
  if (tokenKey) {
    try {
      const buf = parseEncryptionKey(tokenKey);
      keyValid = buf.length === 32;
      keyMsg = "Valid (32-byte AES-256-GCM key)";
    } catch (e: any) {
      keyMsg = `Format tidak valid: ${e.message}`;
    }
  }
  results.push({
    name: "TOKEN_ENC_KEY",
    ok: keyValid,
    message: keyMsg,
  });

  // 4. Test Supabase Database Connectivity
  let dbOk = false;
  let dbMsg = "Koneksi database gagal";
  if (supabaseUrl && serviceRoleKey) {
    try {
      const supabase = createClient(supabaseUrl, serviceRoleKey);
      const { data, error } = await supabase.from("settings").select("key").limit(1);
      if (!error) {
        dbOk = true;
        dbMsg = "Terhubung & schema settings dapat diakses";
      } else {
        dbMsg = `Error query Supabase: ${error.message}`;
      }
    } catch (e: any) {
      dbMsg = `Gagal menjangkau Supabase: ${e.message}`;
    }
  }
  results.push({
    name: "Supabase Database Connection",
    ok: dbOk,
    message: dbMsg,
  });

  // 5. Test Supabase Storage Buckets
  let storageOk = false;
  let storageMsg = "Storage belum siap";
  if (dbOk && supabaseUrl && serviceRoleKey) {
    try {
      const supabase = createClient(supabaseUrl, serviceRoleKey);
      const { data: buckets, error } = await supabase.storage.listBuckets();
      if (!error && buckets) {
        const bucketNames = buckets.map((b) => b.name);
        const hasVideos = bucketNames.includes("videos");
        const hasThumbs = bucketNames.includes("thumbnails");

        if (hasVideos && hasThumbs) {
          storageOk = true;
          storageMsg = "Bucket 'videos' dan 'thumbnails' siap";
        } else {
          storageMsg = `Bucket belum lengkap. Ditemukan: ${bucketNames.join(", ") || "tidak ada"}`;
        }
      }
    } catch (e: any) {
      storageMsg = `Storage error: ${e.message}`;
    }
  }
  results.push({
    name: "Supabase Storage Buckets",
    ok: storageOk,
    message: storageMsg,
  });

  // 6. Check Local Directories
  let dirOk = true;
  for (const dir of ["data/cache", "data/logs", "data/backups"]) {
    try {
      await fs.mkdir(path.resolve(process.cwd(), dir), { recursive: true });
    } catch {
      dirOk = false;
    }
  }
  results.push({
    name: "Local Storage Directories",
    ok: dirOk,
    message: dirOk ? "data/cache, data/logs, data/backups siap" : "Gagal membuat folder lokal",
  });

  // Print Report
  for (const r of results) {
    const icon = r.ok ? "✅ [OK]   " : "❌ [ERROR]";
    console.log(`${icon} ${r.name.padEnd(30)} : ${r.message}`);
  }

  console.log("\n--------------------------------------------------");
  const allOk = results.every((r) => r.ok);
  if (allOk) {
    console.log("🎉 SEMUA PEMERIKSAAN LULUS! Worker siap dijalankan.");
    console.log("   Mulai worker dengan: pnpm --filter worker dev");
  } else {
    console.log("⚠️ ADA PEMERIKSAAN YANG GAGAL. Periksa kembali konfigurasi .env");
  }
  console.log("--------------------------------------------------\n");
}

runDoctor().catch((err) => {
  console.error("Doctor script error:", err);
});
