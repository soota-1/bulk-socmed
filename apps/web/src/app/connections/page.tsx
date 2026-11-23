"use client";

import { useEffect, useState, useTransition, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { Platform, ConnectionStatus } from "@bulk-socmed/shared";

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
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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

  async function handleOAuthAuthorize(platform: "youtube" | "instagram") {
    try {
      setActionMessage(`Menghubungkan ke ${platform}...`);
      const res = await fetch(`/api/v1/connections/${platform}/authorize`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.authorize_url) {
        window.location.href = data.authorize_url;
      } else {
        setActionMessage(`Gagal memulai OAuth: ${data.error?.message || "Unknown error"}`);
      }
    } catch (err) {
      setActionMessage("Terjadi kesalahan jaringan.");
    }
  }

  async function handleTestConnection(platform: Platform) {
    try {
      const res = await fetch(`/api/v1/connections/${platform}/test`, {
        method: "POST",
      });
      if (res.ok) {
        setActionMessage(
          `Uji koneksi ${platform} telah diminta. Worker akan menguji koneksi dalam hitungan detik.`
        );
        setTimeout(loadConnections, 3000);
      } else {
        const err = await res.json();
        setActionMessage(`Gagal menguji koneksi: ${err.error?.message}`);
      }
    } catch {
      setActionMessage("Terjadi kesalahan jaringan saat menguji koneksi.");
    }
  }

  async function handleDisconnect(platform: Platform) {
    if (!confirm(`Yakin ingin memutuskan koneksi ${platform}? Posting yang belum terbit akan ditahan.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/v1/connections/${platform}`, {
        method: "DELETE",
      });
      if (res.ok || res.status === 204) {
        setActionMessage(`Koneksi ${platform} berhasil diputuskan.`);
        loadConnections();
      }
    } catch {
      setActionMessage("Gagal memutuskan koneksi.");
    }
  }

  async function handleFetchBufferChannels() {
    if (!bufferApiKey.trim()) {
      setBufferError("Harap isi API key Buffer terlebih dahulu.");
      return;
    }
    setLoadingChannels(true);
    setBufferError(null);
    try {
      // First save or test the key via PUT to check validity
      const res = await fetch("/api/v1/connections/tiktok", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buffer_api_key: bufferApiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBufferError(data.error?.message || "API key Buffer tidak valid.");
        return;
      }

      // Fetch channels
      const chRes = await fetch("/api/v1/connections/tiktok/channels");
      const chData = await chRes.json();
      if (chRes.ok && chData.items?.length > 0) {
        setBufferChannels(chData.items);
        setSelectedChannelId(chData.items[0].id);
      } else {
        setBufferError("Tidak ditemukan channel TikTok di akun Buffer Anda.");
      }
    } catch {
      setBufferError("Gagal menghubungi server.");
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
        setActionMessage("Akun TikTok via Buffer berhasil terhubung!");
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Koneksi Akun</h1>
        <p className="text-sm text-slate-500 mt-1">
          Hubungkan akun sosial media Anda untuk penerbitan video otomatis Rp0 biaya.
        </p>
      </div>

      {/* Notifications */}
      {connectedParam && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium flex items-center justify-between">
          <span>🎉 Akun {connectedParam} berhasil disambungkan!</span>
          <button onClick={() => window.history.replaceState({}, "", "/connections")} className="text-emerald-600 hover:text-emerald-900">✕</button>
        </div>
      )}
      {errorParam && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm font-medium flex items-center justify-between">
          <span>❌ Gagal menyambungkan: {decodeURIComponent(errorParam)}</span>
          <button onClick={() => window.history.replaceState({}, "", "/connections")} className="text-rose-600 hover:text-rose-900">✕</button>
        </div>
      )}
      {actionMessage && (
        <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium">
          {actionMessage}
        </div>
      )}

      {/* Grid of Connections */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* 1. YouTube */}
        {(() => {
          const yt = connections.find((c) => c.platform === "youtube");
          const isConnected = yt?.status === "active";
          const needsReauth = yt?.status === "needs_reauth";

          return (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col justify-between shadow-sm">
              <div>
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center text-xl text-rose-600 font-bold">
                    ▶
                  </div>
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                      isConnected
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : needsReauth
                        ? "bg-amber-50 text-amber-700 border border-amber-200"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {isConnected ? "Aktif" : needsReauth ? "Perlu Re-auth" : "Belum Terhubung"}
                  </span>
                </div>
                <h3 className="font-bold text-slate-900 mt-4 text-base">YouTube Shorts</h3>
                <p className="text-xs text-slate-500 mt-1">
                  {yt?.display_name ? `Channel: ${yt.display_name}` : "Upload otomatis dengan status rilis terjadwal atomik."}
                </p>

                {yt?.last_test && (
                  <div className="mt-3 text-[11px] text-slate-400">
                    Uji: {yt.last_test.ok ? "✅ Berhasil" : `❌ ${yt.last_test.error?.message || "Gagal"}`} ({new Date(yt.last_test.at).toLocaleTimeString("id-ID")})
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100 flex flex-col gap-2">
                {!isConnected ? (
                  <button
                    onClick={() => handleOAuthAuthorize("youtube")}
                    className="w-full py-2 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition"
                  >
                    Hubungkan dengan Google
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleTestConnection("youtube")}
                      className="flex-1 py-1.5 px-3 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Uji
                    </button>
                    <button
                      onClick={() => handleDisconnect("youtube")}
                      className="py-1.5 px-3 rounded-lg border border-rose-200 text-xs font-medium text-rose-600 hover:bg-rose-50"
                    >
                      Putuskan
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* 2. Instagram */}
        {(() => {
          const ig = connections.find((c) => c.platform === "instagram");
          const isConnected = ig?.status === "active";
          const needsReauth = ig?.status === "needs_reauth";

          return (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col justify-between shadow-sm">
              <div>
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-fuchsia-600 flex items-center justify-center text-xl text-white font-bold">
                    📸
                  </div>
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                      isConnected
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : needsReauth
                        ? "bg-amber-50 text-amber-700 border border-amber-200"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {isConnected ? "Aktif" : needsReauth ? "Perlu Re-auth" : "Belum Terhubung"}
                  </span>
                </div>
                <h3 className="font-bold text-slate-900 mt-4 text-base">Instagram Reels</h3>
                <p className="text-xs text-slate-500 mt-1">
                  {ig?.display_name ? `Akun: ${ig.display_name}` : "Penerbitan 2 fase dengan proteksi anti-duplicate posting."}
                </p>

                {ig?.last_test && (
                  <div className="mt-3 text-[11px] text-slate-400">
                    Uji: {ig.last_test.ok ? "✅ Berhasil" : `❌ ${ig.last_test.error?.message || "Gagal"}`} ({new Date(ig.last_test.at).toLocaleTimeString("id-ID")})
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100 flex flex-col gap-2">
                {!isConnected ? (
                  <button
                    onClick={() => handleOAuthAuthorize("instagram")}
                    className="w-full py-2 px-3 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-95 text-white text-xs font-semibold transition"
                  >
                    Hubungkan dengan Meta
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleTestConnection("instagram")}
                      className="flex-1 py-1.5 px-3 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Uji
                    </button>
                    <button
                      onClick={() => handleDisconnect("instagram")}
                      className="py-1.5 px-3 rounded-lg border border-rose-200 text-xs font-medium text-rose-600 hover:bg-rose-50"
                    >
                      Putuskan
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* 3. TikTok via Buffer */}
        {(() => {
          const tt = connections.find((c) => c.platform === "tiktok");
          const isConnected = tt?.status === "active";
          const channelName = tt?.details?.buffer_channel_name || tt?.display_name;

          return (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col justify-between shadow-sm">
              <div>
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-xl text-white font-bold">
                    🎵
                  </div>
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                      isConnected
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {isConnected ? "Aktif" : "Belum Terhubung"}
                  </span>
                </div>
                <h3 className="font-bold text-slate-900 mt-4 text-base">TikTok (via Buffer)</h3>
                <p className="text-xs text-slate-500 mt-1">
                  {channelName ? `Channel: ${channelName}` : "Penerbitan otomatis via akun gratis Buffer (jendela 10 video)."}
                </p>

                {tt?.last_test && (
                  <div className="mt-3 text-[11px] text-slate-400">
                    Uji: {tt.last_test.ok ? "✅ Berhasil" : `❌ ${tt.last_test.error?.message || "Gagal"}`} ({new Date(tt.last_test.at).toLocaleTimeString("id-ID")})
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100 flex flex-col gap-2">
                {!isConnected ? (
                  <div className="space-y-3">
                    <input
                      type="password"
                      placeholder="Tempel Buffer API Key..."
                      value={bufferApiKey}
                      onChange={(e) => setBufferApiKey(e.target.value)}
                      className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />

                    {bufferChannels.length === 0 ? (
                      <button
                        onClick={handleFetchBufferChannels}
                        disabled={loadingChannels || !bufferApiKey}
                        className="w-full py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold transition"
                      >
                        {loadingChannels ? "Memeriksa..." : "Verifikasi & Ambil Channel"}
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <select
                          value={selectedChannelId}
                          onChange={(e) => setSelectedChannelId(e.target.value)}
                          className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          {bufferChannels.map((ch) => (
                            <option key={ch.id} value={ch.id}>
                              {ch.name}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={handleSaveTikTokChannel}
                          disabled={loadingChannels}
                          className="w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition"
                        >
                          Simpan Channel
                        </button>
                      </div>
                    )}

                    {bufferError && (
                      <p className="text-[11px] text-rose-600 font-medium">{bufferError}</p>
                    )}
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleTestConnection("tiktok")}
                      className="flex-1 py-1.5 px-3 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Uji
                    </button>
                    <button
                      onClick={() => handleDisconnect("tiktok")}
                      className="py-1.5 px-3 rounded-lg border border-rose-200 text-xs font-medium text-rose-600 hover:bg-rose-50"
                    >
                      Putuskan
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
    <Suspense fallback={<div className="py-12 text-center text-slate-500 text-sm">Memuat koneksi...</div>}>
      <ConnectionsContent />
    </Suspense>
  );
}
