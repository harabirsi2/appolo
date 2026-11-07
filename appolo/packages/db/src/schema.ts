import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* enums                                                               */
/* ------------------------------------------------------------------ */

export const roleEnum = pgEnum("role", ["owner", "admin", "manager", "agent", "viewer"]);
export const memberStatusEnum = pgEnum("member_status", ["invited", "active", "disabled"]);
export const channelKindEnum = pgEnum("channel_kind", ["sms", "email", "webchat", "facebook", "instagram", "gbp"]);
export const consentStatusEnum = pgEnum("consent_status", ["granted", "revoked"]);
export const conversationStatusEnum = pgEnum("conversation_status", ["open", "pending", "snoozed", "closed"]);
export const messageDirectionEnum = pgEnum("message_direction", ["inbound", "outbound"]);
export const messageSenderEnum = pgEnum("message_sender", ["contact", "user", "ai", "system"]);
export const messageStatusEnum = pgEnum("message_status", ["queued", "sent", "delivered", "failed", "received"]);
export const reviewPlatformKindEnum = pgEnum("review_platform_kind", [
  "google",
  "facebook",
  "bbb",
  "dealerrater",
  "yelp",
  "custom",
]);
export const reviewRequestStatusEnum = pgEnum("review_request_status", [
  "queued",
  "sent",
  "clicked",
  "reviewed",
  "declined",
  "opted_out",
  "failed",
]);
export const replyStatusEnum = pgEnum("reply_status", ["draft", "approved", "posted", "failed"]);
export const automationRunStateEnum = pgEnum("automation_run_state", ["running", "waiting", "completed", "failed"]);
export const campaignStatusEnum = pgEnum("campaign_status", ["draft", "scheduled", "sending", "sent", "cancelled"]);
export const appointmentStatusEnum = pgEnum("appointment_status", [
  "scheduled",
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
]);

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const pk = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const emptyJson = () => sql`'{}'::jsonb`;
const emptyTextArray = () => sql`'{}'::text[]`;
const emptyUuidArray = () => sql`'{}'::uuid[]`;

/* ------------------------------------------------------------------ */
/* identity & tenancy                                                  */
/* ------------------------------------------------------------------ */

export const orgs = pgTable(
  "orgs",
  {
    id: pk(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    planTier: text("plan_tier").notNull().default("trial"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    settings: jsonb("settings").notNull().default(emptyJson()),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    slugUq: uniqueIndex("orgs_slug_uq").on(t.slug),
  }),
);

export const locations = pgTable(
  "locations",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address"),
    phone: text("phone"),
    timezone: text("timezone").notNull().default("UTC"),
    hours: jsonb("hours").notNull().default(emptyJson()),
    gbpAccountId: text("gbp_account_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    orgIdx: index("locations_org_idx").on(t.orgId),
  }),
);

export const users = pgTable(
  "users",
  {
    id: pk(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    totpSecret: text("totp_secret"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    emailUq: uniqueIndex("users_email_uq").on(t.email),
  }),
);

/**
 * Intentionally NOT under RLS: membership lookup happens before an org
 * context exists. Every query must filter by user_id. Revisit with a
 * SECURITY DEFINER resolver when auth hardening lands.
 */
export const memberships = pgTable(
  "memberships",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("agent"),
    locationIds: uuid("location_ids").array().notNull().default(emptyUuidArray()),
    status: memberStatusEnum("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    orgUserUq: uniqueIndex("memberships_org_user_uq").on(t.orgId, t.userId),
    userIdx: index("memberships_user_idx").on(t.userId),
  }),
);

