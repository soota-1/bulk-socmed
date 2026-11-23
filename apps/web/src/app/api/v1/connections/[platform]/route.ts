import { NextResponse, type NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function DELETE(
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
  const adminSupabase = createAdminClient();

  // 1. Find connection
  const { data: conn } = await adminSupabase
    .from("connections")
    .select("id")
    .eq("owner_id", user.id)
    .eq("platform", platform)
    .maybeSingle();

  if (!conn) {
    return new NextResponse(null, { status: 204 });
  }

  // 2. Delete connection_secrets
  await adminSupabase
    .from("connection_secrets")
    .delete()
    .eq("connection_id", conn.id);

  // 3. Mark connection disabled (or remove row)
  await adminSupabase
    .from("connections")
    .update({
      status: "disabled",
      display_name: null,
      external_account_id: null,
      details: {},
      updated_at: new Date().toISOString(),
    })
    .eq("id", conn.id);

  // 4. Put incomplete targets on hold with needs_reauth
  await adminSupabase
    .from("targets")
    .update({
      hold_reason: "needs_reauth",
      updated_at: new Date().toISOString(),
    })
    .eq("owner_id", user.id)
    .eq("platform", platform)
    .in("status", ["scheduled", "uploading", "awaiting_platform"]);

  return new NextResponse(null, { status: 204 });
}
