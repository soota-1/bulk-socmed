# Panduan Operasional & Deployment: Penjadwal Video Pendek (bulk-socmed)

Panduan lengkap untuk menjalankan sistem **bulk-socmed** secara mandiri dengan **biaya Rp0 (Free-Tier)** menggunakan kombinasi Vercel Hobby, Supabase Free Tier, Buffer Free Plan, dan Laptop Windows pribadi.

---

## 1. Arsitektur Layanan & Alokasi Kuota Rp0

| Layanan | Peran Sistem | Batas Paket Gratis (*Free Tier*) | Strategi Mitigasi Desain |
| :--- | :--- | :--- | :--- |
| **Vercel Hobby** | Hosting Web App Next.js 14 & Endpoint OAuth HTTPS | Serverless payload max 4.5 MB; Cron gratis 1x/hari | Upload video langsung dari browser ke Supabase Storage via Signed Upload URL; Worker laptop sebagai scheduler mandiri. |
| **Supabase Free** | Database PostgreSQL, Storage Buckets & Auth | 500 MB DB, 1 GB Storage, 50 MB/file, 5 GB Egress/bln | Cache lokal video sekali pakai, pratinjau video on-demand, pembersihan media otomatis setelah 3 hari. |
| **Buffer Free** | Pengiriman video otomatis ke TikTok | 1 channel TikTok, maksimal 10 posting antrean | Sistem **Jendela Bergulir (*Rolling Window*)**: Worker hanya mengirim 8 posting ke Buffer (2 hari ke depan); sisanya antre di Supabase. |
| **Laptop Windows** | Worker Daemon (Pengunggah video, pembersih media & backup) | Bergantung ketersediaan listrik & internet laptop | Detak (*heartbeat*) 30s ke database, auto-restart Task Scheduler, toleransi keterlambatan (*grace period* 2 jam). |

---

## 2. Langkah Konfigurasi Awal (Setup dari Nol)

