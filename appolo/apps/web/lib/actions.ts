"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  automationSchema,
  aiAgentConfigSchema,
  bulkReviewRequestSchema,
  campaignSchema,
  can,
  contactCreateSchema,
  consentInputSchema,
  firstIssue,
  locationSchema,
  loginSchema,
  parseClock,
  privateFeedbackSchema,
  reviewDraftSchema,
  reviewReplySchema,
  reviewRequestInputSchema,
  reviewTemplateSchema,
  reviewWidgetConfigSchema,
  savedReplySchema,
  signupSchema,
  type Capability,
} from "@appolo/core";
import { signIn, signOut, signUp } from "./services/auth";
import { createContact, importContactsCsv, updateContact } from "./services/contacts";
import { recordConsent } from "./services/consent";
import {
  addInternalNote,
  createSavedReply,
  sendOutboundMessage,
  updateConversation,
} from "./services/messaging";
import {
  assignReview,
  createReviewTemplate,
  deleteReviewTemplate,
  draftReplyForReview,
  ensureReviewWidget,
  flagReview,
  publishReviewReply,
  replyToReview,
  sendBulkReviewRequests,
  sendDueFollowUps,
  sendReviewRequest,
  submitPrivateFeedback,
  syncPlatformReviews,
  updateLandingBranding,
  updateReviewSettings,
  updateReviewWidget,
} from "./services/reviews";
import {
  createAutomation,
  deleteAutomation,
  setAutomationEnabled,
  updateAutomation,
} from "./services/automations";
import { createCampaign, deleteCampaign, sendCampaign } from "./services/campaigns";
import {
  createKnowledgeDoc,
  deleteKnowledgeDoc,
  ensureAiAgent,
  updateAiAgent,
} from "./services/ai-employee";
import { isDomainError } from "./services/errors";
import { requireSession } from "./session";
import { withOrg, schema } from "./db";

const { locations } = schema;

function safeNext(value: FormDataEntryValue | null): string {
  const raw = typeof value === "string" ? value : "";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/app";
}

function fail(path: string, error: unknown): never {
  const message = isDomainError(error) ? error.message : "Something went wrong. Please try again.";
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}error=${encodeURIComponent(message)}`);
}

function stringField(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function tagList(formData: FormData, name: string): string[] {
  const raw = stringField(formData, name);
  if (!raw) return [];
  return raw
    .split(/[;,]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
}

async function requestIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return h.get("x-real-ip");
}

export async function signupAction(formData: FormData): Promise<void> {
  const parsed = signupSchema.safeParse({
    orgName: formData.get("orgName"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    locationName: formData.get("locationName") || undefined,
    timezone: formData.get("timezone") || "UTC",
  });

  if (!parsed.success) {
    redirect(`/signup?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  const result = await signUp(parsed.data);
  if (!result.ok) {
    redirect(`/signup?error=${encodeURIComponent(result.error)}`);
  }

  redirect("/app/onboarding");
}

export async function loginAction(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    redirect(`/login?error=${encodeURIComponent(firstIssue(parsed.error))}&next=${encodeURIComponent(next)}`);
  }

  const result = await signIn(parsed.data);
  if (!result.ok) {
    redirect(`/login?error=${encodeURIComponent(result.error)}&next=${encodeURIComponent(next)}`);
  }

  redirect(next);
}

export async function logoutAction(): Promise<void> {
  await signOut();
  redirect("/login");
}

