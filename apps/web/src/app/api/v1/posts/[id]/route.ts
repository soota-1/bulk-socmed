import { NextResponse, type NextRequest } from "next/server";
import { PostUpdateSchema } from "@bulk-socmed/shared";
import {
  createR2SignedDownloadUrl,
  headR2Object,
  isR2Configured,
  type MediaFolder,
} from "@bulk-socmed/shared/r2";
import { createClient, createAdminClient } from "@/lib/supabase/server";

async function resolveSignedPreviewUrl(
  supabase: ReturnType<typeof createClient>,
  folder: MediaFolder,
  objectPath: string,
  expiresInSeconds = 600
): Promise<string | null> {
  if (isR2Configured()) {
    try {
      const existsInR2 = await headR2Object(folder, objectPath);
      if (existsInR2) {
        return await createR2SignedDownloadUrl({ folder, objectPath, expiresInSeconds });
      }
    } catch {
      // Fallback to Supabase Storage below
    }
  }

  const { data: signed } = await supabase.storage
    .from(folder)
    .createSignedUrl(objectPath, expiresInSeconds);
  return signed?.signedUrl ?? null;
}

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

  // 4. Generate 10-minute signed preview URL for video (R2 or Supabase fallback)
  const videoPreviewUrl = post.video_object_path
    ? await resolveSignedPreviewUrl(supabase, "videos", post.video_object_path, 600)
    : null;

  // 5. Generate signed preview URL for thumbnail if present
  const thumbPreviewUrl = post.thumbnail_object_path
    ? await resolveSignedPreviewUrl(supabase, "thumbnails", post.thumbnail_object_path, 600)
    : null;

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

  const { title, caption, hashtags, platform_overrides, thumbnail_upload_id } = parsed.data;
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (title !== undefined) updateData.title = title;
  if (caption !== undefined) updateData.caption = caption;
  if (hashtags !== undefined) updateData.hashtags = hashtags;

  const adminSupabase = createAdminClient();

  if (thumbnail_upload_id === null) {
    updateData.thumbnail_object_path = null;
  } else if (typeof thumbnail_upload_id === "string") {
    const { data: thumbUpload, error: thumbErr } = await adminSupabase
      .from("uploads")
      .select("object_path")
      .eq("id", thumbnail_upload_id)
      .eq("owner_id", user.id)
      .eq("kind", "thumbnail")
      .single();

    if (thumbErr || !thumbUpload) {
      return NextResponse.json(
        { error: { code: "upload_not_found", message: "Berkas thumbnail tidak ditemukan." } },
        { status: 404 }
      );
    }

    updateData.thumbnail_object_path = thumbUpload.object_path;
    await adminSupabase
      .from("uploads")
      .update({ state: "consumed", consumed_post_id: postId })
      .eq("id", thumbnail_upload_id);
  }

  // Update posts row
  const { data: updatedPost, error: updateErr } = await adminSupabase
    .from("posts")
    .update(updateData)
    .eq("id", postId)
    .eq("owner_id", user.id)
    .select("*")
    .single();

  if (updateErr) {
    return NextResponse.json(
      { error: { code: "database_error", message: updateErr.message } },
      { status: 500 }
    );
  }

  // Persist per-platform overrides if provided
  if (platform_overrides) {
    const { data: currentTargets } = await adminSupabase
      .from("targets")
      .select("id, platform, external_state")
      .eq("post_id", postId)
      .eq("owner_id", user.id);

    for (const target of currentTargets ?? []) {
      const plat = target.platform as "youtube" | "instagram" | "tiktok";
      const ov = platform_overrides[plat];
      if (!ov) continue;

      const nextState: Record<string, unknown> = {
        ...((target.external_state as Record<string, unknown>) ?? {}),
      };

      if (ov.title !== undefined) {
        if (ov.title.trim()) nextState.override_title = ov.title.trim();
        else delete nextState.override_title;
      }
      if (ov.caption !== undefined) {
        if (ov.caption.trim()) nextState.override_caption = ov.caption.trim();
        else delete nextState.override_caption;
      }
      if (ov.hashtags !== undefined) {
        if (ov.hashtags.trim()) nextState.override_hashtags = ov.hashtags.trim();
        else delete nextState.override_hashtags;
      }

      await adminSupabase
        .from("targets")
        .update({ external_state: nextState, updated_at: new Date().toISOString() })
        .eq("id", target.id);
    }
  }

  // Flag pending_action = "sync_changes" on targets already uploaded or awaiting platform
  await adminSupabase
    .from("targets")
    .update({
      pending_action: "sync_changes",
      updated_at: new Date().toISOString(),
    })
    .eq("post_id", postId)
    .eq("owner_id", user.id)
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
  const adminSupabase = createAdminClient();

  // 2. Set post state = "cancelled" and free the slot_key
  await adminSupabase
    .from("posts")
    .update({
      state: "cancelled",
      slot_key: null, // Frees the slot immediately
      updated_at: now,
    })
    .eq("id", postId)
    .eq("owner_id", user.id);

  // 3. Update targets:
  // For targets already on platform, flag pending_action = "cancel" for worker deletion
  await adminSupabase
    .from("targets")
    .update({
      pending_action: "cancel",
      updated_at: now,
    })
    .eq("post_id", postId)
    .eq("owner_id", user.id)
    .in("status", ["uploading", "awaiting_platform"]);

  // For targets still scheduled/draft, mark cancelled immediately
  await adminSupabase
    .from("targets")
    .update({
      status: "cancelled",
      run_at: null,
      updated_at: now,
    })
    .eq("post_id", postId)
    .eq("owner_id", user.id)
    .in("status", ["scheduled", "draft"]);

  return NextResponse.json({ message: "Posting berhasil dibatalkan.", id: postId });
}
