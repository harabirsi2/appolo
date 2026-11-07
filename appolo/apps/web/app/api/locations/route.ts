import { NextResponse, type NextRequest } from "next/server";
import { can, firstIssue, locationSchema } from "@appolo/core";
import { getSession } from "@/lib/session";
import { withOrg, schema } from "@/lib/db";

const { locations } = schema;

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rows = await withOrg(session.org.id, (tx) =>
    tx.select().from(locations).orderBy(locations.createdAt),
  );
  return NextResponse.json({ locations: rows });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!can(session.membership.role, "locations:manage")) {
    return NextResponse.json({ error: "Your role cannot manage locations." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = locationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  }

  const inserted = await withOrg(session.org.id, (tx) =>
    tx
      .insert(locations)
      .values({
        orgId: session.org.id,
        name: parsed.data.name,
        address: parsed.data.address ?? null,
        phone: parsed.data.phone ?? null,
        timezone: parsed.data.timezone,
      })
      .returning(),
  );

  return NextResponse.json({ location: inserted[0] }, { status: 201 });
}