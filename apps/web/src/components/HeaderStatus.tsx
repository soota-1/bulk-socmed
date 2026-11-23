"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface StatusAlert {
  id: string;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  action?: { label: string; href: string } | null;
}

interface StatusData {
  worker?: {
    worker_id: string;
    healthy: boolean;
    seconds_since_tick: number;
    last_tick_at: string | null;
  };
  alerts?: StatusAlert[];
}

export function HeaderStatus() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [dismissedAlerts, setDismissedAlerts] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let mounted = true;

    async function fetchStatus() {
      try {
        const res = await fetch("/api/v1/status");
        if (res.ok) {
          const data = await res.json();
          if (mounted) setStatus(data);
        }
      } catch {
        // Ignored
      }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 30000); // 30s poll
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const activeAlerts = (status?.alerts ?? []).filter((a) => !dismissedAlerts[a.id]);
  const firstAlert = activeAlerts[0];

  return (
    <>
      {/* Alert Banners */}
      {firstAlert && (
        <div className="bg-amber-500 text-white text-xs font-medium py-2 px-4 shadow-inner">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="font-bold">⚠️ Perhatian:</span>
              <span>{firstAlert.message}</span>
              {firstAlert.action && (
                <Link
                  href={firstAlert.action.href}
                  className="underline font-semibold ml-2 hover:text-amber-100"
                >
                  {firstAlert.action.label} &rarr;
                </Link>
              )}
            </div>
            <button
              onClick={() =>
                setDismissedAlerts((prev) => ({ ...prev, [firstAlert.id]: true }))
              }
              className="text-amber-100 hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Worker Health Pill */}
      <div className="flex items-center gap-2 text-xs">
        {status?.worker ? (
          status.worker.healthy ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-medium border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Worker Aktif
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 font-medium border border-rose-200"
              title="Worker laptop tidak aktif. Posting Instagram ditahan."
            >
              <span className="w-2 h-2 rounded-full bg-rose-500"></span>
              Worker Offline
            </span>
          )
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-medium">
            <span className="w-2 h-2 rounded-full bg-slate-400"></span>
            Memeriksa...
          </span>
        )}
      </div>
    </>
  );
}
