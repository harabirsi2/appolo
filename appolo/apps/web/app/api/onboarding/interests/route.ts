import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { mediaKindSchema } from "@appolo/core";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { saveInterests } from "@/lib/services/interests";

const schema = z.object({
  picks: z
    .array(
      z.object({
        kind: mediaKindSchema,
        genre: z.string().trim().min(1).max(60),
      }),
    )
    .max(80),
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
    if (!parsed.success) {
      return jsonError("Pick interests from the available kinds and genres.", 400, "INVALID_INTERESTS");
    }

    const saved = await saveInterests(session.org.id, parsed.data.picks);
    return NextResponse.json({ saved });
  } catch (error) {
    return apiError(error);
  }
}