export const sessions = pgTable(
  "sessions",
  {
    id: pk(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => ({
    tokenUq: uniqueIndex("sessions_token_uq").on(t.tokenHash),
    userIdx: index("sessions_user_idx").on(t.userId),
  }),
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    scopes: text("scopes").array().notNull().default(emptyTextArray()),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => ({
    keyUq: uniqueIndex("api_keys_hash_uq").on(t.keyHash),
    orgIdx: index("api_keys_org_idx").on(t.orgId),
  }),
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => ({
    orgIdx: index("audit_logs_org_created_idx").on(t.orgId, t.createdAt),
  }),
);

/* ------------------------------------------------------------------ */
/* contacts                                                            */
/* ------------------------------------------------------------------ */

export const contacts = pgTable(
  "contacts",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name"),
    company: text("company"),
    notes: text("notes"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    source: text("source"),
    mergedIntoId: uuid("merged_into_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    orgIdx: index("contacts_org_idx").on(t.orgId),
    nameIdx: index("contacts_name_idx").on(t.orgId, t.name),
  }),
);

export const contactChannels = pgTable(
  "contact_channels",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => ({
    valueIdx: index("contact_channels_value_idx").on(t.orgId, t.normalizedValue),
    contactIdx: index("contact_channels_contact_idx").on(t.contactId),
  }),
);

export const tags = pgTable(
  "tags",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#6366f1"),
    createdAt: createdAt(),
  },
  (t) => ({
    orgNameUq: uniqueIndex("tags_org_name_uq").on(t.orgId, t.name),
  }),
);

export const contactTags = pgTable(
  "contact_tags",
  {
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.contactId, t.tagId] }),
  }),
);

export const customFields = pgTable(
  "custom_fields",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("text"),
    options: jsonb("options").notNull().default(emptyJson()),
    createdAt: createdAt(),
  },
  (t) => ({
    orgNameUq: uniqueIndex("custom_fields_org_name_uq").on(t.orgId, t.name),
  }),
);

export const contactCustomValues = pgTable(
  "contact_custom_values",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    fieldId: uuid("field_id").notNull().references(() => customFields.id, { onDelete: "cascade" }),
    value: text("value"),
  },
  (t) => ({
    contactFieldUq: uniqueIndex("contact_custom_values_uq").on(t.contactId, t.fieldId),
  }),
);

export const consentRecords = pgTable(
  "consent_records",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    status: consentStatusEnum("status").notNull(),
    source: text("source").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip"),
    evidence: jsonb("evidence").notNull().default(emptyJson()),
  },
  (t) => ({
    contactChannelIdx: index("consent_records_contact_channel_idx").on(t.contactId, t.channel, t.capturedAt),
  }),
);

export const contactEvents = pgTable(
  "contact_events",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().default(emptyJson()),
    createdAt: createdAt(),
  },
  (t) => ({
    contactIdx: index("contact_events_contact_idx").on(t.contactId, t.createdAt),
  }),
);

/* ------------------------------------------------------------------ */
/* messaging                                                           */
/* ------------------------------------------------------------------ */

export const channels = pgTable(
  "channels",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "cascade" }),
    kind: channelKindEnum("kind").notNull(),
    provider: text("provider"),
    providerRef: text("provider_ref"),
    config: jsonb("config").notNull().default(emptyJson()),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => ({
    orgKindIdx: index("channels_org_kind_idx").on(t.orgId, t.kind),
  }),
);

export const phoneNumbers = pgTable(
  "phone_numbers",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    e164: text("e164").notNull(),
    providerSid: text("provider_sid"),
    capabilities: jsonb("capabilities").notNull().default(emptyJson()),
    a2pStatus: text("a2p_status").notNull().default("unregistered"),
    country: text("country"),
    createdAt: createdAt(),
  },
  (t) => ({
    e164Uq: uniqueIndex("phone_numbers_e164_uq").on(t.e164),
    orgIdx: index("phone_numbers_org_idx").on(t.orgId),
  }),
);

export const conversations = pgTable(
  "conversations",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "set null" }),
    status: conversationStatusEnum("status").notNull().default("open"),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    priority: integer("priority").notNull().default(0),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    unreadCount: integer("unread_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    orgStatusIdx: index("conversations_org_status_idx").on(t.orgId, t.status, t.lastMessageAt),
    contactIdx: index("conversations_contact_idx").on(t.contactId),
  }),
);

