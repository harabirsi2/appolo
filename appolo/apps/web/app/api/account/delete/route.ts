import { NextResponse, type NextRequest } from "next/server";
import { invalidateCommunity } from "@/lib/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { apiError, jsonError } from "@/lib/api";
import { SESSION_COOKIE } from "@/lib/constants";
import { getSession } from "@/lib/session";
import { deleteAccount } from "@/lib/services/account";

const schema = z.object({
  password: z.string().min(1).max(200),
  confirm: z.string().max(20),
});

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (session.membership.role !== "owner") {
      return jsonError("Only the workspace owner can delete the account.", 403, "FORBIDDEN");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_BODY");
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return jsonError('Send your password and type "DELETE" to confirm.', 400, "INVALID_BODY");
    }

    await deleteAccount({
      userId: session.user.id,
      orgId: session.org.id,
      password: parsed.data.password,
      confirm: parsed.data.confirm,
    });
    // Deleting the workspace cascades its ratings, so shared rankings move.
    invalidateCommunity();

    const store = await cookies();
    store.set(SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
