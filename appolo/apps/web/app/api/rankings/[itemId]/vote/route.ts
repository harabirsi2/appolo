import { NextResponse, type NextRequest } from "next/server";
import { invalidateCommunity } from "@/lib/cache";
import { firstIssue, voteInputSchema } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError, rateLimited } from "@/lib/api";
import { consumeAction, VOTE_WINDOW } from "@/lib/services/action-rate-limit";
import { submitVote } from "@/lib/services/rankings";
import { revalidatePublicPodiumCard, revalidatePublicProfile } from "@/lib/revalidate-public";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ itemId: string }> };

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");

    const limit = await consumeAction("vote", session.org.id, VOTE_WINDOW);
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

    const { itemId } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_BODY");
    }

    const parsed = voteInputSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_VOTE");

    // Set by the client for every vote; the service worker replays it verbatim
    // when a vote taken offline finally reaches the server.
    const outcome = await submitVote(session.org.id, itemId, parsed.data.opponentId, parsed.data.result, {
      idempotencyKey: request.headers.get("idempotency-key"),
    });
    invalidateCommunity();
    // A replay changed nothing, so there is nothing to invalidate for it; the
    // header also stops a proxy from serving one user's result to another.
    if (outcome.replayed) return NextResponse.json(outcome, { headers: { "x-idempotent-replay": "1" } });
    // A vote moves the podium, which is what the share card renders.
    revalidatePublicPodiumCard();
    revalidatePublicProfile();
    return NextResponse.json(outcome);
  } catch (error) {
    return apiError(error);
  }
}
