"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MAX_VIDEO_SIZE_BYTES, MAX_VIDEO_SIZE_MB } from "@bulk-socmed/shared";
import {
  UploadCloud,
  Calendar,
  Sparkles,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Hash,
  FileVideo,
  X,
  Youtube,
  Instagram,
  Check,
  RotateCcw,
  Copy,
  Image as ImageIcon,
} from "lucide-react";

type Platform = "youtube" | "instagram" | "tiktok";

interface PlatformOverride {
  title: string;
  caption: string;
  hashtags: string;
}

interface ConnectionInfo {
  platform: Platform;
  status: string;
  display_name?: string | null;
}

const ALL_PLATFORMS: Platform[] = ["youtube", "instagram", "tiktok"];

const PLATFORM_META: Record<
  Platform,
  { label: string; shortLabel: string; desc: string }
> = {
  youtube: {
    label: "YouTube Shorts",
    shortLabel: "YouTube",
    desc: "Judul max 100 karakter + deskripsi",
  },
  instagram: {
    label: "Instagram Reels",
    shortLabel: "Instagram",
    desc: "Caption & hashtag Reels",
  },
  tiktok: {
    label: "TikTok",
    shortLabel: "TikTok",
    desc: "Caption & hashtag langsung via TikTok API",
  },
};

