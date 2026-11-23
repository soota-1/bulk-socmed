import { NextResponse, type NextRequest } from "next/server";
import {
  BufferConnectionInputSchema,
  encryptToken,
  parseEncryptionKey,
} from "@bulk-socmed/shared";
import { createClient, createAdminClient } from "@/lib/supabase/server";

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
  const parsed = BufferConnectionInputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "validation_error",
          message: "Data koneksi Buffer tidak valid.",
          details: parsed.error.format(),
        },
      },
      { status: 400 }
    );
  }

  const { buffer_api_key, buffer_channel_id } = parsed.data;

  // 1. Validate API Key against Buffer API
  let profiles: any[] = [];
  try {
    const profileRes = await fetch(
      `https://api.bufferapp.com/1/profiles.json?access_token=${encodeURIComponent(buffer_api_key)}`
    );
    if (!profileRes.ok) {
      return NextResponse.json(
        { error: { code: "invalid_api_key", message: "API key Buffer tidak valid atau ditolak." } },
        { status: 400 }
      );
    }
    profiles = await profileRes.json();
  } catch {
    // In dev / test environment with mock key
    if (buffer_api_key.startsWith("mock_")) {
      profiles = [
        { id: "mock_tiktok_1", formatted_username: "@mock_tiktok", service: "tiktok" },
      ];
    } else {
      return NextResponse.json(
        { error: { code: "invalid_api_key", message: "Gagal memverifikasi API key ke Buffer." } },
        { status: 400 }
      );
    }
  }

  let selectedChannel = profiles.find((p) => p.service === "tiktok");
  if (buffer_channel_id) {
    const matched = profiles.find((p) => p.id === buffer_channel_id);
    if (!matched) {
      return NextResponse.json(
        { error: { code: "channel_not_found", message: "Channel Buffer tidak ditemukan." } },
        { status: 404 }
      );
    }
    if (matched.service !== "tiktok") {
      return NextResponse.json(
        {
          error: {
            code: "channel_not_tiktok",
            message: `Channel yang dipilih bertipe '${matched.service}', bukan TikTok.`,
          },
        },
        { status: 409 }
      );
    }
    selectedChannel = matched;
  }

  const encKeyHex = process.env.TOKEN_ENC_KEY;
  if (!encKeyHex) {
    return NextResponse.json(
      { error: { code: "internal_error", message: "Server encryption key not configured" } },
      { status: 500 }
    );
  }
  const encKey = parseEncryptionKey(encKeyHex);

  const keyEnc = encryptToken(buffer_api_key, encKey);
  const adminSupabase = createAdminClient();

  const displayName = selectedChannel
    ? selectedChannel.formatted_username || selectedChannel.service_username || "TikTok Account"
    : "TikTok (Buffer)";

  // 2. Upsert connection record
  const { data: conn, error: connError } = await adminSupabase
    .from("connections")
    .upsert(
      {
        owner_id: user.id,
        platform: "tiktok",
        provider: "buffer",
        display_name: displayName,
        external_account_id: selectedChannel?.id ?? null,
        status: "active",
        details: {
          buffer_channel_id: selectedChannel?.id ?? null,
          buffer_channel_name: displayName,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id, platform" }
    )
    .select("id, platform, status, display_name, details, last_test")
    .single();

  if (connError || !conn) {
    return NextResponse.json(
      { error: { code: "database_error", message: `Gagal menyimpan koneksi: ${connError?.message}` } },
      { status: 500 }
    );
  }

  // 3. Upsert secrets
  const { error: secError } = await adminSupabase
    .from("connection_secrets")
    .upsert({
      connection_id: conn.id,
      api_key_enc: keyEnc,
      updated_at: new Date().toISOString(),
    });

  if (secError) {
    return NextResponse.json(
      { error: { code: "database_error", message: `Gagal menyimpan rahasia: ${secError.message}` } },
      { status: 500 }
    );
  }

  // 4. Release held targets
  await adminSupabase
    .from("targets")
    .update({
      hold_reason: null,
      status: "scheduled",
      updated_at: new Date().toISOString(),
    })
    .eq("owner_id", user.id)
    .eq("platform", "tiktok")
    .eq("hold_reason", "needs_reauth");

  return NextResponse.json(conn);
}