export async function createLocationAction(formData: FormData): Promise<void> {
  const session = await requireSession();

  const denied = (capability: Capability) =>
    redirect(`/app/locations?error=${encodeURIComponent(`Your role cannot ${capability}.`)}`);

  if (!can(session.membership.role, "locations:manage")) denied("locations:manage");

  const parsed = locationSchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address") || undefined,
    phone: formData.get("phone") || undefined,
    timezone: formData.get("timezone") || "UTC",
  });

  if (!parsed.success) {
    redirect(`/app/locations?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  await withOrg(session.org.id, (tx) =>
    tx.insert(locations).values({
      orgId: session.org.id,
      name: parsed.data.name,
      address: parsed.data.address ?? null,
      phone: parsed.data.phone ?? null,
      timezone: parsed.data.timezone,
    }),
  );

  revalidatePath("/app/locations");
  revalidatePath("/app");
  redirect("/app/locations?ok=1");
}

/* ------------------------------------------------------------------ */
/* Phase 1 — contacts                                                  */
/* ------------------------------------------------------------------ */

export async function createContactAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "contacts:write")) {
    redirect(`/app/contacts?error=${encodeURIComponent("Your role cannot create contacts.")}`);
  }

  const channels: { kind: "phone" | "email"; value: string }[] = [];
  const phone = stringField(formData, "phone");
  const email = stringField(formData, "email");
  if (phone) channels.push({ kind: "phone", value: phone });
  if (email) channels.push({ kind: "email", value: email });

  const parsed = contactCreateSchema.safeParse({
    name: stringField(formData, "name"),
    company: stringField(formData, "company"),
    channels,
    tags: tagList(formData, "tags"),
    source: "console",
  });

  if (!parsed.success) {
    redirect(`/app/contacts?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }
  if (channels.length === 0) {
    redirect(`/app/contacts?error=${encodeURIComponent("Add at least a phone number or email.")}`);
  }

  try {
    await createContact(session.org.id, parsed.data);
  } catch (error) {
    fail("/app/contacts", error);
  }

  revalidatePath("/app/contacts");
  revalidatePath("/app");
  redirect("/app/contacts?ok=Contact%20created");
}

export async function importContactsAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "contacts:write")) {
    redirect(`/app/contacts?error=${encodeURIComponent("Your role cannot import contacts.")}`);
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/app/contacts?error=${encodeURIComponent("Choose a CSV file to import.")}`);
  }
  if (file.size > 2_000_000) {
    redirect(`/app/contacts?error=${encodeURIComponent("CSV is too large (max 2 MB).")}`);
  }

  let stats;
  try {
    stats = await importContactsCsv(session.org.id, await file.text());
  } catch (error) {
    fail("/app/contacts", error);
  }

  revalidatePath("/app/contacts");
  revalidatePath("/app");
  redirect(
    `/app/contacts?ok=${encodeURIComponent(`Imported ${stats.created} contact(s), skipped ${stats.skipped}.`)}`,
  );
}

export async function updateContactAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const contactId = stringField(formData, "contactId");
  const back = `/app/contacts/${contactId ?? ""}`;

  if (!contactId) redirect("/app/contacts");
  if (!can(session.membership.role, "contacts:write")) {
    redirect(`${back}?error=${encodeURIComponent("Your role cannot edit contacts.")}`);
  }

  try {
    await updateContact(session.org.id, contactId, {
      name: stringField(formData, "name") ?? null,
      company: stringField(formData, "company") ?? null,
      notes: stringField(formData, "notes") ?? null,
      tags: tagList(formData, "tags"),
    });
  } catch (error) {
    fail(back, error);
  }

  revalidatePath(back);
  revalidatePath("/app/contacts");
  redirect(`${back}?ok=Saved`);
}

export async function consentAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const contactId = stringField(formData, "contactId");
  const back = `/app/contacts/${contactId ?? ""}`;

  if (!contactId) redirect("/app/contacts");
  if (!can(session.membership.role, "contacts:write")) {
    redirect(`${back}?error=${encodeURIComponent("Your role cannot change consent.")}`);
  }

  const parsed = consentInputSchema.safeParse({
    channel: stringField(formData, "channel"),
    status: stringField(formData, "status"),
    source: "console",
  });
  if (!parsed.success) {
    redirect(`${back}?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  try {
    await recordConsent(session.org.id, contactId, parsed.data, { ip: await requestIp() });
  } catch (error) {
    fail(back, error);
  }

  revalidatePath(back);
  revalidatePath("/app/inbox");
  redirect(`${back}?ok=Consent%20updated`);
}

