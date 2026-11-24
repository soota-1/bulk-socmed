"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Film,
  Calendar,
  Clock,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  PauseCircle,
  Hourglass,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import { formatWibDateTime } from "@bulk-socmed/shared";

interface PostOverview {
  id: number;
  title: string | null;
  caption: string;
  due_at: string;
  slot_key: string | null;
  state: string;
  youtube_status?: string | null;
  instagram_status?: string | null;
  tiktok_status?: string | null;
  created_at: string;
}

export default function QueuePage() {
  const [posts, setPosts] = useState<PostOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadPosts() {
    try {
      setRefreshing(true);
      const res = await fetch("/api/v1/posts?limit=50");
      if (res.ok) {
        const data = await res.json();
        setPosts(data.items ?? []);
      }
    } catch {
      // Ignored
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadPosts();
  }, []);

  // Format helper for WIB
  const formatSlot = (dueAtStr: string, slotKey: string | null) => {
    try {
      const d = new Date(dueAtStr);
      // WIB = UTC+7
      const hours = String(d.getUTCHours() + 7).padStart(2, "0");
      const minutes = String(d.getUTCMinutes()).padStart(2, "0");
      return `${hours}:${minutes} WIB`;
    } catch {
      return slotKey || "Jadwal";
    }
  };

  const getStatusBadge = (platform: string, status?: string | null) => {
    if (!status) return null;

    const config: Record<string, { label: string; bg: string; text: string; border: string; icon: any }> = {
      published: { label: "Terbit", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", icon: CheckCircle2 },
      scheduled: { label: "Terjadwal", bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", icon: Clock },
      pending: { label: "Menunggu", bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", icon: Hourglass },
      held: { label: "Ditahan", bg: "bg-amber-50", text: "text-amber-800", border: "border-amber-200", icon: PauseCircle },
      failed: { label: "Gagal", bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", icon: AlertCircle },
      cancelled: { label: "Batal", bg: "bg-slate-100", text: "text-slate-500", border: "border-slate-200", icon: AlertCircle },
    };

    const c = config[status] || { label: status, bg: "bg-slate-100", text: "text-slate-600", border: "border-slate-200", icon: Clock };
    const Icon = c.icon;

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${c.bg} ${c.text} ${c.border}`}>
        <Icon className="w-3 h-3" />
        <span className="capitalize">{platform}</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/60">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Antrean Video</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold">
              {posts.length} Terjadwal
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            Slot Harian: <strong className="text-slate-700 font-semibold">06:00 · 12:00 · 16:00 · 19:00 WIB</strong>
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          <button
            onClick={loadPosts}
            disabled={refreshing}
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100/70 text-slate-600 transition disabled:opacity-50"
            title="Segarkan antrean"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin text-indigo-600" : ""}`} />
          </button>
          <Link
            href="/new"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm font-semibold transition shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah Video</span>
          </Link>
        </div>
      </div>

      {/* Queue List Container */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 bg-slate-50/70 border-b border-slate-200/80 flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
          <span>Slot & Detail Video</span>
          <span className="hidden sm:inline">Status Distribusi</span>
        </div>

        {loading ? (
          <div className="py-16 text-center">
            <div className="w-8 h-8 mx-auto border-3 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin"></div>
            <p className="text-xs text-slate-500 mt-3 font-medium">Memuat antrean video...</p>
          </div>
        ) : posts.length === 0 ? (
          /* Empty State */
          <div className="py-16 px-4 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-indigo-50 rounded-2xl flex items-center justify-center text-3xl">
              📹
            </div>
            <h3 className="text-base font-bold text-slate-900">Belum ada video di antrean</h3>
            <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto mt-1.5">
              Jadwalkan video pendek Anda ke YouTube Shorts, Instagram Reels, dan TikTok secara otomatis sekali unggah.
            </p>
            <div className="mt-6">
              <Link
                href="/new"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Jadwalkan Video Pertama</span>
              </Link>
            </div>
          </div>
        ) : (
          /* Rows of Scheduled Posts */
          <div className="divide-y divide-slate-100">
            {posts.map((post) => (
              <div
                key={post.id}
                className="p-4 sm:p-5 hover:bg-slate-50/70 transition flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                {/* Left: Slot & Info */}
                <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                  <div className="shrink-0 text-center">
                    <span className="inline-block px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200/80 text-xs font-mono font-bold text-slate-800">
                      {formatSlot(post.due_at, post.slot_key)}
                    </span>
                  </div>

                  <div className="w-10 h-14 bg-slate-800 rounded-lg flex items-center justify-center text-white/80 shrink-0 text-xs shadow-xs">
                    ▶
                  </div>

                  <div className="min-w-0">
                    <Link
                      href={`/posts/${post.id}`}
                      className="text-sm font-bold text-slate-900 hover:text-indigo-600 transition truncate block"
                    >
                      {post.title || post.caption.slice(0, 50) || "Tanpa Judul"}
                    </Link>
                    <p className="text-xs text-slate-500 truncate max-w-md mt-0.5">
                      {post.caption}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatWibDateTime(new Date(post.due_at))}
                    </p>
                  </div>
                </div>

                {/* Right: Platform Status Badges & Action */}
                <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0 pt-2 sm:pt-0 border-t sm:border-0 border-slate-100">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {getStatusBadge("YouTube", post.youtube_status)}
                    {getStatusBadge("Instagram", post.instagram_status)}
                    {getStatusBadge("TikTok", post.tiktok_status)}
                  </div>

                  <Link
                    href={`/posts/${post.id}`}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-slate-100 transition shrink-0"
                    title="Lihat detail video"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Slot helper card */}
      <div className="p-4 sm:p-5 bg-gradient-to-r from-indigo-50/60 via-purple-50/30 to-slate-50/50 border border-indigo-100/80 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs">
        <div className="space-y-1">
          <p className="font-bold text-slate-900 flex items-center gap-1.5">
            <span>💡</span> Algoritma Distribusi Slot Atomik
          </p>
          <p className="text-slate-600 max-w-2xl">
            Setiap video baru otomatis dialokasikan ke slot rilis berikutnya (06:00, 12:00, 16:00, atau 19:00 WIB). YouTube & TikTok langsung dijadwalkan otomatis, sedangkan Instagram diunggah oleh pekerja laptop saat mendekati jam tayang.
          </p>
        </div>
        <Link
          href="/new"
          className="shrink-0 px-3 py-1.5 bg-white border border-indigo-200 hover:border-indigo-300 font-semibold text-indigo-700 rounded-lg shadow-2xs transition"
        >
          + Jadwalkan Sekarang
        </Link>
      </div>
    </div>
  );
}
