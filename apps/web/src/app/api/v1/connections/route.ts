import { NextResponse } from "next/server";
import type { Platform, ConnectionStatus } from "@bulk-socmed/shared";
import { createClient } from "@/lib/supabase/server";

const PLATFORMS: Platform[] = ["youtube", "instagram", "tiktok"];

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

  // Fetch connections for this user
  const { data: userConnections, error } = await supabase
    .from("connections")
    .select("platform, status, display_name, details, last_test, updated_at")
    .eq("owner_id", user.id);

  if (error) {
    return NextResponse.json(
      { error: { code: "database_error", message: error.message } },
      { status: 500 }
    );
  }

  const connMap = new Map((userConnections ?? []).map((c) => [c.platform, c]));

  const items = PLATFORMS.map((platform) => {
    const existing = connMap.get(platform);
    if (existing) {
      return {
        platform,
        status: existing.status as ConnectionStatus,
        display_name: existing.display_name,
        details: existing.details ?? {},
        last_test: existing.last_test,
      };
    }
    return {
      platform,
      status: "not_connected" as ConnectionStatus,
      display_name: null,
      details: {},
      last_test: null,
    };
  });

  return NextResponse.json({ items });
}
