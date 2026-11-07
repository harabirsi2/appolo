import { and, desc, eq, gte, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import {
  DEFAULT_QUIET_HOURS,
  DEFAULT_REVIEW_TEMPLATES,
  bulkReviewRequestSchema,
  exceedsDailyCap,
  isWithinQuietHours,
  publicToken,
  renderReviewTemplate,
  sha256,
  type BulkReviewRequestInput,
  type PrivateFeedbackInput,
  type QuietHours,
  type ReviewRequestInput,
  type ReviewTemplateInput,
} from "@appolo/core";
import { getAdminDb, withOrg, schema, type Tx } from "@/lib/db";
import { DomainError } from "./errors";
import { checkConsent } from "./consent";
import { ensureConversationForContact, sendOutboundMessage } from "./messaging";
import { getReviewPlatformClient } from "./review-platforms";

const {
  orgs,
  locations,
  contacts,
  contactChannels,
  reviewTemplates,
  reviewPlatforms,
  reviewRequests,
  reviewTokens,
  reviews,
  reviewReplies,
  privateFeedback,
} = schema;

const REQUEST_TTL_DAYS = 45;
const DEFAULT_COOLDOWN_DAYS = 90;

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

export interface FollowUpSettings {
  enabled: boolean;
  days: number;
  max: number;
  body: string;
}

export interface ReviewSettings {
  quietHours: QuietHours;
  dailyCap: number;
  timezone: string;
  cooldownDays: number;
  defaultPlatformKind: string;
  followUp: FollowUpSettings;
}

export const DEFAULT_FOLLOW_UP_BODY =
  "Hi {{first_name}}, just a gentle reminder — if you have a moment, a quick review for {{business_name}} would really help us out: {{review_link}}";

const DEFAULT_SETTINGS: ReviewSettings = {
  quietHours: DEFAULT_QUIET_HOURS,
  dailyCap: 200,
  timezone: "UTC",
  cooldownDays: DEFAULT_COOLDOWN_DAYS,
  defaultPlatformKind: "google",
  followUp: { enabled: true, days: 3, max: 1, body: DEFAULT_FOLLOW_UP_BODY },
};

function coerceSettings(raw: unknown): ReviewSettings {
  const value = (raw ?? {}) as Record<string, unknown>;
  const review = (value.reviewRequests ?? {}) as Record<string, unknown>;
  const quiet = (review.quietHours ?? {}) as Record<string, unknown>;
  const follow = (review.followUp ?? {}) as Record<string, unknown>;
  return {
    quietHours: {
      enabled: typeof quiet.enabled === "boolean" ? quiet.enabled : DEFAULT_SETTINGS.quietHours.enabled,
      start: typeof quiet.start === "string" ? quiet.start : DEFAULT_SETTINGS.quietHours.start,
      end: typeof quiet.end === "string" ? quiet.end : DEFAULT_SETTINGS.quietHours.end,
    },
    dailyCap: typeof review.dailyCap === "number" ? review.dailyCap : DEFAULT_SETTINGS.dailyCap,
    timezone: typeof review.timezone === "string" ? review.timezone : DEFAULT_SETTINGS.timezone,
    cooldownDays: typeof review.cooldownDays === "number" ? review.cooldownDays : DEFAULT_SETTINGS.cooldownDays,
    defaultPlatformKind:
      typeof review.defaultPlatformKind === "string" ? review.defaultPlatformKind : DEFAULT_SETTINGS.defaultPlatformKind,
    followUp: {
      enabled: typeof follow.enabled === "boolean" ? follow.enabled : DEFAULT_SETTINGS.followUp.enabled,
      days: typeof follow.days === "number" ? follow.days : DEFAULT_SETTINGS.followUp.days,
      max: typeof follow.max === "number" ? follow.max : DEFAULT_SETTINGS.followUp.max,
      body:
        typeof follow.body === "string" && follow.body.trim()
          ? follow.body
          : DEFAULT_SETTINGS.followUp.body,
    },
  };
}

export async function getReviewSettings(orgId: string): Promise<ReviewSettings> {
  return withOrg(orgId, async (tx) => {
    const [org] = await tx.select({ settings: orgs.settings }).from(orgs).limit(1);
    return coerceSettings(org?.settings);
  });
}

export async function updateReviewSettings(orgId: string, patch: Partial<ReviewSettings>): Promise<ReviewSettings> {
  return withOrg(orgId, async (tx) => {
    const [org] = await tx.select({ settings: orgs.settings }).from(orgs).limit(1);
    const current = coerceSettings(org?.settings);
    const next: ReviewSettings = {
      quietHours: patch.quietHours ?? current.quietHours,
      dailyCap: patch.dailyCap ?? current.dailyCap,
      timezone: patch.timezone ?? current.timezone,
      cooldownDays: patch.cooldownDays ?? current.cooldownDays,
      defaultPlatformKind: patch.defaultPlatformKind ?? current.defaultPlatformKind,
      followUp: patch.followUp ?? current.followUp,
    };

    const settings = { ...((org?.settings ?? {}) as Record<string, unknown>) };
    settings.reviewRequests = next;
    await tx.update(orgs).set({ settings, updatedAt: new Date() }).where(eq(orgs.id, orgId));
    return next;
  });
}

/* ------------------------------------------------------------------ */
/* landing-page branding                                               */
/* ------------------------------------------------------------------ */

export interface LandingBranding {
  logoUrl: string | null;
  accentColor: string;
  tagline: string | null;
  supportEmail: string | null;
}

export const DEFAULT_ACCENT_COLOR = "#6366f1";
const BRANDING_FALLBACK: LandingBranding = {
  logoUrl: null,
  accentColor: DEFAULT_ACCENT_COLOR,
  tagline: null,
  supportEmail: null,
};

function coerceBranding(raw: unknown): LandingBranding {
  const value = (raw ?? {}) as Record<string, unknown>;
  const accent = typeof value.accentColor === "string" && /^#[0-9a-f]{6}$/i.test(value.accentColor)
    ? value.accentColor
    : BRANDING_FALLBACK.accentColor;
  return {
    logoUrl: typeof value.logoUrl === "string" && value.logoUrl.trim() ? value.logoUrl.trim() : null,
    accentColor: accent,
    tagline: typeof value.tagline === "string" && value.tagline.trim() ? value.tagline.trim() : null,
    supportEmail:
      typeof value.supportEmail === "string" && value.supportEmail.trim() ? value.supportEmail.trim() : null,
  };
}

export async function getLandingBranding(orgId: string): Promise<LandingBranding> {
  return withOrg(orgId, async (tx) => {
    const [org] = await tx.select({ settings: orgs.settings }).from(orgs).limit(1);
    return coerceBranding(((org?.settings ?? {}) as Record<string, unknown>).branding);
  });
}

export async function updateLandingBranding(
  orgId: string,
  patch: Partial<LandingBranding>,
): Promise<LandingBranding> {
  return withOrg(orgId, async (tx) => {
    const [org] = await tx.select({ settings: orgs.settings }).from(orgs).limit(1);
    const current = coerceBranding(((org?.settings ?? {}) as Record<string, unknown>).branding);
    const next: LandingBranding = {
      logoUrl: patch.logoUrl !== undefined ? patch.logoUrl : current.logoUrl,
      accentColor: patch.accentColor !== undefined ? (coerceBranding({ ...current, ...patch }).accentColor) : current.accentColor,
      tagline: patch.tagline !== undefined ? patch.tagline : current.tagline,
      supportEmail: patch.supportEmail !== undefined ? patch.supportEmail : current.supportEmail,
    };
    const settings = { ...((org?.settings ?? {}) as Record<string, unknown>) };
    settings.branding = next;
    await tx.update(orgs).set({ settings, updatedAt: new Date() }).where(eq(orgs.id, orgId));
    return next;
  });
}

/* ------------------------------------------------------------------ */
/* templates                                                           */
/* ------------------------------------------------------------------ */

export async function listReviewTemplates(orgId: string) {
  return withOrg(orgId, (tx) =>
    tx
      .select()
      .from(reviewTemplates)
      .where(eq(reviewTemplates.orgId, orgId))
      .orderBy(reviewTemplates.channel, reviewTemplates.name),
  );
}

export async function createReviewTemplate(orgId: string, input: ReviewTemplateInput) {
  return withOrg(orgId, async (tx) => {
    const [row] = await tx
      .insert(reviewTemplates)
      .values({
        orgId,
        name: input.name,
        channel: input.channel,
        subject: input.subject ?? null,
        body: input.body,
        isDefault: input.isDefault ?? false,
        variables: ["first_name", "business_name", "review_link"],
      })
      .returning();
    return row!;
  });
}

export async function updateReviewTemplate(orgId: string, id: string, input: ReviewTemplateInput) {
  return withOrg(orgId, async (tx) => {
    const [row] = await tx
      .update(reviewTemplates)
      .set({
        name: input.name,
        channel: input.channel,
        subject: input.subject ?? null,
        body: input.body,
        active: true,
        updatedAt: new Date(),
      })
      .where(eq(reviewTemplates.id, id))
      .returning();
    if (!row) throw new DomainError("TEMPLATE_NOT_FOUND", "Template not found.", 404);
    return row;
  });
}

export async function deleteReviewTemplate(orgId: string, id: string): Promise<void> {
  await withOrg(orgId, (tx) => tx.delete(reviewTemplates).where(eq(reviewTemplates.id, id)));
}

export async function ensureDefaultTemplates(orgId: string): Promise<void> {
  await withOrg(orgId, async (tx) => {
    const existing = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(reviewTemplates)
      .where(eq(reviewTemplates.orgId, orgId));
    if ((existing[0]?.n ?? 0) > 0) return;
    await tx.insert(reviewTemplates).values(
      DEFAULT_REVIEW_TEMPLATES.map((template) => ({
        orgId,
        name: template.name,
        channel: template.channel,
        subject: template.subject ?? null,
        body: template.body,
        isDefault: template.isDefault ?? false,
        variables: ["first_name", "business_name", "review_link"],
      })),
    );
  });
}

async function pickTemplate(tx: Tx, orgId: string, channel: string, templateId?: string | null) {
  if (templateId) {
    const [explicit] = await tx
      .select()
      .from(reviewTemplates)
      .where(and(eq(reviewTemplates.id, templateId), eq(reviewTemplates.active, true)))
      .limit(1);
    if (explicit) return explicit;
  }
  const [preferred] = await tx
    .select()
    .from(reviewTemplates)
    .where(
      and(
        eq(reviewTemplates.orgId, orgId),
        eq(reviewTemplates.channel, channel),
        eq(reviewTemplates.active, true),
      ),
    )
    .orderBy(desc(reviewTemplates.isDefault), reviewTemplates.createdAt)
    .limit(1);
  return preferred ?? null;
}

/* ------------------------------------------------------------------ */
/* platforms                                                           */
/* ------------------------------------------------------------------ */

export function platformPublicUrl(externalRef: string | null): string | null {
  if (externalRef && /^https?:\/\//i.test(externalRef)) return externalRef;
  return null;
}

export async function listReviewPlatforms(orgId: string) {
  return withOrg(orgId, (tx) =>
    tx.select().from(reviewPlatforms).where(eq(reviewPlatforms.orgId, orgId)).orderBy(reviewPlatforms.kind),
  );
}

function fallbackReviewUrl(businessName: string): string {
  const query = encodeURIComponent(businessName);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

/* ------------------------------------------------------------------ */
/* requests                                                            */
/* ------------------------------------------------------------------ */

function baseUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export interface SendReviewRequestResult {
  requestId: string;
  contactId: string;
  channel: string;
  status: string;
  reviewUrl: string;
}

async function assertSendable(
  orgId: string,
  contactId: string,
  channel: "sms" | "email",
  settings: ReviewSettings,
  timeZone: string,
  now: Date,
): Promise<void> {
  if (isWithinQuietHours(settings.quietHours, timeZone, now)) {
    throw new DomainError(
      "QUIET_HOURS",
      `It's outside business hours (${settings.quietHours.start}–${settings.quietHours.end} local). Try again later.`,
      409,
    );
  }

  const consent = await checkConsent(orgId, contactId, channel);
  if (!consent.allowed) {
    throw new DomainError("NO_CONSENT", consent.reason ?? `No consent on file for ${channel}.`, 409);
  }

  await withOrg(orgId, async (tx) => {
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const [todayCount] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(reviewRequests)
      .where(and(eq(reviewRequests.orgId, orgId), gte(reviewRequests.createdAt, dayAgo)));
    if (exceedsDailyCap(todayCount?.n ?? 0, settings.dailyCap)) {
      throw new DomainError("DAILY_CAP", "The daily review-request limit has been reached.", 429);
    }

    const cooldownStart = new Date(now.getTime() - settings.cooldownDays * 86_400_000);
    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(reviewRequests)
      .where(
        and(
          eq(reviewRequests.contactId, contactId),
          gte(reviewRequests.createdAt, cooldownStart),
          ne(reviewRequests.status, "failed"),
        ),
      );
    if ((recent?.n ?? 0) > 0) {
      throw new DomainError(
        "COOLDOWN",
        `This contact was already asked in the last ${settings.cooldownDays} days.`,
        409,
      );
    }
  });
}

export async function sendReviewRequest(
  orgId: string,
  input: ReviewRequestInput,
  actor: { id: string | null },
): Promise<SendReviewRequestResult> {
  const settings = await getReviewSettings(orgId);
  const now = new Date();

  const context = await withOrg(orgId, async (tx) => {
    const [contact] = await tx
      .select({ id: contacts.id, name: contacts.name })
      .from(contacts)
      .where(eq(contacts.id, input.contactId))
      .limit(1);
    if (!contact) throw new DomainError("CONTACT_NOT_FOUND", "Contact not found.", 404);

    const [org] = await tx.select({ name: orgs.name }).from(orgs).limit(1);

    let location: { id: string; name: string; timezone: string } | null = null;
    if (input.locationId) {
      const [row] = await tx
        .select({ id: locations.id, name: locations.name, timezone: locations.timezone })
        .from(locations)
        .where(eq(locations.id, input.locationId))
        .limit(1);
      location = row ?? null;
    }
    if (!location) {
      const [row] = await tx
        .select({ id: locations.id, name: locations.name, timezone: locations.timezone })
        .from(locations)
        .orderBy(locations.createdAt)
        .limit(1);
      location = row ?? null;
    }

    const platforms = await tx
      .select()
      .from(reviewPlatforms)
      .where(eq(reviewPlatforms.orgId, orgId));
    const wantedKind = input.platformKind ?? settings.defaultPlatformKind;
    const platform =
      platforms.find((p) => p.kind === wantedKind) ??
      platforms.find((p) => platformPublicUrl(p.externalRef)) ??
      platforms[0] ??
      null;

    const template = await pickTemplate(tx, orgId, input.channel, input.templateId);

    return { contact, org, location, platform, template };
  });

  const timeZone = context.location?.timezone ?? settings.timezone;
  await assertSendable(orgId, input.contactId, input.channel, settings, timeZone, now);

  if (!context.template) {
    throw new DomainError(
      "NO_TEMPLATE",
      `No active ${input.channel} template. Create one first.`,
      409,
    );
  }

  const businessName = context.org?.name ?? "our business";
  const publicUrl =
    platformPublicUrl(context.platform?.externalRef ?? null) ?? fallbackReviewUrl(businessName);

  const rawToken = publicToken();
  const tokenHash = sha256(rawToken);
  const reviewUrl = `${baseUrl()}/r/${rawToken}`;

  const rendered = renderReviewTemplate(context.template.body, {
    firstName: context.contact.name?.split(/\s+/)[0] ?? "there",
    businessName,
    locationName: context.location?.name ?? "",
    reviewLink: reviewUrl,
  });
  const renderedSubject = context.template.subject
    ? renderReviewTemplate(context.template.subject, {
        firstName: context.contact.name?.split(/\s+/)[0] ?? "there",
        businessName,
        locationName: context.location?.name ?? "",
        reviewLink: reviewUrl,
      })
    : null;

  const requestId = await withOrg(orgId, async (tx) => {
    const [request] = await tx
      .insert(reviewRequests)
      .values({
        orgId,
        contactId: input.contactId,
        locationId: context.location?.id ?? null,
        employeeId: input.employeeId ?? null,
        channel: input.channel,
        templateId: context.template!.id,
        status: "queued",
        platformKind: context.platform?.kind ?? null,
      })
      .returning({ id: reviewRequests.id });

    if (!request) throw new DomainError("REQUEST_CREATE_FAILED", "Could not create the request.", 500);

    await tx.insert(reviewTokens).values({
      orgId,
      tokenHash,
      requestId: request.id,
      expiresAt: new Date(now.getTime() + REQUEST_TTL_DAYS * 86_400_000),
    });

    return request.id;
  });

  try {
    const conversationId = await ensureConversationForContact(orgId, input.contactId, input.channel);
    const message = await sendOutboundMessage(orgId, conversationId, {
      body: rendered,
      subject: renderedSubject,
      senderType: actor.id ? "user" : "system",
      senderId: actor.id,
    });

    await withOrg(orgId, (tx) =>
      tx
        .update(reviewRequests)
        .set({ status: "sent", sentAt: message.sentAt ?? new Date() })
        .where(eq(reviewRequests.id, requestId)),
    );
  } catch (error) {
    await withOrg(orgId, (tx) =>
      tx.update(reviewRequests).set({ status: "failed" }).where(eq(reviewRequests.id, requestId)),
    );
    throw error;
  }

  return {
    requestId,
    contactId: input.contactId,
    channel: input.channel,
    status: "sent",
    reviewUrl,
  };
}

export interface BulkReviewResult {
  sent: number;
  failed: number;
  skipped: number;
  results: { contactId: string; ok: boolean; error?: string; reviewUrl?: string }[];
}

export async function sendBulkReviewRequests(
  orgId: string,
  input: BulkReviewRequestInput,
  actor: { id: string | null },
): Promise<BulkReviewResult> {
  const parsed = bulkReviewRequestSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("INVALID_INPUT", "Invalid bulk request.", 400);

  const result: BulkReviewResult = { sent: 0, failed: 0, skipped: 0, results: [] };
  for (const contactId of parsed.data.contactIds) {
    try {
      const sent = await sendReviewRequest(
        orgId,
        {
          contactId,
          locationId: input.locationId ?? null,
          channel: input.channel,
          templateId: input.templateId ?? null,
          platformKind: input.platformKind ?? null,
        },
        actor,
      );
      result.sent += 1;
      result.results.push({ contactId, ok: true, reviewUrl: sent.reviewUrl });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed";
      if (error instanceof DomainError && ["QUIET_HOURS", "NO_CONSENT", "COOLDOWN", "DAILY_CAP"].includes(error.code)) {
        result.skipped += 1;
      } else {
        result.failed += 1;
      }
      result.results.push({ contactId, ok: false, error: message });
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* follow-up cadence                                                   */
/* ------------------------------------------------------------------ */

export interface FollowUpResult {
  due: number;
  sent: number;
  skipped: number;
  failed: number;
  results: { requestId: string; contactId: string; ok: boolean; reason?: string }[];
}

/**
 * Sends the next reminder for requests that have gone quiet. A new short link
 * is minted per follow-up so the original token can expire independently.
 */
export async function sendDueFollowUps(
  orgId: string,
  actor: { id: string | null },
): Promise<FollowUpResult> {
  const settings = await getReviewSettings(orgId);
  if (!settings.followUp.enabled || settings.followUp.max <= 0) {
    return { due: 0, sent: 0, skipped: 0, failed: 0, results: [] };
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - settings.followUp.days * 86_400_000);

  const candidates = await withOrg(orgId, (tx) =>
    tx
      .select({
        id: reviewRequests.id,
        contactId: reviewRequests.contactId,
        channel: reviewRequests.channel,
        followUpCount: reviewRequests.followUpCount,
        contactName: contacts.name,
        locationName: locations.name,
        locationTimezone: locations.timezone,
      })
      .from(reviewRequests)
      .leftJoin(contacts, eq(contacts.id, reviewRequests.contactId))
      .leftJoin(locations, eq(locations.id, reviewRequests.locationId))
      .where(
        and(
          eq(reviewRequests.orgId, orgId),
          inArray(reviewRequests.status, ["sent", "clicked"]),
          isNotNull(reviewRequests.sentAt),
          lt(reviewRequests.followUpCount, settings.followUp.max),
          sql`coalesce(${reviewRequests.lastFollowUpAt}, ${reviewRequests.sentAt}) <= ${cutoff.toISOString()}::timestamptz`,
          sql`not exists (select 1 from ${privateFeedback} f where f.request_id = ${reviewRequests.id})`,
        ),
      )
      .orderBy(reviewRequests.sentAt)
      .limit(100),
  );

  const result: FollowUpResult = { due: candidates.length, sent: 0, skipped: 0, failed: 0, results: [] };
  if (candidates.length === 0) return result;

  const [org] = await withOrg(orgId, (tx) => tx.select({ name: orgs.name }).from(orgs).limit(1));
  const businessName = org?.name ?? "our business";

  for (const candidate of candidates) {
    const channel = candidate.channel === "email" ? "email" : "sms";
    try {
      const timeZone = candidate.locationTimezone ?? settings.timezone;
      if (isWithinQuietHours(settings.quietHours, timeZone, now)) {
        result.skipped += 1;
        result.results.push({ requestId: candidate.id, contactId: candidate.contactId, ok: false, reason: "quiet hours" });
        continue;
      }

      const consent = await checkConsent(orgId, candidate.contactId, channel);
      if (!consent.allowed) {
        result.skipped += 1;
        result.results.push({
          requestId: candidate.id,
          contactId: candidate.contactId,
          ok: false,
          reason: consent.reason ?? "no consent",
        });
        continue;
      }

      const rawToken = publicToken();
      const reviewUrl = `${baseUrl()}/r/${rawToken}`;
      const rendered = renderReviewTemplate(settings.followUp.body, {
        firstName: candidate.contactName?.split(/\s+/)[0] ?? "there",
        businessName,
        locationName: candidate.locationName ?? "",
        reviewLink: reviewUrl,
      });

      await withOrg(orgId, (tx) =>
        tx.insert(reviewTokens).values({
          orgId,
          tokenHash: sha256(rawToken),
          requestId: candidate.id,
          expiresAt: new Date(now.getTime() + REQUEST_TTL_DAYS * 86_400_000),
        }),
      );

      const conversationId = await ensureConversationForContact(orgId, candidate.contactId, channel);
      await sendOutboundMessage(orgId, conversationId, {
        body: rendered,
        subject: "A quick reminder about your review",
        senderType: actor.id ? "user" : "system",
        senderId: actor.id,
      });

      await withOrg(orgId, (tx) =>
        tx
          .update(reviewRequests)
          .set({ followUpCount: candidate.followUpCount + 1, lastFollowUpAt: now })
          .where(eq(reviewRequests.id, candidate.id)),
      );

      result.sent += 1;
      result.results.push({ requestId: candidate.id, contactId: candidate.contactId, ok: true });
    } catch (error) {
      result.failed += 1;
      result.results.push({
        requestId: candidate.id,
        contactId: candidate.contactId,
        ok: false,
        reason: error instanceof Error ? error.message : "Failed",
      });
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* tokens + public landing                                             */
/* ------------------------------------------------------------------ */

interface TokenLookup {
  id: string;
  orgId: string;
  requestId: string;
  expiresAt: Date;
  clickedAt: Date | null;
}

async function lookupToken(rawToken: string): Promise<TokenLookup | null> {
  // Narrow, RLS-bypassing lookup: we do not yet know the org.
  const [row] = await getAdminDb()
    .select({
      id: reviewTokens.id,
      orgId: reviewTokens.orgId,
      requestId: reviewTokens.requestId,
      expiresAt: reviewTokens.expiresAt,
      clickedAt: reviewTokens.clickedAt,
    })
    .from(reviewTokens)
    .where(eq(reviewTokens.tokenHash, sha256(rawToken)))
    .limit(1);
  return row ?? null;
}

export interface ReviewLanding {
  requestId: string;
  contactId: string | null;
  contactName: string | null;
  businessName: string;
  locationName: string | null;
  platforms: { kind: string; displayName: string; url: string | null }[];
  publicUrl: string;
  alreadyResponded: boolean;
  branding: LandingBranding;
}

export async function resolveReviewLanding(
  rawToken: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<ReviewLanding | null> {
  const token = await lookupToken(rawToken);
  if (!token || token.expiresAt.getTime() < Date.now()) return null;

  return withOrg(token.orgId, async (tx) => {
    const [request] = await tx
      .select()
      .from(reviewRequests)
      .where(eq(reviewRequests.id, token.requestId))
      .limit(1);
    if (!request) return null;

    const [org] = await tx.select({ name: orgs.name, settings: orgs.settings }).from(orgs).limit(1);
    let locationName: string | null = null;
    if (request.locationId) {
      const [loc] = await tx
        .select({ name: locations.name })
        .from(locations)
        .where(eq(locations.id, request.locationId))
        .limit(1);
      locationName = loc?.name ?? null;
    }

    const [contact] = await tx
      .select({ name: contacts.name })
      .from(contacts)
      .where(eq(contacts.id, request.contactId))
      .limit(1);

    const platformRows = await tx.select().from(reviewPlatforms).where(eq(reviewPlatforms.orgId, token.orgId));

    const [existingFeedback] = await tx
      .select({ id: privateFeedback.id })
      .from(privateFeedback)
      .where(eq(privateFeedback.requestId, request.id))
      .limit(1);

    // Mark click exactly once.
    if (!token.clickedAt) {
      await tx
        .update(reviewTokens)
        .set({ clickedAt: new Date(), ip: meta.ip ?? null, userAgent: meta.userAgent ?? null })
        .where(eq(reviewTokens.id, token.id));
      if (request.status === "sent" || request.status === "queued") {
        await tx
          .update(reviewRequests)
          .set({ status: "clicked", clickedAt: new Date() })
          .where(eq(reviewRequests.id, request.id));
      }
    }

    const businessName = org?.name ?? "our business";
    const branding = coerceBranding(((org?.settings ?? {}) as Record<string, unknown>).branding);
    const platforms = platformRows.map((row) => ({
      kind: row.kind,
      displayName: row.displayName,
      url: platformPublicUrl(row.externalRef),
    }));

    return {
      requestId: request.id,
      contactId: request.contactId,
      contactName: contact?.name ?? null,
      businessName,
      locationName,
      platforms,
      publicUrl: platforms.find((p) => p.url)?.url ?? fallbackReviewUrl(businessName),
      alreadyResponded: Boolean(existingFeedback),
      branding,
    };
  });
}

export async function submitPrivateFeedback(
  rawToken: string,
  input: PrivateFeedbackInput,
): Promise<{ ok: true }> {
  const token = await lookupToken(rawToken);
  if (!token || token.expiresAt.getTime() < Date.now()) {
    throw new DomainError("TOKEN_INVALID", "This link is no longer valid.", 410);
  }

  await withOrg(token.orgId, async (tx) => {
    const [request] = await tx
      .select({ contactId: reviewRequests.contactId })
      .from(reviewRequests)
      .where(eq(reviewRequests.id, token.requestId))
      .limit(1);

    await tx.insert(privateFeedback).values({
      orgId: token.orgId,
      contactId: request?.contactId ?? null,
      requestId: token.requestId,
      rating: input.rating ?? null,
      body: input.body,
      status: "new",
    });
  });

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* review inbox + sync                                                 */
/* ------------------------------------------------------------------ */

export async function listReviews(
  orgId: string,
  filters: { limit?: number; platformKind?: string; maxRating?: number } = {},
) {
  const limit = Math.min(filters.limit ?? 50, 100);
  return withOrg(orgId, async (tx) => {
    const conditions = [];
    if (filters.platformKind) conditions.push(eq(reviewPlatforms.kind, filters.platformKind as never));
    if (filters.maxRating) conditions.push(sql`${reviews.rating} <= ${filters.maxRating}`);

    return tx
      .select({
        id: reviews.id,
        authorName: reviews.authorName,
        rating: reviews.rating,
        body: reviews.body,
        reviewedAt: reviews.reviewedAt,
        replyStatus: reviews.replyStatus,
        platformKind: reviewPlatforms.kind,
        platformName: reviewPlatforms.displayName,
      })
      .from(reviews)
      .leftJoin(reviewPlatforms, eq(reviewPlatforms.id, reviews.platformId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(reviews.reviewedAt))
      .limit(limit);
  });
}

export async function listReviewRequests(orgId: string, filters: { limit?: number } = {}) {
  const limit = Math.min(filters.limit ?? 50, 100);
  return withOrg(orgId, (tx) =>
    tx
      .select({
        id: reviewRequests.id,
        status: reviewRequests.status,
        channel: reviewRequests.channel,
        platformKind: reviewRequests.platformKind,
        sentAt: reviewRequests.sentAt,
        clickedAt: reviewRequests.clickedAt,
        reviewedAt: reviewRequests.reviewedAt,
        followUpCount: reviewRequests.followUpCount,
        lastFollowUpAt: reviewRequests.lastFollowUpAt,
        createdAt: reviewRequests.createdAt,
        contactId: reviewRequests.contactId,
        contactName: contacts.name,
        locationId: reviewRequests.locationId,
      })
      .from(reviewRequests)
      .leftJoin(contacts, eq(contacts.id, reviewRequests.contactId))
      .where(eq(reviewRequests.orgId, orgId))
      .orderBy(desc(reviewRequests.createdAt))
      .limit(limit),
  );
}

export async function listPrivateFeedback(orgId: string, limit = 50) {
  return withOrg(orgId, (tx) =>
    tx
      .select({
        id: privateFeedback.id,
        rating: privateFeedback.rating,
        body: privateFeedback.body,
        status: privateFeedback.status,
        createdAt: privateFeedback.createdAt,
        contactName: contacts.name,
      })
      .from(privateFeedback)
      .leftJoin(contacts, eq(contacts.id, privateFeedback.contactId))
      .where(eq(privateFeedback.orgId, orgId))
      .orderBy(desc(privateFeedback.createdAt))
      .limit(limit),
  );
}

export interface ReviewStats {
  total: number;
  averageRating: number;
  responded: number;
  requests: number;
  requestsSent: number;
  clicked: number;
  reviewed: number;
  privateFeedback: number;
  distribution: { rating: number; count: number }[];
}

export async function reviewStats(orgId: string): Promise<ReviewStats> {
  return withOrg(orgId, async (tx) => {
    const [reviewAgg] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        avg: sql<number>`coalesce(avg(${reviews.rating}), 0)::float`,
        responded: sql<number>`count(*) filter (where ${reviews.replyStatus} = 'posted')::int`,
      })
      .from(reviews);

    const distRows = await tx
      .select({ rating: reviews.rating, count: sql<number>`count(*)::int` })
      .from(reviews)
      .groupBy(reviews.rating);

    const [reqAgg] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        sent: sql<number>`count(*) filter (where ${reviewRequests.status} in ('sent','clicked','reviewed'))::int`,
        clicked: sql<number>`count(*) filter (where ${reviewRequests.status} in ('clicked','reviewed'))::int`,
        reviewed: sql<number>`count(*) filter (where ${reviewRequests.status} = 'reviewed')::int`,
      })
      .from(reviewRequests);

    const [feedbackAgg] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(privateFeedback);

    return {
      total: reviewAgg?.total ?? 0,
      averageRating: Number((reviewAgg?.avg ?? 0).toFixed(2)),
      responded: reviewAgg?.responded ?? 0,
      requests: reqAgg?.total ?? 0,
      requestsSent: reqAgg?.sent ?? 0,
      clicked: reqAgg?.clicked ?? 0,
      reviewed: reqAgg?.reviewed ?? 0,
      privateFeedback: feedbackAgg?.n ?? 0,
      distribution: [1, 2, 3, 4, 5].map((rating) => ({
        rating,
        count: distRows.find((row) => row.rating === rating)?.count ?? 0,
      })),
    };
  });
}

export interface SyncReviewsResult {
  imported: number;
  updated: number;
  platforms: number;
  skipped: number;
  errors: { platformId: string; kind: string; error: string }[];
}

export async function syncPlatformReviews(
  orgId: string,
  platformId: string | null,
): Promise<SyncReviewsResult> {
  const platforms = await withOrg(orgId, (tx) =>
    tx
      .select()
      .from(reviewPlatforms)
      .where(platformId ? eq(reviewPlatforms.id, platformId) : eq(reviewPlatforms.orgId, orgId)),
  );
  if (platforms.length === 0) throw new DomainError("NO_PLATFORMS", "No review platforms configured.", 404);

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const errors: SyncReviewsResult["errors"] = [];

  for (const platform of platforms) {
    const client = getReviewPlatformClient(platform.kind);
    let fetched;
    try {
      fetched = await client.fetchReviews({
        externalRef: platform.externalRef,
        credentialsRef: platform.credentialsRef,
      });
    } catch (error) {
      // A single unconfigured platform must not abort a full sync. When a
      // specific platform was requested, surface the error to the caller.
      if (platformId) throw error;
      skipped += 1;
      errors.push({
        platformId: platform.id,
        kind: platform.kind,
        error: error instanceof Error ? error.message : "Sync failed.",
      });
      continue;
    }

    for (const review of fetched) {
      const existed = await withOrg(orgId, (tx) =>
        tx
          .select({ id: reviews.id })
          .from(reviews)
          .where(and(eq(reviews.platformId, platform.id), eq(reviews.externalId, review.externalId)))
          .limit(1),
      );

      await withOrg(orgId, (tx) =>
        tx
          .insert(reviews)
          .values({
            orgId,
            locationId: null,
            platformId: platform.id,
            externalId: review.externalId,
            authorName: review.authorName,
            rating: review.rating,
            body: review.body,
            language: review.language,
            reviewedAt: review.reviewedAt,
            url: review.url,
            replyStatus: "draft",
            raw: (review.raw ?? {}) as never,
          })
          .onConflictDoUpdate({
            target: [reviews.platformId, reviews.externalId],
            set: {
              authorName: review.authorName,
              rating: review.rating,
              body: review.body,
              reviewedAt: review.reviewedAt,
              updatedAt: new Date(),
            },
          }),
      );
      if (existed[0]) updated += 1;
      else imported += 1;
    }
  }

  return { imported, updated, platforms: platforms.length - skipped, skipped, errors };
}

export async function replyToReview(
  orgId: string,
  reviewId: string,
  body: string,
  authorId: string,
): Promise<{ id: string }> {
  return withOrg(orgId, async (tx) => {
    const [review] = await tx.select({ id: reviews.id }).from(reviews).where(eq(reviews.id, reviewId)).limit(1);
    if (!review) throw new DomainError("REVIEW_NOT_FOUND", "Review not found.", 404);

    const [reply] = await tx
      .insert(reviewReplies)
      .values({ orgId, reviewId, body, status: "draft", authorId })
      .returning({ id: reviewReplies.id });

    await tx
      .update(reviews)
      .set({ replyStatus: "draft", updatedAt: new Date() })
      .where(eq(reviews.id, reviewId));

    return { id: reply!.id };
  });
}

/** Contact options for the request picker. */
export async function listContactOptions(orgId: string) {
  return withOrg(orgId, (tx) =>
    tx
      .select({ id: contacts.id, name: contacts.name })
      .from(contacts)
      .where(eq(contacts.orgId, orgId))
      .orderBy(contacts.name)
      .limit(200),
  );
}

/** Marks a request reviewed when a matching public review lands (manual/API). */
export async function markRequestReviewed(orgId: string, requestId: string): Promise<void> {
  await withOrg(orgId, (tx) =>
    tx
      .update(reviewRequests)
      .set({ status: "reviewed", reviewedAt: new Date() })
      .where(eq(reviewRequests.id, requestId)),
  );
}

export async function contactHasConsentForChannel(
  orgId: string,
  contactId: string,
  channel: "sms" | "email",
): Promise<boolean> {
  const decision = await checkConsent(orgId, contactId, channel);
  return decision.allowed;
}

export async function contactChannelValue(
  orgId: string,
  contactId: string,
  channel: "sms" | "email",
): Promise<string | null> {
  return withOrg(orgId, async (tx) => {
    const kind = channel === "sms" ? "phone" : "email";
    const rows = await tx
      .select({ value: contactChannels.value })
      .from(contactChannels)
      .where(and(eq(contactChannels.contactId, contactId), eq(contactChannels.kind, kind)))
      .limit(1);
    return rows[0]?.value ?? null;
  });
}
