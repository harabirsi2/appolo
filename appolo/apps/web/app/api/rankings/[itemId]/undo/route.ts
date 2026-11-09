import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { undoLastComparison } from "@/lib/services/rankings";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ itemId: string }> };

/**
 * POST /api/rankings/:itemId/undo
 * Undo the latest comparison involving this item and rebuild the model.
 */
export async function POST(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");

    const { itemId } = await params;
    const result = await undoLastComparison(session.org.id, itemId);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