/* ------------------------------------------------------------------ */
/* Phase 1 — inbox                                                     */
/* ------------------------------------------------------------------ */

export async function sendMessageAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const conversationId = stringField(formData, "conversationId");
  const back = `/app/inbox?c=${conversationId ?? ""}`;

  if (!conversationId) redirect("/app/inbox");
  if (!can(session.membership.role, "messages:send")) {
    redirect(`/app/inbox?error=${encodeURIComponent("Your role cannot send messages.")}`);
  }

  const body = stringField(formData, "body");
  if (!body) redirect(`${back}&error=${encodeURIComponent("Message cannot be empty.")}`);

  try {
    await sendOutboundMessage(session.org.id, conversationId, {
      body,
      senderType: "user",
      senderId: session.user.id,
    });
  } catch (error) {
    fail(back, error);
  }

  revalidatePath("/app/inbox");
  revalidatePath("/app");
  redirect(back);
}

export async function updateConversationAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const conversationId = stringField(formData, "conversationId");
  const back = `/app/inbox?c=${conversationId ?? ""}`;

  if (!conversationId) redirect("/app/inbox");
  if (!can(session.membership.role, "messages:send")) {
    redirect(`/app/inbox?error=${encodeURIComponent("Your role cannot update conversations.")}`);
  }

  const status = stringField(formData, "status");
  const assignTo = stringField(formData, "assignTo");
  const assigneeId =
    assignTo === "me"
      ? session.user.id
      : assignTo === "unassigned"
        ? null
        : assignTo && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assignTo)
          ? assignTo
          : undefined;

  try {
    await updateConversation(session.org.id, conversationId, {
      ...(status ? { status } : {}),
      ...(assigneeId !== undefined ? { assigneeId } : {}),
    });
  } catch (error) {
    fail(back, error);
  }

  revalidatePath("/app/inbox");
  redirect(back);
}

export async function addNoteAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const conversationId = stringField(formData, "conversationId");
  const back = `/app/inbox?c=${conversationId ?? ""}`;

  if (!conversationId) redirect("/app/inbox");
  if (!can(session.membership.role, "messages:send")) {
    redirect(`/app/inbox?error=${encodeURIComponent("Your role cannot add notes.")}`);
  }

  const body = stringField(formData, "body");
  if (!body) redirect(`${back}&error=${encodeURIComponent("Note cannot be empty.")}`);

  try {
    await addInternalNote(session.org.id, conversationId, session.user.id, body);
  } catch (error) {
    fail(back, error);
  }

  revalidatePath("/app/inbox");
  redirect(back);
}

