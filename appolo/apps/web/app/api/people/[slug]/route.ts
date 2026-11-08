import { NextResponse } from "next/server";
import { apiError, jsonError } from "@/lib/api";
import { personBySlug } from "@/lib/services/rankings";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  try {
    const { slug } = await params;
    const person = await personBySlug(slug);
    if (!person) return jsonError("Not found.", 404, "NOT_FOUND");
    return NextResponse.json({ person });
  } catch (error) {
    return apiError(error);
  }
}