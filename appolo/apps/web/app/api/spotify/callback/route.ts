import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { jsonError } from "@/lib/api";
import {
  SPOTIFY_STATE_COOKIE,
  SPOTIFY_STATE_PATH,
  isValidSpotifyState,
} from "@/lib/spotify-oauth";
import { importSpotifyTopTracks } from "@/lib/services/importers";
import { recordSpotifyConnection } from "@/lib/services/social-graph";

export const dynamic = "force-dynamic";

type SpotifyOutcome =
  | "state_error"
  | "cancelled"
  | "unconfigured"
  | "token_error"
  | "imported"
  | "error";

function clearStateCookie(response: NextResponse): void {
  response.cookies.set(SPOTIFY_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: SPOTIFY_STATE_PATH,
    maxAge: 0,
  });
}

function profileRedirect(request: NextRequest, status: SpotifyOutcome): NextResponse {
  const response = NextResponse.redirect(new URL(`/app/profile?spotify=${status}`, request.url));
  clearStateCookie(response);
  return response;
}

/**
 * Spotify OAuth callback. Exchanges the code for a token, fetches the user's
 * top tracks, imports them as unrated watchlist entries, and records that the
 * OAuth connection completed.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");

    // Validate the browser-bound state before reporting configuration or
    // exchanging anything. This also keeps the route testable without live
    // Spotify credentials: a valid state reaches `unconfigured`, a forged one
    // is rejected as `state_error`.
    const expectedState = request.cookies.get(SPOTIFY_STATE_COOKIE)?.value;
    const actualState = request.nextUrl.searchParams.get("state");
    if (!isValidSpotifyState(expectedState, actualState, session.org.id)) {
      return profileRedirect(request, "state_error");
    }

    const code = request.nextUrl.searchParams.get("code");
    if (!code) {
      return profileRedirect(request, "cancelled");
    }

    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return profileRedirect(request, "unconfigured");
    }

    const origin = request.nextUrl.origin;
    const redirectUri = process.env.SPOTIFY_REDIRECT_URI ?? `${origin}/api/spotify/callback`;

    const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
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
    await recordSpotifyConnection(session.org.id);
    return profileRedirect(request, "imported");
  } catch (error) {
    // The callback should land back on the profile with a clear outcome, and a
    // token/import failure must not leave a replayable state cookie behind.
    console.error("[spotify] callback failed:", error);
    return profileRedirect(request, "error");
  }
}
