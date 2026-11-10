import { NextResponse, type NextRequest } from "next/server";
import { firstIssue, signupSchema } from "@appolo/core";
import { signUp } from "@/lib/services/auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  }

  const result = await signUp(parsed.data);
  if (!result.ok) {
    if (result.retryAfterSeconds) {
      return NextResponse.json(
        { error: result.error },
        { status: 429, headers: { "retry-after": String(result.retryAfterSeconds) } },
      );
    }
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}