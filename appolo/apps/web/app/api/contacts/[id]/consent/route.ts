import { NextResponse, type NextRequest } from "next/server";
import { can, consentInputSchema, firstIssue } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, clientIpFrom, jsonError } from "@/lib/api";
import { recordConsent } from "@/lib/services/consent";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "contacts:write")) {
      return jsonError("Your role cannot change consent.", 403, "FORBIDDEN");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_JSON");
    }

    const parsed = consentInputSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_INPUT");

    const { id } = await params;
    const ip = clientIpFrom(request.headers);
    const record = await recordConsent(session.org.id, id, parsed.data, { ip });
    return NextResponse.json({ consent: record }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}