import { NextResponse, type NextRequest } from "next/server";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { getProfileByUsername, isFollowing, profileBundle } from "@/lib/services/social";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ username: string }> };

export async function GET(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const { username } = await params;
    const profile = await getProfileByUsername(username);
    if (!profile) return jsonError("Profile not found.", 404, "PROFILE_NOT_FOUND");

    const session = await getSession();
    const [bundle, following] = await Promise.all([
      profileBundle(profile),
      session ? isFollowing(session.org.id, profile.orgId) : Promise.resolve(false),
    ]);

    return NextResponse.json({
      profile: bundle.profile,
      topFive: bundle.topFive,
      ratings: bundle.ratings.slice(0, 60),
      pods: bundle.pods,
      following,
    });
  } catch (error) {
    return apiError(error);
  }
}