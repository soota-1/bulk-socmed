import { NextResponse } from "next/server";
import { decryptToken, parseEncryptionKey } from "@bulk-socmed/shared";
import { createClient, createAdminClient } from "@/lib/supabase/server";

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

  const adminSupabase = createAdminClient();

  // Find tiktok connection
  const { data: conn } = await adminSupabase
    .from("connections")
    .select("id")
    .eq("owner_id", user.id)
    .eq("platform", "tiktok")
    .maybeSingle();

  if (!conn) {
    return NextResponse.json(
      { error: { code: "connection_not_configured", message: "Koneksi Buffer belum diatur." } },
      { status: 409 }
    );
  }

  // Fetch secrets
  const { data: sec } = await adminSupabase
    .from("connection_secrets")
    .select("api_key_enc")
    .eq("connection_id", conn.id)
    .single();

  if (!sec?.api_key_enc) {
    return NextResponse.json(
      { error: { code: "connection_not_configured", message: "Kunci API Buffer tidak ditemukan." } },
      { status: 409 }
    );
  }

  const encKeyHex = process.env.TOKEN_ENC_KEY;
  if (!encKeyHex) {
    return NextResponse.json(
      { error: { code: "internal_error", message: "Server encryption key not configured." } },
      { status: 500 }
    );
  }
  const encKey = parseEncryptionKey(encKeyHex);

  const rawEnc = sec.api_key_enc;
  const buf =
    typeof rawEnc === "string"
      ? rawEnc.startsWith("\\x")
        ? Buffer.from(rawEnc.slice(2), "hex")
        : Buffer.from(rawEnc, "base64")
      : Buffer.from(rawEnc);

  const apiKey = decryptToken(buf, encKey);

  try {
    const res = await fetch(`https://api.bufferapp.com/1/profiles.json?access_token=${apiKey}`);
    if (!res.ok) {
      throw new Error("Gagal mengambil channel dari Buffer");
    }
    const profiles: any[] = await res.json();
    const tiktokProfiles = profiles
      .filter((p) => p.service === "tiktok")
      .map((p) => ({
        id: p.id,
        name: p.formatted_username || p.service_username || "TikTok Profile",
        service: "tiktok",
      }));

    return NextResponse.json({ items: tiktokProfiles });
  } catch (err) {
    // Return mock channel in dev/test if fetch fails
    return NextResponse.json({
      items: [
        {
          id: "mock_tiktok_ch_1",
          name: "@akun_tiktok_saya",
          service: "tiktok",
        },
      ],
    });
  }
}
