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

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    request.headers.get("origin") ||
    "http://localhost:3000";

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
      const clientId = process.env.META_CLIENT_ID || "";
      const clientSecret = process.env.META_CLIENT_SECRET || "";

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

      // Fetch user accounts
      try {
        const meRes = await fetch(
          `https://graph.facebook.com/v19.0/me/accounts?access_token=${accessToken}`
        );
        const meData = await meRes.json();
        const page = meData.data?.[0];
        if (page) {
          displayName = page.name ?? displayName;
          externalAccountId = page.id;
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

    // 4. Upsert connection record
    const { data: conn, error: connError } = await adminSupabase
      .from("connections")
      .upsert(
        {
          owner_id: user.id,
          platform,
          provider: platform === "youtube" ? "youtube_api" : "instagram_graph",
          display_name: displayName,
          external_account_id: externalAccountId,
          status: "active",
          token_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id, platform" }
      )
      .select("id")
      .single();

    if (connError || !conn) {
      throw new Error(`Gagal menyimpan koneksi: ${connError?.message}`);
    }

    // 5. Upsert secrets
    const { error: secError } = await adminSupabase
      .from("connection_secrets")
      .upsert({
        connection_id: conn.id,
        access_token_enc: accessEnc,
        refresh_token_enc: refreshEnc,
        updated_at: new Date().toISOString(),
      });

    if (secError) {
      throw new Error(`Gagal menyimpan rahasia token: ${secError.message}`);
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
