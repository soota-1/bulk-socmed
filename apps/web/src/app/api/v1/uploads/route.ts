import { NextResponse, type NextRequest } from "next/server";
import { UploadRequestSchema, MAX_VIDEO_SIZE_BYTES, MAX_THUMBNAIL_SIZE_BYTES } from "@bulk-socmed/shared";
import { createClient } from "@/lib/supabase/server";

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
    const parsed = UploadRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "validation_error",
            message: "Format unggahan tidak valid.",
            details: parsed.error.format(),
          },
        },
        { status: 400 }
      );
    }

    const { kind, filename, size_bytes, content_type, metadata } = parsed.data;

    // Check size limit specifically
    const maxBytes = kind === "video" ? MAX_VIDEO_SIZE_BYTES : MAX_THUMBNAIL_SIZE_BYTES;
    if (size_bytes > maxBytes) {
      const limitMb = maxBytes / (1024 * 1024);
      return NextResponse.json(
        {
          error: {
            code: "file_too_large",
            message: `Ukuran berkas (${(size_bytes / (1024 * 1024)).toFixed(1)} MB) melebihi batas ${limitMb} MB.`,
            details: { limit_mb: limitMb },
          },
        },
        { status: 413 }
      );
    }

    const bucket = kind === "video" ? "videos" : "thumbnails";
    const uploadId = crypto.randomUUID();
    const objectPath = `${user.id}/${uploadId}/${filename}`;

    // Create signed upload URL in Supabase Storage
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(objectPath);

    if (uploadErr || !uploadData) {
      return NextResponse.json(
        {
          error: {
            code: "storage_error",
            message: `Gagal membuat URL unggah: ${uploadErr?.message}`,
          },
        },
        { status: 500 }
      );
    }

    // Insert pending upload record into `uploads` table
    const { error: dbErr } = await supabase.from("uploads").insert({
      id: uploadId,
      owner_id: user.id,
      kind,
      bucket,
      object_path: objectPath,
      filename,
      size_bytes,
      content_type,
      metadata: metadata ?? {},
      state: "pending",
    });

    if (dbErr) {
      return NextResponse.json(
        {
          error: {
            code: "database_error",
            message: `Gagal mencatat unggahan: ${dbErr.message}`,
          },
        },
        { status: 500 }
      );
    }

    // Calculate non-blocking warnings (e.g. aspect ratio)
    const warnings: Array<{ code: string; message: string; platforms: string[] }> = [];
    if (kind === "video" && metadata?.width && metadata?.height) {
      const isVertical = metadata.height > metadata.width;
      if (!isVertical) {
        warnings.push({
          code: "not_vertical",
          message:
            "Video ini tidak berformat vertikal 9:16. Tampilan di Shorts, Reels, dan TikTok bisa terpotong.",
          platforms: ["youtube", "instagram", "tiktok"],
        });
      }
    }

    return NextResponse.json(
      {
        upload_id: uploadId,
        kind,
        bucket,
        object_path: objectPath,
        signed_upload_url: uploadData.signedUrl,
        upload: {
          method: "signed_url",
          url: uploadData.signedUrl,
          token: uploadData.token,
        },
        warnings,
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
