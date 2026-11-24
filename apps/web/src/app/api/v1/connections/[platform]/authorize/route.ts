import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: { platform: string } }
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

  const platform = params.platform.toLowerCase();
  if (platform !== "youtube" && platform !== "instagram") {
    return NextResponse.json(
      {
        error: {
          code: "invalid_platform",
          message: `Platform '${platform}' tidak mendukung OAuth authorize. Hanya 'youtube' atau 'instagram'.`,
        },
      },
      { status: 400 }
    );
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    request.headers.get("origin") ||
    "http://localhost:3000";

  const redirectUri = `${appUrl}/api/oauth/${platform}/callback`;
  const state = crypto.randomBytes(24).toString("hex");
  const stateExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

  // Set HTTP-only cookie for state verification
  cookies().set({
    name: `oauth_state_${platform}`,
    value: state,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes
  });

  let authorizeUrl = "";
  if (platform === "youtube") {
    const clientId = process.env.GOOGLE_CLIENT_ID || "MOCK_GOOGLE_CLIENT_ID";
    const scopes = [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube",
    ].join(" ");

    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes,
      access_type: "offline",
      prompt: "consent",
      state,
    });
    authorizeUrl = `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
  } else if (platform === "instagram") {
    const clientId = process.env.META_CLIENT_ID || process.env.META_APP_ID || "MOCK_META_CLIENT_ID";
    const scopes = "instagram_basic,instagram_content_publish,pages_show_list";

    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes,
      state,
    });
    authorizeUrl = `https://www.facebook.com/v19.0/dialog/oauth?${query.toString()}`;
  }

  return NextResponse.json({
    authorize_url: authorizeUrl,
    state_expires_at: stateExpiresAt,
  });
}
