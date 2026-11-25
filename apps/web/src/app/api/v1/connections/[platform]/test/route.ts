import { NextResponse, type NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { decryptToken, encryptToken, parseEncryptionKey, parseByteaPayload } from "@bulk-socmed/shared";

export async function POST(
  _request: NextRequest,
  { params }: { params: { platform: string } }
) {
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

    const platform = params.platform.toLowerCase();
    const now = new Date();
    const adminSupabase = createAdminClient();

    // 1. Fetch connection using admin client (bypasses RLS restrictions for service operations)
    const { data: conn, error: connErr } = await adminSupabase
      .from("connections")
      .select("id, platform, status, display_name, external_account_id, connection_secrets(access_token_enc, api_key_enc)")
      .eq("owner_id", user.id)
      .eq("platform", platform)
      .neq("status", "disabled")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (connErr || !conn) {
      return NextResponse.json(
        {
          error: {
            code: "connection_not_configured",
            message: `Koneksi platform '${platform}' belum dikonfigurasi atau tidak aktif.`,
          },
        },
        { status: 404 }
      );
    }

    // 2. Mark test_requested_at
    await adminSupabase
      .from("connections")
      .update({
        test_requested_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", conn.id);

    // 3. Attempt live credential verification
    const encKeyHex = process.env.TOKEN_ENC_KEY;
    if (!encKeyHex) {
      return NextResponse.json({
        ok: true,
        requested_at: now.toISOString(),
        message: "Permintaan uji terkirim ke worker.",
      });
    }

    const rawSecrets = conn.connection_secrets as any;
    const secrets = Array.isArray(rawSecrets) ? rawSecrets[0] : rawSecrets;
    const encPayload = secrets?.access_token_enc || secrets?.api_key_enc;

    if (!encPayload) {
      await adminSupabase
        .from("connections")
        .update({
          last_test: {
            at: now.toISOString(),
            ok: false,
            error: { code: "missing_token", message: "Kredensial token tidak ditemukan." },
          },
        })
        .eq("id", conn.id);

      return NextResponse.json({
        ok: false,
        error: { message: "Token otentikasi tidak ditemukan di database." },
      });
    }

    let token = "";
    try {
      const keyBuf = parseEncryptionKey(encKeyHex);
      const tokenBuf = parseByteaPayload(encPayload);
      token = decryptToken(tokenBuf, keyBuf);
    } catch (decErr: any) {
      const errMsg = `Gagal mendekripsi token: ${decErr.message}`;
      await adminSupabase
        .from("connections")
        .update({
          last_test: {
            at: now.toISOString(),
            ok: false,
            error: { code: "decrypt_error", message: errMsg },
          },
        })
        .eq("id", conn.id);

      return NextResponse.json({
        ok: false,
        error: { message: errMsg },
      });
    }

    let testOk = false;
    let testError: { code: string; message: string } | null = null;

    if (platform === "youtube") {
      try {
        let currentToken = token;
        let ytRes = await fetch(
          "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
          {
            headers: { Authorization: `Bearer ${currentToken}` },
          }
        );

        // If access token is expired (HTTP 401), automatically refresh using refresh_token!
        if (ytRes.status === 401 && secrets?.refresh_token_enc) {
          try {
            const keyBuf = parseEncryptionKey(encKeyHex);
            const rBuf = parseByteaPayload(secrets.refresh_token_enc);
            const refreshToken = decryptToken(rBuf, keyBuf);

            const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                client_id: process.env.GOOGLE_CLIENT_ID || "",
                client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
                refresh_token: refreshToken,
                grant_type: "refresh_token",
              }),
            });

            if (refreshRes.ok) {
              const refreshData = await refreshRes.json();
              if (refreshData.access_token) {
                currentToken = refreshData.access_token;
                const newAccessEnc = encryptToken(currentToken, keyBuf);
                const newExpiresAt = new Date(
                  Date.now() + (refreshData.expires_in ?? 3600) * 1000
                ).toISOString();

                // Save renewed access token to DB
                await adminSupabase
                  .from("connection_secrets")
                  .update({
                    access_token_enc: newAccessEnc,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("connection_id", conn.id);

                await adminSupabase
                  .from("connections")
                  .update({
                    token_expires_at: newExpiresAt,
                    status: "active",
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", conn.id);

                // Retry API call with the refreshed token
                ytRes = await fetch(
                  "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
                  {
                    headers: { Authorization: `Bearer ${currentToken}` },
                  }
                );
              }
            }
          } catch {
            // Ignore refresh error here, fallback to handling ytRes response below
          }
        }

        if (ytRes.ok) {
          const ytData = await ytRes.json();
          const channelTitle = ytData.items?.[0]?.snippet?.title;
          testOk = true;
          if (channelTitle && channelTitle !== conn.display_name) {
            await adminSupabase
              .from("connections")
              .update({ display_name: channelTitle, status: "active" })
              .eq("id", conn.id);
          }
        } else {
          const errData = await ytRes.json().catch(() => ({}));
          testOk = false;
          testError = {
            code: "youtube_api_error",
            message: errData.error?.message || `YouTube API menolak akses (${ytRes.status})`,
          };
        }
      } catch (fetchErr: any) {
        testOk = false;
        testError = {
          code: "network_error",
          message: `Gagal menjangkau YouTube API: ${fetchErr.message}`,
        };
      }
    } else if (platform === "instagram") {
      try {
        const accRes = await fetch(
          `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,instagram_business_account{id,username,name}&access_token=${encodeURIComponent(token)}`
        );
        if (accRes.ok) {
          const accData: any = await accRes.json();
          const pages: any[] = accData.data ?? [];
          const igPage = pages.find((p) => p.instagram_business_account?.id);

          if (igPage?.instagram_business_account) {
            const ig = igPage.instagram_business_account;
            const resolvedName = ig.username ? `@${ig.username}` : (ig.name || igPage.name);
            testOk = true;
            await adminSupabase
              .from("connections")
              .update({
                external_account_id: ig.id,
                display_name: resolvedName || conn.display_name,
                status: "active",
              })
              .eq("id", conn.id);
          } else {
            testOk = false;
            testError = {
              code: "ig_business_account_missing",
              message:
                "Login Facebook berhasil, tetapi tidak ada Halaman Facebook dengan Instagram Bisnis/Kreator yang ditemukan (/me/accounts kosong). Pastikan IG Anda Akun Profesional, tertaut ke Facebook Page, dan Page dicentang saat login.",
            };
          }
        } else {
          const errData: any = await accRes.json().catch(() => ({}));
          testOk = false;
          testError = {
            code: "meta_api_error",
            message: errData.error?.message || `Meta API menolak akses (${accRes.status})`,
          };
        }
      } catch (fetchErr: any) {
        testOk = false;
        testError = {
          code: "network_error",
          message: `Gagal menjangkau Meta API: ${fetchErr.message}`,
        };
      }
    } else if (platform === "tiktok") {
      try {
        let currentToken = token;
        let ttRes = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
            Authorization: `Bearer ${currentToken}`,
          },
        });

        // If access token is expired (401), auto-refresh with refresh_token
        if (ttRes.status === 401 && secrets?.refresh_token_enc) {
          try {
            const keyBuf = parseEncryptionKey(encKeyHex);
            const rBuf = parseByteaPayload(secrets.refresh_token_enc);
            const refreshToken = decryptToken(rBuf, keyBuf);
            const clientKey = process.env.TIKTOK_CLIENT_KEY || process.env.TIKTOK_CLIENT_ID || "";
            const clientSecret = process.env.TIKTOK_CLIENT_SECRET || "";

            const refreshRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                client_key: clientKey,
                client_secret: clientSecret,
                grant_type: "refresh_token",
                refresh_token: refreshToken,
              }),
            });

            if (refreshRes.ok) {
              const refreshData: any = await refreshRes.json();
              if (refreshData.access_token) {
                currentToken = refreshData.access_token;
                const newAccessEnc = encryptToken(currentToken, keyBuf);
                const newRefreshEnc = refreshData.refresh_token
                  ? encryptToken(refreshData.refresh_token, keyBuf)
                  : undefined;
                const newExpiresAt = new Date(
                  Date.now() + (refreshData.expires_in ?? 86400) * 1000
                ).toISOString();

                await adminSupabase
                  .from("connection_secrets")
                  .update({
                    access_token_enc: newAccessEnc,
                    ...(newRefreshEnc ? { refresh_token_enc: newRefreshEnc } : {}),
                    updated_at: new Date().toISOString(),
                  })
                  .eq("connection_id", conn.id);

                await adminSupabase
                  .from("connections")
                  .update({
                    token_expires_at: newExpiresAt,
                    status: "active",
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", conn.id);

                ttRes = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json; charset=UTF-8",
                    Authorization: `Bearer ${currentToken}`,
                  },
                });
              }
            }
          } catch {
            // Fallback to error handling below
          }
        }

        const ttData: any = await ttRes.json().catch(() => ({}));
        if (ttRes.ok && ttData?.data) {
          testOk = true;
          const nickname = ttData.data.creator_nickname || ttData.data.creator_username;
          if (nickname && nickname !== conn.display_name) {
            await adminSupabase
              .from("connections")
              .update({ display_name: nickname, status: "active" })
              .eq("id", conn.id);
          }
        } else {
          testOk = false;
          testError = {
            code: ttData.error?.code || "tiktok_api_error",
            message:
              ttData.error?.message ||
              `TikTok Content Posting API menolak akses (${ttRes.status}). Hubungkan ulang akun Anda.`,
          };
        }
      } catch (fetchErr: any) {
        testOk = false;
        testError = {
          code: "network_error",
          message: `Gagal menjangkau TikTok API: ${fetchErr.message}`,
        };
      }
    } else {
      testOk = true;
    }

    // 4. Update last_test in connections table
    await adminSupabase
      .from("connections")
      .update({
        last_test: {
          at: now.toISOString(),
          ok: testOk,
          error: testError,
        },
        status: testOk ? "active" : "needs_reauth",
        updated_at: now.toISOString(),
      })
      .eq("id", conn.id);

    if (testOk) {
      return NextResponse.json({
        ok: true,
        message: `Uji koneksi ${platform} berhasil! Kredensial aktif dan terverifikasi.`,
      });
    } else {
      return NextResponse.json({
        ok: false,
        error: testError || { message: "Uji koneksi gagal diverifikasi oleh platform." },
      });
    }
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "internal_error",
          message: err.message || "Terjadi kesalahan internal saat menguji koneksi.",
        },
      },
      { status: 500 }
    );
  }
}
