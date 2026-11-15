import { randomUUID } from "node:crypto";

/** Cookie that binds a Spotify OAuth authorization request to this browser. */
export const SPOTIFY_STATE_COOKIE = "appolo_spotify_state";
export const SPOTIFY_STATE_PATH = "/api/spotify";
export const SPOTIFY_STATE_MAX_AGE_SECONDS = 10 * 60;

/** State is an org-bound nonce; the cookie is the unguessable secret. */
export function createSpotifyState(orgId: string): string {
  return `${orgId}.${randomUUID()}`;
}

export function isValidSpotifyState(
  expected: string | null | undefined,
  actual: string | null | undefined,
  orgId: string,
): boolean {
  return Boolean(expected && expected === actual && expected.startsWith(`${orgId}.`));
}
