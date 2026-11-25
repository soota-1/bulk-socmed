import { NextResponse, type NextRequest } from "next/server";
import {
  BufferConnectionInputSchema,
  encryptToken,
  parseEncryptionKey,
} from "@bulk-socmed/shared";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { DELETE as deletePlatformConnection } from "../[platform]/route";

export async function DELETE(request: NextRequest) {
  return deletePlatformConnection(request, { params: { platform: "tiktok" } });
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

  // 1. Validate API Key against Buffer GraphQL API (https://api.buffer.com)
  let profiles: any[] = [];
  try {
    const cleanKey = buffer_api_key.trim();

    // Step A: Fetch account & organizations
    const orgsRes = await fetch("https://api.buffer.com", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cleanKey}`,
      },
      body: JSON.stringify({
        query: `
          query GetAccountOrganizations {
            account {
              id
              email
              name
              organizations {
                id
                name
              }
            }
          }
        `,
      }),
    });

    if (!orgsRes.ok) {
      const errText = await orgsRes.text().catch(() => "");
      return NextResponse.json(
        {
          error: {
            code: "invalid_api_key",
            message: `Buffer API menolak token (${orgsRes.status}: ${errText || orgsRes.statusText}).`,
          },
        },
        { status: 400 }
      );
    }

    const orgsData = await orgsRes.json();
    if (orgsData.errors && orgsData.errors.length > 0) {
      const msg = orgsData.errors[0]?.message || "Akses ke akun Buffer ditolak";
      return NextResponse.json(
        {
          error: {
            code: "invalid_api_key",
            message: `Buffer API menolak: ${msg}. Pastikan email akun Buffer sudah diverifikasi dan token memiliki izin akses.`,
          },
        },
        { status: 400 }
      );
    }

    const orgs = orgsData.data?.account?.organizations || [];
    if (orgs.length === 0) {
      return NextResponse.json(
        {
          error: {
            code: "no_organization",
            message: "Tidak ditemukan organisasi/workspace di akun Buffer Anda.",
          },
        },
        { status: 404 }
      );
    }

    // Step B: Fetch channels for each organization using channels(input: { organizationId: "..." })
    for (const org of orgs) {
      const chRes = await fetch("https://api.buffer.com", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cleanKey}`,
        },
        body: JSON.stringify({
          query: `
            query GetOrgChannels($orgId: OrganizationId!) {
              channels(input: { organizationId: $orgId }) {
                id
                name
                displayName
                service
              }
            }
          `,
          variables: { orgId: org.id },
        }),
      });

      if (chRes.ok) {
        const chData = await chRes.json();
        const chList = chData.data?.channels;
        if (Array.isArray(chList)) {
          profiles.push(...chList);
        }
      }
    }
  } catch (netErr: any) {
    if (buffer_api_key.startsWith("mock_")) {
      profiles = [
        { id: "mock_tiktok_1", formatted_username: "@mock_tiktok", service: "tiktok" },
      ];
    } else {
      return NextResponse.json(
        {
          error: {
            code: "network_error",
            message: `Gagal menghubungi server Buffer: ${netErr?.message || "Kesalahan koneksi jaringan"}`,
          },
        },
        { status: 502 }
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

  // 2. Find existing connection or insert
  const { data: existingConn } = await adminSupabase
    .from("connections")
    .select("id")
    .eq("owner_id", user.id)
    .eq("platform", "tiktok")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  let conn: any;

  if (existingConn) {
    const { data: updated, error: updateErr } = await adminSupabase
      .from("connections")
      .update({
        provider: "buffer",
        display_name: displayName,
        external_account_id: selectedChannel?.id ?? null,
        status: "active",
        details: {
          buffer_channel_id: selectedChannel?.id ?? null,
          buffer_channel_name: displayName,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingConn.id)
      .select("id, platform, status, display_name, details, last_test")
      .single();

    if (updateErr || !updated) {
      return NextResponse.json(
        { error: { code: "database_error", message: `Gagal memperbarui koneksi: ${updateErr?.message}` } },
        { status: 500 }
      );
    }
    conn = updated;
  } else {
    const { data: inserted, error: insertErr } = await adminSupabase
      .from("connections")
      .insert({
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
      })
      .select("id, platform, status, display_name, details, last_test")
      .single();

    if (insertErr || !inserted) {
      return NextResponse.json(
        { error: { code: "database_error", message: `Gagal menyimpan koneksi: ${insertErr?.message}` } },
        { status: 500 }
      );
    }
    conn = inserted;
  }

  // 3. Save secrets (update if exists, else insert)
  const { data: existingSec } = await adminSupabase
    .from("connection_secrets")
    .select("connection_id")
    .eq("connection_id", conn.id)
    .maybeSingle();

  if (existingSec) {
    const { error: secError } = await adminSupabase
      .from("connection_secrets")
      .update({
        api_key_enc: keyEnc,
        updated_at: new Date().toISOString(),
      })
      .eq("connection_id", conn.id);

    if (secError) {
      return NextResponse.json(
        { error: { code: "database_error", message: `Gagal menyimpan rahasia: ${secError.message}` } },
        { status: 500 }
      );
    }
  } else {
    const { error: secError } = await adminSupabase
      .from("connection_secrets")
      .insert({
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
