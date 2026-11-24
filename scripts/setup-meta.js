/**
 * Script Interaktif Setup Meta for Developers dengan Playwright
 * Membuka Google Chrome secara visual (headed) dan memandu pembuatan Meta App
 * untuk Instagram Reels / Instagram Graph API.
 */

const { chromium } = require("playwright");
const readline = require("readline");
const fs = require("fs");
const path = require("path");

const ENV_PATH = path.resolve(__dirname, "..", ".env");

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

function updateEnvFile(appId, appSecret) {
  if (!fs.existsSync(ENV_PATH)) {
    console.error("[-] File .env tidak ditemukan di:", ENV_PATH);
    return false;
  }

  let content = fs.readFileSync(ENV_PATH, "utf8");

  // Update atau pasang META_APP_ID & META_CLIENT_ID
  if (content.includes("META_APP_ID=")) {
    content = content.replace(/META_APP_ID=.*/g, `META_APP_ID=${appId}`);
  } else {
    content += `\nMETA_APP_ID=${appId}`;
  }

  if (content.includes("META_CLIENT_ID=")) {
    content = content.replace(/META_CLIENT_ID=.*/g, `META_CLIENT_ID=${appId}`);
  } else {
    content += `\nMETA_CLIENT_ID=${appId}`;
  }

  // Update atau pasang META_APP_SECRET & META_CLIENT_SECRET
  if (content.includes("META_APP_SECRET=")) {
    content = content.replace(/META_APP_SECRET=.*/g, `META_APP_SECRET=${appSecret}`);
  } else {
    content += `\nMETA_APP_SECRET=${appSecret}`;
  }

  if (content.includes("META_CLIENT_SECRET=")) {
    content = content.replace(/META_CLIENT_SECRET=.*/g, `META_CLIENT_SECRET=${appSecret}`);
  } else {
    content += `\nMETA_CLIENT_SECRET=${appSecret}`;
  }

  fs.writeFileSync(ENV_PATH, content, "utf8");
  return true;
}

async function main() {
  console.log("\n========================================================");
  console.log("   🚀 PANDUAN INTERAKTIF META FOR DEVELOPERS (PLAYWRIGHT)   ");
  console.log("========================================================\n");
  console.log("Membuka browser Google Chrome untuk navigasi ke Meta for Developers...\n");

  const userDataDir = path.resolve(__dirname, "..", ".cache", "meta-chrome-profile");
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  let browserContext;
  try {
    browserContext = await chromium.launchPersistentContext(userDataDir, {
      channel: "chrome",
      headless: false,
      viewport: { width: 1280, height: 800 },
      args: ["--start-maximized"],
    });
  } catch (err) {
    console.log("[i] Membuka Chrome biasa tanpa profil persisten...");
    const browser = await chromium.launch({
      channel: "chrome",
      headless: false,
    });
    browserContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
  }

  const page = browserContext.pages()[0] || (await browserContext.newPage());

  console.log("[1/6] Membuka https://developers.facebook.com/apps/ ...");
  await page.goto("https://developers.facebook.com/apps/", { waitUntil: "domcontentloaded" });

  console.log("\n--------------------------------------------------------");
  console.log("📋 PETUNJUK LANGKAH DEMI LANGKAH DI BROWSER:");
  console.log("--------------------------------------------------------");
  console.log("1. Silakan LOGIN ke akun Meta / Facebook Anda di jendela Chrome yang terbuka.");
  console.log("2. Klik tombol 'Create App' (atau 'Buat Aplikasi').");
  console.log("3. Pilih Tipe Aplikasi:");
  console.log("   - Jika ada pilihan 'Other' / 'Lainnya', pilih 'Other' -> Next -> pilih 'Business' -> Next.");
  console.log("   - Masukkan Nama Aplikasi (misal: 'Bulk Socmed Scheduler') dan email kontak Anda.");
  console.log("4. Tambahkan Produk:");
  console.log("   - Cari 'Instagram Graph API' -> Klik 'Set Up' / 'Siapkan'.");
  console.log("   - Cari 'Facebook Login for Business' -> Klik 'Set Up' / 'Siapkan'.");
  console.log("5. Konfigurasi Valid OAuth Redirect URIs:");
  console.log("   - Buka menu: Facebook Login -> Settings (atau Instagram -> Basic Display / API setup).");
  console.log("   - Pada 'Valid OAuth Redirect URIs', tambahkan:");
  console.log("     👉 http://localhost:3000/api/oauth/instagram/callback");
  console.log("     👉 (Opsional jika sudah ada) https://<domain-anda>.vercel.app/api/oauth/instagram/callback");
  console.log("   - Klik 'Save changes'.");
  console.log("6. Ambil Kredensial:");
  console.log("   - Buka menu: App Settings -> Basic (Pengaturan Aplikasi -> Dasar).");
  console.log("   - Di sana Anda akan melihat 'App ID' dan 'App Secret' (klik 'Show').");
  console.log("--------------------------------------------------------\n");

  // Deteksi otomatis URL untuk mendeteksi App ID jika pengguna sudah masuk ke dashboard aplikasi
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      const url = frame.url();
      const match = url.match(/developers\.facebook\.com\/apps\/(\d+)/);
      if (match && match[1]) {
        console.log(`\n✨ Terdeteksi App ID dari URL browser: ${match[1]}`);
      }
    }
  });

  const appId = await askQuestion("👉 Masukkan App ID (Client ID): ");
  const appSecret = await askQuestion("👉 Masukkan App Secret (Client Secret): ");

  if (appId && appSecret) {
    const success = updateEnvFile(appId, appSecret);
    if (success) {
      console.log("\n✅ Berhasil! META_APP_ID dan META_APP_SECRET telah disimpan ke .env!");
    }
  } else {
    console.log("\n[!] Input dilewati atau belum lengkap. Anda dapat mengisinya nanti langsung di .env.");
  }

  console.log("\n--------------------------------------------------------");
  console.log("⚠️  PENTING: DAFTARKAN INSTAGRAM TESTER");
  console.log("--------------------------------------------------------");
  console.log("Selama aplikasi Meta Anda masih dalam status 'Development Mode':");
  console.log("1. Buka menu 'App Roles' -> 'Roles' di dashboard Meta App.");
  console.log("2. Di bagian 'Instagram Testers', klik 'Add Instagram Testers'.");
  console.log("3. Masukkan username Instagram yang ingin Anda hubungkan.");
  console.log("4. Buka Instagram (di aplikasi HP atau web www.instagram.com):");
  console.log("   Settings -> Apps and Websites -> Tester Invitations -> Klik 'Accept'.");
  console.log("5. Pastikan akun Instagram tersebut bertipe Professional (Creator/Business)");
  console.log("   dan sudah ditautkan ke sebuah Facebook Page.");
  console.log("========================================================\n");

  const closeBrowser = await askQuestion("Tekan Enter untuk menutup browser Chrome (atau ketik 'keep' untuk membiarkannya terbuka): ");
  if (closeBrowser.toLowerCase() !== "keep") {
    await browserContext.close();
    console.log("Browser ditutup. Selesai!");
  } else {
    console.log("Browser tetap terbuka. Anda dapat menutupnya secara manual kapan saja.");
  }
}

main().catch((err) => {
  console.error("Terjadi kesalahan:", err);
  process.exit(1);
});
