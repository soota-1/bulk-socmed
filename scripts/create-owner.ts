/**
 * Script untuk membuat akun pemilik (Owner) pertama di Supabase Auth
 * dan otomatis menyimpan OWNER_ID ke file .env.
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import readline from "node:readline";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const envPath = path.resolve(__dirname, "../.env");

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

async function main() {
  console.log("==================================================");
  console.log("   Pembuatan Akun Pemilik (Owner) Supabase Auth   ");
  console.log("==================================================\n");

  if (!url || !key) {
    console.error("[-] Error: SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum terisi di .env");
    process.exit(1);
  }

  const supabase = createClient(url, key);

  // Ambil argumen dari command line jika ada (misal: tsx scripts/create-owner.ts email pass)
  let email = process.argv[2];
  let password = process.argv[3];

  if (!email) {
    email = await ask("👉 Masukkan Email Akun Pemilik: ");
  }
  if (!password) {
    password = await ask("👉 Masukkan Kata Sandi (min. 6 karakter): ");
  }

  if (!email || !password || password.length < 6) {
    console.error("[-] Email dan kata sandi (minimal 6 karakter) wajib diisi.");
    process.exit(1);
  }

  console.log(`\nMembuat akun untuk: ${email} di Supabase...`);

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // Langsung aktif tanpa perlu konfirmasi email
  });

  if (error) {
    console.error("[-] Gagal membuat akun:", error.message);
    process.exit(1);
  }

  const userId = data.user.id;
  console.log(`\n🎉 Akun Pemilik Berhasil Dibuat!`);
  console.log(`   👉 Email   : ${email}`);
  console.log(`   👉 User ID : ${userId}`);

  // Update OWNER_ID di .env
  if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, "utf8");
    if (envContent.includes("OWNER_ID=")) {
      envContent = envContent.replace(/OWNER_ID=.*/g, `OWNER_ID=${userId}`);
    } else {
      envContent += `\nOWNER_ID=${userId}`;
    }
    fs.writeFileSync(envPath, envContent, "utf8");

    // Sinkronkan ke apps/web/.env.local jika ada
    const webEnvPath = path.resolve(__dirname, "../apps/web/.env.local");
    if (fs.existsSync(path.dirname(webEnvPath))) {
      fs.copyFileSync(envPath, webEnvPath);
    }

    console.log(`   👉 File .env berhasil diperbarui dengan OWNER_ID=${userId}`);
  }

  console.log("\nAnda sekarang dapat login di http://localhost:3000/login dengan email dan kata sandi di atas!\n");
}

main().catch((err) => {
  console.error("Terjadi kesalahan:", err);
  process.exit(1);
});
