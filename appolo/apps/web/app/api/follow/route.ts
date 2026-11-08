import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { firstIssue } from "@appolo/core";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { getProfileByUsername, setFollow } from "@/lib/services/social";

export const dynamic = "force-dynamic";

const followSchema = z.object({
  username: z.string().trim().min(1).max(60).optional(),
  orgId: z.string().uuid().optional(),
  follow: z.boolean(),
});

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
    const parsed = followSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_FOLLOW");

    let targetOrgId = parsed.data.orgId;
    if (!targetOrgId && parsed.data.username) {
      const profile = await getProfileByUsername(parsed.data.username);
      if (!profile) return jsonError("Profile not found.", 404, "PROFILE_NOT_FOUND");
      targetOrgId = profile.orgId;
    }
    if (!targetOrgId) return jsonError("Provide a username or org id.", 400, "INVALID_FOLLOW");

    const outcome = await setFollow(session.org.id, targetOrgId, parsed.data.follow);
    return NextResponse.json(outcome);
  } catch (error) {
    return apiError(error);
  }
}