"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { formatWibDateTime } from "@bulk-socmed/shared";

interface Target {
  id: number;
  platform: "youtube" | "instagram" | "tiktok";
  status: string;
  step: string | null;
  pending_action: string | null;
  run_at: string | null;
  planned_dispatch_at: string | null;
  external_id: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  hold_reason: string | null;
  published_at: string | null;
}

interface EventLog {
  id: number;
  target_id: number;
  event: string;
  from_status: string | null;
  to_status: string | null;
  detail: Record<string, any>;
  created_at: string;
}

interface PostDetail {
  id: number;
  title: string | null;
  caption: string;
  hashtags: string;
  due_at: string;
  slot_key: string | null;
  state: string;
  video: {
    object_path: string;
    size_bytes: number;
    duration_ms?: number | null;
    width?: number | null;
    height?: number | null;
    preview_url: string | null;
  };
  thumbnail?: {
    object_path: string;
    preview_url: string | null;
  } | null;
  targets: Target[];
  events: EventLog[];
  created_at: string;
}

export default function PostDetailPage() {
  const params = useParams();
  const router = useRouter();
  const postId = params.id as string;

  const [post, setPost] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit metadata state
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Video playback on demand
  const [playVideo, setPlayVideo] = useState(false);

  async function loadPost() {
    try {
      setLoading(true);
      const res = await fetch(`/api/v1/posts/${postId}`);
      if (!res.ok) {
        const err = await res.json();
        setError(err.error?.message || "Gagal memuat posting.");
        return;
      }
      const data: PostDetail = await res.json();
      setPost(data);
      setTitle(data.title ?? "");
      setCaption(data.caption ?? "");
      setHashtags(data.hashtags ?? "");
    } catch {
      setError("Terjadi kesalahan jaringan.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPost();
  }, [postId]);

  async function handleSaveMetadata(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch(`/api/v1/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          caption: caption.trim(),
          hashtags: hashtags.trim(),
        }),
      });

      if (res.ok) {
        setSaveMessage("Perubahan berhasil disimpan! Sinkronisasi otomatis dikirim ke platform.");
        loadPost();
      } else {
        const err = await res.json();
        setSaveMessage(`Gagal menyimpan: ${err.error?.message}`);
      }
    } catch {
      setSaveMessage("Terjadi kesalahan saat menyimpan.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelPost() {
    if (!confirm("Batalkan seluruh jadwal publikasi untuk video ini? Slot jadwal akan kosong kembali.")) {
      return;
    }
    try {
      const res = await fetch(`/api/v1/posts/${postId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        alert("Posting berhasil dibatalkan.");
        router.push("/");
      }
    } catch {
      alert("Gagal membatalkan posting.");
    }
  }

  async function handleRetryTarget(targetId: number) {
    try {
      const res = await fetch(`/api/v1/posts/${postId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_id: targetId }),
      });
      if (res.ok) {
        setSaveMessage("Target dijadwalkan untuk dicoba ulang.");
        loadPost();
      } else {
        const err = await res.json();
        alert(`Gagal mencoba ulang: ${err.error?.message}`);
      }
    } catch {
      alert("Terjadi kesalahan jaringan.");
    }
  }

  if (loading) {
    return (
      <div className="py-12 text-center text-slate-500 text-sm">
        Memuat detail posting...
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="py-12 text-center text-rose-600 text-sm">
        {error || "Posting tidak ditemukan."}
        <div className="mt-4">
          <Link href="/" className="text-indigo-600 underline">
            &larr; Kembali ke Antrean
          </Link>
        </div>
      </div>
    );
  }

  const isCancelled = post.state === "cancelled";

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs text-indigo-600 hover:underline flex items-center gap-1 mb-1">
            &larr; Kembali ke antrean
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {post.title || "Detail Video"}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Jadwal: <span className="font-semibold text-slate-800">{formatWibDateTime(new Date(post.due_at))}</span>
            {post.slot_key && <span className="ml-2 px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono text-[11px]">{post.slot_key}</span>}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`text-xs px-3 py-1 rounded-full font-semibold ${
              post.state === "active"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : post.state === "cancelled"
                ? "bg-rose-50 text-rose-700 border border-rose-200"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            {post.state === "active" ? "Aktif" : post.state === "cancelled" ? "Dibatalkan" : "Draft"}
          </span>

          {!isCancelled && (
            <button
              onClick={handleCancelPost}
              className="text-xs px-3 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 font-medium transition"
            >
              Batalkan Jadwal
            </button>
          )}
        </div>
      </div>

      {saveMessage && (
        <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium">
          {saveMessage}
        </div>
      )}

      {/* Main Grid: Video Player on left, Metadata Form on right */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Video Preview Card */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
          <h3 className="font-bold text-slate-900 text-sm">Pratinjau Video</h3>

          <div className="aspect-[9/16] max-h-[380px] bg-slate-900 rounded-xl overflow-hidden flex items-center justify-center relative">
            {playVideo && post.video.preview_url ? (
              <video
                src={post.video.preview_url}
                controls
                autoPlay
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="text-center p-6 text-white space-y-3">
                <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center mx-auto text-xl">
                  ▶
                </div>
                <p className="text-xs text-slate-300">
                  Pratinjau video dimuat secara on-demand untuk menghemat kuota egress Supabase.
                </p>
                <button
                  type="button"
                  onClick={() => setPlayVideo(true)}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow"
                >
                  Putar Video
                </button>
              </div>
            )}
          </div>

          <div className="text-[11px] text-slate-500 space-y-1">
            <div>Ukuran: {(post.video.size_bytes / (1024 * 1024)).toFixed(1)} MB</div>
            {post.video.duration_ms && (
              <div>Durasi: {(post.video.duration_ms / 1000).toFixed(0)} detik</div>
            )}
            {post.video.width && post.video.height && (
              <div>Resolusi: {post.video.width} × {post.video.height} (9:16 vertikal)</div>
            )}
          </div>
        </div>

        {/* Metadata Editor */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
          <h3 className="font-bold text-slate-900 text-sm">Informasi Konten</h3>

          <form onSubmit={handleSaveMetadata} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Judul Video (YouTube Shorts & Internal)
              </label>
              <input
                type="text"
                disabled={isCancelled}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={100}
                className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Caption
              </label>
              <textarea
                disabled={isCancelled}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={5}
                className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Hashtag (#shorts #reels)
              </label>
              <input
                type="text"
                disabled={isCancelled}
                value={hashtags}
                onChange={(e) => setHashtags(e.target.value)}
                className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50"
              />
            </div>

            {!isCancelled && (
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition disabled:opacity-50"
              >
                {saving ? "Menyimpan..." : "Simpan Perubahan"}
              </button>
            )}
          </form>
        </div>
      </div>

      {/* Target Status Cards per Platform */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
        <h3 className="font-bold text-slate-900 text-sm">Status Target Platform</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {post.targets.map((target) => {
            const isFailed = target.status === "failed" || target.status === "missed";
            return (
              <div
                key={target.id}
                className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col justify-between space-y-3"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs uppercase tracking-wider text-slate-700">
                      {target.platform === "youtube"
                        ? "YouTube Shorts"
                        : target.platform === "instagram"
                        ? "Instagram Reels"
                        : "TikTok (Buffer)"}
                    </span>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                        target.status === "published"
                          ? "bg-emerald-50 text-emerald-700"
                          : target.status === "uploading"
                          ? "bg-blue-50 text-blue-700"
                          : target.status === "awaiting_platform"
                          ? "bg-purple-50 text-purple-700"
                          : isFailed
                          ? "bg-rose-50 text-rose-700"
                          : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {target.status}
                    </span>
                  </div>

                  <div className="mt-2 text-xs text-slate-600 space-y-1">
                    {target.step && <div>Langkah: <span className="font-mono text-[11px] text-slate-800">{target.step}</span></div>}
                    {target.external_id && (
                      <div className="truncate">ID: <span className="font-mono text-[11px]">{target.external_id}</span></div>
                    )}
                    {target.pending_action && (
                      <div className="text-amber-700 font-medium">Tindakan: {target.pending_action}</div>
                    )}
                    {target.last_error_message && (
                      <div className="text-rose-600 text-[11px] font-medium mt-1">
                        Galat: {target.last_error_message}
                      </div>
                    )}
                  </div>
                </div>

                {isFailed && (
                  <button
                    onClick={() => handleRetryTarget(target.id)}
                    className="w-full py-1.5 px-2 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold rounded-lg transition"
                  >
                    Coba Lagi
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Target Events Timeline */}
      {post.events.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
          <h3 className="font-bold text-slate-900 text-sm">Riwayat Kejadian (Audit Log)</h3>
          <div className="divide-y divide-slate-100">
            {post.events.map((ev) => (
              <div key={ev.id} className="py-2.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[11px] text-slate-400">
                    {new Date(ev.created_at).toLocaleTimeString("id-ID")}
                  </span>
                  <span className="font-semibold text-slate-800">{ev.event}</span>
                  {ev.from_status && ev.to_status && (
                    <span className="text-slate-500 font-mono text-[11px]">
                      {ev.from_status} &rarr; {ev.to_status}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400">
                  {new Date(ev.created_at).toLocaleDateString("id-ID")}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
