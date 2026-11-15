import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { SPOTIFY_STATE_COOKIE, SPOTIFY_STATE_PATH } from "@/lib/spotify-oauth";

export const dynamic = "force-dynamic";

/**
 * Starts the Spotify authorization flow for importing the user's top tracks.
 * Requires `SPOTIFY_CLIENT_ID` to be configured.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");

    const clientId = process.env.SPOTIFY_CLIENT_ID;
    if (!clientId) {
      return jsonError("Spotify is not configured on this server.", 503, "SPOTIFY_NOT_CONFIGURED");
    }
    const origin = request.nextUrl.origin;
    const redirectUri = process.env.SPOTIFY_REDIRECT_URI ?? `${origin}/api/spotify/callback`;
    // Bind the callback to this session and this browser. Without the cookie
    // check an attacker could complete an OAuth flow on a victim's session.
    const state = `${session.org.id}.${randomUUID()}`;

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: "user-top-read",
      state,
    });
    const response = NextResponse.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
    response.cookies.set(SPOTIFY_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: SPOTIFY_STATE_PATH,
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    return apiError(error);
  }
}