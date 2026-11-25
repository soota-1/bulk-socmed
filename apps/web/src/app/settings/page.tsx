"use client";

import { useEffect, useState } from "react";
import type { Settings } from "@bulk-socmed/shared";
import {
  Sliders,
  HardDrive,
  Save,
  CheckCircle2,
  AlertCircle,
  Database,
  ArrowUpRight,
} from "lucide-react";

interface UsageData {
  storage_provider?: "r2" | "supabase";
  egress_unlimited?: boolean;
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
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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
        setMessage({ type: "success", text: "Pengaturan berhasil diperbarui!" });
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: `Gagal menyimpan: ${err.error?.message}` });
      }
    } catch {
      setMessage({ type: "error", text: "Terjadi kesalahan jaringan." });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 mx-auto border-3 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin"></div>
        <p className="text-xs text-slate-500 mt-3 font-medium">Memuat konfigurasi sistem...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="pb-2 border-b border-slate-200/60">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Pengaturan Sistem</h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Konfigurasi toleransi jadwal posting, antrean platform, dan pantau kuota penyimpanan media.
        </p>
      </div>

      {message && (
        <div
          className={`p-3.5 rounded-xl border text-xs sm:text-sm font-medium flex items-center gap-2.5 shadow-2xs ${
            message.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-rose-50 border-rose-200 text-rose-800"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Storage & Egress Meters */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <Database className="w-5 h-5 text-indigo-600" />
            <h3 className="font-bold text-slate-900 text-sm">
              {usage?.storage_provider === "r2"
                ? "Estimasi Kuota Cloudflare R2 (Free Tier)"
                : "Estimasi Kuota Free-Tier Supabase"}
            </h3>
          </div>
          <span
            className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${
              usage?.storage_provider === "r2"
                ? "bg-orange-50 text-orange-700 border-orange-200"
                : "bg-slate-100 text-slate-600 border-slate-200"
            }`}
          >
            {usage?.storage_provider === "r2" ? "Cloudflare R2 Aktif" : "Supabase Storage"}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Storage Meter */}
          <div className="space-y-2 p-4 rounded-xl bg-slate-50/70 border border-slate-200/60">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-slate-500" />
                Penyimpanan Media
              </span>
              <span className="font-mono text-slate-600 font-medium">
                {((usage?.storage?.used_bytes_estimate ?? 0) / (1024 * 1024)).toFixed(1)} MB /{" "}
                {((usage?.storage?.quota_bytes ?? 1024 * 1024 * 1024) / (1024 * 1024)).toLocaleString(
                  "id-ID"
                )}{" "}
                MB
              </span>
            </div>
            <div className="w-full bg-slate-200/80 rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  (usage?.storage?.percent ?? 0) >= 80 ? "bg-amber-500" : "bg-indigo-600"
                }`}
                style={{ width: `${Math.min(100, usage?.storage?.percent ?? 0)}%` }}
              ></div>
            </div>
            <p className="text-[11px] text-slate-500">
              {usage?.storage_provider === "r2"
                ? "Kapasitas gratis: 10 GB/bulan (maks 1 GB/video). Berkas dibersihkan otomatis 3 hari setelah terbit."
                : "Kapasitas: 1 GB. Berkas video dibersihkan otomatis 3 hari setelah terbit."}
            </p>
          </div>

          {/* Egress Meter */}
          <div className="space-y-2 p-4 rounded-xl bg-slate-50/70 border border-slate-200/60">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-500" />
                Bandwidth Unduhan (Egress)
              </span>
              <span className="font-mono text-slate-600 font-medium">
                {usage?.egress_unlimited
                  ? "Gratis Tanpa Batas ($0)"
                  : `${((usage?.egress_month?.used_bytes_estimate ?? 0) / (1024 * 1024)).toFixed(1)} MB / 5.120 MB`}
              </span>
            </div>
            <div className="w-full bg-slate-200/80 rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  usage?.egress_unlimited
                    ? "bg-emerald-500"
                    : (usage?.egress_month?.percent ?? 0) >= 80
                    ? "bg-amber-500"
                    : "bg-emerald-500"
                }`}
                style={{
                  width: usage?.egress_unlimited
                    ? "100%"
                    : `${Math.min(100, usage?.egress_month?.percent ?? 0)}%`,
                }}
              ></div>
            </div>
            <p className="text-[11px] text-slate-500">
              {usage?.egress_unlimited
                ? "Cloudflare R2 tidak mengenakan biaya egress (Zero Egress Fee)."
                : "Batas gratis: 5 GB/bulan. Dihemat dengan cache lokal pekerja dan pemutaran on-demand."}
            </p>
          </div>
        </div>
      </div>

      {/* Operational Parameters Form */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-5">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
          <Sliders className="w-5 h-5 text-indigo-600" />
          <h3 className="font-bold text-slate-900 text-sm">Parameter Operasional & Toleransi Pekerja</h3>
        </div>

        <form onSubmit={handleSaveSettings} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Grace Period */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                Toleransi Keterlambatan (*Grace Period*)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={graceMinutes}
                  onChange={(e) => setGraceMinutes(Number(e.target.value))}
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50/50 focus:bg-white"
                />
                <span className="text-xs text-slate-500 font-medium shrink-0">menit</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Bila laptop mati dan hidup kembali lewat batas ini, posting ditandai *missed* (tidak diposting mendadak).
              </p>
            </div>

            {/* TikTok Rolling Window */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                Jendela Kirim TikTok Buffer
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={14}
                  value={tiktokWindowDays}
                  onChange={(e) => setTiktokWindowDays(Number(e.target.value))}
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50/50 focus:bg-white"
                />
                <span className="text-xs text-slate-500 font-medium shrink-0">hari sebelum</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Mencegah kuota antrean gratis Buffer (10 post) penuh dengan hanya mengirim video beberapa hari ke depan.
              </p>
            </div>

            {/* Buffer Queue Limit */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                Batas Antrean Maksimal Buffer
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={bufferQueueLimit}
                onChange={(e) => setBufferQueueLimit(Number(e.target.value))}
                className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50/50 focus:bg-white"
              />
              <p className="text-[11px] text-slate-400">
                Batas standar paket gratis Buffer adalah 10 antrean per channel.
              </p>
            </div>

            {/* Instagram Prepare Lead */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                Lead Time Kontainer Instagram
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={5}
                  max={60}
                  value={igPrepareLeadMinutes}
                  onChange={(e) => setIgPrepareLeadMinutes(Number(e.target.value))}
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50/50 focus:bg-white"
                />
                <span className="text-xs text-slate-500 font-medium shrink-0">menit</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Waktu pekerja mengunggah kontainer video ke Meta sebelum jadwal rilis tiba.
              </p>
            </div>

            {/* Min Lead Minutes */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                Jarak Minimum Waktu Entri Baru (*Min Lead*)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={minLeadMinutes}
                  onChange={(e) => setMinLeadMinutes(Number(e.target.value))}
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50/50 focus:bg-white"
                />
                <span className="text-xs text-slate-500 font-medium shrink-0">menit</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Batas slot waktu terdekat yang dapat dipilih saat membuat video baru.
              </p>
            </div>

            {/* Quota Warning Percent */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                Ambang Peringatan Kuota (*Quota Warning*)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={50}
                  max={95}
                  value={quotaWarnPercent}
                  onChange={(e) => setQuotaWarnPercent(Number(e.target.value))}
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50/50 focus:bg-white"
                />
                <span className="text-xs text-slate-500 font-medium shrink-0">%</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Spanduk peringatan muncul di bagian atas ketika storage atau egress mencapai persentase ini.
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs sm:text-sm font-semibold shadow-xs transition disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? "Menyimpan..." : "Simpan Perubahan"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