export const messages = pgTable(
  "messages",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    direction: messageDirectionEnum("direction").notNull(),
    senderType: messageSenderEnum("sender_type").notNull(),
    senderId: uuid("sender_id"),
    body: text("body").notNull().default(""),
    media: jsonb("media").notNull().default(sql`'[]'::jsonb`),
    providerSid: text("provider_sid"),
    status: messageStatusEnum("status").notNull().default("queued"),
    errorCode: text("error_code"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => ({
    conversationIdx: index("messages_conversation_created_idx").on(t.conversationId, t.createdAt),
    providerIdx: index("messages_provider_sid_idx").on(t.providerSid),
  }),
);

export const messageEvents = pgTable(
  "message_events",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull().default(emptyJson()),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    messageIdx: index("message_events_message_idx").on(t.messageId, t.occurredAt),
  }),
);

export const internalNotes = pgTable(
  "internal_notes",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    mentions: uuid("mentions").array().notNull().default(emptyUuidArray()),
    createdAt: createdAt(),
  },
  (t) => ({
    conversationIdx: index("internal_notes_conversation_idx").on(t.conversationId, t.createdAt),
  }),
);

export const savedReplies = pgTable(
  "saved_replies",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    scope: text("scope").notNull().default("org"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    variables: jsonb("variables").notNull().default(sql`'[]'::jsonb`),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => ({
    orgIdx: index("saved_replies_org_idx").on(t.orgId),
  }),
);

/* ------------------------------------------------------------------ */
/* reviews                                                             */
/* ------------------------------------------------------------------ */

export const reviewPlatforms = pgTable(
  "review_platforms",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    kind: reviewPlatformKindEnum("kind").notNull(),
    displayName: text("display_name").notNull(),
    externalRef: text("external_ref"),
    credentialsRef: text("credentials_ref"),
    createdAt: createdAt(),
  },
  (t) => ({
    orgKindIdx: index("review_platforms_org_kind_idx").on(t.orgId, t.kind),
  }),
);

export const reviewTemplates = pgTable(
  "review_templates",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    channel: text("channel").notNull().default("sms"),
    subject: text("subject"),
    body: text("body").notNull(),
    variables: jsonb("variables").notNull().default(sql`'[]'::jsonb`),
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    orgIdx: index("review_templates_org_idx").on(t.orgId, t.active),
  }),
);

export const reviewRequests = pgTable(
  "review_requests",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    employeeId: uuid("employee_id").references(() => users.id, { onDelete: "set null" }),
    channel: text("channel").notNull().default("sms"),
    templateId: text("template_id"),
    status: reviewRequestStatusEnum("status").notNull().default("queued"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    followUpCount: integer("follow_up_count").notNull().default(0),
    lastFollowUpAt: timestamp("last_follow_up_at", { withTimezone: true }),
    platformKind: reviewPlatformKindEnum("platform_kind"),
    campaignId: uuid("campaign_id"),
    createdAt: createdAt(),
  },
  (t) => ({
    orgStatusIdx: index("review_requests_org_status_idx").on(t.orgId, t.status, t.sentAt),
    contactIdx: index("review_requests_contact_idx").on(t.contactId),
  }),
);

export const reviewTokens = pgTable(
  "review_tokens",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    requestId: uuid("request_id").notNull().references(() => reviewRequests.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    userAgent: text("user_agent"),
    ip: text("ip"),
  },
  (t) => ({
    tokenUq: uniqueIndex("review_tokens_hash_uq").on(t.tokenHash),
  }),
);

export const reviews = pgTable(
  "reviews",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    platformId: uuid("platform_id").notNull().references(() => reviewPlatforms.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    authorName: text("author_name"),
    rating: integer("rating").notNull(),
    body: text("body"),
    language: text("language"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
    url: text("url"),
    replyStatus: replyStatusEnum("reply_status").notNull().default("draft"),
    sentiment: text("sentiment"),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    flagged: boolean("flagged").notNull().default(false),
    raw: jsonb("raw").notNull().default(emptyJson()),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    platformExternalUq: uniqueIndex("reviews_platform_external_uq").on(t.platformId, t.externalId),
    orgReviewedIdx: index("reviews_org_reviewed_idx").on(t.orgId, t.reviewedAt),
    orgReplyIdx: index("reviews_org_reply_idx").on(t.orgId, t.replyStatus),
  }),
);

