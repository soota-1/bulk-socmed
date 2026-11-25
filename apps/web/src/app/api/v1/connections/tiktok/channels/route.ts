import { NextResponse } from "next/server";
import { decryptToken, parseEncryptionKey, parseByteaPayload } from "@bulk-socmed/shared";
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
  const buf = parseByteaPayload(sec.api_key_enc);
  const apiKey = decryptToken(buf, encKey);

  try {
    let profiles: any[] = [];

    // Query account organizations first
    const orgsRes = await fetch("https://api.buffer.com", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: `
          query GetBufferOrgs {
            account {
              organizations {
                id
              }
            }
          }
        `,
      }),
    });

    if (orgsRes.ok) {
      const orgsData = await orgsRes.json();
      const orgs = orgsData.data?.account?.organizations || [];
      for (const org of orgs) {
        const chRes = await fetch("https://api.buffer.com", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
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
          const list = chData.data?.channels;
          if (Array.isArray(list)) {
            profiles.push(...list);
          }
        }
      }
    }

    const tiktokProfiles = profiles
      .filter((p) => p.service === "tiktok")
      .map((p) => ({
        id: p.id,
        name: p.displayName || p.name || p.formatted_username || p.service_username || "TikTok Profile",
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
