import { NextResponse, type NextRequest } from "next/server";
import { firstIssue, privateFeedbackSchema } from "@appolo/core";
import { apiError, jsonError } from "@/lib/api";
import { submitPrivateFeedback } from "@/lib/services/reviews";

export const dynamic = "force-dynamic";

/** Public private-feedback submission. Token-scoped, never gated. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_JSON");
    }

    const parsed = privateFeedbackSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_INPUT");

    await submitPrivateFeedback(parsed.data.token, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
