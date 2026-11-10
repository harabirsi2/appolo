import { NextResponse, type NextRequest } from "next/server";
import { mediaKindSchema } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { cancelRankingRefresh, refreshRankingModel } from "@/lib/services/rankings";

export const dynamic = "force-dynamic";

/**
 * GET /api/rankings/model?kind=movie
 *
 * Rebuilds the caller's Bradley–Terry + Davidson fit from their comparison
 * history and returns positions, personal scores and uncertainty. The fit is
 * reproducible: deleting this response changes nothing, because
 * `item_matchups` is the durable source of truth.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");

    const parsed = mediaKindSchema.safeParse(request.nextUrl.searchParams.get("kind") ?? "movie");
    if (!parsed.success) {
      return jsonError("Unknown media kind.", 400, "INVALID_KIND");
    }

    // This route is an explicit rebuild, so drop any queued background fit and
    // pay for exactly one.
    cancelRankingRefresh(session.org.id, parsed.data);
    const model = await refreshRankingModel(session.org.id, parsed.data);

    return NextResponse.json({
      kind: model.kind,
      comparisons: model.comparisons,
      tieParameter: model.tieParameter,
      converged: model.converged,
      logLikelihood: model.logLikelihood,
      updatedAt: model.updatedAt,
      items: model.items.map((item) => ({
        id: item.id,
        theta: item.theta,
        standardError: item.standardError,
        lower: item.lower,
        upper: item.upper,
        comparisons: item.comparisons,
        wins: item.wins,
        losses: item.losses,
        ties: item.ties,
        winRate: item.winRate,
        personalScore: item.personalScore,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
