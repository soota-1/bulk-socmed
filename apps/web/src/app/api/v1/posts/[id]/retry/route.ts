import { NextResponse, type NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
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

  const postId = Number(params.id);
  const body = await request.json().catch(() => ({}));
  const { target_id, platform } = body as { target_id?: number; platform?: string };

  const adminSupabase = createAdminClient();

  let query = adminSupabase
    .from("targets")
    .select("*")
    .eq("post_id", postId)
    .eq("owner_id", user.id);
  if (target_id) {
    query = query.eq("id", target_id);
  } else if (platform) {
    query = query.eq("platform", platform);
  }

  const { data: targets, error: targetErr } = await query;
  if (targetErr || !targets || targets.length === 0) {
    return NextResponse.json(
      { error: { code: "target_not_found", message: "Target posting tidak ditemukan." } },
      { status: 404 }
    );
  }

  const now = new Date();
  const updatedTargets = [];

  for (const target of targets) {
    const isRetryable =
      target.status === "failed" ||
      target.status === "missed" ||
      target.hold_reason !== null ||
      target.last_error_code !== null;

    if (!isRetryable) {
      return NextResponse.json(
        {
          error: {
            code: "not_retryable",
            message: `Target berstatus '${target.status}' tidak dapat dicoba ulang (hanya target yang gagal, terlewat, atau ditahan).`,
          },
        },
        { status: 409 }
      );
    }

    const { data: updated, error: updErr } = await adminSupabase
      .from("targets")
      .update({
        status: "scheduled",
        step: null,
        pending_action: null,
        last_error_code: null,
        last_error_message: null,
        hold_reason: null,
        attempt_count: 0,
        run_at: now.toISOString(),
        lease_owner: null,
        lease_until: null,
        updated_at: now.toISOString(),
      })
      .eq("id", target.id)
      .select("*")
      .single();

    if (updErr) {
      return NextResponse.json(
        { error: { code: "database_error", message: `Gagal memperbarui target: ${updErr.message}` } },
        { status: 500 }
      );
    }

    if (updated) {
      await adminSupabase.from("target_events").insert({
        target_id: target.id,
        event: "retry",
        from_status: target.status,
        to_status: "scheduled",
        detail: { reason: "user_retry_request" },
      });
      updatedTargets.push(updated);
    }
  }

  return NextResponse.json({
    items: updatedTargets,
    message: "Target berhasil dijadwalkan untuk dicoba ulang.",
  });
}
