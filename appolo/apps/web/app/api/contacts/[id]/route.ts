import { NextResponse, type NextRequest } from "next/server";
import { can, contactUpdateSchema, firstIssue } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { getContact, updateContact } from "@/lib/services/contacts";
import { consentSummary } from "@/lib/services/consent";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "contacts:read")) {
      return jsonError("Your role cannot read contacts.", 403, "FORBIDDEN");
    }

    const { id } = await params;
    const detail = await getContact(session.org.id, id);
    if (!detail) return jsonError("Contact not found.", 404, "CONTACT_NOT_FOUND");

    const consent = await consentSummary(session.org.id, id);
    return NextResponse.json({ ...detail, consent });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "contacts:write")) {
      return jsonError("Your role cannot edit contacts.", 403, "FORBIDDEN");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_JSON");
    }

    const parsed = contactUpdateSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_INPUT");

    const { id } = await params;
    const contact = await updateContact(session.org.id, id, parsed.data);
    return NextResponse.json({ contact });
  } catch (error) {
    return apiError(error);
  }
}