import { NextResponse } from "next/server";
import { apiError, jsonError } from "@/lib/api";
import { getPublicWidget } from "@/lib/services/reviews";

export const dynamic = "force-dynamic";

/** Public, unauthenticated widget data resolved by its public key. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<NextResponse> {
  try {
    const { key } = await params;
    const widget = await getPublicWidget(key);
    if (!widget) return jsonError("Widget not found.", 404, "WIDGET_NOT_FOUND");
    return NextResponse.json(widget, { headers: { "Access-Control-Allow-Origin": "*" } });
  } catch (error) {
    return apiError(error);
  }
}
