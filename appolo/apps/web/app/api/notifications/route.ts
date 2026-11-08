import { NextResponse } from "next/server";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { notificationsFor, unreadNotificationCount } from "@/lib/services/social";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    const [items, unread] = await Promise.all([
      notificationsFor(session.org.id),
      unreadNotificationCount(session.org.id),
    ]);
    return NextResponse.json({ items, unread });
  } catch (error) {
    return apiError(error);
  }
}