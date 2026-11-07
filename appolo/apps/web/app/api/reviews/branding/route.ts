import { NextResponse, type NextRequest } from "next/server";
import { can } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { getLandingBranding, updateLandingBranding } from "@/lib/services/reviews";

export const dynamic = "force-dynamic";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export async function GET(): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "reviews:read")) {
      return jsonError("Your role cannot read branding.", 403, "FORBIDDEN");
    }
    return NextResponse.json({ branding: await getLandingBranding(session.org.id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "reviews:request")) {
      return jsonError("Your role cannot change branding.", 403, "FORBIDDEN");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_JSON");
    }

    const patch = (body ?? {}) as Record<string, unknown>;
    const next: {
      logoUrl?: string | null;
      accentColor?: string;
      tagline?: string | null;
      supportEmail?: string | null;
    } = {};

    if (patch.accentColor !== undefined) {
      if (typeof patch.accentColor !== "string" || !HEX_COLOR.test(patch.accentColor)) {
        return jsonError("accentColor must be a hex colour like #6366f1.", 400, "INVALID_INPUT");
      }
      next.accentColor = patch.accentColor;
    }
    if (patch.logoUrl !== undefined) {
      if (patch.logoUrl === null || patch.logoUrl === "") {
        next.logoUrl = null;
      } else if (typeof patch.logoUrl === "string" && /^https?:\/\//i.test(patch.logoUrl)) {
        next.logoUrl = patch.logoUrl.trim();
      } else {
        return jsonError("logoUrl must be an http(s) URL.", 400, "INVALID_INPUT");
      }
    }
    if (patch.tagline !== undefined) {
      if (patch.tagline !== null && typeof patch.tagline !== "string") {
        return jsonError("tagline must be a string.", 400, "INVALID_INPUT");
      }
      next.tagline = typeof patch.tagline === "string" && patch.tagline.trim() ? patch.tagline.trim().slice(0, 160) : null;
    }
    if (patch.supportEmail !== undefined) {
      if (patch.supportEmail !== null && typeof patch.supportEmail !== "string") {
        return jsonError("supportEmail must be a string.", 400, "INVALID_INPUT");
      }
      const email = typeof patch.supportEmail === "string" ? patch.supportEmail.trim() : "";
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return jsonError("supportEmail looks invalid.", 400, "INVALID_INPUT");
      }
      next.supportEmail = email || null;
    }

    return NextResponse.json({ branding: await updateLandingBranding(session.org.id, next) });
  } catch (error) {
    return apiError(error);
  }
}