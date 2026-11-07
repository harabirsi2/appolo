import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { getCatalogItem, getRating, recentMatchups } from "@/lib/services/rankings";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ itemId: string }> };

export async function GET(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");

    const { itemId } = await params;
    const item = await getCatalogItem(itemId);
    if (!item) return jsonError("Item not found.", 404, "ITEM_NOT_FOUND");

    const [rating, history] = await Promise.all([
      getRating(session.org.id, itemId),
      recentMatchups(session.org.id, itemId),
    ]);

    return NextResponse.json({ item, rating, history });
  } catch (error) {
    return apiError(error);
  }
}
