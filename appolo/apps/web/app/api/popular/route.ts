import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { popularThisWeek } from "@/lib/services/rankings";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const items = await popularThisWeek();
    return NextResponse.json({ items });
  } catch (error) {
    return apiError(error);
  }
}