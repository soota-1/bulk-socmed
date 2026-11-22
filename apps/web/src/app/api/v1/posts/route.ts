import { NextResponse, type NextRequest } from "next/server";
import {
  PostCreateSchema,
  planTargets,
  nextFreeSlot,
  DEFAULT_SLOT_TIMES,
  DEFAULT_MIN_LEAD_MINUTES,
} from "@bulk-socmed/shared";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
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

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const offset = Number(searchParams.get("offset") ?? 0);

  // Read overview from view
  const { data, error, count } = await supabase
    .from("v_post_overview")
    .select("*", { count: "exact" })
    .order("due_at", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json(
      { error: { code: "database_error", message: error.message } },
      { status: 500 }
    );
  }

  return NextResponse.json({
    items: data ?? [],
    total: count ?? data?.length ?? 0,
    server_time: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  try {
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
    const parsed = PostCreateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "validation_error",
            message: "Data entri video tidak valid.",
            details: parsed.error.format(),
          },
        },
        { status: 400 }
      );
    }

    const { video_upload_id, thumbnail_upload_id, title, caption, hashtags, schedule, mode } =
      parsed.data;

    // Verify video upload existence
    const { data: videoUpload, error: videoErr } = await supabase
      .from("uploads")
      .select("*")
      .eq("id", video_upload_id)
      .single();

    if (videoErr || !videoUpload) {
      return NextResponse.json(
        { error: { code: "upload_not_found", message: "Berkas video tidak ditemukan." } },
        { status: 404 }
      );
    }

    // Determine due_at and slot_key
    const now = new Date();
    let dueAt: Date;
    let slotKey: string | null = null;
    let isTimeOverridden = false;

    if (!schedule || schedule.type === "next_free") {
      // Fetch occupied slots
      const { data: occupiedPosts } = await supabase
        .from("posts")
        .select("slot_key")
        .not("slot_key", "is", null)
        .eq("state", "active");

      const occupied = new Set<string>((occupiedPosts ?? []).map((p) => p.slot_key as string));

      const { candidate, key } = nextFreeSlot(
        now,
        [...DEFAULT_SLOT_TIMES],
        occupied,
        DEFAULT_MIN_LEAD_MINUTES
      );
      dueAt = candidate;
      slotKey = key;
    } else if (schedule.type === "slot") {
      slotKey = schedule.slot_key;
      // Convert slot key "YYYY-MM-DD@HH:MM" to Date
      const [datePart, timePart] = schedule.slot_key.split("@");
      dueAt = new Date(`${datePart}T${timePart}:00+07:00`);
    } else {
      dueAt = new Date(schedule.due_at);
      isTimeOverridden = true;
    }

    // Default title from 1st line of caption if empty
    const resolvedTitle =
      title?.trim() ||
      caption.split("\n")[0]?.trim().slice(0, 100) ||
      "Untitled Video";

    // Plan target dispatch times
    const targets = planTargets(dueAt, now);

    const uploadIds = [video_upload_id];
    let thumbnailPath: string | null = null;

    if (thumbnail_upload_id) {
      uploadIds.push(thumbnail_upload_id);
      const { data: thumbUpload } = await supabase
        .from("uploads")
        .select("object_path")
        .eq("id", thumbnail_upload_id)
        .single();
      thumbnailPath = thumbUpload?.object_path ?? null;
    }

    // Call atomic create_post_tx DB function
    const { data: postId, error: txError } = await supabase.rpc("create_post_tx", {
      p: {
        title: resolvedTitle,
        caption,
        hashtags: hashtags ?? "",
        video_object_path: videoUpload.object_path,
        video_size_bytes: videoUpload.size_bytes,
        video_duration_ms: videoUpload.metadata?.duration_ms ?? null,
        video_width: videoUpload.metadata?.width ?? null,
        video_height: videoUpload.metadata?.height ?? null,
        thumbnail_object_path: thumbnailPath,
        due_at: dueAt.toISOString(),
        slot_key: slotKey,
        is_time_overridden: isTimeOverridden,
        state: mode === "draft" ? "draft" : "active",
        upload_ids: uploadIds,
        targets: targets.map((t) => ({
          platform: t.platform,
          dispatch_at: t.dispatch_at.toISOString(),
        })),
      },
    });

    if (txError) {
      if (txError.code === "23505") {
        return NextResponse.json(
          {
            error: {
              code: "slot_taken",
              message: `Slot ${slotKey} sudah terisi. Pilih slot lain.`,
              details: { slot_key: slotKey },
            },
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        {
          error: {
            code: "database_error",
            message: `Gagal membuat entri: ${txError.message}`,
          },
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        id: postId,
        title: resolvedTitle,
        due_at: dueAt.toISOString(),
        slot_key: slotKey,
        state: mode === "draft" ? "draft" : "active",
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: "internal_error",
          message: err instanceof Error ? err.message : "Terjadi kesalahan internal.",
        },
      },
      { status: 500 }
    );
  }
}
