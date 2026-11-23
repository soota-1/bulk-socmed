import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { HeaderStatus } from "@/components/HeaderStatus";

export const metadata: Metadata = {
  title: "Penjadwal Video Pendek",
  description: "Penjadwal video otomatis untuk YouTube Shorts, Instagram Reels, dan TikTok",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
        <header className="border-b bg-white border-slate-200 sticky top-0 z-30 shadow-sm">
          <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
            <div className="flex items-center space-x-6">
              <Link href="/" className="font-bold text-lg text-indigo-600 flex items-center gap-2">
                <span className="p-1.5 bg-indigo-50 rounded-lg text-indigo-600">🎬</span>
                Bulk Socmed
              </Link>
              <nav className="flex space-x-4 text-sm font-medium text-slate-600">
                <Link href="/" className="hover:text-indigo-600 transition-colors">
                  Antrean
                </Link>
                <Link href="/connections" className="hover:text-indigo-600 transition-colors">
                  Koneksi
                </Link>
                <Link href="/settings" className="hover:text-indigo-600 transition-colors">
                  Pengaturan
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-4">
              <HeaderStatus />
              <Link
                href="/new"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition shadow-sm"
              >
                + Video baru
              </Link>
            </div>
          </div>
        </header>
        <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