export const reviewReplies = pgTable(
  "review_replies",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    reviewId: uuid("review_id").notNull().references(() => reviews.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    status: replyStatusEnum("status").notNull().default("draft"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    externalId: text("external_id"),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => ({
    reviewIdx: index("review_replies_review_idx").on(t.reviewId, t.createdAt),
  }),
);

export const privateFeedback = pgTable(
  "private_feedback",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    requestId: uuid("request_id").references(() => reviewRequests.id, { onDelete: "set null" }),
    rating: integer("rating"),
    body: text("body"),
    status: text("status").notNull().default("new"),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => ({
    orgStatusIdx: index("private_feedback_org_status_idx").on(t.orgId, t.status, t.createdAt),
  }),
);

export const reviewWidgets = pgTable(
  "review_widgets",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "cascade" }),
    config: jsonb("config").notNull().default(emptyJson()),
    publicKey: text("public_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    publicKeyUq: uniqueIndex("review_widgets_public_key_uq").on(t.publicKey),
  }),
);

/* ------------------------------------------------------------------ */
/* automations & campaigns                                             */
/* ------------------------------------------------------------------ */

export const automations = pgTable(
  "automations",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    trigger: text("trigger").notNull().default("event"),
    conditions: jsonb("conditions").notNull().default(emptyJson()),
    enabled: boolean("enabled").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    orgIdx: index("automations_org_idx").on(t.orgId, t.enabled),
  }),
);

export const automationSteps = pgTable(
  "automation_steps",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    automationId: uuid("automation_id").notNull().references(() => automations.id, { onDelete: "cascade" }),
    order: integer("order").notNull(),
    kind: text("kind").notNull(),
    config: jsonb("config").notNull().default(emptyJson()),
  },
  (t) => ({
    automationOrderIdx: index("automation_steps_automation_order_idx").on(t.automationId, t.order),
  }),
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    automationId: uuid("automation_id").notNull().references(() => automations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    state: automationRunStateEnum("state").notNull().default("running"),
    currentStep: integer("current_step").notNull().default(0),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => ({
    nextRunIdx: index("automation_runs_state_next_idx").on(t.state, t.nextRunAt),
  }),
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    channel: text("channel").notNull().default("sms"),
    segment: jsonb("segment").notNull().default(emptyJson()),
    templateId: text("template_id"),
    status: campaignStatusEnum("status").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => ({
    orgStatusIdx: index("campaigns_org_status_idx").on(t.orgId, t.status),
  }),
);

export const campaignRecipients = pgTable(
  "campaign_recipients",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    error: text("error"),
  },
  (t) => ({
    campaignIdx: index("campaign_recipients_campaign_idx").on(t.campaignId, t.status),
  }),
);

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */

export const aiAgents = pgTable(
  "ai_agents",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("AI Employee"),
    enabled: boolean("enabled").notNull().default(false),
    model: text("model"),
    voiceProfile: jsonb("voice_profile").notNull().default(emptyJson()),
    goals: jsonb("goals").notNull().default(emptyJson()),
    guardrails: jsonb("guardrails").notNull().default(emptyJson()),
    createdAt: createdAt(),
  },
  (t) => ({
    orgIdx: index("ai_agents_org_idx").on(t.orgId, t.enabled),
  }),
);

export const aiPlaybooks = pgTable(
  "ai_playbooks",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => aiAgents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    version: integer("version").notNull().default(1),
    instructions: text("instructions").notNull().default(""),
    allowedTools: text("allowed_tools").array().notNull().default(emptyTextArray()),
    escalationRules: jsonb("escalation_rules").notNull().default(emptyJson()),
    status: text("status").notNull().default("draft"),
    createdAt: createdAt(),
  },
  (t) => ({
    agentIdx: index("ai_playbooks_agent_idx").on(t.agentId, t.version),
  }),
);

