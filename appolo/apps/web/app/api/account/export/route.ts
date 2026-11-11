import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { exportMediaData } from "@/lib/services/account";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");

    const data = await exportMediaData(session.org.id);
    const stamp = new Date().toISOString().slice(0, 10);

    return new NextResponse(JSON.stringify({ account: session.user.email, org: session.org.slug, ...data }, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="appolo-media-${stamp}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
