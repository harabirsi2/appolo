import { z } from "zod";
import { renderTemplate } from "./messaging";

/* ------------------------------------------------------------------ */
/* automation schemas                                                  */
/* ------------------------------------------------------------------ */

export const automationTriggers = ["keyword", "new_contact", "review_received"] as const;
export type AutomationTrigger = (typeof automationTriggers)[number];

export const automationStepKinds = ["auto_reply", "add_tag", "assign"] as const;
export type AutomationStepKind = (typeof automationStepKinds)[number];

export const automationStepSchema = z.object({
  kind: z.enum(automationStepKinds),
  /** free-form per-kind config: auto_reply -> { body }, add_tag -> { tag }, assign -> {} */
  config: z.record(z.string(), z.unknown()).default({}),
});

export const automationSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(80),
    trigger: z.enum(automationTriggers).default("keyword"),
    enabled: z.boolean().default(false),
    /** Keyword triggers match against inbound message bodies. */
    keywords: z.array(z.string().trim().min(1).max(40)).max(25).default([]),
    matchType: z.enum(["contains", "exact"]).default("contains"),
    channels: z.array(z.enum(["sms", "email", "webchat"])).default([]),
    /** The first auto_reply step body, surfaced in the simple builder. */
    replyBody: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.trigger === "keyword" && value.keywords.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add at least one keyword for a keyword automation.",
        path: ["keywords"],
      });
    }
    if (value.trigger === "keyword" && !value.replyBody?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add an auto-reply message.",
        path: ["replyBody"],
      });
    }
  });

export type AutomationInput = z.infer<typeof automationSchema>;

/* ------------------------------------------------------------------ */
/* matching                                                            */
/* ------------------------------------------------------------------ */

export interface AutomationConditions {
  keywords?: string[];
  matchType?: "contains" | "exact";
  channels?: string[];
}

export interface AutomationRecord {
  id: string;
  name: string;
  trigger: string;
  enabled: boolean;
  conditions: unknown;
}

/**
 * True when an inbound message satisfies a keyword automation's conditions.
 * Matching is case-insensitive and never uses regex (no ReDoS surface).
 */
export function keywordMatches(
  conditions: AutomationConditions,
  message: string,
  channel?: string | null,
): boolean {
  const keywords = (conditions.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (keywords.length === 0) return false;

  const allowed = conditions.channels ?? [];
  if (allowed.length > 0 && channel && !allowed.includes(channel)) return false;

  const haystack = message.toLowerCase();
  const matchType = conditions.matchType ?? "contains";
  if (matchType === "exact") {
    return keywords.includes(haystack.trim());
  }
  return keywords.some((keyword) => haystack.includes(keyword));
}

/** Picks the first enabled keyword automation that matches, if any. */
export function firstMatchingAutomation<T extends AutomationRecord>(
  automations: T[],
  message: string,
  channel?: string | null,
): T | null {
  for (const automation of automations) {
    if (!automation.enabled || automation.trigger !== "keyword") continue;
    if (keywordMatches((automation.conditions ?? {}) as AutomationConditions, message, channel)) {
      return automation;
    }
  }
  return null;
}

export interface AutomationStepLike {
  order: number;
  kind: string;
  config: unknown;
}

export function firstAutoReplyBody(steps: AutomationStepLike[]): string | null {
  const step = [...steps].sort((a, b) => a.order - b.order).find((s) => s.kind === "auto_reply");
  const body = step ? (step.config as { body?: unknown }).body : null;
  return typeof body === "string" && body.trim() ? body : null;
}

/** Renders an auto-reply body with the subset of variables we support. */
export function renderAutomationReply(
  template: string,
  vars: { firstName?: string | null; businessName?: string | null },
): string {
  return renderTemplate(template, {
    first_name: vars.firstName ?? "there",
    business_name: vars.businessName ?? "our business",
  });
}
