import { NextResponse } from "next/server";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { searchHistoryFor, clearSearchHistory } from "@/lib/services/social";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    const queries = await searchHistoryFor(session.org.id);
    return NextResponse.json({ queries });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    await clearSearchHistory(session.org.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}