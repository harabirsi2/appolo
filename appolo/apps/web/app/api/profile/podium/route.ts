import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { setPodiumOrder } from "@/lib/services/social";
import { mediaKindSchema } from "@appolo/core/ranking";

const schema = z.object({
  kind: mediaKindSchema,
  itemIds: z.array(z.string().uuid()).max(5),
});

export const dynamic = "force-dynamic";

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
    const parsed = schema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid podium order.", 400, "INVALID_PODIUM");
    const profile = await setPodiumOrder(session.org.id, parsed.data.kind, parsed.data.itemIds);
    return NextResponse.json({ profile });
  } catch (error) {
    return apiError(error);
  }
}