### A. Setup Supabase
1. Buka [database.new](https://database.new) dan buat project baru (Region terdekat: Singapore `ap-southeast-1`).
2. Masuk ke menu **SQL Editor**, buka file `supabase/migrations/20261122000000_init_schema.sql` dari repositori ini, tempel seluruh kodenya, lalu klik **Run**.
3. Pastikan 10 tabel, fungsi RPC (`create_post_tx`, `claim_targets`), serta storage bucket `videos` dan `thumbnails` terbuat dengan RLS aktif.
4. Salin kredensial dari menu **Project Settings &rarr; API**:
   - `Project URL`
   - `anon public` key
   - `service_role secret` key (Simpan rahasia, jangan dibagikan)

### B. Generate Token Encryption Key
Jalankan perintah berikut di terminal untuk membuat kunci enkripsi AES-256-GCM 32-byte (64 karakter hex):
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Salin hasilnya sebagai `TOKEN_ENC_KEY`.

### C. Setup Google Cloud Console (YouTube Data API v3)
1. Buka [Google Cloud Console](https://console.cloud.google.com/) dan buat project baru.
2. Masuk ke **APIs & Services &rarr; Library**, cari **YouTube Data API v3**, lalu klik **Enable**.
3. Buka **OAuth consent screen**:
   - Pilih User Type: **External**.
   - Isi App Name, User support email, dan Developer contact info.
   - Pada bagian **Scopes**, tambahkan:
     - `https://www.googleapis.com/auth/youtube.upload`
     - `https://www.googleapis.com/auth/youtube`
   - Pada bagian **Test users**, tambahkan alamat email Google yang memiliki channel YouTube Anda.
4. Buka **Credentials &rarr; Create Credentials &rarr; OAuth client ID**:
   - Application type: **Web application**.
   - Name: `Bulk Socmed YouTube Client`.
   - Authorized redirect URIs:
     - `https://<nama-aplikasi-anda>.vercel.app/api/oauth/youtube/callback`
     - `http://localhost:3000/api/oauth/youtube/callback` (untuk pengujian lokal)
5. Salin **Client ID** dan **Client Secret**.

### D. Setup Meta for Developers (Instagram Graph API)
1. Buka [Meta for Developers](https://developers.facebook.com/) dan buat App bertipe **Business**.
2. Pastikan akun Instagram Anda bertipe **Instagram Professional / Creator Account** dan telah terhubung ke sebuah **Facebook Page**.
3. Tambahkan produk **Instagram Graph API**.
4. Di bagian **Settings &rarr; Basic**, salin **App ID** (`META_CLIENT_ID`) dan **App Secret** (`META_CLIENT_SECRET`).
5. Pada menu **Facebook Login &rarr; Settings**, masukkan Valid OAuth Redirect URIs:
   - `https://<nama-aplikasi-anda>.vercel.app/api/oauth/instagram/callback`
   - `http://localhost:3000/api/oauth/instagram/callback`

### E. Setup Buffer (TikTok API)
1. Buka [buffer.com](https://buffer.com/) dan buat akun gratis.
2. Hubungkan profil TikTok Anda di antarmuka Buffer.
3. Buka [buffer.com/developers/apps](https://buffer.com/developers/apps), buat aplikasi baru untuk mendapatkan **Access Token (API Key)**.

---

## 3. Konfigurasi Environment Variable (`.env`)

Buat berkas `.env` di root direktori proyek (salin dari `.env.example`):

```env
# ---------------------------------------------------------------------------
# Supabase
# ---------------------------------------------------------------------------
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJh...
SUPABASE_SERVICE_ROLE_KEY=eyJh...

# ---------------------------------------------------------------------------
# Enkripsi Token Rahasia (AES-256-GCM, 64 hex characters)
# ---------------------------------------------------------------------------
TOKEN_ENC_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# ---------------------------------------------------------------------------
# Alamat Aplikasi (HTTPS Vercel)
# ---------------------------------------------------------------------------
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app

# ---------------------------------------------------------------------------
# OAuth Kredensial (Google & Meta)
# ---------------------------------------------------------------------------
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret

META_CLIENT_ID=your-meta-app-id
META_CLIENT_SECRET=your-meta-app-secret

# ---------------------------------------------------------------------------
# Worker Daemon Config
# ---------------------------------------------------------------------------
WORKER_ID=laptop-01
OWNER_ID=your-supabase-user-uuid
```

---

## 4. Pengoperasian Worker di Laptop Windows

Pekerja (*worker daemon*) bertugas mengunduh video ke cache lokal, memposting ke YouTube/Instagram/Buffer, menyegarkan token OAuth, membersihkan storage, dan membuat backup JSON harian.

### A. Uji Kesehatan Lingkungan (*Environment Doctor*)
Sebelum menjalankan worker, jalankan skrip diagnosa otomatis:
```powershell
pnpm check:env
```
Pastikan seluruh indikator berstatus `[OK]`.

### B. Menjalankan Worker secara Manual
Jalankan perintah berikut di terminal:
```powershell
.\scripts\start-worker.ps1
# atau
pnpm --filter worker dev
```
Tekan `Ctrl+C` untuk mematikan daemon secara aman (*graceful shutdown*).

### C. Menjalankan Otomatis dengan Windows Task Scheduler
Agar worker selalu menyala otomatis di latar belakang setiap kali laptop dihidupkan:
1. Buka PowerShell sebagai Administrator.
2. Jalankan perintah instalasi:
   ```powershell
   .\scripts\worker-task-scheduler.ps1 -Action Install
   ```
3. Periksa status layanan:
   ```powershell
   .\scripts\worker-task-scheduler.ps1 -Action Status
   ```
4. Untuk menghapus task scheduler:
   ```powershell
   .\scripts\worker-task-scheduler.ps1 -Action Uninstall
   ```

### D. Pengaturan Daya Laptop (*Power Settings*)
Agar worker dapat berjalan tepat waktu saat jam tayang postingan:
1. Buka **Windows Settings &rarr; System &rarr; Power & battery**.
2. Pada bagian **Screen and sleep**:
   - *When plugged in, turn off my screen after*: `15 minutes` (Boleh mati layar).
   - *When plugged in, put my device to sleep after*: **`Never`** (Wajib *Never* agar CPU tetap memproses jadwal).
3. Pastikan laptop tetap terhubung ke charger listrik dan koneksi Wi-Fi stabil.

---

## 5. Pemeliharaan, Monitoring & Pemulihan Bencana

### A. Monitoring Antrean & Kesehatan Worker
- Buka dashboard antarmuka web di `/`.
- Lihat indikator di pojok kanan atas navbar:
  - **Hijau ("Worker Aktif")**: Detak terakhir diterima dalam 3 menit terakhir.
  - **Merah ("Worker Offline")**: Laptop mati / offline. Spanduk peringatan darurat akan muncul.

### B. Pembersihan Media Otomatis
- Video dan thumbnail akan otomatis dihapus dari Supabase Storage dan disk lokal `data/cache/<post_id>/` tepat **3 hari** setelah seluruh target postingan selesai (`published` atau `cancelled`).
- Hal ini menjamin pemakaian storage gratis Supabase tidak akan pernah melampaui kuota 1 GB.

### C. Cadangan Harian JSON (*Daily Backups*)
- Setiap hari, worker secara otomatis mengekspor tabel `posts`, `targets`, `target_events`, `slots`, `settings`, dan `connections` ke folder:
  `data/backups/YYYY-MM-DD/`
- Sistem mempertahankan **7 salinan harian terakhir** dan menghapus folder cadangan lama secara otomatis.

### D. Pemulihan Pasca Gangguan (*Disaster Recovery*)
1. **Jika Laptop Mati Melewati Jam Tayang**:
   - Jika durasi mati $\le 2\text{ jam}$ (*grace period*): Worker yang baru menyala akan langsung memposting susulan.
   - Jika durasi mati $> 2\text{ jam}$: Postingan ditandai `missed`. Buka halaman `/posts/[id]` lalu klik tombol **Coba Lagi** bila Anda ingin mempostingnya saat itu juga.
2. **Jika Token OAuth Kedaluwarsa / Dicabut**:
   - Status koneksi akan otomatis berubah menjadi `Perlu Sambung Ulang`.
   - Buka halaman `/connections` dan klik **Hubungkan dengan Google / Meta**. Begitu berhasil, seluruh postingan yang tertahan akan otomatis dibuka kembali.
