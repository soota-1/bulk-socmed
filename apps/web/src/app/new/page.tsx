"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  UploadCloud,
  Film,
  Calendar,
  Sparkles,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Hash,
  FileVideo,
  X,
} from "lucide-react";

export default function NewPostPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [title, setTitle] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [scheduleMode, setScheduleMode] = useState<"next_free" | "exact">("next_free");
  const [exactDate, setExactDate] = useState("");
  const [exactTime, setExactTime] = useState("06:00");

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Auto-fill last hashtags from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("bulk_socmed_last_hashtags");
    if (saved) setHashtags(saved);
  }, []);

  // Keyboard shortcut Ctrl+Enter to submit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit(false);
      }
      if (e.key === "Escape") {
        router.push("/");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [caption, title, hashtags, videoFile, scheduleMode, exactDate, exactTime]);

  const autoTitle = caption.split("\n")[0]?.trim().slice(0, 100) || "";

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith("video/")) {
      setErrorMsg("Harap pilih berkas video (format MP4 atau MOV).");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setErrorMsg("Ukuran video melebihi batas 50 MB.");
      return;
    }
    setErrorMsg(null);
    setVideoFile(file);
    const url = URL.createObjectURL(file);
    setVideoPreview(url);
  };

  const handleSubmit = async (addAnother = false) => {
    if (!videoFile) {
      setErrorMsg("Harap pilih berkas video terlebih dahulu.");
      return;
    }
    if (!caption.trim()) {
      setErrorMsg("Caption tidak boleh kosong.");
      return;
    }

    setUploading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    // Save hashtags
    if (hashtags.trim()) {
      localStorage.setItem("bulk_socmed_last_hashtags", hashtags.trim());
    }

    try {
      // 1. Request signed upload URL
      setUploadProgress("Menyiapkan unggahan...");
      const initRes = await fetch("/api/v1/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "video",
          filename: videoFile.name,
          size_bytes: videoFile.size,
          content_type: videoFile.type || "video/mp4",
        }),
      });

      if (!initRes.ok) {
        const err = await initRes.json();
        throw new Error(err.error?.message || "Gagal menginisialisasi unggahan.");
      }

      const uploadData = await initRes.json();
      const { upload_id, signed_upload_url } = uploadData;

      // 2. Upload file to Supabase Storage signed URL
      setUploadProgress("Mengunggah video ke penyimpanan...");
      const putRes = await fetch(signed_upload_url, {
        method: "PUT",
        headers: {
          "Content-Type": videoFile.type || "video/mp4",
        },
        body: videoFile,
      });

      if (!putRes.ok) {
        throw new Error("Gagal mentransfer video ke penyimpanan cloud.");
      }

      // 3. Create scheduled post
      setUploadProgress("Menjadwalkan rilis video...");
      const postBody: any = {
        video_upload_id: upload_id,
        title: (title || autoTitle).trim() || null,
        caption: caption.trim(),
        hashtags: hashtags.trim(),
        mode: scheduleMode === "exact" ? "exact" : "next_free",
      };

      if (scheduleMode === "exact" && exactDate && exactTime) {
        postBody.schedule = {
          date: exactDate,
          time: exactTime,
        };
      }

      const createRes = await fetch("/api/v1/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postBody),
      });

      if (!createRes.ok) {
        const err = await createRes.json();
        throw new Error(err.error?.message || "Gagal membuat entri penjadwalan.");
      }

      setSuccessMsg("Video berhasil dijadwalkan!");

      if (addAnother) {
        // Reset form for next video, keep hashtags
        setVideoFile(null);
        setVideoPreview(null);
        setCaption("");
        setTitle("");
        setUploading(false);
        setUploadProgress("");
      } else {
        setTimeout(() => {
          router.push("/");
          router.refresh();
        }, 800);
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Terjadi kesalahan saat memproses video.");
      setUploading(false);
      setUploadProgress("");
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
        <div>
          <Link
            href="/"
            className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1 mb-1 font-medium"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Kembali ke Antrean
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Jadwalkan Video Baru</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Unggah sekali untuk didistribusikan ke YouTube Shorts, Instagram Reels, dan TikTok.
          </p>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm flex items-center gap-2.5 shadow-2xs">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs sm:text-sm flex items-center gap-2.5 shadow-2xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Form Container */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 sm:p-7 shadow-xs space-y-6">
        {/* Upload Zone */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
            Berkas Video
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
            }}
          />

          {!videoFile ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) handleFileSelect(file);
              }}
              className="border-2 border-dashed border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/20 transition-all rounded-2xl p-8 sm:p-10 text-center cursor-pointer bg-slate-50/50 group"
            >
              <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 group-hover:scale-110 transition-transform">
                <UploadCloud className="w-6 h-6" />
              </div>
              <p className="text-sm font-bold text-slate-800">
                Pilih atau seret berkas video ke sini
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Format vertikal 9:16 (MP4 atau MOV). Maksimal 50 MB.
              </p>
            </div>
          ) : (
            <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-14 bg-slate-900 rounded-lg flex items-center justify-center text-white shrink-0">
                  <FileVideo className="w-5 h-5 text-indigo-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">{videoFile.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {(videoFile.size / (1024 * 1024)).toFixed(2)} MB &bull; {videoFile.type || "video/mp4"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setVideoFile(null);
                  setVideoPreview(null);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-200/60 transition shrink-0"
                title="Ganti video"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Caption */}
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              Caption
            </label>
            <span className={`text-[11px] ${caption.length > 2200 ? "text-rose-600 font-bold" : "text-slate-400"}`}>
              {caption.length} / 2.200 karakter
            </span>
          </div>
          <textarea
            rows={4}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Tulis caption menarik untuk video Anda..."
            className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50/50 focus:bg-white transition"
          />
        </div>

        {/* Title (YouTube Shorts) */}
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              Judul YouTube Shorts (Opsional)
            </label>
            <span className="text-[11px] text-slate-400">
              {(title || autoTitle).length} / 100 karakter
            </span>
          </div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={autoTitle || "Otomatis diambil dari baris pertama caption"}
            className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50/50 focus:bg-white transition"
          />
        </div>

        {/* Hashtags */}
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Hash className="w-3.5 h-3.5 text-slate-500" />
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              Hashtags
            </label>
          </div>
          <input
            type="text"
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            placeholder="#shorts #reels #tiktok #viral"
            className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50/50 focus:bg-white transition"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Hashtag otomatis tersimpan untuk video berikutnya.
          </p>
        </div>

        {/* Schedule Mode */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/60 space-y-3">
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
            Pengaturan Jadwal Tayang
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setScheduleMode("next_free")}
              className={`p-3 rounded-xl border text-left transition flex items-start gap-2.5 cursor-pointer ${
                scheduleMode === "next_free"
                  ? "bg-white border-indigo-600 ring-2 ring-indigo-500/20 text-slate-900 shadow-2xs"
                  : "bg-white/60 border-slate-200 text-slate-600 hover:bg-white"
              }`}
            >
              <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-slate-900">Slot Otomatis (Rekomendasi)</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Mengisi slot kosong berikutnya (06:00, 12:00, 16:00, atau 19:00 WIB).
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setScheduleMode("exact")}
              className={`p-3 rounded-xl border text-left transition flex items-start gap-2.5 cursor-pointer ${
                scheduleMode === "exact"
                  ? "bg-white border-indigo-600 ring-2 ring-indigo-500/20 text-slate-900 shadow-2xs"
                  : "bg-white/60 border-slate-200 text-slate-600 hover:bg-white"
              }`}
            >
              <Calendar className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-slate-900">Pilih Waktu Spesifik</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Tentukan tanggal dan jam tayang khusus.
                </p>
              </div>
            </button>
          </div>

          {scheduleMode === "exact" && (
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <input
                type="date"
                value={exactDate}
                onChange={(e) => setExactDate(e.target.value)}
                className="text-xs px-3 py-2 rounded-lg border border-slate-300 bg-white"
              />
              <input
                type="time"
                value={exactTime}
                onChange={(e) => setExactTime(e.target.value)}
                className="text-xs px-3 py-2 rounded-lg border border-slate-300 bg-white"
              />
              <span className="text-xs text-slate-500 font-medium">WIB</span>
            </div>
          )}
        </div>

        {/* Submit Actions */}
        <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
          <Link
            href="/"
            className="text-xs text-slate-500 hover:text-slate-800 transition order-2 sm:order-1"
          >
            Batal
          </Link>

          <div className="flex items-center gap-2.5 w-full sm:w-auto order-1 sm:order-2">
            <button
              type="button"
              disabled={uploading}
              onClick={() => handleSubmit(true)}
              className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl border border-indigo-200 text-indigo-700 bg-indigo-50/70 hover:bg-indigo-100 text-xs sm:text-sm font-semibold transition disabled:opacity-50 cursor-pointer"
            >
              Simpan & tambah lagi
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={() => handleSubmit(false)}
              className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs sm:text-sm font-semibold transition shadow-xs disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {uploading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  <span>{uploadProgress || "Memproses..."}</span>
                </>
              ) : (
                <span>Jadwalkan [Ctrl+Enter]</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
