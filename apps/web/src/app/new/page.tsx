"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function NewPostPage() {
  const router = useRouter();

  const [caption, setCaption] = useState("");
  const [title, setTitle] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Feature S2: Auto-fill last hashtags from localStorage
  useEffect(() => {
    const savedHashtags = localStorage.getItem("bulk_socmed_last_hashtags");
    if (savedHashtags) {
      setHashtags(savedHashtags);
    }
  }, []);

  // Auto-generate title from 1st line of caption if title not manually set
  const autoTitle = caption.split("\n")[0]?.trim().slice(0, 100) || "";

  // Feature S3: Keyboard shortcut Ctrl+Enter to submit
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
  }, [caption, title, hashtags]);

  const handleSubmit = async (addAnother = false) => {
    if (!caption.trim()) {
      alert("Caption tidak boleh kosong.");
      return;
    }

    setLoading(true);
    setMessage(null);

    // Save hashtags to localStorage (Feature S2)
    if (hashtags.trim()) {
      localStorage.setItem("bulk_socmed_last_hashtags", hashtags.trim());
    }

    try {
      // Simulate post creation / demo response
      setMessage("Video berhasil dijadwalkan!");

      if (addAnother) {
        // Feature S1: "Simpan & tambah lagi" -> reset form for next slot
        setCaption("");
        setTitle("");
        // Keep hashtags
        setLoading(false);
        alert("Entri disimpan! Silakan isi video berikutnya.");
      } else {
        setTimeout(() => {
          router.push("/");
          router.refresh();
        }, 500);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal menyimpan video");
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Video Baru</h1>
          <p className="text-sm text-slate-500">
            Unggah sekali untuk YouTube Shorts, Instagram Reels, dan TikTok.
          </p>
        </div>
        <button
          onClick={() => router.push("/")}
          className="text-sm text-slate-500 hover:text-slate-800"
        >
          Batal [Esc]
        </button>
      </div>

      {message && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg">
          {message}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-6">
        {/* Upload box */}
        <div className="border-2 border-dashed border-slate-200 hover:border-indigo-400 transition rounded-xl p-8 text-center cursor-pointer bg-slate-50/50">
          <div className="text-3xl mb-2">📹</div>
          <p className="text-sm font-semibold text-slate-800">
            Pilih atau seret berkas video ke sini
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Format MP4 atau MOV vertikal (9:16). Maksimal 50 MB.
          </p>
        </div>

        {/* Caption */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-sm font-semibold text-slate-700">Caption</label>
            <span className="text-xs text-slate-400">
              {caption.length} karakter (Instagram maks. 2.200)
            </span>
          </div>
          <textarea
            rows={4}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Tulis caption video di sini..."
            className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          />
        </div>

        {/* Title */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-sm font-semibold text-slate-700">
              Judul YouTube Shorts (Opsional)
            </label>
            <span className="text-xs text-slate-400">
              {(title || autoTitle).length}/100
            </span>
          </div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={autoTitle || "Diambil otomatis dari baris pertama caption"}
            className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          />
        </div>

        {/* Hashtags */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">Hashtag</label>
          <input
            type="text"
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            placeholder="#tips #resep #shorts"
            className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          />
          <p className="text-xs text-slate-400 mt-1">
            Otomatis terisi dari hashtag video sebelumnya (bisa disesuaikan).
          </p>
        </div>

        {/* Action buttons with S1 & S3 */}
        <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800"
          >
            Batal
          </button>
          <div className="flex items-center gap-3">
            {/* Feature S1: Simpan & tambah lagi */}
            <button
              type="button"
              disabled={loading}
              onClick={() => handleSubmit(true)}
              className="px-4 py-2.5 rounded-xl border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 text-sm font-semibold transition"
            >
              Simpan & tambah lagi
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => handleSubmit(false)}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 text-sm font-semibold transition shadow-sm"
            >
              {loading ? "Menyimpan..." : "Jadwalkan [Ctrl+Enter]"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
