import { NextResponse, type NextRequest } from "next/server";
import { PostUpdateSchema } from "@bulk-socmed/shared";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: NextRequest,
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
  if (isNaN(postId)) {
    return NextResponse.json(
      { error: { code: "post_not_found", message: "ID posting tidak valid." } },
      { status: 404 }
    );
  }

  // 1. Fetch post
  const { data: post, error: postErr } = await supabase
    .from("posts")
    .select("*")
    .eq("id", postId)
    .single();

  if (postErr || !post) {
    return NextResponse.json(
      { error: { code: "post_not_found", message: "Posting tidak ditemukan." } },
      { status: 404 }
    );
  }

  // 2. Fetch targets
  const { data: targets } = await supabase
    .from("targets")
    .select("*")
    .eq("post_id", postId)
    .order("id", { ascending: true });

  const targetIds = (targets ?? []).map((t) => t.id);

  // 3. Fetch events
  let events: any[] = [];
  if (targetIds.length > 0) {
    const { data: eventRows } = await supabase
      .from("target_events")
      .select("*")
      .in("target_id", targetIds)
      .order("created_at", { ascending: true });
    events = eventRows ?? [];
  }

  // 4. Generate 10-minute signed preview URL for video
  let videoPreviewUrl: string | null = null;
  if (post.video_object_path) {
    const { data: signed } = await supabase.storage
      .from("videos")
      .createSignedUrl(post.video_object_path, 600); // 10 minutes
    videoPreviewUrl = signed?.signedUrl ?? null;
  }

  // 5. Generate signed preview URL for thumbnail if present
  let thumbPreviewUrl: string | null = null;
  if (post.thumbnail_object_path) {
    const { data: signedThumb } = await supabase.storage
      .from("thumbnails")
      .createSignedUrl(post.thumbnail_object_path, 600);
    thumbPreviewUrl = signedThumb?.signedUrl ?? null;
  }

  return NextResponse.json({
    id: post.id,
    title: post.title,
    caption: post.caption,
    hashtags: post.hashtags,
    due_at: post.due_at,
    slot_key: post.slot_key,
    is_time_overridden: post.is_time_overridden,
    state: post.state,
    video: {
      object_path: post.video_object_path,
      size_bytes: post.video_size_bytes,
      duration_ms: post.video_duration_ms,
      width: post.video_width,
      height: post.video_height,
      preview_url: videoPreviewUrl,
    },
    thumbnail: post.thumbnail_object_path
      ? {
          object_path: post.thumbnail_object_path,
          preview_url: thumbPreviewUrl,
        }
      : null,
    targets: targets ?? [],
    events,
    created_at: post.created_at,
    updated_at: post.updated_at,
  });
}

export async function PATCH(
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
  const body = await request.json();
  const parsed = PostUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "validation_error",
          message: "Data pembaruan tidak valid.",
          details: parsed.error.format(),
        },
      },
      { status: 400 }
    );
  }

  // Check existing post
  const { data: existing, error: existErr } = await supabase
    .from("posts")
    .select("id, state")
    .eq("id", postId)
    .single();

  if (existErr || !existing) {
    return NextResponse.json(
      { error: { code: "post_not_found", message: "Posting tidak ditemukan." } },
      { status: 404 }
    );
  }

  if (existing.state === "cancelled") {
    return NextResponse.json(
      {
        error: {
          code: "post_locked",
          message: "Posting yang sudah dibatalkan tidak dapat diubah.",
        },
      },
      { status: 409 }
    );
  }

  const { title, caption, hashtags } = parsed.data;
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (title !== undefined) updateData.title = title;
  if (caption !== undefined) updateData.caption = caption;
  if (hashtags !== undefined) updateData.hashtags = hashtags;

  // Update posts row
  const { data: updatedPost, error: updateErr } = await supabase
    .from("posts")
    .update(updateData)
    .eq("id", postId)
    .select("*")
    .single();

  if (updateErr) {
    return NextResponse.json(
      { error: { code: "database_error", message: updateErr.message } },
      { status: 500 }
    );
  }

  // Flag pending_action = "sync_changes" on targets already uploaded or awaiting platform
  await supabase
    .from("targets")
    .update({
      pending_action: "sync_changes",
      updated_at: new Date().toISOString(),
    })
    .eq("post_id", postId)
    .in("status", ["uploading", "awaiting_platform"]);

  return NextResponse.json(updatedPost);
}

export async function DELETE(
  _request: NextRequest,
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

  // 1. Check existing post
  const { data: post, error: postErr } = await supabase
    .from("posts")
    .select("id, slot_key, state")
    .eq("id", postId)
    .single();

  if (postErr || !post) {
    return NextResponse.json(
      { error: { code: "post_not_found", message: "Posting tidak ditemukan." } },
      { status: 404 }
    );
  }

  const now = new Date().toISOString();

  // 2. Set post state = "cancelled" and free the slot_key
  await supabase
    .from("posts")
    .update({
      state: "cancelled",
      slot_key: null, // Frees the slot immediately
      updated_at: now,
    })
    .eq("id", postId);

  // 3. Update targets:
  // For targets already on platform, flag pending_action = "cancel" for worker deletion
  await supabase
    .from("targets")
    .update({
      pending_action: "cancel",
      updated_at: now,
    })
    .eq("post_id", postId)
    .in("status", ["uploading", "awaiting_platform"]);

  // For targets still scheduled/draft, mark cancelled immediately
  await supabase
    .from("targets")
    .update({
      status: "cancelled",
      run_at: null,
      updated_at: now,
    })
    .eq("post_id", postId)
    .in("status", ["scheduled", "draft"]);

  return NextResponse.json({ message: "Posting berhasil dibatalkan.", id: postId });
}
