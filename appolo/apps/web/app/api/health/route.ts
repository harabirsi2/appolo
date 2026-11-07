import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const started = Date.now();
  let database: "up" | "down" = "up";
  try {
    await getDb().execute(sql`select 1`);
  } catch {
    database = "down";
  }

  return NextResponse.json(
    {
      ok: database === "up",
      service: "appolo-web",
      database,
      latencyMs: Date.now() - started,
      time: new Date().toISOString(),
    },
    { status: database === "up" ? 200 : 503 },
  );
}