export const aiKnowledgeDocs = pgTable(
  "ai_knowledge_docs",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sourceType: text("source_type").notNull().default("text"),
    sourceRef: text("source_ref"),
    status: text("status").notNull().default("pending"),
    checksum: text("checksum"),
    createdAt: createdAt(),
  },
  (t) => ({
    orgIdx: index("ai_knowledge_docs_org_idx").on(t.orgId, t.status),
  }),
);

/**
 * `embedding` is jsonb in Phase 0 because pgvector is not installed on the
 * bundled Postgres. Migration 0002 (optional) converts it to vector(1536)
 * when the extension is available.
 */
export const aiKnowledgeChunks = pgTable(
  "ai_knowledge_chunks",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    docId: uuid("doc_id").notNull().references(() => aiKnowledgeDocs.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    embedding: jsonb("embedding"),
    tokenCount: integer("token_count").notNull().default(0),
    metadata: jsonb("metadata").notNull().default(emptyJson()),
  },
  (t) => ({
    docIdx: index("ai_knowledge_chunks_doc_idx").on(t.docId),
  }),
);

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => aiAgents.id, { onDelete: "set null" }),
    state: text("state").notNull().default("active"),
    handoffAt: timestamp("handoff_at", { withTimezone: true }),
    handoffReason: text("handoff_reason"),
    csat: integer("csat"),
    createdAt: createdAt(),
  },
  (t) => ({
    conversationIdx: index("ai_conversations_conversation_idx").on(t.conversationId),
  }),
);

export const aiTurns = pgTable(
  "ai_turns",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    aiConversationId: uuid("ai_conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull().default(""),
    toolCalls: jsonb("tool_calls").notNull().default(sql`'[]'::jsonb`),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    latencyMs: integer("latency_ms"),
    model: text("model"),
    createdAt: createdAt(),
  },
  (t) => ({
    conversationIdx: index("ai_turns_conversation_idx").on(t.aiConversationId, t.createdAt),
  }),
);

export const aiEvals = pgTable("ai_evals", {
  id: pk(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  testCase: jsonb("test_case").notNull().default(emptyJson()),
  createdAt: createdAt(),
});

export const aiEvalRuns = pgTable(
  "ai_eval_runs",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    evalId: uuid("eval_id").notNull().references(() => aiEvals.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    score: numeric("score", { precision: 5, scale: 2 }),
    output: jsonb("output").notNull().default(emptyJson()),
    createdAt: createdAt(),
  },
  (t) => ({
    evalIdx: index("ai_eval_runs_eval_idx").on(t.evalId, t.createdAt),
  }),
);

/* ------------------------------------------------------------------ */
/* calendar                                                            */
/* ------------------------------------------------------------------ */

export const calendars = pgTable(
  "calendars",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("internal"),
    externalId: text("external_id"),
    timezone: text("timezone").notNull().default("UTC"),
    createdAt: createdAt(),
  },
  (t) => ({
    orgIdx: index("calendars_org_idx").on(t.orgId),
  }),
);

export const appointments = pgTable(
  "appointments",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    calendarId: uuid("calendar_id").references(() => calendars.id, { onDelete: "set null" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: appointmentStatusEnum("status").notNull().default("scheduled"),
    service: text("service"),
    source: text("source").notNull().default("manual"),
    externalId: text("external_id"),
    createdAt: createdAt(),
  },
  (t) => ({
    orgStartIdx: index("appointments_org_start_idx").on(t.orgId, t.startsAt),
  }),
);

export const availabilityRules = pgTable(
  "availability_rules",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    calendarId: uuid("calendar_id").notNull().references(() => calendars.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    slotMinutes: integer("slot_minutes").notNull().default(30),
    bufferMinutes: integer("buffer_minutes").notNull().default(0),
  },
  (t) => ({
    calendarIdx: index("availability_rules_calendar_idx").on(t.calendarId, t.weekday),
  }),
);

/* ------------------------------------------------------------------ */
/* platform / ops                                                      */
/* ------------------------------------------------------------------ */

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: text("events").array().notNull().default(emptyTextArray()),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => ({
    orgIdx: index("webhook_endpoints_org_idx").on(t.orgId),
  }),
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull().references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull().default(emptyJson()),
    attempts: integer("attempts").notNull().default(0),
    status: text("status").notNull().default("pending"),
    responseCode: integer("response_code"),
    createdAt: createdAt(),
  },
  (t) => ({
    statusIdx: index("webhook_deliveries_status_idx").on(t.status, t.createdAt),
  }),
);