export async function createSavedReplyAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "messages:send")) {
    redirect(`/app/settings?error=${encodeURIComponent("Your role cannot create saved replies.")}`);
  }

  const parsed = savedReplySchema.safeParse({
    title: stringField(formData, "title"),
    body: stringField(formData, "body"),
    scope: stringField(formData, "scope") ?? "org",
  });
  if (!parsed.success) {
    redirect(`/app/settings?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  try {
    await createSavedReply(session.org.id, session.user.id, parsed.data);
  } catch (error) {
    fail("/app/settings", error);
  }

  revalidatePath("/app/settings");
  revalidatePath("/app/inbox");
  redirect("/app/settings?ok=Saved%20reply%20created");
}

/* ------------------------------------------------------------------ */
/* Phase 2 — reviews                                                   */
/* ------------------------------------------------------------------ */

export async function sendReviewRequestAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "reviews:request")) {
    redirect(`/app/reviews?error=${encodeURIComponent("Your role cannot send review requests.")}`);
  }

  const parsed = reviewRequestInputSchema.safeParse({
    contactId: stringField(formData, "contactId"),
    locationId: stringField(formData, "locationId") ?? null,
    channel: stringField(formData, "channel") ?? "sms",
    templateId: stringField(formData, "templateId") ?? null,
    platformKind: stringField(formData, "platformKind") ?? null,
  });
  if (!parsed.success) {
    redirect(`/app/reviews?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  let reviewUrl: string;
  try {
    const result = await sendReviewRequest(session.org.id, parsed.data, { id: session.user.id });
    reviewUrl = result.reviewUrl;
  } catch (error) {
    fail("/app/reviews", error);
  }

  revalidatePath("/app/reviews");
  revalidatePath("/app/inbox");
  revalidatePath("/app");
  redirect(`/app/reviews?ok=${encodeURIComponent(`Review request sent. Link: ${reviewUrl}`)}`);
}

export async function bulkReviewRequestAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "reviews:request")) {
    redirect(`/app/reviews?error=${encodeURIComponent("Your role cannot send review requests.")}`);
  }

  const contactIds = formData
    .getAll("contactIds")
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  const parsed = bulkReviewRequestSchema.safeParse({
    contactIds,
    locationId: stringField(formData, "locationId") ?? null,
    channel: stringField(formData, "channel") ?? "sms",
    templateId: stringField(formData, "templateId") ?? null,
    platformKind: stringField(formData, "platformKind") ?? null,
  });
  if (!parsed.success) {
    redirect(`/app/reviews?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  let result;
  try {
    result = await sendBulkReviewRequests(session.org.id, parsed.data, { id: session.user.id });
  } catch (error) {
    fail("/app/reviews", error);
  }

  revalidatePath("/app/reviews");
  revalidatePath("/app/inbox");
  revalidatePath("/app");
  const message = `Sent ${result.sent}, skipped ${result.skipped}, failed ${result.failed}.`;
  redirect(`/app/reviews?ok=${encodeURIComponent(message)}`);
}

export async function createReviewTemplateAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "reviews:request")) {
    redirect(`/app/reviews?error=${encodeURIComponent("Your role cannot create templates.")}`);
  }

  const parsed = reviewTemplateSchema.safeParse({
    name: stringField(formData, "name"),
    channel: stringField(formData, "channel") ?? "sms",
    subject: stringField(formData, "subject"),
    body: stringField(formData, "body"),
    isDefault: formData.get("isDefault") === "on",
  });
  if (!parsed.success) {
    redirect(`/app/reviews?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  try {
    await createReviewTemplate(session.org.id, parsed.data);
  } catch (error) {
    fail("/app/reviews", error);
  }

  revalidatePath("/app/reviews");
  redirect("/app/reviews?ok=Template%20created");
}

export async function deleteReviewTemplateAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "reviews:request")) {
    redirect(`/app/reviews?error=${encodeURIComponent("Your role cannot delete templates.")}`);
  }

  const templateId = stringField(formData, "templateId");
  if (!templateId) redirect("/app/reviews");

  try {
    await deleteReviewTemplate(session.org.id, templateId);
  } catch (error) {
    fail("/app/reviews", error);
  }

  revalidatePath("/app/reviews");
  redirect("/app/reviews?ok=Template%20deleted");
}

export async function updateReviewSettingsAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "reviews:request")) {
    redirect(`/app/reviews?error=${encodeURIComponent("Your role cannot change review settings.")}`);
  }

  const start = stringField(formData, "quietStart") ?? "21:00";
  const end = stringField(formData, "quietEnd") ?? "08:00";
  if (parseClock(start) === null || parseClock(end) === null) {
    redirect(`/app/reviews?error=${encodeURIComponent("Quiet hours must use 24-hour HH:MM format.")}`);
  }

  const dailyCap = Number(stringField(formData, "dailyCap") ?? "200");
  const cooldownDays = Number(stringField(formData, "cooldownDays") ?? "90");
  if (!Number.isFinite(dailyCap) || dailyCap < 0 || !Number.isFinite(cooldownDays) || cooldownDays < 0) {
    redirect(`/app/reviews?error=${encodeURIComponent("Daily cap and cooldown must be positive numbers.")}`);
  }

  try {
    await updateReviewSettings(session.org.id, {
      quietHours: { enabled: formData.get("quietEnabled") === "on", start, end },
      dailyCap,
      cooldownDays,
      timezone: stringField(formData, "timezone") ?? "UTC",
      defaultPlatformKind: stringField(formData, "defaultPlatformKind") ?? "google",
      followUp: {
        enabled: formData.get("followUpEnabled") === "on",
        days: Math.max(0, Number(stringField(formData, "followUpDays") ?? "3") || 0),
        max: Math.max(0, Number(stringField(formData, "followUpMax") ?? "1") || 0),
        body: stringField(formData, "followUpBody") ?? "",
      },
    });
  } catch (error) {
    fail("/app/reviews", error);
  }

  revalidatePath("/app/reviews");
  redirect("/app/reviews?ok=Review%20settings%20saved");
}

