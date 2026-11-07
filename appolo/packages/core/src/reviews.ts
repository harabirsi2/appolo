import { z } from "zod";
import { renderTemplate } from "./messaging";

export const reviewRequestStatuses = [
  "queued",
  "sent",
  "clicked",
  "reviewed",
  "declined",
  "opted_out",
  "failed",
] as const;
export type ReviewRequestStatus = (typeof reviewRequestStatuses)[number];

export const reviewPlatformKinds = [
  "google",
  "facebook",
  "bbb",
  "dealerrater",
  "yelp",
  "custom",
] as const;
export type ReviewPlatformKind = (typeof reviewPlatformKinds)[number];

export const reviewRequestChannels = ["sms", "email"] as const;
export type ReviewRequestChannel = (typeof reviewRequestChannels)[number];

/* ------------------------------------------------------------------ */
/* schemas                                                             */
/* ------------------------------------------------------------------ */

export const reviewTemplateSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80),
  channel: z.enum(reviewRequestChannels).default("sms"),
  subject: z.string().trim().max(160).optional(),
  body: z.string().trim().min(1, "Body is required.").max(1000),
  isDefault: z.boolean().optional(),
});

export const reviewRequestInputSchema = z.object({
  contactId: z.string().uuid("Pick a contact."),
  locationId: z.string().uuid().nullish(),
  channel: z.enum(reviewRequestChannels).default("sms"),
  templateId: z.string().uuid().nullish(),
  platformKind: z.enum(reviewPlatformKinds).nullish(),
  employeeId: z.string().uuid().nullish(),
});

export const bulkReviewRequestSchema = z.object({
  contactIds: z.array(z.string().uuid()).min(1, "Select at least one contact.").max(200),
  locationId: z.string().uuid().nullish(),
  channel: z.enum(reviewRequestChannels).default("sms"),
  templateId: z.string().uuid().nullish(),
  platformKind: z.enum(reviewPlatformKinds).nullish(),
});

export const privateFeedbackSchema = z.object({
  token: z.string().trim().min(8).max(200),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  body: z.string().trim().min(1, "Tell us what happened.").max(2000),
  name: z.string().trim().max(120).optional(),
});

export const reviewReplySchema = z.object({
  reviewId: z.string().uuid(),
  body: z.string().trim().min(1, "Reply cannot be empty.").max(2000),
});

export type ReviewTemplateInput = z.infer<typeof reviewTemplateSchema>;
export type ReviewRequestInput = z.infer<typeof reviewRequestInputSchema>;
export type BulkReviewRequestInput = z.infer<typeof bulkReviewRequestSchema>;
export type PrivateFeedbackInput = z.infer<typeof privateFeedbackSchema>;

/* ------------------------------------------------------------------ */
/* rendering                                                           */
/* ------------------------------------------------------------------ */

export interface ReviewTemplateVariables {
  firstName?: string | null;
  businessName?: string | null;
  locationName?: string | null;
  reviewLink?: string | null;
}

export function renderReviewTemplate(template: string, vars: ReviewTemplateVariables): string {
  return renderTemplate(template, {
    first_name: vars.firstName ?? "there",
    business_name: vars.businessName ?? "our business",
    location_name: vars.locationName ?? "",
    review_link: vars.reviewLink ?? "",
  });
}

export const DEFAULT_REVIEW_TEMPLATES: readonly ReviewTemplateInput[] = [
  {
    name: "SMS review request",
    channel: "sms",
    body:
      "Hi {{first_name}}, thanks for visiting {{business_name}}! If you had a great experience, " +
      "a quick review would mean a lot to us: {{review_link}}",
    isDefault: true,
  },
  {
    name: "Email review request",
    channel: "email",
    subject: "How was your visit to {{business_name}}?",
    body:
      "Hi {{first_name}},\n\nThanks for choosing {{business_name}}. If you have a moment, leaving us a " +
      "quick review helps other neighbours find us:\n\n{{review_link}}\n\nThank you!",
    isDefault: true,
  },
];

/* ------------------------------------------------------------------ */
/* quiet hours                                                         */
/* ------------------------------------------------------------------ */

export interface QuietHours {
  enabled: boolean;
  /** "HH:MM" 24-hour local time, inclusive. */
  start: string;
  /** "HH:MM" 24-hour local time, exclusive. */
  end: string;
}

export const DEFAULT_QUIET_HOURS: QuietHours = { enabled: true, start: "21:00", end: "08:00" };

export function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function localMinutes(now: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return (hour % 24) * 60 + minute;
}

/** True when `now` falls inside the quiet window for the given timezone. */
export function isWithinQuietHours(
  quiet: QuietHours,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  if (!quiet.enabled) return false;
  const start = parseClock(quiet.start);
  const end = parseClock(quiet.end);
  if (start === null || end === null || start === end) return false;

  let local: number;
  try {
    local = localMinutes(now, timeZone);
  } catch {
    local = localMinutes(now, "UTC");
  }

  if (start < end) return local >= start && local < end;
  // Window wraps midnight, e.g. 21:00 → 08:00.
  return local >= start || local < end;
}

/** True when the org has already hit its per-day request cap. */
export function exceedsDailyCap(sentToday: number, dailyCap: number | null | undefined): boolean {
  if (!dailyCap || dailyCap <= 0) return false;
  return sentToday >= dailyCap;
}
