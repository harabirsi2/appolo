import { NextResponse } from "next/server";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { markNotificationsRead } from "@/lib/services/social";

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    const count = await markNotificationsRead(session.org.id);
    return NextResponse.json({ read: count });
  } catch (error) {
    return apiError(error);
  }
}