export const imports = pgTable(
  "imports",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    fileKey: text("file_key"),
    stats: jsonb("stats").notNull().default(emptyJson()),
    errors: jsonb("errors").notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => ({
    orgIdx: index("imports_org_idx").on(t.orgId, t.status),
  }),
);

export const exports = pgTable(
  "exports",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    fileKey: text("file_key"),
    createdAt: createdAt(),
  },
  (t) => ({
    orgIdx: index("exports_org_idx").on(t.orgId, t.status),
  }),
);

export const notifications = pgTable(
  "notifications",
  {
    id: pk(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().default(emptyJson()),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => ({
    userIdx: index("notifications_user_idx").on(t.userId, t.createdAt),
  }),
);

export const featureFlags = pgTable(
  "feature_flags",
  {
    id: pk(),
    orgId: uuid("org_id").references(() => orgs.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull().default(sql`'true'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => ({
    orgKeyUq: uniqueIndex("feature_flags_org_key_uq").on(t.orgId, t.key),
  }),
);

/** Distributed locks for sync jobs. Not tenant-scoped. */
export const jobLocks = pgTable("job_locks", {
  key: text("key").primaryKey(),
  owner: text("owner").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/* ------------------------------------------------------------------ */
/* media catalog & head-to-head rankings                               */
/* ------------------------------------------------------------------ */

export const mediaKindEnum = pgEnum("media_kind", ["movie", "tv", "music", "podcast", "book"]);

/**
 * The shared catalog. It is intentionally NOT tenant-scoped: everyone browses
 * the same titles, while each org keeps its own rankings against them.
 */
export const catalogItems = pgTable(
  "catalog_items",
  {
    id: pk(),
    kind: mediaKindEnum("kind").notNull(),
    title: text("title").notNull(),
    subtitle: text("subtitle").notNull().default(""),
    year: integer("year"),
    imageUrl: text("image_url"),
    externalRef: text("external_ref"),
    tags: text("tags").array().notNull().default(emptyTextArray()),
    createdAt: createdAt(),
  },
  (t) => ({
    kindTitleUq: uniqueIndex("catalog_items_kind_title_uq").on(t.kind, t.title, t.subtitle),
    externalRefUq: uniqueIndex("catalog_items_external_ref_uq").on(t.externalRef),
    kindIdx: index("catalog_items_kind_idx").on(t.kind, t.title),
  }),
);

/** One taste-profile ranking per org per catalog item. */
export const itemRatings = pgTable(
  "item_ratings",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => catalogItems.id, { onDelete: "cascade" }),
    elo: integer("elo").notNull().default(1500),
    matches: integer("matches").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    skips: integer("skips").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    orgItemUq: uniqueIndex("item_ratings_org_item_uq").on(t.orgId, t.itemId),
    orgEloIdx: index("item_ratings_org_elo_idx").on(t.orgId, t.elo),
  }),
);

/** Immutable log of every head-to-head vote, for history and stats. */
export const itemMatchups = pgTable(
  "item_matchups",
  {
    id: pk(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => catalogItems.id, { onDelete: "cascade" }),
    opponentId: uuid("opponent_id").notNull().references(() => catalogItems.id, { onDelete: "cascade" }),
    /** Result from the item's perspective: win | loss | skip. */
    result: text("result").notNull(),
    itemEloBefore: integer("item_elo_before").notNull(),
    itemEloAfter: integer("item_elo_after").notNull(),
    opponentEloBefore: integer("opponent_elo_before").notNull(),
    opponentEloAfter: integer("opponent_elo_after").notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    orgItemIdx: index("item_matchups_org_item_idx").on(t.orgId, t.itemId, t.createdAt),
  }),
);