import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  return NextResponse.json({
    user: session.user,
    org: session.org,
    membership: { role: session.membership.role, locationIds: session.membership.locationIds },
    capabilities: session.capabilities,
  });
}