export async function runFollowUpsAction(): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "reviews:request")) {
    redirect(`/app/reviews?error=${encodeURIComponent("Your role cannot send follow-ups.")}`);
  }

  let result;
  try {
    result = await sendDueFollowUps(session.org.id, { id: session.user.id });
  } catch (error) {
    fail("/app/reviews", error);
  }

  revalidatePath("/app/reviews");
  revalidatePath("/app/inbox");
  const message =
    result.due === 0
      ? "No follow-ups are due yet."
      : `Sent ${result.sent}, skipped ${result.skipped}, failed ${result.failed}.`;
  redirect(`/app/reviews?ok=${encodeURIComponent(message)}`);
}

export async function updateBrandingAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "reviews:request")) {
    redirect(`/app/reviews?error=${encodeURIComponent("Your role cannot change branding.")}`);
  }

  const accentColor = stringField(formData, "accentColor") ?? "#6366f1";
  if (!/^#[0-9a-f]{6}$/i.test(accentColor)) {
    redirect(`/app/reviews?error=${encodeURIComponent("Accent colour must be a hex value like #6366f1.")}`);
  }

  const logoUrl = stringField(formData, "logoUrl") ?? null;
  if (logoUrl && !/^https?:\/\//i.test(logoUrl)) {
    redirect(`/app/reviews?error=${encodeURIComponent("Logo URL must start with http:// or https://.")}`);
  }

  const supportEmail = stringField(formData, "supportEmail") ?? null;
  if (supportEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(supportEmail)) {
    redirect(`/app/reviews?error=${encodeURIComponent("Support email looks invalid.")}`);
  }

  try {
    await updateLandingBranding(session.org.id, {
      logoUrl,
      accentColor,
      tagline: stringField(formData, "tagline") ?? null,
      supportEmail,
    });
  } catch (error) {
    fail("/app/reviews", error);
  }

  revalidatePath("/app/reviews");
  redirect("/app/reviews?ok=Landing%20page%20branding%20saved");
}

export async function syncReviewsAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "reviews:respond")) {
    redirect(`/app/reviews?error=${encodeURIComponent("Your role cannot sync reviews.")}`);
  }

  let result;
  try {
    result = await syncPlatformReviews(session.org.id, stringField(formData, "platformId") ?? null);
  } catch (error) {
    fail("/app/reviews", error);
  }

  revalidatePath("/app/reviews");
  const summary =
    `Synced ${result.imported} new and ${result.updated} updated review(s)` +
    (result.skipped > 0 ? `; ${result.skipped} platform(s) not connected.` : ".");
  redirect(`/app/reviews?ok=${encodeURIComponent(summary)}`);
}

