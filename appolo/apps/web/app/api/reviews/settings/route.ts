import { NextResponse, type NextRequest } from "next/server";
import { can, parseClock, reviewPlatformKinds } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { getReviewSettings, updateReviewSettings, type ReviewSettings } from "@/lib/services/reviews";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "reviews:read")) {
      return jsonError("Your role cannot read review settings.", 403, "FORBIDDEN");
    }
    return NextResponse.json({ settings: await getReviewSettings(session.org.id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "reviews:request")) {
      return jsonError("Your role cannot change review settings.", 403, "FORBIDDEN");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_JSON");
    }

    const patch = (body ?? {}) as Partial<ReviewSettings> & { quietHours?: Record<string, unknown> };
    const next: Partial<ReviewSettings> = {};

    if (patch.quietHours !== undefined) {
      const quiet = patch.quietHours as { enabled?: unknown; start?: unknown; end?: unknown };
      const start = typeof quiet.start === "string" ? quiet.start : "";
      const end = typeof quiet.end === "string" ? quiet.end : "";
      if (parseClock(start) === null || parseClock(end) === null) {
        return jsonError("Quiet hours must use 24-hour HH:MM format.", 400, "INVALID_INPUT");
      }
      next.quietHours = {
        enabled: typeof quiet.enabled === "boolean" ? quiet.enabled : true,
        start,
        end,
      };
    }
    if (patch.dailyCap !== undefined) {
      if (typeof patch.dailyCap !== "number" || patch.dailyCap < 0) {
        return jsonError("dailyCap must be a positive number.", 400, "INVALID_INPUT");
      }
      next.dailyCap = patch.dailyCap;
    }
    if (patch.cooldownDays !== undefined) {
      if (typeof patch.cooldownDays !== "number" || patch.cooldownDays < 0) {
        return jsonError("cooldownDays must be a positive number.", 400, "INVALID_INPUT");
      }
      next.cooldownDays = patch.cooldownDays;
    }
    if (patch.timezone !== undefined) {
      if (typeof patch.timezone !== "string" || !patch.timezone.trim()) {
        return jsonError("timezone must be a non-empty string.", 400, "INVALID_INPUT");
      }
      next.timezone = patch.timezone.trim();
    }
    if (patch.defaultPlatformKind !== undefined) {
      if (!reviewPlatformKinds.includes(patch.defaultPlatformKind as never)) {
        return jsonError("Unknown default platform.", 400, "INVALID_INPUT");
      }
      next.defaultPlatformKind = patch.defaultPlatformKind;
    }
    if (patch.followUp !== undefined) {
      const follow = patch.followUp as { enabled?: unknown; days?: unknown; max?: unknown; body?: unknown };
      const days = typeof follow.days === "number" ? follow.days : 3;
      const max = typeof follow.max === "number" ? follow.max : 1;
      const body = typeof follow.body === "string" ? follow.body.trim() : "";
      if (days < 0 || max < 0) {
        return jsonError("Follow-up days and max must be positive numbers.", 400, "INVALID_INPUT");
      }
      if (!body) {
        return jsonError("Follow-up body cannot be empty.", 400, "INVALID_INPUT");
      }
      next.followUp = {
        enabled: typeof follow.enabled === "boolean" ? follow.enabled : true,
        days,
        max,
        body,
      };
    }

    const settings = await updateReviewSettings(session.org.id, next);
    return NextResponse.json({ settings });
  } catch (error) {
    return apiError(error);
  }
}