import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { firstIssue } from "@appolo/core";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import {
  addPodMember,
  getProfileByUsername,
  joinPod,
  removePodMember,
  setMemberRole,
} from "@/lib/services/social";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const addSchema = z.object({
  /** Omit to join as the signed-in profile. */
  username: z.string().trim().min(1).max(40).optional(),
  role: z.enum(["editor", "viewer"]).optional(),
});
const roleSchema = z.object({
  username: z.string().trim().min(1).max(40),
  role: z.enum(["editor", "viewer"]),
});
const removeSchema = z.object({
  /** Omit to leave the pod yourself. */
  username: z.string().trim().min(1).max(40).optional(),
});

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    const { id } = await params;
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const parsed = addSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_MEMBER");

    const pod = parsed.data.username
      ? await addPodMember(session.org.id, id, parsed.data.username, parsed.data.role ?? "viewer")
      : await joinPod(session.org.id, id);
    return NextResponse.json({ pod }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    const { id } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_BODY");
    }
    const parsed = roleSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_MEMBER");
    const member = await getProfileByUsername(parsed.data.username);
    if (!member) return jsonError("No profile matches that username.", 404, "PROFILE_NOT_FOUND");
    const pod = await setMemberRole(session.org.id, id, member.orgId, parsed.data.role);
    return NextResponse.json({ pod });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    const { id } = await params;
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const parsed = removeSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_MEMBER");

    const targetOrgId = parsed.data.username
      ? (await getProfileByUsername(parsed.data.username))?.orgId
      : session.org.id;
    if (!targetOrgId) return jsonError("No profile matches that username.", 404, "PROFILE_NOT_FOUND");
    const pod = await removePodMember(session.org.id, id, targetOrgId);
    return NextResponse.json({ pod });
  } catch (error) {
    return apiError(error);
  }
}