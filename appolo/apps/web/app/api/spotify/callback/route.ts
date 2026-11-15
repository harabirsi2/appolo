import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { SPOTIFY_STATE_COOKIE, SPOTIFY_STATE_PATH } from "@/lib/spotify-oauth";
import { importSpotifyTopTracks } from "@/lib/services/importers";

export const dynamic = "force-dynamic";

function profileRedirect(request: NextRequest, status: string): NextResponse {
  const response = NextResponse.redirect(new URL(`/app/profile?spotify=${status}`, request.url));
  response.cookies.set(SPOTIFY_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: SPOTIFY_STATE_PATH,
    maxAge: 0,
  });
  return response;
}

/**
 * Spotify OAuth callback. Exchanges the code for a token, fetches the user's
 * top tracks, and imports them into the catalog as rated music items.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");

    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return profileRedirect(request, "unconfigured");
    }

    const expectedState = request.cookies.get(SPOTIFY_STATE_COOKIE)?.value;
    const actualState = request.nextUrl.searchParams.get("state");
    if (
      !expectedState ||
      !actualState ||
      expectedState !== actualState ||
      !expectedState.startsWith(`${session.org.id}.`)
    ) {
      return profileRedirect(request, "state_error");
    }

    const code = request.nextUrl.searchParams.get("code");
    if (!code) {
      return profileRedirect(request, "cancelled");
    }

    const origin = request.nextUrl.origin;
    const redirectUri = process.env.SPOTIFY_REDIRECT_URI ?? `${origin}/api/spotify/callback`;

    const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!tokenResponse.ok) {
      return profileRedirect(request, "token_error");
    }
    const token = (await tokenResponse.json()) as { access_token?: string };
    if (!token.access_token) {
      return profileRedirect(request, "token_error");
    }

    await importSpotifyTopTracks(session.org.id, token.access_token);
    return profileRedirect(request, "imported");
  } catch (error) {
    return apiError(error);
  }
}