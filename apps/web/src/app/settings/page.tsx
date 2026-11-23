"use client";

import { useEffect, useState } from "react";
import type { Settings } from "@bulk-socmed/shared";

interface UsageData {
  storage: {
    used_bytes_estimate: number;
    quota_bytes: number;
    percent: number;
  };
  egress_month: {
    used_bytes_estimate: number;
    quota_bytes: number;
    percent: number;
  };
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Form states
  const [graceMinutes, setGraceMinutes] = useState(120);
  const [tiktokWindowDays, setTiktokWindowDays] = useState(2);
  const [bufferQueueLimit, setBufferQueueLimit] = useState(10);
  const [igPrepareLeadMinutes, setIgPrepareLeadMinutes] = useState(10);
  const [minLeadMinutes, setMinLeadMinutes] = useState(15);
  const [quotaWarnPercent, setQuotaWarnPercent] = useState(80);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [setRes, statRes] = await Promise.all([
          fetch("/api/v1/settings"),
          fetch("/api/v1/status"),
        ]);

        if (setRes.ok) {
          const s = await setRes.json();
          setSettings(s);
          setGraceMinutes(s.grace_minutes ?? 120);
          setTiktokWindowDays(s.tiktok_window_days ?? 2);
          setBufferQueueLimit(s.buffer_queue_limit ?? 10);
          setIgPrepareLeadMinutes(s.instagram_prepare_lead_minutes ?? 10);
          setMinLeadMinutes(s.min_lead_minutes ?? 15);
          setQuotaWarnPercent(s.quota_warn_percent ?? 80);
        }

        if (statRes.ok) {
          const stat = await statRes.json();
          setUsage(stat.usage);
        }
      } catch {
        // Ignored
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grace_minutes: Number(graceMinutes),
          tiktok_window_days: Number(tiktokWindowDays),
          buffer_queue_limit: Number(bufferQueueLimit),
          instagram_prepare_lead_minutes: Number(igPrepareLeadMinutes),
          min_lead_minutes: Number(minLeadMinutes),
          quota_warn_percent: Number(quotaWarnPercent),
        }),
      });

      if (res.ok) {
        setMessage("Pengaturan berhasil disimpan.");
      } else {
        const err = await res.json();
        setMessage(`Gagal menyimpan: ${err.error?.message}`);
      }
    } catch {
      setMessage("Terjadi kesalahan jaringan.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="py-12 text-center text-slate-500 text-sm">
        Memuat pengaturan...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Pengaturan</h1>
        <p className="text-sm text-slate-500 mt-1">
          Konfigurasi toleransi jadwal, antrean platform, dan pantauan kuota gratis Supabase.
        </p>
      </div>

      {message && (
        <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium">
          {message}
        </div>
      )}

      {/* Storage & Egress Meters */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
        <h3 className="font-bold text-slate-900 text-sm">Estimasi Pemakaian Kuota Free-Tier Supabase</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Storage Meter */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="font-semibold text-slate-700">Penyimpanan Media (Storage)</span>
              <span className="text-slate-500">
                {((usage?.storage?.used_bytes_estimate ?? 0) / (1024 * 1024)).toFixed(1)} MB / 1.024 MB
              </span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  (usage?.storage?.percent ?? 0) >= 80 ? "bg-amber-500" : "bg-indigo-600"
                }`}
                style={{ width: `${Math.min(100, usage?.storage?.percent ?? 0)}%` }}
              ></div>
            </div>
            <p className="text-[11px] text-slate-400">
              Kapasitas maksimal: 1 GB (50 MB per video). File video dibersihkan otomatis 3 hari setelah terbit.
            </p>
          </div>

          {/* Egress Meter */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="font-semibold text-slate-700">Unduhan Bulan Ini (Egress)</span>
              <span className="text-slate-500">
                {((usage?.egress_month?.used_bytes_estimate ?? 0) / (1024 * 1024)).toFixed(1)} MB / 5.120 MB
              </span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  (usage?.egress_month?.percent ?? 0) >= 80 ? "bg-amber-500" : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min(100, usage?.egress_month?.percent ?? 0)}%` }}
              ></div>
            </div>
            <p className="text-[11px] text-slate-400">
              Batas gratis Supabase: 5 GB/bulan. Dilindungi cache lokal pekerja dan pemutaran video on-demand.
            </p>
          </div>
        </div>
      </div>

      {/* Operational Parameters Form */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
        <h3 className="font-bold text-slate-900 text-sm">Parameter Operasional & Toleransi</h3>

        <form onSubmit={handleSaveSettings} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Toleransi Keterlambatan (*Grace Period*)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={graceMinutes}
                  onChange={(e) => setGraceMinutes(Number(e.target.value))}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <span className="text-xs text-slate-500">menit</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Bila laptop mati dan hidup kembali melewati batas ini, posting ditandai *missed* (tidak diposting diam-diam).
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Jendela Kirim TikTok Buffer (*Rolling Window*)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={14}
                  value={tiktokWindowDays}
                  onChange={(e) => setTiktokWindowDays(Number(e.target.value))}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <span className="text-xs text-slate-500">hari sebelum tayang</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Mencegah kuota antrean gratis Buffer (10 post) penuh dengan hanya mengirim video beberapa hari ke depan.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Batas Antrean Maksimal Buffer
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={bufferQueueLimit}
                onChange={(e) => setBufferQueueLimit(Number(e.target.value))}
                className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Default 10 post untuk paket gratis Buffer.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Waktu Mulai Siapkan Instagram Reels
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={5}
                  max={60}
                  value={igPrepareLeadMinutes}
                  onChange={(e) => setIgPrepareLeadMinutes(Number(e.target.value))}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <span className="text-xs text-slate-500">menit sebelum tayang</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Waktu worker mengunggah kontainer Reels sebelum jam tayang tiba.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Waktu Minimum Pembuatan Entri (*Min Lead*)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={minLeadMinutes}
                  onChange={(e) => setMinLeadMinutes(Number(e.target.value))}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <span className="text-xs text-slate-500">menit dari sekarang</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Batas slot waktu terdekat yang dapat dipilih saat membuat video baru.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Ambang Peringatan Kuota (*Quota Warning*)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={50}
                  max={95}
                  value={quotaWarnPercent}
                  onChange={(e) => setQuotaWarnPercent(Number(e.target.value))}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <span className="text-xs text-slate-500">%</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Spanduk peringatan muncul ketika penyimpanan atau unduhan mencapai persentase ini.
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow transition disabled:opacity-50"
            >
              {saving ? "Menyimpan..." : "Simpan Pengaturan"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
