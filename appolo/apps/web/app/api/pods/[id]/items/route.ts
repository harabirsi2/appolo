import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { firstIssue } from "@appolo/core";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { addItemToPod, removeItemFromPod, reorderPodItems } from "@/lib/services/social";

export const dynamic = "force-dynamic";

const addSchema = z.object({ itemId: z.string().uuid() });
const removeSchema = z.object({ itemId: z.string().uuid() });
const reorderSchema = z.object({ itemIds: z.array(z.string().uuid()) });

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
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
    const parsed = addSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_ITEM");
    const pod = await addItemToPod(session.org.id, id, parsed.data.itemId);
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
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_BODY");
    }
    const parsed = removeSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_ITEM");
    const pod = await removeItemFromPod(session.org.id, id, parsed.data.itemId);
    return NextResponse.json({ pod });
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
    const parsed = reorderSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_ORDER");
    const pod = await reorderPodItems(session.org.id, id, parsed.data.itemIds);
    return NextResponse.json({ pod });
  } catch (error) {
    return apiError(error);
  }
}