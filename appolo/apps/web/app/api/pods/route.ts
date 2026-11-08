import { NextResponse, type NextRequest } from "next/server";
import { firstIssue } from "@appolo/core";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { createPod, podInputSchema, podsForProfile, getProfileByOrgId } from "@/lib/services/social";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    const profile = await getProfileByOrgId(session.org.id);
    if (!profile) return NextResponse.json({ pods: [] });
    const pods = await podsForProfile(profile.orgId, profile.username, profile.displayName);
    return NextResponse.json({ pods });
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
    const parsed = podInputSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_POD");

    const pod = await createPod(session.org.id, parsed.data);
    return NextResponse.json({ pod }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}