import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { importSpotifyTopTracks } from "@/lib/services/importers";

export const dynamic = "force-dynamic";

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
      return NextResponse.redirect(new URL("/app/profile?spotify=unconfigured", request.url));
    }

    const code = request.nextUrl.searchParams.get("code");
    if (!code) {
      return NextResponse.redirect(new URL("/app/profile?spotify=cancelled", request.url));
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
      return NextResponse.redirect(new URL("/app/profile?spotify=token_error", request.url));
    }
    const token = (await tokenResponse.json()) as { access_token?: string };
    if (!token.access_token) {
      return NextResponse.redirect(new URL("/app/profile?spotify=token_error", request.url));
    }

    await importSpotifyTopTracks(session.org.id, token.access_token);
    return NextResponse.redirect(new URL("/app/profile?spotify=imported", request.url));
  } catch (error) {
    return apiError(error);
  }
}