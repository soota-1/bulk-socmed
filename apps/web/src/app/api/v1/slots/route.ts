import { NextResponse, type NextRequest } from "next/server";
import { TIMEZONE_WIB } from "@bulk-socmed/shared";
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

  const { data: slots, error } = await supabase
    .from("slots")
    .select("id, local_time, is_active")
    .order("local_time", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: { code: "database_error", message: error.message } },
      { status: 500 }
    );
  }

  return NextResponse.json({
    timezone: TIMEZONE_WIB,
    items: slots ?? [],
  });
}

export async function PUT(request: NextRequest) {
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
  const items: Array<{ local_time: string }> = body?.items ?? [];

  if (!items.length || items.length > 12) {
    return NextResponse.json(
      {
        error: {
          code: "validation_error",
          message: "Daftar slot harus berisi antara 1 hingga 12 slot.",
        },
      },
      { status: 400 }
    );
  }

  // Delete existing and insert new in transaction
  await supabase.from("slots").delete().eq("owner_id", user.id);

  const { data: inserted, error: insertErr } = await supabase
    .from("slots")
    .insert(
      items.map((i) => ({
        owner_id: user.id,
        local_time: i.local_time,
        is_active: true,
      }))
    )
    .select();

  if (insertErr) {
    return NextResponse.json(
      { error: { code: "database_error", message: insertErr.message } },
      { status: 500 }
    );
  }

  return NextResponse.json({
    timezone: TIMEZONE_WIB,
    items: inserted ?? [],
  });
}