export async function replyToReviewAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "reviews:respond")) {
    redirect(`/app/reviews?error=${encodeURIComponent("Your role cannot reply to reviews.")}`);
  }

  const parsed = reviewReplySchema.safeParse({
    reviewId: stringField(formData, "reviewId"),
    body: stringField(formData, "body"),
  });
  if (!parsed.success) {
    redirect(`/app/reviews?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  try {
    await replyToReview(session.org.id, parsed.data.reviewId, parsed.data.body, session.user.id);
  } catch (error) {
    fail("/app/reviews", error);
  }

  revalidatePath("/app/reviews");
  redirect("/app/reviews?ok=Reply%20drafted");
}

/** Public — lives on the tokenized landing page, so no session is required. */
export async function submitPrivateFeedbackAction(formData: FormData): Promise<void> {
  const token = stringField(formData, "token");
  if (!token) redirect("/");

  const ratingRaw = stringField(formData, "rating");
  const parsed = privateFeedbackSchema.safeParse({
    token,
    rating: ratingRaw ? Number(ratingRaw) : undefined,
    body: stringField(formData, "body"),
    name: stringField(formData, "name"),
  });
  if (!parsed.success) {
    redirect(`/r/${token}?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  try {
    await submitPrivateFeedback(token, parsed.data);
  } catch (error) {
    fail(`/r/${token}`, error);
  }

  redirect(`/r/${token}?ok=1#feedback`);
}

/* ------------------------------------------------------------------ */
/* Phase 3 — review management                                         */
/* ------------------------------------------------------------------ */

export async function draftReviewReplyAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "reviews:respond")) {
    redirect(`/app/reviews?error=${encodeURIComponent("Your role cannot draft replies.")}`);
  }

  const parsed = reviewDraftSchema.safeParse({
    reviewId: stringField(formData, "reviewId"),
    tone: stringField(formData, "tone") ?? "friendly",
  });
  if (!parsed.success) {
    redirect(`/app/reviews?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  try {
    await draftReplyForReview(session.org.id, parsed.data.reviewId, parsed.data.tone, session.user.id);
  } catch (error) {
    fail("/app/reviews", error);
  }

  revalidatePath("/app/reviews");
  redirect("/app/reviews?ok=AI%20draft%20ready");
}

export async function publishReviewReplyAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "reviews:respond")) {
    redirect(`/app/reviews?error=${encodeURIComponent("Your role cannot publish replies.")}`);
  }

  const reviewId = stringField(formData, "reviewId");
  if (!reviewId) redirect("/app/reviews");

  try {
    await publishReviewReply(session.org.id, reviewId, session.user.id);
  } catch (error) {
    fail("/app/reviews", error);
  }

  revalidatePath("/app/reviews");
  redirect("/app/reviews?ok=Reply%20published");
}

export async function assignReviewAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "reviews:respond")) {
    redirect(`/app/reviews?error=${encodeURIComponent("Your role cannot assign reviews.")}`);
  }

  const reviewId = stringField(formData, "reviewId");
  const rawAssignee = stringField(formData, "assignedTo");
  const assignedTo = rawAssignee && rawAssignee !== "unassigned" ? rawAssignee : null;
  if (!reviewId) redirect("/app/reviews");

  try {
    await assignReview(session.org.id, reviewId, assignedTo, session.user.id);
  } catch (error) {
    fail("/app/reviews", error);
  }

  revalidatePath("/app/reviews");
  redirect("/app/reviews?ok=Review%20assigned");
}

export async function flagReviewAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "reviews:respond")) {
    redirect(`/app/reviews?error=${encodeURIComponent("Your role cannot flag reviews.")}`);
  }

  const reviewId = stringField(formData, "reviewId");
  const flagged = formData.get("flagged") === "on";
  if (!reviewId) redirect("/app/reviews");

  try {
    await flagReview(session.org.id, reviewId, flagged, session.user.id);
  } catch (error) {
    fail("/app/reviews", error);
  }

  revalidatePath("/app/reviews");
  redirect(flagged ? "/app/reviews?ok=Review%20flagged" : "/app/reviews?ok=Review%20unflagged");
}

export async function updateWidgetAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "reviews:request")) {
    redirect(`/app/reviews?error=${encodeURIComponent("Your role cannot change the widget.")}`);
  }

  const parsed = reviewWidgetConfigSchema.safeParse({
    headline: stringField(formData, "headline") ?? "What our customers say",
    theme: stringField(formData, "theme") ?? "dark",
    layout: stringField(formData, "layout") ?? "list",
    minRating: Number(stringField(formData, "minRating") ?? "4") || 4,
    limit: Number(stringField(formData, "limit") ?? "6") || 6,
    showRating: formData.get("showRating") === "on",
  });
  if (!parsed.success) {
    redirect(`/app/reviews?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  try {
    const widget = await ensureReviewWidget(session.org.id);
    await updateReviewWidget(session.org.id, widget.id, parsed.data);
  } catch (error) {
    fail("/app/reviews", error);
  }

  revalidatePath("/app/reviews");
  redirect("/app/reviews?ok=Widget%20saved");
}

/* ------------------------------------------------------------------ */
/* Phase 3 — automations                                               */
/* ------------------------------------------------------------------ */

function automationInputFrom(formData: FormData) {
  const keywords = (stringField(formData, "keywords") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const channels = formData
    .getAll("channels")
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  return {
    name: stringField(formData, "name"),
    trigger: stringField(formData, "trigger") ?? "keyword",
    enabled: formData.get("enabled") === "on",
    keywords,
    matchType: stringField(formData, "matchType") ?? "contains",
    channels,
    replyBody: stringField(formData, "replyBody") ?? "",
  };
}

export async function createAutomationAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "automations:manage")) {
    redirect(`/app/automations?error=${encodeURIComponent("Your role cannot manage automations.")}`);
  }

  const parsed = automationSchema.safeParse(automationInputFrom(formData));
  if (!parsed.success) {
    redirect(`/app/automations?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  try {
    await createAutomation(session.org.id, parsed.data, session.user.id);
  } catch (error) {
    fail("/app/automations", error);
  }

  revalidatePath("/app/automations");
  redirect("/app/automations?ok=Automation%20created");
}

export async function updateAutomationAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "automations:manage")) {
    redirect(`/app/automations?error=${encodeURIComponent("Your role cannot manage automations.")}`);
  }

  const id = stringField(formData, "automationId");
  if (!id) redirect("/app/automations");

  const parsed = automationSchema.safeParse(automationInputFrom(formData));
  if (!parsed.success) {
    redirect(`/app/automations?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  try {
    await updateAutomation(session.org.id, id, parsed.data, session.user.id);
  } catch (error) {
    fail("/app/automations", error);
  }

  revalidatePath("/app/automations");
  redirect("/app/automations?ok=Automation%20saved");
}

export async function toggleAutomationAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "automations:manage")) {
    redirect(`/app/automations?error=${encodeURIComponent("Your role cannot manage automations.")}`);
  }

  const id = stringField(formData, "automationId");
  const enabled = formData.get("enabled") === "on";
  if (!id) redirect("/app/automations");

  try {
    await setAutomationEnabled(session.org.id, id, enabled, session.user.id);
  } catch (error) {
    fail("/app/automations", error);
  }

  revalidatePath("/app/automations");
  redirect(enabled ? "/app/automations?ok=Automation%20enabled" : "/app/automations?ok=Automation%20paused");
}

