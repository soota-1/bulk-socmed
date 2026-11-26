import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { encryptToken, parseEncryptionKey } from "@bulk-socmed/shared";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function GET(
  request: NextRequest,
  { params }: { params: { platform: string } }
) {
  const platform = params.platform.toLowerCase();
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  const origin = request.nextUrl.origin || request.headers.get("origin") || "http://localhost:3000";
  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const appUrl =
    configuredAppUrl &&
    !configuredAppUrl.includes("<") &&
    !configuredAppUrl.includes("nama-app") &&
    !configuredAppUrl.includes("your-app")
      ? configuredAppUrl
      : origin;

  if (errorParam) {
    return NextResponse.redirect(`${appUrl}/connections?error=${encodeURIComponent(errorParam)}`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/connections?error=missing_code_or_state`);
  }

  // 1. Verify CSRF state cookie
  const cookieState = cookies().get(`oauth_state_${platform}`)?.value;
  if (!cookieState || cookieState !== state) {
    return NextResponse.redirect(`${appUrl}/connections?error=invalid_state`);
  }

  // Clear state cookie
  cookies().delete(`oauth_state_${platform}`);

  // 2. Verify authenticated user
  const userSupabase = createClient();
  const {
    data: { user },
  } = await userSupabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${appUrl}/login?next=/connections`);
  }

  const encKeyHex = process.env.TOKEN_ENC_KEY;
  if (!encKeyHex) {
    return NextResponse.redirect(`${appUrl}/connections?error=missing_encryption_key`);
  }
  const encKey = parseEncryptionKey(encKeyHex);

  const redirectUri = `${appUrl}/api/oauth/${platform}/callback`;

  let accessToken = "";
  let refreshToken: string | undefined;
  let expiresInSeconds = 3600;
  let displayName = `${platform} Account`;
  let externalAccountId: string | undefined;

  try {
    if (platform === "youtube") {
      const clientId = process.env.GOOGLE_CLIENT_ID || "";
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.access_token) {
        throw new Error(tokenData.error_description || "Gagal menukar token YouTube");
      }

      accessToken = tokenData.access_token;
      refreshToken = tokenData.refresh_token;
      expiresInSeconds = tokenData.expires_in ?? 3600;

      // Fetch channel details
      try {
        const channelRes = await fetch(
          "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const channelData = await channelRes.json();
        const item = channelData.items?.[0];
        if (item) {
          displayName = item.snippet?.title ?? displayName;
          externalAccountId = item.id;
        }
      } catch {
        // Fallback display name
      }
    } else if (platform === "instagram") {
      const clientId = process.env.META_CLIENT_ID || process.env.META_APP_ID || "";
      const clientSecret = process.env.META_CLIENT_SECRET || process.env.META_APP_SECRET || "";

      const tokenRes = await fetch(
        `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${clientId}&client_secret=${clientSecret}&redirect_uri=${encodeURIComponent(
          redirectUri
        )}&code=${code}`
      );

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.access_token) {
        throw new Error(tokenData.error?.message || "Gagal menukar token Meta/Instagram");
      }

      accessToken = tokenData.access_token;
      expiresInSeconds = tokenData.expires_in ?? 5184000; // 60 days for long-lived

      // Fetch linked Facebook Pages and their Instagram Business Account
      const meRes = await fetch(
        `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name}&access_token=${encodeURIComponent(accessToken)}`
      );
      const meData: any = await meRes.json();
      const pages: any[] = meData.data ?? [];
      let igAccount = pages.find((p) => p.instagram_business_account?.id)?.instagram_business_account;

      // Fallback: If not returned directly on /me/accounts, query each page with its page access token
      if (!igAccount && pages.length > 0) {
        for (const p of pages) {
          if (!p.id || !p.access_token) continue;
          try {
            const pageRes = await fetch(
              `https://graph.facebook.com/v19.0/${p.id}?fields=instagram_business_account{id,username,name}&access_token=${encodeURIComponent(p.access_token)}`
            );
            if (pageRes.ok) {
              const pageData: any = await pageRes.json();
              if (pageData.instagram_business_account?.id) {
                igAccount = pageData.instagram_business_account;
                break;
              }
            }
          } catch {
            // Ignore individual page fetch errors
          }
        }
      }

      if (igAccount?.id) {
        externalAccountId = igAccount.id;
        displayName = igAccount.username ? `@${igAccount.username}` : (igAccount.name || displayName);
      } else if (pages.length === 0) {
        throw new Error(
          "Tidak ada Halaman Facebook yang terdeteksi. Saat jendela login Facebook muncul, pastikan Anda mencentang/memilih Halaman Facebook Anda (jangan klik lewati/uncheck Halaman)."
        );
      } else {
        const pageNames = pages.map((p) => `"${p.name || p.id}"`).join(", ");
        throw new Error(
          `Ditemukan Halaman Facebook: ${pageNames}, tetapi belum ada akun Instagram Profesional yang ditautkan ke Halaman tersebut. Buka aplikasi Instagram di HP Anda -> Edit Profil -> Bagian 'Halaman' (Page) -> Tautkan ke salah satu Halaman Facebook tersebut, lalu coba hubungkan ulang.`
        );
      }
    } else if (platform === "tiktok") {
      const clientKey = process.env.TIKTOK_CLIENT_KEY || process.env.TIKTOK_CLIENT_ID || "";
      const clientSecret = process.env.TIKTOK_CLIENT_SECRET || "";

      const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: clientKey,
          client_secret: clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.access_token) {
        throw new Error(
          tokenData.error_description || tokenData.error?.message || "Gagal menukar kode otorisasi TikTok"
        );
      }

      accessToken = tokenData.access_token;
      refreshToken = tokenData.refresh_token;
      expiresInSeconds = tokenData.expires_in ?? 86400; // 24 hours
      externalAccountId = tokenData.open_id;

      // Fetch user profile info
      try {
        const userRes = await fetch(
          "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username",
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const userData: any = await userRes.json();
        const u = userData?.data?.user;
        if (u) {
          displayName = u.username ? `@${u.username}` : (u.display_name || displayName);
          if (u.open_id) externalAccountId = u.open_id;
        }
      } catch {
        // Fallback display name
      }
    } else {
      return NextResponse.redirect(`${appUrl}/connections?error=unsupported_platform`);
    }

    // 3. Encrypt tokens with AES-256-GCM
    const accessEnc = encryptToken(accessToken, encKey);
    const refreshEnc = refreshToken ? encryptToken(refreshToken, encKey) : null;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    const adminSupabase = createAdminClient();

    // 4. Find existing connection or insert
    const { data: existingConn } = await adminSupabase
      .from("connections")
      .select("id")
      .eq("owner_id", user.id)
      .eq("platform", platform)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    let conn: { id: number };

    const providerName =
      platform === "youtube"
        ? "youtube_api"
        : platform === "instagram"
        ? "instagram_graph"
        : "buffer";

    if (existingConn) {
      const { data: updated, error: updateErr } = await adminSupabase
        .from("connections")
        .update({
          provider: providerName,
          display_name: displayName,
          external_account_id: externalAccountId,
          status: "active",
          token_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingConn.id)
        .select("id")
        .single();

      if (updateErr || !updated) {
        throw new Error(`Gagal memperbarui koneksi: ${updateErr?.message}`);
      }
      conn = updated;
    } else {
      const { data: inserted, error: insertErr } = await adminSupabase
        .from("connections")
        .insert({
          owner_id: user.id,
          platform,
          provider: providerName,
          display_name: displayName,
          external_account_id: externalAccountId,
          status: "active",
          token_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (insertErr || !inserted) {
        throw new Error(`Gagal menyimpan koneksi: ${insertErr?.message}`);
      }
      conn = inserted;
    }

    // 5. Save secrets (update if exists, else insert)
    const { data: existingSec } = await adminSupabase
      .from("connection_secrets")
      .select("connection_id")
      .eq("connection_id", conn.id)
      .maybeSingle();

    if (existingSec) {
      const { error: secError } = await adminSupabase
        .from("connection_secrets")
        .update({
          access_token_enc: accessEnc,
          refresh_token_enc: refreshEnc,
          updated_at: new Date().toISOString(),
        })
        .eq("connection_id", conn.id);

      if (secError) {
        throw new Error(`Gagal menyimpan rahasia token: ${secError.message}`);
      }
    } else {
      const { error: secError } = await adminSupabase
        .from("connection_secrets")
        .insert({
          connection_id: conn.id,
          access_token_enc: accessEnc,
          refresh_token_enc: refreshEnc,
          updated_at: new Date().toISOString(),
        });

      if (secError) {
        throw new Error(`Gagal menyimpan rahasia token: ${secError.message}`);
      }
    }

    // 6. Release any targets held due to needs_reauth
    await adminSupabase
      .from("targets")
      .update({
        hold_reason: null,
        status: "scheduled",
        updated_at: new Date().toISOString(),
      })
      .eq("owner_id", user.id)
      .eq("platform", platform)
      .eq("hold_reason", "needs_reauth");

    return NextResponse.redirect(`${appUrl}/connections?connected=${platform}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OAuth exchange failed";
    return NextResponse.redirect(`${appUrl}/connections?error=${encodeURIComponent(msg)}`);
  }
}
