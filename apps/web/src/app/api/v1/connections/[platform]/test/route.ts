import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  _request: NextRequest,
  { params }: { params: { platform: string } }
) {
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

  const platform = params.platform.toLowerCase();
  const now = new Date();

  // Update test_requested_at on the connection
  const { data, error } = await supabase
    .from("connections")
    .update({
      test_requested_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("owner_id", user.id)
    .eq("platform", platform)
    .select("id, platform, test_requested_at")
    .single();

  if (error || !data) {
    return NextResponse.json(
      {
        error: {
          code: "connection_not_configured",
          message: `Koneksi platform '${platform}' belum dikonfigurasi.`,
        },
      },
      { status: 404 }
    );
  }

  return NextResponse.json(
    { requested_at: now.toISOString() },
    { status: 202 }
  );
}
