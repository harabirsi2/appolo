import { NextResponse, type NextRequest } from "next/server";
import { catalogQuerySchema, firstIssue } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { listCatalog, ratedItemIds } from "@/lib/services/rankings";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");

    const params = request.nextUrl.searchParams;
    const parsed = catalogQuerySchema.safeParse({
      kind: params.get("kind") ?? undefined,
      q: params.get("q") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_QUERY");

    const [items, rated] = await Promise.all([
      listCatalog(parsed.data),
      ratedItemIds(session.org.id),
    ]);

    const ratedSet = new Set(rated);
    return NextResponse.json({
      items: items.map((item) => ({ ...item, rated: ratedSet.has(item.id) })),
    });
  } catch (error) {
    return apiError(error);
  }
}
