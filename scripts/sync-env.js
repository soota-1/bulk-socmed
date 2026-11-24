const fs = require("node:fs");
const path = require("node:path");

const rootEnv = path.resolve(__dirname, "..", ".env");
const webEnv = path.resolve(__dirname, "..", "apps", "web", ".env.local");

if (fs.existsSync(rootEnv)) {
  fs.copyFileSync(rootEnv, webEnv);
  console.log("[sync-env] .env berhasil disinkronkan ke apps/web/.env.local");
} else {
  console.warn("[sync-env] Peringatan: .env di root proyek belum ditemukan. Salin dari .env.example terlebih dahulu.");
}
