"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Film, Share2, Settings, Plus, LogOut } from "lucide-react";

interface WorkerStatus {
  healthy: boolean;
  worker_id: string;
}

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [worker, setWorker] = useState<WorkerStatus | null>(null);

  // Jangan tampilkan navigasi penuh jika di halaman login
  const isLoginPage = pathname === "/login";

  useEffect(() => {
    if (isLoginPage) return;

    let mounted = true;
    async function checkWorker() {
      try {
        const res = await fetch("/api/v1/status");
        if (res.ok) {
          const data = await res.json();
          if (mounted && data.worker) {
            setWorker(data.worker);
          }
        }
      } catch {
        // Ignored
      }
    }

    checkWorker();
    const interval = setInterval(checkWorker, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [isLoginPage]);

  const handleLogout = async () => {
    if (!confirm("Yakin ingin keluar dari sesi?")) return;
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="border-b bg-white border-slate-200 sticky top-0 z-30 shadow-xs">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Brand Logo */}
        <div className="flex items-center gap-6 shrink-0">
          <Link href="/" className="flex items-center gap-2.5 font-bold text-lg text-slate-900 group">
            <span className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white text-lg shadow-sm group-hover:scale-105 transition-transform">
              🎬
            </span>
            <span className="tracking-tight font-extrabold bg-gradient-to-r from-slate-900 to-indigo-950 bg-clip-text text-transparent">
              Bulk Socmed
            </span>
          </Link>

          {/* Navigation Links - Only show if not on login page */}
          {!isLoginPage && (
            <nav className="hidden sm:flex items-center gap-1">
              <Link
                href="/"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  pathname === "/"
                    ? "bg-indigo-50 text-indigo-700 font-semibold"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70"
                }`}
              >
                <Film className="w-4 h-4" />
                Antrean
              </Link>
              <Link
                href="/connections"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  pathname.startsWith("/connections")
                    ? "bg-indigo-50 text-indigo-700 font-semibold"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70"
                }`}
              >
                <Share2 className="w-4 h-4" />
                Koneksi
              </Link>
              <Link
                href="/settings"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  pathname.startsWith("/settings")
                    ? "bg-indigo-50 text-indigo-700 font-semibold"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70"
                }`}
              >
                <Settings className="w-4 h-4" />
                Pengaturan
              </Link>
            </nav>
          )}
        </div>

        {/* Right Actions */}
        {!isLoginPage ? (
          <div className="flex items-center gap-3 shrink-0">
            {/* Worker Health Pill */}
            <div className="hidden md:flex items-center">
              {worker ? (
                worker.healthy ? (
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium"
                    title={`Worker laptop (${worker.worker_id}) aktif & terhubung`}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    Worker Aktif
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-xs font-medium"
                    title="Worker laptop tidak aktif. Jalankan worker di laptop Anda untuk upload."
                  >
                    <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                    Worker Offline
                  </span>
                )
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 text-xs">
                  <span className="w-2 h-2 rounded-full bg-slate-300"></span>
                  Cek status...
                </span>
              )}
            </div>

            {/* + Video Baru Button */}
            <Link
              href="/new"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs sm:text-sm font-semibold transition shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Video baru</span>
            </Link>

            {/* Logout button */}
            <button
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
              title="Keluar dari akun"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="text-xs text-slate-400 font-medium">Khusus Pemilik</div>
        )}
      </div>

      {/* Mobile Nav Sub-bar */}
      {!isLoginPage && (
        <div className="sm:hidden border-t border-slate-100 bg-slate-50/80 px-4 py-2 flex items-center justify-around text-xs">
          <Link
            href="/"
            className={`flex items-center gap-1 py-1 px-2.5 rounded-md font-medium ${
              pathname === "/" ? "bg-white text-indigo-700 shadow-xs" : "text-slate-600"
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            Antrean
          </Link>
          <Link
            href="/connections"
            className={`flex items-center gap-1 py-1 px-2.5 rounded-md font-medium ${
              pathname.startsWith("/connections") ? "bg-white text-indigo-700 shadow-xs" : "text-slate-600"
            }`}
          >
            <Share2 className="w-3.5 h-3.5" />
            Koneksi
          </Link>
          <Link
            href="/settings"
            className={`flex items-center gap-1 py-1 px-2.5 rounded-md font-medium ${
              pathname.startsWith("/settings") ? "bg-white text-indigo-700 shadow-xs" : "text-slate-600"
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            Pengaturan
          </Link>
        </div>
      )}
    </header>
  );
}
