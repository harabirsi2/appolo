import { NextResponse } from "next/server";
import { can } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { sendDueFollowUps } from "@/lib/services/reviews";

export const dynamic = "force-dynamic";

/** Sends the next reminder to requests that have gone quiet. */
export async function POST(): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "reviews:request")) {
      return jsonError("Your role cannot send follow-ups.", 403, "FORBIDDEN");
    }

    const result = await sendDueFollowUps(session.org.id, { id: session.user.id });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}