import { NextResponse, type NextRequest } from "next/server";
import { can, contactCreateSchema, contactQuerySchema, firstIssue } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { createContact, listContacts } from "@/lib/services/contacts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "contacts:read")) {
      return jsonError("Your role cannot read contacts.", 403, "FORBIDDEN");
    }

    const parsed = contactQuerySchema.safeParse({
      query: request.nextUrl.searchParams.get("q") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_QUERY");

    const contacts = await listContacts(session.org.id, parsed.data);
    return NextResponse.json({ contacts });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "contacts:write")) {
      return jsonError("Your role cannot create contacts.", 403, "FORBIDDEN");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_JSON");
    }

    const parsed = contactCreateSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_INPUT");

    const contact = await createContact(session.org.id, parsed.data);
    return NextResponse.json({ contact }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}