export async function deleteAutomationAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "automations:manage")) {
    redirect(`/app/automations?error=${encodeURIComponent("Your role cannot manage automations.")}`);
  }

  const id = stringField(formData, "automationId");
  if (!id) redirect("/app/automations");

  try {
    await deleteAutomation(session.org.id, id, session.user.id);
  } catch (error) {
    fail("/app/automations", error);
  }

  revalidatePath("/app/automations");
  redirect("/app/automations?ok=Automation%20deleted");
}

/* ------------------------------------------------------------------ */
/* Phase 3 — campaigns                                                 */
/* ------------------------------------------------------------------ */

export async function createCampaignAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "messages:send")) {
    redirect(`/app/campaigns?error=${encodeURIComponent("Your role cannot create campaigns.")}`);
  }

  const parsed = campaignSchema.safeParse({
    name: stringField(formData, "name"),
    channel: stringField(formData, "channel") ?? "sms",
    segment: stringField(formData, "segment") ?? "all",
    tag: stringField(formData, "tag") ?? undefined,
    subject: stringField(formData, "subject") ?? undefined,
    body: stringField(formData, "body"),
  });
  if (!parsed.success) {
    redirect(`/app/campaigns?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  let created;
  try {
    created = await createCampaign(session.org.id, parsed.data, session.user.id);
  } catch (error) {
    fail("/app/campaigns", error);
  }

  revalidatePath("/app/campaigns");
  redirect(`/app/campaigns?ok=${encodeURIComponent(`Campaign queued for ${created.recipients} recipient(s).`)}`);
}

export async function sendCampaignAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "messages:send")) {
    redirect(`/app/campaigns?error=${encodeURIComponent("Your role cannot send campaigns.")}`);
  }

  const id = stringField(formData, "campaignId");
  if (!id) redirect("/app/campaigns");

  let result;
  try {
    result = await sendCampaign(session.org.id, id, session.user.id);
  } catch (error) {
    fail("/app/campaigns", error);
  }

  revalidatePath("/app/campaigns");
  redirect(`/app/campaigns?ok=${encodeURIComponent(`Sent ${result.sent}, skipped ${result.skipped}, failed ${result.failed}.`)}`);
}

export async function deleteCampaignAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "messages:send")) {
    redirect(`/app/campaigns?error=${encodeURIComponent("Your role cannot delete campaigns.")}`);
  }

  const id = stringField(formData, "campaignId");
  if (!id) redirect("/app/campaigns");

  try {
    await deleteCampaign(session.org.id, id, session.user.id);
  } catch (error) {
    fail("/app/campaigns", error);
  }

  revalidatePath("/app/campaigns");
  redirect("/app/campaigns?ok=Campaign%20deleted");
}

/* ------------------------------------------------------------------ */
/* Phase 4 — AI employee                                               */
/* ------------------------------------------------------------------ */

function listField(formData: FormData, name: string): string[] {
  const raw = stringField(formData, name);
  if (!raw) return [];
  return raw
    .split(/[;,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function updateAiAgentAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "ai:manage")) {
    redirect(`/app/ai?error=${encodeURIComponent("Your role cannot manage the AI employee.")}`);
  }

  const current = await ensureAiAgent(session.org.id);
  const thresholdRaw = stringField(formData, "confidenceThreshold");

  const parsed = aiAgentConfigSchema.safeParse({
    enabled: formData.get("enabled") === "on",
    greeting: stringField(formData, "greeting") ?? "",
    escalationKeywords: listField(formData, "escalationKeywords"),
    blockedTopics: listField(formData, "blockedTopics"),
    confidenceThreshold: thresholdRaw ? Number(thresholdRaw) : current.config.confidenceThreshold,
  });
  if (!parsed.success) {
    redirect(`/app/ai?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  try {
    await updateAiAgent(session.org.id, parsed.data, session.user.id);
  } catch (error) {
    fail("/app/ai", error);
  }

  revalidatePath("/app/ai");
  redirect(parsed.data.enabled ? "/app/ai?ok=AI%20employee%20enabled" : "/app/ai?ok=AI%20employee%20saved");
}

export async function createKnowledgeDocAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "ai:manage")) {
    redirect(`/app/ai?error=${encodeURIComponent("Your role cannot manage the knowledge base.")}`);
  }

  const title = stringField(formData, "title");
  const content = stringField(formData, "content");
  if (!title || !content) {
    redirect(`/app/ai?error=${encodeURIComponent("Enter a title and some content.")}`);
  }

  try {
    await createKnowledgeDoc(session.org.id, { title, content }, session.user.id);
  } catch (error) {
    fail("/app/ai", error);
  }

  revalidatePath("/app/ai");
  redirect("/app/ai?ok=Knowledge%20added");
}

export async function deleteKnowledgeDocAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.membership.role, "ai:manage")) {
    redirect(`/app/ai?error=${encodeURIComponent("Your role cannot manage the knowledge base.")}`);
  }

  const id = stringField(formData, "docId");
  if (!id) redirect("/app/ai");

  try {
    await deleteKnowledgeDoc(session.org.id, id, session.user.id);
  } catch (error) {
    fail("/app/ai", error);
  }

  revalidatePath("/app/ai");
  redirect("/app/ai?ok=Knowledge%20removed");
}