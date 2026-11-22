import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { pushPublicKey, removePushSubscription, savePushSubscription } from "@/lib/services/push";

export const dynamic = "force-dynamic";

/** The browser needs the application server key before it can subscribe. */
export async function GET(): Promise<NextResponse> {
  const key = pushPublicKey();
  return NextResponse.json({ key }, { headers: { "cache-control": "no-store" } });
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

    await savePushSubscription(
      session.org.id,
      (body ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } },
      request.headers.get("user-agent"),
    );
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    const body = (await request.json().catch(() => ({}))) as { endpoint?: unknown };
    if (typeof body.endpoint === "string" && body.endpoint) {
      await removePushSubscription(session.org.id, body.endpoint);
    }
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
