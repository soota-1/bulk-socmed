import { NextResponse } from "next/server";
import { differenceInSeconds } from "date-fns";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthenticated", message: "Belum masuk atau sesi berakhir." } },
      { status: 401 }
    );
  }

  const now = new Date();

  // 1. Fetch latest worker heartbeat
  const { data: heartbeat } = await supabase
    .from("worker_heartbeats")
    .select("*")
    .order("last_tick_at", { ascending: false })
    .limit(1)
    .single();

  let workerHealthy = false;
  let secondsSinceTick = 9999;

  if (heartbeat?.last_tick_at) {
    secondsSinceTick = differenceInSeconds(now, new Date(heartbeat.last_tick_at));
    workerHealthy = secondsSinceTick <= 180; // Healthy if tick within 3 minutes
  }

  // 2. Fetch usage estimate from view
  const { data: usageData } = await supabase
    .from("v_usage_estimate")
    .select("*")
    .single();

  const storageUsed = Number(usageData?.storage_bytes_estimate ?? 0);
  const egressUsedMonth = Number(usageData?.egress_bytes_estimate_month ?? 0);

  // 3. Build alerts list
  const alerts: Array<{
    id: string;
    severity: "error" | "warning" | "info";
    code: string;
    message: string;
    action?: { label: string; href: string } | null;
  }> = [];

  if (!workerHealthy) {
    alerts.push({
      id: "worker_offline",
      severity: "error",
      code: "worker_offline",
      message: `Pekerja di laptop tidak aktif sejak ${
        heartbeat?.last_tick_at
          ? new Date(heartbeat.last_tick_at).toLocaleTimeString("id-ID")
          : "belum pernah aktif"
      }. Posting Instagram tidak akan terbit sampai laptop menyala.`,
      action: null,
    });
  }

  // Check storage warnings (80% of 1GB and 5GB)
  const STORAGE_QUOTA = 1024 * 1024 * 1024; // 1 GB
  const EGRESS_QUOTA = 5 * 1024 * 1024 * 1024; // 5 GB

  if (egressUsedMonth / EGRESS_QUOTA >= 0.8) {
    alerts.push({
      id: "egress_high",
      severity: "warning",
      code: "storage_usage_high",
      message: `Perkiraan unduhan bulan ini telah mencapai ${(
        (egressUsedMonth / EGRESS_QUOTA) *
        100
      ).toFixed(0)}% dari kuota 5 GB.`,
      action: { label: "Lihat penyimpanan", href: "/settings" },
    });
  }

  return NextResponse.json({
    server_time: now.toISOString(),
    worker: {
      worker_id: heartbeat?.worker_id ?? "unknown",
      last_tick_at: heartbeat?.last_tick_at ?? null,
      seconds_since_tick: secondsSinceTick,
      healthy: workerHealthy,
    },
    usage: {
      storage: {
        used_bytes_estimate: storageUsed,
        quota_bytes: STORAGE_QUOTA,
        percent: Math.min(100, Math.round((storageUsed / STORAGE_QUOTA) * 100)),
      },
      egress_month: {
        used_bytes_estimate: egressUsedMonth,
        quota_bytes: EGRESS_QUOTA,
        percent: Math.min(100, Math.round((egressUsedMonth / EGRESS_QUOTA) * 100)),
      },
    },
    alerts,
  });
}
