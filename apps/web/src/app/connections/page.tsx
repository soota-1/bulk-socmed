"use client";

import { useEffect, useState, useTransition, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { Platform, ConnectionStatus } from "@bulk-socmed/shared";
import {
  Youtube,
  Instagram,
  Music2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ExternalLink,
  RefreshCw,
  Unplug,
  KeyRound,
  ShieldCheck,
  Check,
  X,
} from "lucide-react";

interface ConnectionItem {
  platform: Platform;
  status: ConnectionStatus;
  display_name: string | null;
  details: Record<string, any>;
  last_test?: {
    at: string;
    ok: boolean;
    error?: { code: string; message: string } | null;
  } | null;
}

function ConnectionsContent() {
  const searchParams = useSearchParams();
  const connectedParam = searchParams.get("connected");
  const errorParam = searchParams.get("error");

  const [connections, setConnections] = useState<ConnectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [testingPlatform, setTestingPlatform] = useState<string | null>(null);

  // TikTok Buffer modal state
  const [bufferApiKey, setBufferApiKey] = useState("");
  const [bufferChannels, setBufferChannels] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [bufferError, setBufferError] = useState<string | null>(null);

  async function loadConnections() {
    try {
      setLoading(true);
      const res = await fetch("/api/v1/connections");
      if (res.ok) {
        const data = await res.json();
        setConnections(data.items ?? []);
      }
    } catch {
      // Ignored
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConnections();
  }, []);

  async function handleOAuthAuthorize(platform: "youtube" | "instagram" | "tiktok") {
    try {
      setActionMessage({ type: "info", text: `Mengarahkan ke dialog masuk ${platform}...` });
      const res = await fetch(`/api/v1/connections/${platform}/authorize`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.authorize_url) {
        window.location.href = data.authorize_url;
      } else {
        setActionMessage({
          type: "error",
          text: `Gagal memulai OAuth: ${data.error?.message || "Pastikan kredensial di .env sudah benar"}`,
        });
      }
    } catch {
      setActionMessage({ type: "error", text: "Terjadi kesalahan koneksi jaringan." });
    }
  }

  async function handleTestConnection(platform: Platform) {
    try {
      setTestingPlatform(platform);
      setActionMessage({ type: "info", text: `Menguji koneksi ${platform}...` });
      const res = await fetch(`/api/v1/connections/${platform}/test`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.ok === false) {
          setActionMessage({
            type: "error",
            text: `Uji ${platform} gagal: ${data.error?.message || "Kredensial tidak valid"}`,
          });
        } else {
          setActionMessage({
            type: "success",
            text: data.message || `Uji koneksi ${platform} berhasil! Kredensial aktif dan terverifikasi.`,
          });
        }
        loadConnections();
      } else {
        const err = await res.json().catch(() => ({}));
        setActionMessage({ type: "error", text: `Uji gagal: ${err.error?.message || "Kesalahan server"}` });
      }
    } catch {
      setActionMessage({ type: "error", text: "Terjadi kesalahan jaringan saat menguji koneksi." });
    } finally {
      setTestingPlatform(null);
    }
  }

  async function handleDisconnect(platform: Platform) {
    if (!confirm(`Yakin ingin memutuskan koneksi ${platform}? Video terjadwal ke platform ini akan ditahan.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/v1/connections/${platform}`, {
        method: "DELETE",
      });
      if (res.ok || res.status === 204) {
        setActionMessage({ type: "success", text: `Koneksi ${platform} berhasil diputuskan.` });
        loadConnections();
      }
    } catch {
      setActionMessage({ type: "error", text: "Gagal memutuskan koneksi." });
    }
  }

  async function handleFetchBufferChannels() {
    if (!bufferApiKey.trim()) {
      setBufferError("Harap masukkan API key Buffer terlebih dahulu.");
      return;
    }
    setLoadingChannels(true);
    setBufferError(null);
    try {
      const res = await fetch("/api/v1/connections/tiktok", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buffer_api_key: bufferApiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBufferError(data.error?.message || "API key Buffer tidak valid atau ditolak.");
        return;
      }

      const chRes = await fetch("/api/v1/connections/tiktok/channels");
      const chData = await chRes.json();
      if (chRes.ok && chData.items?.length > 0) {
        setBufferChannels(chData.items);
        setSelectedChannelId(chData.items[0].id);
      } else {
        setBufferError("Tidak ditemukan channel TikTok di akun Buffer Anda. Hubungkan TikTok di buffer.com terlebih dahulu.");
      }
    } catch {
      setBufferError("Gagal menghubungi server Buffer.");
    } finally {
      setLoadingChannels(false);
    }
  }

  async function handleSaveTikTokChannel() {
    if (!selectedChannelId) {
      setBufferError("Pilih channel TikTok terlebih dahulu.");
      return;
    }
    setLoadingChannels(true);
    try {
      const res = await fetch("/api/v1/connections/tiktok", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buffer_api_key: bufferApiKey.trim(),
          buffer_channel_id: selectedChannelId,
        }),
      });
      if (res.ok) {
        setActionMessage({ type: "success", text: "Akun TikTok via Buffer berhasil terhubung!" });
        setBufferApiKey("");
        setBufferChannels([]);
        loadConnections();
      } else {
        const err = await res.json();
        setBufferError(err.error?.message || "Gagal menyimpan channel TikTok.");
      }
    } catch {
      setBufferError("Terjadi kesalahan jaringan.");
    } finally {
      setLoadingChannels(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-2 border-b border-slate-200/60">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Koneksi Akun Sosial Media</h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Hubungkan akun YouTube, Instagram, dan TikTok untuk distribusi video otomatis Rp0 biaya.
        </p>
      </div>

      {/* Notifications / Alerts */}
      {connectedParam && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs sm:text-sm font-medium flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Akun <strong>{connectedParam}</strong> berhasil dihubungkan!</span>
          </div>
          <button onClick={() => window.history.replaceState({}, "", "/connections")} className="text-emerald-700 hover:text-emerald-950">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {errorParam && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs sm:text-sm font-medium flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2">
            <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>Gagal menyambungkan akun: {decodeURIComponent(errorParam)}</span>
          </div>
          <button onClick={() => window.history.replaceState({}, "", "/connections")} className="text-rose-700 hover:text-rose-950">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {actionMessage && (
        <div
          className={`p-3.5 rounded-xl border text-xs sm:text-sm font-medium flex items-center justify-between gap-3 ${
            actionMessage.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : actionMessage.type === "error"
              ? "bg-rose-50 border-rose-200 text-rose-800"
              : "bg-indigo-50 border-indigo-200 text-indigo-800"
          }`}
        >
          <span>{actionMessage.text}</span>
          <button onClick={() => setActionMessage(null)} className="opacity-70 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Grid of Connections - 1 col on mobile, 3 cols on large desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ==================== 1. YouTube ==================== */}
        {(() => {
          const yt = connections.find((c) => c.platform === "youtube");
          const isConnected = yt?.status === "active";
          const needsReauth = yt?.status === "needs_reauth";

          return (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 flex flex-col justify-between shadow-xs hover:shadow-sm transition-shadow">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shadow-2xs">
                    <Youtube className="w-6 h-6" />
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold border ${
                      isConnected
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : needsReauth
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-slate-100 text-slate-500 border-slate-200"
                    }`}
                  >
                    {isConnected ? (
                      <>
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>Aktif</span>
                      </>
                    ) : needsReauth ? (
                      <>
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                        <span>Re-auth</span>
                      </>
                    ) : (
                      "Belum Terhubung"
                    )}
                  </span>
                </div>

                <div>
                  <h3 className="font-bold text-slate-900 text-base">YouTube Shorts</h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    {yt?.display_name ? (
                      <span className="font-semibold text-slate-800">Channel: {yt.display_name}</span>
                    ) : (
                      "Penerbitan otomatis langsung via YouTube Data API v3 dengan status publishAt atomik."
                    )}
                  </p>
                </div>

                {yt?.last_test && (
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-[11px] text-slate-600">
                    <span className="font-semibold">Uji Terakhir: </span>
                    {yt.last_test.ok ? (
                      <span className="text-emerald-700 font-medium">Berhasil ({new Date(yt.last_test.at).toLocaleTimeString("id-ID")})</span>
                    ) : (
                      <span className="text-rose-600">{yt.last_test.error?.message || "Gagal"}</span>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100">
                {!isConnected ? (
                  <button
                    onClick={() => handleOAuthAuthorize("youtube")}
                    className="w-full py-2.5 px-3.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white text-xs font-semibold transition shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Youtube className="w-4 h-4" />
                    <span>Hubungkan dengan Google</span>
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleTestConnection("youtube")}
                      disabled={testingPlatform === "youtube"}
                      className="flex-1 py-2 px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 transition flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${testingPlatform === "youtube" ? "animate-spin" : ""}`} />
                      <span>Uji</span>
                    </button>
                    <button
                      onClick={() => handleDisconnect("youtube")}
                      className="py-2 px-3 rounded-lg border border-rose-200 hover:bg-rose-50 text-xs font-medium text-rose-600 transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Unplug className="w-3.5 h-3.5" />
                      <span>Putuskan</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ==================== 2. Instagram ==================== */}
        {(() => {
          const ig = connections.find((c) => c.platform === "instagram");
          const isConnected = ig?.status === "active";
          const needsReauth = ig?.status === "needs_reauth";

          return (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 flex flex-col justify-between shadow-xs hover:shadow-sm transition-shadow">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 flex items-center justify-center text-white shadow-2xs">
                    <Instagram className="w-6 h-6" />
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold border ${
                      isConnected
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : needsReauth
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-slate-100 text-slate-500 border-slate-200"
                    }`}
                  >
                    {isConnected ? (
                      <>
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>Aktif</span>
                      </>
                    ) : needsReauth ? (
                      <>
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                        <span>Re-auth</span>
                      </>
                    ) : (
                      "Belum Terhubung"
                    )}
                  </span>
                </div>

                <div>
                  <h3 className="font-bold text-slate-900 text-base">Instagram Reels</h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    {ig?.display_name ? (
                      <span className="font-semibold text-slate-800">Akun: {ig.display_name}</span>
                    ) : (
                      "Penerbitan 2 fase (container creation & publish) dengan worker laptop."
                    )}
                  </p>
                </div>

                {ig?.last_test && (
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-[11px] text-slate-600">
                    <span className="font-semibold">Uji Terakhir: </span>
                    {ig.last_test.ok ? (
                      <span className="text-emerald-700 font-medium">Berhasil ({new Date(ig.last_test.at).toLocaleTimeString("id-ID")})</span>
                    ) : (
                      <span className="text-rose-600">{ig.last_test.error?.message || "Gagal"}</span>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100">
                {!isConnected ? (
                  <button
                    onClick={() => handleOAuthAuthorize("instagram")}
                    className="w-full py-2.5 px-3.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-95 text-white text-xs font-semibold transition shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Instagram className="w-4 h-4" />
                    <span>Hubungkan dengan Meta</span>
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleTestConnection("instagram")}
                      disabled={testingPlatform === "instagram"}
                      className="flex-1 py-2 px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 transition flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${testingPlatform === "instagram" ? "animate-spin" : ""}`} />
                      <span>Uji</span>
                    </button>
                    <button
                      onClick={() => handleDisconnect("instagram")}
                      className="py-2 px-3 rounded-lg border border-rose-200 hover:bg-rose-50 text-xs font-medium text-rose-600 transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Unplug className="w-3.5 h-3.5" />
                      <span>Putuskan</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ==================== 3. TikTok (Direct API) ==================== */}
        {(() => {
          const tt = connections.find((c) => c.platform === "tiktok");
          const isConnected = tt?.status === "active";
          const needsReauth = tt?.status === "needs_reauth";

          return (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 flex flex-col justify-between shadow-xs hover:shadow-sm transition-shadow">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-cyan-300 shadow-2xs">
                    <Music2 className="w-6 h-6" />
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold border ${
                      isConnected
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : needsReauth
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-slate-100 text-slate-500 border-slate-200"
                    }`}
                  >
                    {isConnected ? (
                      <>
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>Aktif</span>
                      </>
                    ) : needsReauth ? (
                      <>
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                        <span>Re-auth</span>
                      </>
                    ) : (
                      "Belum Terhubung"
                    )}
                  </span>
                </div>

                <div>
                  <h3 className="font-bold text-slate-900 text-base">TikTok</h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    {tt?.display_name ? (
                      <span className="font-semibold text-slate-800">Akun: {tt.display_name}</span>
                    ) : (
                      "Penerbitan langsung tanpa perantara via TikTok Content Posting API v2."
                    )}
                  </p>
                </div>

                {tt?.last_test && (
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-[11px] text-slate-600">
                    <span className="font-semibold">Uji Terakhir: </span>
                    {tt.last_test.ok ? (
                      <span className="text-emerald-700 font-medium">Berhasil ({new Date(tt.last_test.at).toLocaleTimeString("id-ID")})</span>
                    ) : (
                      <span className="text-rose-600">{tt.last_test.error?.message || "Gagal"}</span>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100">
                {!isConnected ? (
                  <button
                    onClick={() => handleOAuthAuthorize("tiktok")}
                    className="w-full py-2.5 px-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 active:bg-black text-white text-xs font-semibold transition shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Music2 className="w-4 h-4 text-cyan-300" />
                    <span>Hubungkan dengan TikTok</span>
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleTestConnection("tiktok")}
                      disabled={testingPlatform === "tiktok"}
                      className="flex-1 py-2 px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 transition flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${testingPlatform === "tiktok" ? "animate-spin" : ""}`} />
                      <span>Uji</span>
                    </button>
                    <button
                      onClick={() => handleDisconnect("tiktok")}
                      className="py-2 px-3 rounded-lg border border-rose-200 hover:bg-rose-50 text-xs font-medium text-rose-600 transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Unplug className="w-3.5 h-3.5" />
                      <span>Putuskan</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export default function ConnectionsPage() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-slate-500 text-sm">Memuat status koneksi akun...</div>}>
      <ConnectionsContent />
    </Suspense>
  );
}
