import { NextResponse, type NextRequest } from "next/server";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { getProfileByOrgId, profileUpdateSchema, updateProfile } from "@/lib/services/social";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    const profile = await getProfileByOrgId(session.org.id);
    if (!profile) return jsonError("Profile not found.", 404, "PROFILE_NOT_FOUND");
    return NextResponse.json({ profile });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_BODY");
    }
    const parsed = profileUpdateSchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid profile data.", 400, "INVALID_PROFILE");
    const profile = await updateProfile(session.org.id, parsed.data);
    return NextResponse.json({ profile });
  } catch (error) {
    return apiError(error);
  }
}