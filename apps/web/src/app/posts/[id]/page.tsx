"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { formatWibDateTime } from "@bulk-socmed/shared";
import {
  ArrowLeft,
  Play,
  CheckCircle2,
  Clock,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Calendar,
  Film,
  Hash,
  Type,
  FileText,
  Trash2,
  ExternalLink,
  Save,
  ShieldCheck,
  Video,
  Activity,
  Layers,
  Sparkles,
  Youtube,
  Instagram,
  Image as ImageIcon,
  X,
} from "lucide-react";

interface Target {
  id: number;
  platform: "youtube" | "instagram" | "tiktok";
  status: string;
  step: string | null;
  pending_action: string | null;
  run_at: string | null;
  planned_dispatch_at: string | null;
  external_id: string | null;
  external_state?: Record<string, any> | null;
  last_error_code: string | null;
  last_error_message: string | null;
  hold_reason: string | null;
  published_at: string | null;
}

type PlatformOverride = {
  title: string;
  caption: string;
  hashtags: string;
};

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
  const [activeMetaTab, setActiveMetaTab] = useState<"default" | "youtube" | "instagram" | "tiktok">("default");
  const [overrides, setOverrides] = useState<Record<"youtube" | "instagram" | "tiktok", PlatformOverride>>({
    youtube: { title: "", caption: "", hashtags: "" },
    instagram: { title: "", caption: "", hashtags: "" },
    tiktok: { title: "", caption: "", hashtags: "" },
  });
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Video playback on demand (saves egress)
  const [playVideo, setPlayVideo] = useState(false);
  const [retryingTargetId, setRetryingTargetId] = useState<number | null>(null);
  const [uploadingThumb, setUploadingThumb] = useState(false);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  async function handleThumbnailUpload(file: File) {
    if (file.type !== "image/jpeg" && file.type !== "image/png") {
      setSaveStatus({ type: "error", message: "Thumbnail hanya mendukung format JPG atau PNG." });
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setSaveStatus({ type: "error", message: "Ukuran thumbnail melebihi batas 8 MB." });
      return;
    }

    setUploadingThumb(true);
    setSaveStatus(null);
    try {
      const initRes = await fetch("/api/v1/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "thumbnail",
          filename: file.name,
          size_bytes: file.size,
          content_type: file.type,
        }),
      });
      if (!initRes.ok) {
        const err = await initRes.json();
        throw new Error(err.error?.message || "Gagal menginisialisasi unggahan thumbnail.");
      }
      const uploadData = await initRes.json();
      const uploadUrl =
        uploadData.upload?.url || uploadData.signed_upload_url || uploadData.signedUrl;
      if (!uploadUrl) throw new Error("URL unggah thumbnail tidak valid.");

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error("Gagal mentransfer thumbnail ke penyimpanan cloud.");

      const patchRes = await fetch(`/api/v1/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thumbnail_upload_id: uploadData.upload_id }),
      });
      if (!patchRes.ok) {
        const err = await patchRes.json();
        throw new Error(err.error?.message || "Gagal menyimpan thumbnail ke posting.");
      }

      setSaveStatus({ type: "success", message: "Thumbnail / Cover berhasil diperbarui!" });
      await loadPost();
    } catch (err: any) {
      setSaveStatus({ type: "error", message: err.message || "Gagal mengunggah thumbnail." });
    } finally {
      setUploadingThumb(false);
      if (thumbInputRef.current) thumbInputRef.current.value = "";
    }
  }

  async function handleRemoveThumbnail() {
    setUploadingThumb(true);
    setSaveStatus(null);
    try {
      const patchRes = await fetch(`/api/v1/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thumbnail_upload_id: null }),
      });
      if (!patchRes.ok) {
        const err = await patchRes.json();
        throw new Error(err.error?.message || "Gagal menghapus thumbnail.");
      }
      setSaveStatus({ type: "success", message: "Thumbnail / Cover dihapus." });
      await loadPost();
    } catch (err: any) {
      setSaveStatus({ type: "error", message: err.message || "Gagal menghapus thumbnail." });
    } finally {
      setUploadingThumb(false);
    }
  }

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

      const nextOverrides: Record<"youtube" | "instagram" | "tiktok", PlatformOverride> = {
        youtube: { title: "", caption: "", hashtags: "" },
        instagram: { title: "", caption: "", hashtags: "" },
        tiktok: { title: "", caption: "", hashtags: "" },
      };
      for (const t of data.targets ?? []) {
        const es = t.external_state ?? {};
        nextOverrides[t.platform] = {
          title: typeof es.override_title === "string" ? es.override_title : "",
          caption: typeof es.override_caption === "string" ? es.override_caption : "",
          hashtags: typeof es.override_hashtags === "string" ? es.override_hashtags : "",
        };
      }
      setOverrides(nextOverrides);
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
    setSaveStatus(null);
    try {
      const platformOverridesPayload: Record<string, PlatformOverride> = {};
      for (const t of post?.targets ?? []) {
        platformOverridesPayload[t.platform] = {
          title: overrides[t.platform].title.trim(),
          caption: overrides[t.platform].caption.trim(),
          hashtags: overrides[t.platform].hashtags.trim(),
        };
      }

      const res = await fetch(`/api/v1/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          caption: caption.trim(),
          hashtags: hashtags.trim(),
          ...(Object.keys(platformOverridesPayload).length > 0
            ? { platform_overrides: platformOverridesPayload }
            : {}),
        }),
      });

      if (res.ok) {
        setSaveStatus({
          type: "success",
          message: "Perubahan metadata berhasil disimpan! Data sinkron dengan jadwal worker.",
        });
        loadPost();
      } else {
        const err = await res.json();
        setSaveStatus({
          type: "error",
          message: `Gagal menyimpan: ${err.error?.message || "Kesalahan tidak diketahui"}`,
        });
      }
    } catch {
      setSaveStatus({
        type: "error",
        message: "Terjadi kesalahan jaringan saat menyimpan data.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelPost() {
    if (
      !confirm(
        "Apakah Anda yakin ingin membatalkan jadwal publikasi ini? Slot jadwal akan dikosongkan dan worker tidak akan memproses video ini."
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/v1/posts/${postId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.push("/");
      } else {
        const err = await res.json();
        alert(`Gagal membatalkan: ${err.error?.message || "Kesalahan server"}`);
      }
    } catch {
      alert("Terjadi kesalahan jaringan saat membatalkan posting.");
    }
  }

  async function handleRetryTarget(targetId: number) {
    setRetryingTargetId(targetId);
    try {
      const res = await fetch(`/api/v1/posts/${postId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_id: targetId }),
      });
      if (res.ok) {
        setSaveStatus({
          type: "success",
          message: "Target platform dijadwalkan ulang untuk diproses worker laptop.",
        });
        await loadPost();
      } else {
        const err = await res.json();
        alert(`Gagal mencoba ulang: ${err.error?.message}`);
      }
    } catch {
      alert("Terjadi kesalahan jaringan saat mencoba ulang.");
    } finally {
      setRetryingTargetId(null);
    }
  }

  if (loading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center text-center space-y-4">
        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
        <p className="text-sm font-medium text-slate-600">Memuat detail jadwal posting...</p>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="max-w-md mx-auto py-16 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-900">Posting Tidak Ditemukan</h2>
        <p className="text-sm text-slate-500">{error || "Posting mungkin telah dibatalkan atau dihapus."}</p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Kembali ke Antrean
        </Link>
      </div>
    );
  }

  const isCancelled = post.state === "cancelled";
  const allPublished = post.targets.length > 0 && post.targets.every((t) => t.status === "published");
  const hasFailed = post.targets.some((t) => t.status === "failed" || t.status === "missed");

  const hashtagList = hashtags
    .split(/\s+/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Top Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition mb-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Kembali ke Antrean
            </Link>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              {post.title || "Detail Jadwal Video"}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 pt-1">
              <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 font-medium px-2 py-0.5 rounded-md">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                {formatWibDateTime(new Date(post.due_at))}
              </span>
              {post.slot_key && (
                <span className="font-mono text-[11px] bg-indigo-50 text-indigo-700 font-semibold px-2 py-0.5 rounded-md border border-indigo-100">
                  Slot: {post.slot_key}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5 self-start sm:self-center">
            {/* Status Pill */}
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border ${
                allPublished
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : isCancelled
                  ? "bg-rose-50 text-rose-700 border-rose-200"
                  : hasFailed
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-blue-50 text-blue-700 border-blue-200"
              }`}
            >
              {allPublished ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Selesai Dipublikasikan
                </>
              ) : isCancelled ? (
                <>
                  <AlertCircle className="w-3.5 h-3.5" />
                  Dibatalkan
                </>
              ) : hasFailed ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Perlu Perhatian
                </>
              ) : (
                <>
                  <Clock className="w-3.5 h-3.5" />
                  Dalam Antrean
                </>
              )}
            </span>

            {/* Cancel Action */}
            {!isCancelled && !allPublished && (
              <button
                type="button"
                onClick={handleCancelPost}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold transition"
                title="Batalkan publikasi video ini"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Batalkan</span>
              </button>
            )}

            {/* Refresh Button */}
            <button
              type="button"
              onClick={loadPost}
              className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition"
              title="Perbarui data"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Feedback message */}
        {saveStatus && (
          <div
            className={`p-3.5 rounded-xl text-xs font-medium flex items-center gap-2.5 ${
              saveStatus.type === "success"
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                : "bg-rose-50 text-rose-800 border border-rose-200"
            }`}
          >
            {saveStatus.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            )}
            <span>{saveStatus.message}</span>
          </div>
        )}
      </div>

      {/* Main Grid: Video Preview on Left, Metadata Editor on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Video Preview & Specs (5 columns) */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Film className="w-4 h-4 text-indigo-600" />
              Pratinjau Video Vertikal
            </h3>
            <span className="text-[11px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">9:16</span>
          </div>

          {/* Video Container */}
          <div className="w-full aspect-[9/16] max-h-[460px] mx-auto bg-slate-950 rounded-2xl overflow-hidden shadow-inner flex flex-col items-center justify-center relative border border-slate-800">
            {playVideo && post.video.preview_url ? (
              <video
                src={post.video.preview_url}
                controls
                autoPlay
                playsInline
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="text-center p-6 text-white space-y-4 flex flex-col items-center justify-center">
                <div className="w-16 h-16 rounded-2xl bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center text-indigo-300 shadow-lg">
                  <Play className="w-8 h-8 fill-current ml-1" />
                </div>
                <div className="space-y-1.5 max-w-[220px]">
                  <p className="text-xs font-bold text-slate-100">Pratinjau On-Demand</p>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Video dimuat hanya saat Anda menekan tombol putar agar halaman tetap ringan.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPlayVideo(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md transition"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Putar Video
                </button>
              </div>
            )}
          </div>

          {/* Video Technical Specs */}
          <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100 space-y-2 text-xs">
            <div className="flex items-center justify-between text-slate-600">
              <span className="text-slate-400">Ukuran File:</span>
              <span className="font-semibold text-slate-800">
                {(post.video.size_bytes / (1024 * 1024)).toFixed(1)} MB
              </span>
            </div>
            {post.video.duration_ms && (
              <div className="flex items-center justify-between text-slate-600">
                <span className="text-slate-400">Durasi:</span>
                <span className="font-semibold text-slate-800">
                  {(post.video.duration_ms / 1000).toFixed(0)} detik
                </span>
              </div>
            )}
            {post.video.width && post.video.height && (
              <div className="flex items-center justify-between text-slate-600">
                <span className="text-slate-400">Resolusi:</span>
                <span className="font-semibold text-slate-800">
                  {post.video.width} × {post.video.height} (Vertikal)
                </span>
              </div>
            )}
            <div className="flex items-center justify-between text-slate-600 pt-1 border-t border-slate-200/60">
              <span className="text-slate-400">Storage Path:</span>
              <span className="font-mono text-[10px] text-slate-500 truncate max-w-[180px]" title={post.video.object_path}>
                {post.video.object_path}
              </span>
            </div>
          </div>

          {/* Thumbnail / Cover Section */}
          <div className="pt-3 border-t border-slate-100 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-indigo-600" />
                Thumbnail / Cover Video
              </span>
              <span className="text-[11px] text-slate-400">JPG/PNG (maks. 8 MB)</span>
            </div>
            <input
              ref={thumbInputRef}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleThumbnailUpload(file);
              }}
            />

            {post.thumbnail?.preview_url ? (
              <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={post.thumbnail.preview_url}
                    alt="Thumbnail Cover"
                    className="w-10 h-14 object-cover rounded-lg border border-slate-200 shrink-0 bg-slate-900"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800">Cover Terpasang</p>
                    <p className="text-[10px] font-mono text-slate-400 truncate max-w-[150px]">
                      {post.thumbnail.object_path}
                    </p>
                  </div>
                </div>
                {!isCancelled && !allPublished && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={uploadingThumb}
                      onClick={() => thumbInputRef.current?.click()}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-medium text-slate-700 transition cursor-pointer disabled:opacity-50"
                    >
                      Ganti
                    </button>
                    <button
                      type="button"
                      disabled={uploadingThumb}
                      onClick={handleRemoveThumbnail}
                      className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer disabled:opacity-50"
                      title="Hapus cover"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ) : !isCancelled && !allPublished ? (
              <button
                type="button"
                disabled={uploadingThumb}
                onClick={() => thumbInputRef.current?.click()}
                className="w-full py-2.5 px-3 rounded-xl border border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/30 text-xs font-medium text-slate-600 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <ImageIcon className="w-3.5 h-3.5 text-slate-400" />
                <span>{uploadingThumb ? "Mengunggah cover..." : "Unggah Cover / Thumbnail"}</span>
              </button>
            ) : (
              <p className="text-[11px] text-slate-400 italic">Tidak ada thumbnail khusus.</p>
            )}
          </div>
        </div>

        {/* Right: Content Information & Metadata Form (7 columns) */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-600" />
              Metadata & Teks Konten
            </h3>
            <span className="text-xs text-slate-400">Dapat disunting sebelum publish</span>
          </div>

          <form onSubmit={handleSaveMetadata} className="space-y-4">
            {/* Platform Metadata Tabs */}
            <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200/60">
              <button
                type="button"
                onClick={() => setActiveMetaTab("default")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeMetaTab === "default"
                    ? "bg-white text-slate-900 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Default
              </button>
              {post.targets.map((t) => {
                const ov = overrides[t.platform];
                const hasCustom = Boolean(ov.title.trim() || ov.caption.trim() || ov.hashtags.trim());
                const label =
                  t.platform === "youtube"
                    ? "YouTube"
                    : t.platform === "instagram"
                    ? "Instagram"
                    : "TikTok";
                return (
                  <button
                    key={t.platform}
                    type="button"
                    onClick={() => setActiveMetaTab(t.platform)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      activeMetaTab === t.platform
                        ? "bg-white text-indigo-700 shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <span>{label}</span>
                    {hasCustom && <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />}
                  </button>
                );
              })}
            </div>

            {activeMetaTab === "default" ? (
              <>
                {/* Title Field */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Type className="w-3.5 h-3.5 text-slate-400" />
                      Judul Default (YouTube Shorts &amp; Internal)
                    </label>
                    <span className="text-[11px] font-mono text-slate-400">{title.length} / 100</span>
                  </div>
                  <input
                    type="text"
                    disabled={isCancelled || allPublished}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={100}
                    placeholder="Judul menarik untuk video Anda..."
                    className="w-full text-xs sm:text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-500 transition"
                  />
                </div>

                {/* Caption Field */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-slate-400" />
                      Caption Default
                    </label>
                    <span className="text-[11px] font-mono text-slate-400">{caption.length} / 2200</span>
                  </div>
                  <textarea
                    disabled={isCancelled || allPublished}
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    maxLength={2200}
                    rows={5}
                    placeholder="Tulis deskripsi konten Anda di sini..."
                    className="w-full text-xs sm:text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-500 transition resize-none leading-relaxed"
                  />
                </div>

                {/* Hashtags Field */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Hash className="w-3.5 h-3.5 text-slate-400" />
                      Hashtag Default
                    </label>
                    <span className="text-[11px] text-slate-400">Pisahkan dengan spasi</span>
                  </div>
                  <input
                    type="text"
                    disabled={isCancelled || allPublished}
                    value={hashtags}
                    onChange={(e) => setHashtags(e.target.value)}
                    placeholder="#shorts #reels #fyp"
                    className="w-full text-xs sm:text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-500 transition font-mono"
                  />

                  {/* Hashtag chips preview */}
                  {hashtagList.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-2">
                      {hashtagList.map((tag, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-mono text-[11px] font-medium border border-indigo-100"
                        >
                          {tag.startsWith("#") ? tag : `#${tag}`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              (() => {
                const plat = activeMetaTab;
                const ov = overrides[plat];
                const platLabel =
                  plat === "youtube" ? "YouTube" : plat === "instagram" ? "Instagram" : "TikTok";
                const updateOv = (field: keyof PlatformOverride, val: string) =>
                  setOverrides((prev) => ({
                    ...prev,
                    [plat]: { ...prev[plat], [field]: val },
                  }));

                return (
                  <div className="space-y-4 p-3.5 rounded-xl border border-indigo-100 bg-indigo-50/20">
                    <p className="text-[11px] text-slate-500">
                      Teks khusus untuk <strong>{platLabel}</strong>. Kosongkan field agar otomatis mengikuti tab Default.
                    </p>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-700">
                          Judul Khusus {platLabel}
                        </label>
                        <span className="text-[11px] font-mono text-slate-400">
                          {ov.title.length} / 100
                        </span>
                      </div>
                      <input
                        type="text"
                        disabled={isCancelled || allPublished}
                        value={ov.title}
                        onChange={(e) => updateOv("title", e.target.value)}
                        maxLength={100}
                        placeholder={title || "Mengikuti Judul Default"}
                        className="w-full text-xs sm:text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50 transition"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-700">
                          Caption Khusus {platLabel}
                        </label>
                        <span className="text-[11px] font-mono text-slate-400">
                          {ov.caption.length} / 2200
                        </span>
                      </div>
                      <textarea
                        disabled={isCancelled || allPublished}
                        value={ov.caption}
                        onChange={(e) => updateOv("caption", e.target.value)}
                        maxLength={2200}
                        rows={4}
                        placeholder={caption || "Mengikuti Caption Default"}
                        className="w-full text-xs sm:text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50 transition resize-none leading-relaxed"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700 block">
                        Hashtag Khusus {platLabel}
                      </label>
                      <input
                        type="text"
                        disabled={isCancelled || allPublished}
                        value={ov.hashtags}
                        onChange={(e) => updateOv("hashtags", e.target.value)}
                        placeholder={hashtags || "Mengikuti Hashtag Default"}
                        className="w-full text-xs sm:text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50 transition font-mono"
                      />
                    </div>
                  </div>
                );
              })()
            )}

            {/* Submit Button */}
            {!isCancelled && !allPublished && (
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-xs transition disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Menyimpan Perubahan...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Simpan Perubahan
                    </>
                  )}
                </button>
              </div>
            )}
          </form>
        </div>
      </div>

      {/* Target Status Cards per Platform */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-600" />
            Status Publikasi Per Platform
          </h3>
          <span className="text-xs text-slate-400">Diproses otomatis oleh worker laptop</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {post.targets.map((target) => {
            const isFailed =
              target.status === "failed" ||
              target.status === "missed" ||
              target.hold_reason !== null ||
              target.last_error_code !== null;
            const isPublished = target.status === "published";
            const isUploading = target.status === "uploading";
            const isAwaiting = target.status === "awaiting_platform";
            const isRetrying = retryingTargetId === target.id;

            return (
              <div
                key={target.id}
                className={`p-4 rounded-xl border flex flex-col justify-between space-y-4 transition ${
                  isPublished
                    ? "border-emerald-200 bg-emerald-50/30"
                    : isFailed
                    ? "border-rose-200 bg-rose-50/30"
                    : isUploading
                    ? "border-blue-200 bg-blue-50/30"
                    : "border-slate-200 bg-slate-50/50"
                }`}
              >
                <div className="space-y-3">
                  {/* Platform Brand Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {target.platform === "youtube" ? (
                        <div className="w-7 h-7 rounded-lg bg-red-600 text-white flex items-center justify-center shadow-xs">
                          <Youtube className="w-4 h-4" />
                        </div>
                      ) : target.platform === "instagram" ? (
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 text-white flex items-center justify-center shadow-xs">
                          <Instagram className="w-4 h-4" />
                        </div>
                      ) : (
                        <div className="w-7 h-7 rounded-lg bg-slate-900 text-cyan-300 flex items-center justify-center font-black text-xs shadow-xs">
                          TT
                        </div>
                      )}
                      <div>
                        <span className="font-bold text-xs text-slate-900">
                          {target.platform === "youtube"
                            ? "YouTube Shorts"
                            : target.platform === "instagram"
                            ? "Instagram Reels"
                            : "TikTok (Buffer)"}
                        </span>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <span
                      className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold border inline-flex items-center gap-1 ${
                        isPublished
                          ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                          : isUploading
                          ? "bg-blue-100 text-blue-800 border-blue-300"
                          : isAwaiting
                          ? "bg-purple-100 text-purple-800 border-purple-300"
                          : isFailed
                          ? "bg-rose-100 text-rose-800 border-rose-300"
                          : "bg-slate-100 text-slate-700 border-slate-200"
                      }`}
                    >
                      {isPublished && <CheckCircle2 className="w-3 h-3 text-emerald-600" />}
                      {isUploading && <RefreshCw className="w-3 h-3 animate-spin text-blue-600" />}
                      {isAwaiting && <Clock className="w-3 h-3 text-purple-600" />}
                      {isFailed && <AlertCircle className="w-3 h-3 text-rose-600" />}
                      {target.status}
                    </span>
                  </div>

                  {/* Step & Details */}
                  <div className="text-xs space-y-1.5 text-slate-600 bg-white/70 rounded-lg p-2.5 border border-slate-100">
                    {target.step && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Langkah:</span>
                        <span className="font-mono text-[11px] font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                          {target.step}
                        </span>
                      </div>
                    )}
                    {target.external_id && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">ID Post:</span>
                        <span
                          className="font-mono text-[10px] text-indigo-700 truncate max-w-[140px]"
                          title={target.external_id}
                        >
                          {target.external_id}
                        </span>
                      </div>
                    )}
                    {target.pending_action && (
                      <div className="text-amber-700 text-[11px] font-medium flex items-center gap-1 pt-1">
                        <Clock className="w-3 h-3 text-amber-500" />
                        Tindakan: {target.pending_action}
                      </div>
                    )}
                    {target.published_at && (
                      <div className="text-emerald-700 text-[11px] font-medium flex items-center gap-1 pt-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                        Rilis: {new Date(target.published_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} WIB
                      </div>
                    )}
                  </div>

                  {/* Error Notification Box */}
                  {target.last_error_message && (
                    <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-medium space-y-0.5">
                      <div className="font-bold flex items-center gap-1 text-rose-800">
                        <AlertTriangle className="w-3 h-3 text-rose-600" />
                        Galat Upload:
                      </div>
                      <p className="line-clamp-2 leading-relaxed">{target.last_error_message}</p>
                    </div>
                  )}
                </div>

                {/* Retry Button for Failed or Held Targets */}
                {isFailed && !isPublished && (
                  <button
                    type="button"
                    disabled={isRetrying}
                    onClick={() => handleRetryTarget(target.id)}
                    className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 active:bg-black text-white text-xs font-semibold rounded-lg transition inline-flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? "animate-spin" : ""}`} />
                    {isRetrying ? "Menjadwalkan Ulang..." : "Coba Lagi Target Ini"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Target Events Timeline (Audit Log) */}
      {post.events && post.events.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-600" />
              Riwayat Peristiwa (Audit Log)
            </h3>
            <span className="text-xs text-slate-400">{post.events.length} kejadian tercatat</span>
          </div>

          <div className="relative pl-4 border-l-2 border-slate-200 space-y-4">
            {post.events.map((ev) => (
              <div key={ev.id} className="relative group">
                {/* Dot marker */}
                <div className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full bg-indigo-500 border-2 border-white ring-2 ring-slate-100 group-hover:bg-indigo-600 transition"></div>

                <div className="bg-slate-50/70 hover:bg-slate-50 rounded-xl p-3 border border-slate-100 transition space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900">{ev.event}</span>
                      {ev.from_status && ev.to_status && (
                        <span className="text-slate-500 font-mono text-[11px] bg-white px-1.5 py-0.5 rounded border border-slate-200">
                          {ev.from_status} &rarr; {ev.to_status}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] font-mono text-slate-400">
                      {new Date(ev.created_at).toLocaleTimeString("id-ID")} WIB
                    </span>
                  </div>

                  {ev.detail && Object.keys(ev.detail).length > 0 && (
                    <div className="text-[11px] text-slate-500 font-mono truncate">
                      {JSON.stringify(ev.detail)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
