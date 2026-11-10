import { NextResponse, type NextRequest } from "next/server";
import { firstIssue, loginSchema } from "@appolo/core";
import { signIn } from "@/lib/services/auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  }

  const result = await signIn(parsed.data);
  if (!result.ok) {
    if (result.retryAfterSeconds) {
      return NextResponse.json(
        { error: result.error },
        { status: 429, headers: { "retry-after": String(result.retryAfterSeconds) } },
      );
    }
    return NextResponse.json({ error: result.error }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}