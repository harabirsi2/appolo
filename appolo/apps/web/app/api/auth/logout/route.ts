import { NextResponse } from "next/server";
import { signOut } from "@/lib/services/auth";

export async function POST(): Promise<NextResponse> {
  await signOut();
  return NextResponse.json({ ok: true });
}