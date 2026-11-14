import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";

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
    const state = `${session.org.id}:${Math.random().toString(36).slice(2)}`;

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: "user-top-read",
      state,
    });
    return NextResponse.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
  } catch (error) {
    return apiError(error);
  }
}