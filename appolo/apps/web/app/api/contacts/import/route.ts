import { NextResponse, type NextRequest } from "next/server";
import { can } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { importContactsCsv } from "@/lib/services/contacts";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2_000_000;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "contacts:write")) {
      return jsonError("Your role cannot import contacts.", 403, "FORBIDDEN");
    }

    const contentType = request.headers.get("content-type") ?? "";
    let text = "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return jsonError("Attach a CSV file in the 'file' field.", 400, "NO_FILE");
      if (file.size > MAX_BYTES) return jsonError("CSV is too large (max 2 MB).", 413, "FILE_TOO_LARGE");
      text = await file.text();
    } else if (contentType.includes("application/json")) {
      const body = (await request.json().catch(() => ({}))) as { csv?: unknown };
      if (typeof body.csv !== "string") return jsonError("Expected { csv: string }.", 400, "NO_CSV");
      text = body.csv;
    } else {
      text = await request.text();
    }

    if (text.length > MAX_BYTES) return jsonError("CSV is too large (max 2 MB).", 413, "FILE_TOO_LARGE");
    if (!text.trim()) return jsonError("The CSV is empty.", 400, "CSV_EMPTY");

    const stats = await importContactsCsv(session.org.id, text);
    return NextResponse.json({ ...stats }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}