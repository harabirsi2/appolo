import { NextResponse, type NextRequest } from "next/server";
import { isSearchCategory } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { liveSearchEnabled, searchCatalog } from "@/lib/services/catalog-search";

export const dynamic = "force-dynamic";

/**
 * Unified catalog search.
 *
 * Local rows come back first; with a specific query and thin local results the
 * enabled metadata providers are consulted under a hard deadline and anything
 * new is upserted into the shared catalog. `category` accepts the search
 * lens values (movie, tv, anime, music, podcast, book, game).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");

    const params = request.nextUrl.searchParams;
    const categoryParam = params.get("category") ?? params.get("kind");
    const category = isSearchCategory(categoryParam) ? categoryParam : null;
    const q = (params.get("q") ?? "").trim().slice(0, 120);
    const limitParam = Number(params.get("limit"));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : 24;
    const live = params.get("live") === "1";

    const result = await searchCatalog({ category, q, limit, live, orgId: session.org.id });

    return NextResponse.json({
      items: result.items,
      origin: result.origin,
      providers: result.providers,
      liveSearch: liveSearchEnabled(),
    });
  } catch (error) {
    return apiError(error);
  }
}
