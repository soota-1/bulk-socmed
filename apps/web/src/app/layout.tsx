import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { AlertBanner } from "@/components/AlertBanner";

export const metadata: Metadata = {
  title: "Penjadwal Video Pendek — Bulk Socmed",
  description: "Penjadwal video otomatis untuk YouTube Shorts, Instagram Reels, dan TikTok",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id" className="h-full">
      <body className="min-h-full bg-slate-50/70 text-slate-900 flex flex-col antialiased">
        <AlertBanner />
        <Navbar />
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
