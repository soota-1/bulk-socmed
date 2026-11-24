"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, AlertCircle, Info, X } from "lucide-react";

interface StatusAlert {
  id: string;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  action?: { label: string; href: string } | null;
}

export function AlertBanner() {
  const [alerts, setAlerts] = useState<StatusAlert[]>([]);
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let mounted = true;

    async function checkStatus() {
      try {
        const res = await fetch("/api/v1/status");
        if (res.ok) {
          const data = await res.json();
          if (mounted && data.alerts) {
            setAlerts(data.alerts);
          }
        }
      } catch {
        // Ignored
      }
    }

    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const activeAlerts = alerts.filter((a) => !dismissed[a.id]);
  if (activeAlerts.length === 0) return null;

  const current = activeAlerts[0];
  if (!current) return null;

  const severityStyles = {
    error: "bg-rose-50 border-rose-200 text-rose-800",
    warning: "bg-amber-50 border-amber-200 text-amber-900",
    info: "bg-blue-50 border-blue-200 text-blue-800",
  }[current.severity] || "bg-amber-50 border-amber-200 text-amber-900";

  const IconComponent = {
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
  }[current.severity] || AlertTriangle;

  return (
    <div className={`border-b text-xs py-2 px-4 transition-all duration-200 ${severityStyles}`}>
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <IconComponent className="w-4 h-4 shrink-0" />
          <span className="font-semibold shrink-0">Perhatian:</span>
          <span className="truncate">{current.message}</span>
          {current.action && (
            <Link
              href={current.action.href}
              className="underline font-semibold ml-1 shrink-0 hover:opacity-80"
            >
              {current.action.label} &rarr;
            </Link>
          )}
        </div>
        <button
          onClick={() => setDismissed((prev) => ({ ...prev, [current.id]: true }))}
          className="p-1 rounded hover:bg-black/5 transition shrink-0"
          title="Tutup pemberitahuan"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
