import Link from "next/link";

interface PostItem {
  id: number;
  title: string | null;
  caption: string;
  due_at: string;
  slot_key: string | null;
  youtube_status?: string | null;
  instagram_status?: string | null;
  tiktok_status?: string | null;
}

export default async function QueuePage() {
  // Simple SSR fallback / initial state
  const mockHeartbeatHealthy = true;

  return (
    <div className="space-y-6">
      {!mockHeartbeatHealthy && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-sm flex items-start gap-3">
          <span className="text-lg">✕</span>
          <div>
            <p className="font-semibold">Pekerja di laptop tidak aktif.</p>
            <p className="text-red-700 text-xs mt-0.5">
              Posting Instagram tidak akan terbit sampai laptop menyala dan pekerja berjalan.
            </p>
          </div>
        </div>
      )}

      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Antrean Video</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Slot harian: 06:00 · 12:00 · 16:00 · 19:00 WIB
          </p>
        </div>
        <Link
          href="/new"
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition"
        >
          + Video baru
        </Link>
      </div>

      {/* Queue container */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
          <span>Hari Ini · Slot Terjadwal</span>
          <span>Status Platform</span>
        </div>

        <div className="divide-y divide-slate-100">
          {/* Sample row 06:00 */}
          <div className="p-4 hover:bg-slate-50 transition flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm font-mono font-bold text-slate-700">06:00</span>
              <div className="w-10 h-14 bg-slate-200 rounded-md flex items-center justify-center text-xs text-slate-400">
                ▶
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Tips hemat listrik harian</h3>
                <p className="text-xs text-slate-400">3 kebiasaan kecil menurunkan tagihan...</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                ✓ YouTube
              </span>
              <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                ✓ Instagram
              </span>
              <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                ✓ TikTok
              </span>
            </div>
          </div>

          {/* Sample row empty slot */}
          <div className="p-4 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm font-mono text-slate-400">12:00</span>
              <span className="text-xs text-slate-400 italic">(slot kosong)</span>
            </div>
            <Link
              href="/new"
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              + Isi slot ini
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
