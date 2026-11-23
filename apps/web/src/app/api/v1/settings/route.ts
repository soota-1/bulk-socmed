import { NextResponse, type NextRequest } from "next/server";
import { SettingsSchema, type Settings } from "@bulk-socmed/shared";
import { createClient } from "@/lib/supabase/server";

export const DEFAULT_SETTINGS: Required<Settings> & {
  timezone: string;
  max_video_size_mb: number;
} = {
  timezone: "Asia/Jakarta",
  grace_minutes: 120,
  tiktok_window_days: 2,
  buffer_queue_limit: 10,
  retry_backoff_minutes: [1, 5, 15],
  instagram_prepare_lead_minutes: 10,
  min_lead_minutes: 15,
  media_retention_days: 3,
  event_retention_days: 180,
  max_video_size_mb: 50,
  storage_quota_mb: 1024,
  egress_quota_mb: 5120,
  quota_warn_percent: 80,
};

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

  // Fetch settings from database for this user
  const { data: rows, error } = await supabase
    .from("settings")
    .select("key, value")
    .eq("owner_id", user.id);

  if (error) {
    return NextResponse.json(
      { error: { code: "database_error", message: error.message } },
      { status: 500 }
    );
  }

  const current: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows ?? []) {
    current[row.key] = row.value;
  }

  return NextResponse.json(current);
}

export async function PATCH(request: NextRequest) {
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

  const body = await request.json();
  const parsed = SettingsSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "validation_error",
          message: "Data pengaturan tidak valid.",
          details: parsed.error.format(),
        },
      },
      { status: 422 }
    );
  }

  const updates = parsed.data;
  const now = new Date().toISOString();

  // Upsert each key
  const upsertRows = Object.entries(updates)
    .filter(([_, val]) => val !== undefined)
    .map(([key, value]) => ({
      owner_id: user.id,
      key,
      value: value as any,
      updated_at: now,
    }));

  if (upsertRows.length > 0) {
    const { error: upsertErr } = await supabase
      .from("settings")
      .upsert(upsertRows, { onConflict: "owner_id, key" });

    if (upsertErr) {
      return NextResponse.json(
        { error: { code: "database_error", message: upsertErr.message } },
        { status: 500 }
      );
    }
  }

  // Return updated full settings
  const { data: allRows } = await supabase
    .from("settings")
    .select("key, value")
    .eq("owner_id", user.id);

  const full: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of allRows ?? []) {
    full[row.key] = row.value;
  }

  return NextResponse.json(full);
}
