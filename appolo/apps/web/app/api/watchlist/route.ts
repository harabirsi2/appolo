import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { toggleWatchlist, watchlistFor } from "@/lib/services/rankings";

const toggleSchema = z.object({ itemId: z.string().uuid() });

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    const items = await watchlistFor(session.org.id);
    return NextResponse.json({ items });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_BODY");
    }
    const parsed = toggleSchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid item.", 400, "INVALID_ITEM");
    const result = await toggleWatchlist(session.org.id, parsed.data.itemId);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}