export default function NewPostPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const [thumbPreview, setThumbPreview] = useState<string | null>(null);

  // Selected target platforms
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([
    "youtube",
    "instagram",
    "tiktok",
  ]);
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);

  // Global (default) metadata
  const [caption, setCaption] = useState("");
  const [title, setTitle] = useState("");
  const [hashtags, setHashtags] = useState("");

  // Per-platform overrides
  const [activeTab, setActiveTab] = useState<"default" | Platform>("default");
  const [overrides, setOverrides] = useState<Record<Platform, PlatformOverride>>({
    youtube: { title: "", caption: "", hashtags: "" },
    instagram: { title: "", caption: "", hashtags: "" },
    tiktok: { title: "", caption: "", hashtags: "" },
  });

  const [scheduleMode, setScheduleMode] = useState<"next_free" | "exact">("next_free");
  const [exactDate, setExactDate] = useState("");
  const [exactTime, setExactTime] = useState("06:00");

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Auto-fill last hashtags & fetch connection statuses
  useEffect(() => {
    const saved = localStorage.getItem("bulk_socmed_last_hashtags");
    if (saved) setHashtags(saved);

    fetch("/api/v1/connections")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.items) setConnections(data.items);
      })
      .catch(() => {});
  }, []);

  // Switch back to default tab if active platform tab is unselected
  useEffect(() => {
    if (activeTab !== "default" && !selectedPlatforms.includes(activeTab)) {
      setActiveTab("default");
    }
  }, [selectedPlatforms, activeTab]);

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
  }, [
    caption,
    title,
    hashtags,
    videoFile,
    scheduleMode,
    exactDate,
    exactTime,
    selectedPlatforms,
    overrides,
  ]);

  const autoTitle = caption.split("\n")[0]?.trim().slice(0, 100) || "";

  const togglePlatform = (platform: Platform) => {
    setSelectedPlatforms((prev) => {
      if (prev.includes(platform)) {
        if (prev.length === 1) {
          setErrorMsg("Minimal satu platform tujuan harus dipilih.");
          return prev;
        }
        setErrorMsg(null);
        return prev.filter((p) => p !== platform);
      }
      setErrorMsg(null);
      return ALL_PLATFORMS.filter((p) => p === platform || prev.includes(p));
    });
  };

  const updateOverride = (
    platform: Platform,
    field: keyof PlatformOverride,
    value: string
  ) => {
    setOverrides((prev) => ({
      ...prev,
      [platform]: {
        ...prev[platform],
        [field]: value,
      },
    }));
  };

  const hasCustomOverride = (platform: Platform) => {
    const ov = overrides[platform];
    return Boolean(ov.title.trim() || ov.caption.trim() || ov.hashtags.trim());
  };

  const copyDefaultToPlatform = (platform: Platform) => {
    setOverrides((prev) => ({
      ...prev,
      [platform]: {
        title: title || autoTitle,
        caption,
        hashtags,
      },
    }));
  };

  const resetPlatformOverride = (platform: Platform) => {
    setOverrides((prev) => ({
      ...prev,
      [platform]: { title: "", caption: "", hashtags: "" },
    }));
  };

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith("video/")) {
      setErrorMsg("Harap pilih berkas video (format MP4 atau MOV).");
      return;
    }
    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      const limitLabel = MAX_VIDEO_SIZE_MB >= 1024 ? `${MAX_VIDEO_SIZE_MB / 1024} GB` : `${MAX_VIDEO_SIZE_MB} MB`;
      setErrorMsg(`Ukuran video melebihi batas ${limitLabel}.`);
      return;
    }
    setErrorMsg(null);
    setVideoFile(file);
    const url = URL.createObjectURL(file);
    setVideoPreview(url);
  };

  const handleThumbSelect = (file: File) => {
    if (file.type !== "image/jpeg" && file.type !== "image/png") {
      setErrorMsg("Thumbnail/Cover hanya mendukung format gambar JPG atau PNG.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setErrorMsg("Ukuran thumbnail melebihi batas 8 MB.");
      return;
    }
    setErrorMsg(null);
    setThumbFile(file);
    setThumbPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (addAnother = false) => {
    if (!videoFile) {
      setErrorMsg("Harap pilih berkas video terlebih dahulu.");
      return;
    }
    if (selectedPlatforms.length === 0) {
      setErrorMsg("Pilih minimal satu platform tujuan.");
      return;
    }

    // Resolve global fallback caption if user only filled per-platform captions
    const firstCustomCaption = selectedPlatforms
      .map((p) => overrides[p].caption.trim())
      .find((c) => c.length > 0);
    const effectiveGlobalCaption = caption.trim() || firstCustomCaption || "";

    if (!effectiveGlobalCaption) {
      setErrorMsg(
        "Caption tidak boleh kosong. Isi Caption Default atau isi Caption pada masing-masing platform yang dipilih."
      );
      return;
    }

    // Check if every selected platform has at least a global or custom caption
    const missingCaptionPlatform = selectedPlatforms.find(
      (p) => !caption.trim() && !overrides[p].caption.trim()
    );
    if (missingCaptionPlatform) {
      setErrorMsg(
        `Caption untuk ${PLATFORM_META[missingCaptionPlatform].label} masih kosong (karena Caption Default juga kosong).`
      );
      return;
    }

    setUploading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

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
      const uploadId = uploadData.upload_id;
      const signedUploadUrl =
        uploadData.upload?.url || uploadData.signed_upload_url || uploadData.signedUrl;

      if (!signedUploadUrl) {
        throw new Error("Gagal memperoleh URL unggah dari server.");
      }

      // 2. Upload file directly to cloud storage signed URL (Cloudflare R2 / fallback)
      setUploadProgress("Mengunggah video ke penyimpanan cloud...");
      const contentType = videoFile.type || "video/mp4";
      const putRes = await fetch(signedUploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
        },
        body: videoFile,
      });

      if (!putRes.ok) {
        const errorText = await putRes.text().catch(() => "");
        throw new Error(
          `Gagal mentransfer video ke penyimpanan cloud (${putRes.status}: ${errorText || putRes.statusText})`
        );
      }

      // 2b. Upload optional thumbnail / cover
      let thumbnailUploadId: string | undefined;
      if (thumbFile) {
        setUploadProgress("Mengunggah thumbnail / cover...");
        const thumbInitRes = await fetch("/api/v1/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "thumbnail",
            filename: thumbFile.name,
            size_bytes: thumbFile.size,
            content_type: thumbFile.type,
          }),
        });
        if (!thumbInitRes.ok) {
          const err = await thumbInitRes.json();
          throw new Error(err.error?.message || "Gagal menginisialisasi unggahan thumbnail.");
        }
        const thumbData = await thumbInitRes.json();
        const thumbUrl =
          thumbData.upload?.url || thumbData.signed_upload_url || thumbData.signedUrl;
        if (!thumbUrl) {
          throw new Error("URL unggah thumbnail tidak valid.");
        }
        const thumbPutRes = await fetch(thumbUrl, {
          method: "PUT",
          headers: { "Content-Type": thumbFile.type },
          body: thumbFile,
        });
        if (!thumbPutRes.ok) {
          throw new Error("Gagal mentransfer thumbnail ke penyimpanan cloud.");
        }
        thumbnailUploadId = thumbData.upload_id;
      }

      // 3. Build per-platform overrides payload (only for selected platforms with custom values)
      const platformOverridesPayload: Record<string, Partial<PlatformOverride>> = {};
      for (const plat of selectedPlatforms) {
        const ov = overrides[plat];
        const entry: Partial<PlatformOverride> = {};
        if (ov.title.trim()) entry.title = ov.title.trim();
        if (ov.caption.trim()) entry.caption = ov.caption.trim();
        if (ov.hashtags.trim()) entry.hashtags = ov.hashtags.trim();
        if (Object.keys(entry).length > 0) {
          platformOverridesPayload[plat] = entry;
        }
      }

      // 4. Create scheduled post
      setUploadProgress("Menjadwalkan rilis video...");
      const fallbackAutoTitle = effectiveGlobalCaption.split("\n")[0]?.trim().slice(0, 100) || "";
      const resolvedTitle = (title || fallbackAutoTitle).trim();

      const postBody: any = {
        video_upload_id: uploadId,
        ...(thumbnailUploadId ? { thumbnail_upload_id: thumbnailUploadId } : {}),
        ...(resolvedTitle ? { title: resolvedTitle } : {}),
        caption: effectiveGlobalCaption,
        hashtags: hashtags.trim(),
        platforms: selectedPlatforms,
        ...(Object.keys(platformOverridesPayload).length > 0
          ? { platform_overrides: platformOverridesPayload }
          : {}),
        mode: "schedule",
      };

      if (scheduleMode === "exact" && exactDate && exactTime) {
        const standardSlots = ["06:00", "12:00", "16:00", "19:00"];
        if (standardSlots.includes(exactTime)) {
          postBody.schedule = {
            type: "slot",
            slot_key: `${exactDate}@${exactTime}`,
          };
        } else {
          postBody.schedule = {
            type: "custom",
            due_at: new Date(`${exactDate}T${exactTime}:00+07:00`).toISOString(),
          };
        }
      } else {
        postBody.schedule = {
          type: "next_free",
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

      setSuccessMsg(
        `Video berhasil dijadwalkan ke ${selectedPlatforms
          .map((p) => PLATFORM_META[p].shortLabel)
          .join(", ")}!`
      );

      if (addAnother) {
        setVideoFile(null);
        setVideoPreview(null);
        setThumbFile(null);
        setThumbPreview(null);
        setCaption("");
        setTitle("");
        setOverrides({
          youtube: { title: "", caption: "", hashtags: "" },
          instagram: { title: "", caption: "", hashtags: "" },
          tiktok: { title: "", caption: "", hashtags: "" },
        });
        setActiveTab("default");
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

  const renderPlatformIcon = (platform: Platform, active: boolean) => {
    if (platform === "youtube") {
      return (
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
            active ? "bg-rose-600 text-white" : "bg-slate-200 text-slate-500"
          }`}
        >
          <Youtube className="w-4 h-4" />
        </div>
      );
    }
    if (platform === "instagram") {
      return (
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
            active
              ? "bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 text-white"
              : "bg-slate-200 text-slate-500"
          }`}
        >
          <Instagram className="w-4 h-4" />
        </div>
      );
    }
    return (
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs shrink-0 ${
          active ? "bg-slate-900 text-cyan-300" : "bg-slate-200 text-slate-500"
        }`}
      >
        TT
      </div>
    );
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
            Pilih platform tujuan dan atur judul, caption, serta hashtag secara seragam atau berbeda tiap platform.
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
        {/* 1. Upload Zone */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
            1. Berkas Video
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
                Format vertikal 9:16 (MP4 atau MOV). Maksimal{" "}
                {MAX_VIDEO_SIZE_MB >= 1024 ? `${MAX_VIDEO_SIZE_MB / 1024} GB` : `${MAX_VIDEO_SIZE_MB} MB`}.
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

          {/* Optional Thumbnail / Cover Upload */}
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-indigo-600" />
                Thumbnail / Cover Video (Opsional)
              </label>
              <span className="text-[11px] text-slate-400">JPG atau PNG, maks. 8 MB</span>
            </div>
            <input
              ref={thumbInputRef}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleThumbSelect(file);
              }}
            />
            {!thumbFile ? (
              <button
                type="button"
                onClick={() => thumbInputRef.current?.click()}
                className="w-full py-3 px-4 rounded-xl border border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/30 transition flex items-center justify-center gap-2 text-xs font-medium text-slate-600 cursor-pointer bg-slate-50/40"
              >
                <ImageIcon className="w-4 h-4 text-slate-400" />
                <span>Pilih Gambar Thumbnail / Cover (IG Reels &amp; YouTube)</span>
              </button>
            ) : (
              <div className="border border-slate-200 rounded-xl p-3 bg-slate-50 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {thumbPreview && (
                    <img
                      src={thumbPreview}
                      alt="Pratinjau Thumbnail"
                      className="w-10 h-14 object-cover rounded-lg border border-slate-200 shrink-0 bg-slate-900"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 truncate">{thumbFile.name}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {(thumbFile.size / (1024 * 1024)).toFixed(2)} MB &bull; {thumbFile.type}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setThumbFile(null);
                    setThumbPreview(null);
                    if (thumbInputRef.current) thumbInputRef.current.value = "";
                  }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-200/60 transition shrink-0"
                  title="Hapus thumbnail"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 2. Target Platform Selection */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              2. Pilih Platform Tujuan ({selectedPlatforms.length} dipilih)
            </label>
            <button
              type="button"
              onClick={() => setSelectedPlatforms(ALL_PLATFORMS)}
              className="text-[11px] font-medium text-indigo-600 hover:underline cursor-pointer"
            >
              Pilih Semua
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {ALL_PLATFORMS.map((plat) => {
              const isSelected = selectedPlatforms.includes(plat);
              const conn = connections.find((c) => c.platform === plat);
              const isConnected = conn?.status === "active";

              return (
                <button
                  key={plat}
                  type="button"
                  onClick={() => togglePlatform(plat)}
                  className={`relative p-3.5 rounded-xl border text-left transition flex items-start gap-3 cursor-pointer ${
                    isSelected
                      ? "bg-indigo-50/40 border-indigo-600 ring-2 ring-indigo-500/15 shadow-2xs"
                      : "bg-slate-50/60 border-slate-200 text-slate-500 hover:bg-white"
                  }`}
                >
                  {renderPlatformIcon(plat, isSelected)}

                  <div className="min-w-0 flex-1 pr-5">
                    <p
                      className={`text-xs font-bold ${
                        isSelected ? "text-slate-900" : "text-slate-600"
                      }`}
                    >
                      {PLATFORM_META[plat].label}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                      {conn?.display_name
                        ? conn.display_name
                        : isConnected
                        ? "Akun terhubung"
                        : "Belum terhubung"}
                    </p>
                  </div>

                  {/* Checkbox badge */}
                  <span
                    className={`absolute top-3 right-3 w-5 h-5 rounded-md border flex items-center justify-center transition ${
                      isSelected
                        ? "bg-indigo-600 border-indigo-600 text-white"
                        : "bg-white border-slate-300 text-transparent"
                    }`}
                  >
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Metadata Tabs (Default vs Per Platform) */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              3. Judul, Caption &amp; Hashtag
            </label>
            <span className="text-[11px] text-slate-400">
              Pilih tab platform bila ingin membedakan teks tiap media sosial
            </span>
          </div>

          {/* Tab Navigation */}
          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200/60">
            <button
              type="button"
              onClick={() => setActiveTab("default")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                activeTab === "default"
                  ? "bg-white text-slate-900 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Semua (Default)
            </button>

            {selectedPlatforms.map((plat) => {
              const isCustom = hasCustomOverride(plat);
              return (
                <button
                  key={plat}
                  type="button"
                  onClick={() => setActiveTab(plat)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    activeTab === plat
                      ? "bg-white text-indigo-700 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <span>{PLATFORM_META[plat].shortLabel}</span>
                  {isCustom && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-indigo-600"
                      title="Memiliki teks khusus"
                    />
                  )}
                </button>
              );
            })}
          </div>

          {activeTab === "default" ? (
            <div className="space-y-4 p-4 rounded-xl border border-slate-200/80 bg-slate-50/30">
              {/* Default Caption */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Caption Default
                  </label>
                  <span
                    className={`text-[11px] ${
                      caption.length > 2200 ? "text-rose-600 font-bold" : "text-slate-400"
                    }`}
                  >
                    {caption.length} / 2.200 karakter
                  </span>
                </div>
                <textarea
                  rows={4}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Tulis caption utama (dipakai oleh semua platform yang tidak dikustomisasi)..."
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white transition"
                />
              </div>

              {/* Default Title */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Judul Default (YouTube Shorts &amp; Label Antrean)
                  </label>
                  <span className="text-[11px] text-slate-400">
                    {(title || autoTitle).length} / 100 karakter
                  </span>
                </div>
                <input
                  type="text"
                  maxLength={100}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={autoTitle || "Otomatis diambil dari baris pertama caption"}
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white transition"
                />
              </div>

              {/* Default Hashtags */}
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Hash className="w-3.5 h-3.5 text-slate-500" />
                  <label className="text-xs font-semibold text-slate-700">
                    Hashtags Default
                  </label>
                </div>
                <input
                  type="text"
                  value={hashtags}
                  onChange={(e) => setHashtags(e.target.value)}
                  placeholder="#shorts #reels #tiktok #viral"
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white transition"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Hashtag default otomatis tersimpan untuk video berikutnya.
                </p>
              </div>
            </div>
          ) : (
            (() => {
              const plat = activeTab;
              const ov = overrides[plat];
              return (
                <div className="space-y-4 p-4 rounded-xl border border-indigo-200 bg-indigo-50/20">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-indigo-100">
                    <div>
                      <p className="text-xs font-bold text-indigo-950">
                        Kustomisasi Khusus {PLATFORM_META[plat].label}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Kosongkan bagian tertentu bila tetap ingin mengikuti teks Default.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => copyDefaultToPlatform(plat)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-medium text-slate-700 cursor-pointer"
                      >
                        <Copy className="w-3 h-3" />
                        Salin Default
                      </button>
                      {hasCustomOverride(plat) && (
                        <button
                          type="button"
                          onClick={() => resetPlatformOverride(plat)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-[11px] font-medium text-rose-600 cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Reset
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Platform Title */}
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="text-xs font-semibold text-slate-700">
                        Judul Khusus {PLATFORM_META[plat].shortLabel} (Opsional)
                      </label>
                      <span className="text-[11px] text-slate-400">
                        {ov.title.length} / 100 karakter
                      </span>
                    </div>
                    <input
                      type="text"
                      maxLength={100}
                      value={ov.title}
                      onChange={(e) => updateOverride(plat, "title", e.target.value)}
                      placeholder={
                        title || autoTitle || "Mengikuti Judul Default jika dikosongkan"
                      }
                      className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white transition"
                    />
                  </div>

                  {/* Platform Caption */}
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="text-xs font-semibold text-slate-700">
                        Caption Khusus {PLATFORM_META[plat].shortLabel}
                      </label>
                      <span className="text-[11px] text-slate-400">
                        {ov.caption.length} / 2.200 karakter
                      </span>
                    </div>
                    <textarea
                      rows={4}
                      value={ov.caption}
                      onChange={(e) => updateOverride(plat, "caption", e.target.value)}
                      placeholder={
                        caption
                          ? `Mengikuti Default: "${caption.slice(0, 80)}${caption.length > 80 ? "..." : ""}"`
                          : `Tulis caption khusus untuk ${PLATFORM_META[plat].label}...`
                      }
                      className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white transition"
                    />
                  </div>

                  {/* Platform Hashtags */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Hash className="w-3.5 h-3.5 text-slate-500" />
                      <label className="text-xs font-semibold text-slate-700">
                        Hashtag Khusus {PLATFORM_META[plat].shortLabel}
                      </label>
                    </div>
                    <input
                      type="text"
                      value={ov.hashtags}
                      onChange={(e) => updateOverride(plat, "hashtags", e.target.value)}
                      placeholder={
                        hashtags
                          ? `Mengikuti Default: ${hashtags}`
                          : `#${plat === "youtube" ? "shorts" : plat === "instagram" ? "reels" : "fyp"}`
                      }
                      className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white transition"
                    />
                  </div>
                </div>
              );
            })()
          )}
        </div>

        {/* 4. Schedule Mode */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/60 space-y-3">
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
            4. Pengaturan Jadwal Tayang
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
              Simpan &amp; tambah lagi
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
