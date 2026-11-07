import { and, desc, eq, or, sql } from "drizzle-orm";
import {
  HELP_REPLY,
  STOP_REPLY,
  canSendOnChannel,
  isHelpKeyword,
  isStartKeyword,
  isStopKeyword,
  type ConsentRecordLike,
} from "@appolo/core";
import { getAdminDb, withOrg, schema, type Tx } from "@/lib/db";
import { getEmailProvider, getSmsProvider } from "./providers";
import { DomainError } from "./errors";

const {
  conversations,
  messages,
  channels,
  contactChannels,
  contacts,
  contactEvents,
  consentRecords,
  internalNotes,
  savedReplies,
  users,
  phoneNumbers,
  memberships,
  orgs,
} = schema;

type SenderType = "user" | "ai" | "system";
type OutboundStatus = "queued" | "sent" | "delivered" | "failed";

/* ------------------------------------------------------------------ */
/* reads                                                               */
/* ------------------------------------------------------------------ */

export interface ConversationListRow {
  id: string;
  status: string;
  priority: number;
  unreadCount: number;
  lastMessageAt: Date | null;
  contactId: string;
  contactName: string | null;
  channelKind: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  lastMessageBody: string | null;
}

export async function listConversations(
  orgId: string,
  filters: { status?: string; channel?: string; assignee?: string; limit?: number } = {},
): Promise<ConversationListRow[]> {
  const limit = Math.min(filters.limit ?? 50, 100);

  return withOrg(orgId, async (tx) => {
    const conditions = [];
    if (filters.status) conditions.push(eq(conversations.status, filters.status as "open"));
    if (filters.channel) conditions.push(eq(channels.kind, filters.channel as "sms"));
    if (filters.assignee) conditions.push(eq(conversations.assigneeId, filters.assignee));

    return tx
      .select({
        id: conversations.id,
        status: conversations.status,
        priority: conversations.priority,
        unreadCount: conversations.unreadCount,
        lastMessageAt: conversations.lastMessageAt,
        contactId: conversations.contactId,
        contactName: contacts.name,
        channelKind: channels.kind,
        assigneeId: conversations.assigneeId,
        assigneeName: users.name,
        lastMessageBody: sql<string | null>`(
          select m.body from messages m
          where m.conversation_id = ${conversations.id}
          order by m.created_at desc limit 1
        )`,
      })
      .from(conversations)
      .leftJoin(contacts, eq(contacts.id, conversations.contactId))
      .leftJoin(channels, eq(channels.id, conversations.channelId))
      .leftJoin(users, eq(users.id, conversations.assigneeId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(conversations.lastMessageAt), desc(conversations.createdAt))
      .limit(limit);
  });
}

export async function getConversation(orgId: string, conversationId: string) {
  return withOrg(orgId, async (tx) => {
    const [row] = await tx
      .select({
        id: conversations.id,
        status: conversations.status,
        priority: conversations.priority,
        unreadCount: conversations.unreadCount,
        lastMessageAt: conversations.lastMessageAt,
        snoozedUntil: conversations.snoozedUntil,
        contactId: conversations.contactId,
        contactName: contacts.name,
        contactCompany: contacts.company,
        channelId: conversations.channelId,
        channelKind: channels.kind,
        assigneeId: conversations.assigneeId,
        assigneeName: users.name,
      })
      .from(conversations)
      .leftJoin(contacts, eq(contacts.id, conversations.contactId))
      .leftJoin(channels, eq(channels.id, conversations.channelId))
      .leftJoin(users, eq(users.id, conversations.assigneeId))
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (!row) return null;

    const [messageRows, noteRows, channelRows, consentRows] = await Promise.all([
      tx
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(messages.createdAt)
        .limit(200),
      tx
        .select()
        .from(internalNotes)
        .where(eq(internalNotes.conversationId, conversationId))
        .orderBy(desc(internalNotes.createdAt))
        .limit(50),
      tx
        .select()
        .from(contactChannels)
        .where(eq(contactChannels.contactId, row.contactId)),
      tx
        .select()
        .from(consentRecords)
        .where(eq(consentRecords.contactId, row.contactId))
        .orderBy(desc(consentRecords.capturedAt)),
    ]);

    return { conversation: row, messages: messageRows, notes: noteRows, channels: channelRows, consent: consentRows };
  });
}

export async function listSavedReplies(orgId: string, userId: string) {
  return withOrg(orgId, (tx) =>
    tx
      .select()
      .from(savedReplies)
      .where(
        and(
          eq(savedReplies.orgId, orgId),
          or(eq(savedReplies.scope, "org"), eq(savedReplies.ownerId, userId)),
        ),
      )
      .orderBy(savedReplies.title),
  );
}

export async function createSavedReply(
  orgId: string,
  userId: string,
  input: { title: string; body: string; scope: "org" | "user" },
) {
  return withOrg(orgId, async (tx) => {
    const [row] = await tx
      .insert(savedReplies)
      .values({
        orgId,
        title: input.title,
        body: input.body,
        scope: input.scope,
        ownerId: input.scope === "user" ? userId : null,
      })
      .returning();
    return row!;
  });
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

async function ensureConversation(
  tx: Tx,
  orgId: string,
  contactId: string,
  channelId: string | null,
  locationId: string | null,
): Promise<string> {
  const conditions = [eq(conversations.contactId, contactId)];
  conditions.push(channelId ? eq(conversations.channelId, channelId) : sql`${conversations.channelId} is null`);

  const existing = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(...conditions))
    .orderBy(desc(conversations.createdAt))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const [created] = await tx
    .insert(conversations)
    .values({
      orgId,
      contactId,
      channelId,
      locationId,
      status: "open",
      lastMessageAt: new Date(),
    })
    .returning({ id: conversations.id });
  return created!.id;
}

function destinationFor(
  channelRows: { kind: string; value: string; isPrimary: boolean }[],
  channelKind: string,
): string | null {
  if (channelKind === "sms") {
    const phones = channelRows.filter((c) => c.kind === "phone");
    return (phones.find((c) => c.isPrimary) ?? phones[0])?.value ?? null;
  }
  if (channelKind === "email") {
    return channelRows.find((c) => c.kind === "email")?.value ?? null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* outbound                                                            */
/* ------------------------------------------------------------------ */

export async function sendOutboundMessage(
  orgId: string,
  conversationId: string,
  input: { body: string; subject?: string | null; senderType: SenderType; senderId?: string | null },
) {
  const context = await withOrg(orgId, async (tx) => {
    const [row] = await tx
      .select({
        conversationId: conversations.id,
        contactId: conversations.contactId,
        channelId: conversations.channelId,
        channelKind: channels.kind,
        channelRef: channels.providerRef,
        locationId: conversations.locationId,
      })
      .from(conversations)
      .leftJoin(channels, eq(channels.id, conversations.channelId))
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (!row) throw new DomainError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404);

    const channelRows = await tx
      .select({ kind: contactChannels.kind, value: contactChannels.value, isPrimary: contactChannels.isPrimary })
      .from(contactChannels)
      .where(eq(contactChannels.contactId, row.contactId));

    const consentRows = await tx
      .select({
        channel: consentRecords.channel,
        status: consentRecords.status,
        capturedAt: consentRecords.capturedAt,
      })
      .from(consentRecords)
      .where(eq(consentRecords.contactId, row.contactId))
      .orderBy(desc(consentRecords.capturedAt));

    return { ...row, channelRows, consentRows };
  });

  const channelKind = context.channelKind ?? "webchat";
  const decision = canSendOnChannel(context.consentRows as ConsentRecordLike[], channelKind);
  if (!decision.allowed) {
    throw new DomainError("NO_CONSENT", decision.reason ?? "Contact has not consented.", 409);
  }

  const destination = destinationFor(context.channelRows, channelKind);
  if ((channelKind === "sms" || channelKind === "email") && !destination) {
    throw new DomainError(
      "NO_DESTINATION",
      `This contact has no ${channelKind === "sms" ? "phone number" : "email address"} on file.`,
      422,
    );
  }

  const [queued] = await withOrg(orgId, async (tx) => {
    const inserted = await tx
      .insert(messages)
      .values({
        orgId,
        conversationId,
        direction: "outbound",
        senderType: input.senderType,
        senderId: input.senderId ?? null,
        body: input.body,
        status: channelKind === "webchat" ? "delivered" : "queued",
        sentAt: channelKind === "webchat" ? new Date() : null,
      })
      .returning();
    return inserted;
  });
  if (!queued) throw new DomainError("MESSAGE_CREATE_FAILED", "Could not queue the message.", 500);

  let providerSid: string | null = null;
  let finalStatus: OutboundStatus = channelKind === "webchat" ? "delivered" : "queued";

  if (channelKind === "sms") {
    try {
      const result = await getSmsProvider().sendSms({
        to: destination!,
        from: context.channelRef,
        body: input.body,
        idempotencyKey: queued.id,
      });
      providerSid = result.providerSid;
      finalStatus = result.status as OutboundStatus;
    } catch (error) {
      await withOrg(orgId, (tx) =>
        tx
          .update(messages)
          .set({ status: "failed", errorCode: "PROVIDER_ERROR" })
          .where(eq(messages.id, queued.id)),
      );
      throw new DomainError(
        "SEND_FAILED",
        error instanceof Error ? error.message : "The SMS provider rejected the message.",
        502,
      );
    }
  }

  if (channelKind === "email") {
    try {
      const result = await getEmailProvider().sendEmail({
        to: destination!,
        from: context.channelRef,
        subject: input.subject ?? null,
        body: input.body,
        idempotencyKey: queued.id,
      });
      providerSid = result.providerSid;
      finalStatus = result.status as OutboundStatus;
    } catch (error) {
      await withOrg(orgId, (tx) =>
        tx
          .update(messages)
          .set({ status: "failed", errorCode: "PROVIDER_ERROR" })
          .where(eq(messages.id, queued.id)),
      );
      throw new DomainError(
        "SEND_FAILED",
        error instanceof Error ? error.message : "The email provider rejected the message.",
        502,
      );
    }
  }

  const [saved] = await withOrg(orgId, async (tx) => {
    const updated = await tx
      .update(messages)
      .set({
        status: finalStatus,
        providerSid,
        sentAt: finalStatus === "failed" ? null : new Date(),
      })
      .where(eq(messages.id, queued.id))
      .returning();

    await tx
      .update(conversations)
      .set({ lastMessageAt: new Date(), status: "open", updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));

    await tx.insert(contactEvents).values({
      orgId,
      contactId: context.contactId,
      kind: "message.sent",
      payload: { conversationId, messageId: queued.id, channel: channelKind },
    });

    return updated;
  });

  return saved!;
}

/* ------------------------------------------------------------------ */
/* inbound SMS                                                         */
/* ------------------------------------------------------------------ */

interface ResolvedSms {
  orgId: string;
  channelId: string | null;
  locationId: string | null;
}

async function resolveSmsTarget(to: string): Promise<ResolvedSms | null> {
  const admin = getAdminDb();
  const [phone] = await admin
    .select({ orgId: phoneNumbers.orgId })
    .from(phoneNumbers)
    .where(eq(phoneNumbers.e164, to))
    .limit(1);
  if (!phone) return null;

  const [channel] = await admin
    .select({ id: channels.id, locationId: channels.locationId })
    .from(channels)
    .where(and(eq(channels.orgId, phone.orgId), eq(channels.kind, "sms")))
    .limit(1);

  return { orgId: phone.orgId, channelId: channel?.id ?? null, locationId: channel?.locationId ?? null };
}

export interface InboundSms {
  to: string;
  from: string;
  body: string;
  providerSid?: string | null;
  media?: unknown[];
}

export async function receiveInboundSms(input: InboundSms) {
  const target = await resolveSmsTarget(input.to);
  if (!target) {
    throw new DomainError("UNKNOWN_NUMBER", "No workspace owns that destination number.", 404);
  }
  const orgId = target.orgId;

  return withOrg(orgId, async (tx) => {
    if (input.providerSid) {
      const duplicate = await tx
        .select({ id: messages.id, conversationId: messages.conversationId })
        .from(messages)
        .where(and(eq(messages.orgId, orgId), eq(messages.providerSid, input.providerSid)))
        .limit(1);
      if (duplicate[0]) {
        return { orgId, conversationId: duplicate[0].conversationId, contactId: null, duplicate: true, action: "duplicate" as const };
      }
    }

    const normalized = input.from.replace(/[^\d+]/g, "");
    const [existingChannel] = await tx
      .select({ contactId: contactChannels.contactId })
      .from(contactChannels)
      .where(
        and(
          eq(contactChannels.orgId, orgId),
          eq(contactChannels.kind, "phone"),
          eq(contactChannels.normalizedValue, normalized),
        ),
      )
      .limit(1);

    let contactId = existingChannel?.contactId ?? null;
    if (!contactId) {
      const [contact] = await tx
        .insert(contacts)
        .values({ orgId, source: "sms_inbound" })
        .returning({ id: contacts.id });
      contactId = contact!.id;
      await tx.insert(contactChannels).values({
        orgId,
        contactId,
        kind: "phone",
        value: input.from,
        normalizedValue: normalized,
        isPrimary: true,
      });
      await tx.insert(contactEvents).values({
        orgId,
        contactId,
        kind: "contact.created",
        payload: { source: "sms_inbound" },
      });
    }

    const conversationId = await ensureConversation(
      tx,
      orgId,
      contactId,
      target.channelId,
      target.locationId,
    );

    await tx.insert(messages).values({
      orgId,
      conversationId,
      direction: "inbound",
      senderType: "contact",
      body: input.body,
      media: input.media ?? [],
      providerSid: input.providerSid ?? null,
      status: "received",
      sentAt: new Date(),
    });

    await tx.insert(contactEvents).values({
      orgId,
      contactId,
      kind: "message.received",
      payload: { conversationId, channel: "sms" },
    });

    let action: "stop" | "help" | "start" | "message" = "message";

    if (isStopKeyword(input.body)) {
      action = "stop";
      await tx.insert(consentRecords).values({
        orgId,
        contactId,
        channel: "sms",
        status: "revoked",
        source: "sms_stop",
        evidence: { keyword: input.body.trim().toUpperCase(), from: input.from },
      });
      await tx.insert(contactEvents).values({
        orgId,
        contactId,
        kind: "consent.revoked",
        payload: { channel: "sms", source: "sms_stop" },
      });
      await tx.insert(messages).values({
        orgId,
        conversationId,
        direction: "outbound",
        senderType: "system",
        body: STOP_REPLY,
        status: "delivered",
        sentAt: new Date(),
      });
      await tx
        .update(conversations)
        .set({ status: "closed", unreadCount: 0, lastMessageAt: new Date(), updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
    } else if (isHelpKeyword(input.body)) {
      action = "help";
      await tx.insert(messages).values({
        orgId,
        conversationId,
        direction: "outbound",
        senderType: "system",
        body: HELP_REPLY,
        status: "delivered",
        sentAt: new Date(),
      });
      await tx
        .update(conversations)
        .set({
          status: "open",
          unreadCount: sql`${conversations.unreadCount} + 1`,
          lastMessageAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversationId));
    } else if (isStartKeyword(input.body)) {
      action = "start";
      await tx.insert(consentRecords).values({
        orgId,
        contactId,
        channel: "sms",
        status: "granted",
        source: "sms_start",
        evidence: { keyword: input.body.trim().toUpperCase(), from: input.from },
      });
      await tx.insert(contactEvents).values({
        orgId,
        contactId,
        kind: "consent.granted",
        payload: { channel: "sms", source: "sms_start" },
      });
      await tx.insert(messages).values({
        orgId,
        conversationId,
        direction: "outbound",
        senderType: "system",
        body: "You are resubscribed and will receive messages again. Reply STOP to opt out.",
        status: "delivered",
        sentAt: new Date(),
      });
      await tx
        .update(conversations)
        .set({
          status: "open",
          unreadCount: sql`${conversations.unreadCount} + 1`,
          lastMessageAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversationId));
    } else {
      await tx
        .update(conversations)
        .set({
          status: "open",
          unreadCount: sql`${conversations.unreadCount} + 1`,
          lastMessageAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversationId));
    }

    return { orgId, conversationId, contactId, duplicate: false, action };
  });
}

/* ------------------------------------------------------------------ */
/* inbound webchat                                                     */
/* ------------------------------------------------------------------ */

async function resolveWebchatChannel(publicKey: string) {
  const admin = getAdminDb();
  const [row] = await admin
    .select({ orgId: channels.orgId, channelId: channels.id, locationId: channels.locationId, status: channels.status })
    .from(channels)
    .where(and(eq(channels.kind, "webchat"), eq(channels.providerRef, publicKey)))
    .limit(1);
  return row ?? null;
}

export async function getWebchatConfig(publicKey: string) {
  const channel = await resolveWebchatChannel(publicKey);
  if (!channel || channel.status !== "active") return null;

  const admin = getAdminDb();
  const [org] = await admin
    .select({ name: orgs.name })
    .from(orgs)
    .where(eq(orgs.id, channel.orgId))
    .limit(1);

  return { orgName: org?.name ?? "Appolo", publicKey };
}

export async function receiveWebchatMessage(
  publicKey: string,
  input: { visitorId: string; body: string; name?: string },
) {
  const channel = await resolveWebchatChannel(publicKey);
  if (!channel || channel.status !== "active") {
    throw new DomainError("UNKNOWN_WEBCHAT", "This chat widget is not available.", 404);
  }
  const orgId = channel.orgId;
  const normalizedValue = `webchat:${input.visitorId}`;

  return withOrg(orgId, async (tx) => {
    const [existing] = await tx
      .select({ contactId: contactChannels.contactId })
      .from(contactChannels)
      .where(
        and(
          eq(contactChannels.orgId, orgId),
          eq(contactChannels.kind, "social"),
          eq(contactChannels.normalizedValue, normalizedValue),
        ),
      )
      .limit(1);

    let contactId = existing?.contactId ?? null;
    if (!contactId) {
      const [contact] = await tx
        .insert(contacts)
        .values({ orgId, name: input.name ?? "Web chat visitor", source: "webchat" })
        .returning({ id: contacts.id });
      contactId = contact!.id;
      await tx.insert(contactChannels).values({
        orgId,
        contactId,
        kind: "social",
        value: normalizedValue,
        normalizedValue,
        isPrimary: true,
      });
      await tx.insert(contactEvents).values({
        orgId,
        contactId,
        kind: "contact.created",
        payload: { source: "webchat" },
      });
    }

    const conversationId = await ensureConversation(tx, orgId, contactId, channel.channelId, channel.locationId);

    const [message] = await tx
      .insert(messages)
      .values({
        orgId,
        conversationId,
        direction: "inbound",
        senderType: "contact",
        body: input.body,
        status: "received",
        sentAt: new Date(),
      })
      .returning({ id: messages.id, createdAt: messages.createdAt });

    await tx.insert(contactEvents).values({
      orgId,
      contactId,
      kind: "message.received",
      payload: { conversationId, channel: "webchat" },
    });

    await tx
      .update(conversations)
      .set({
        status: "open",
        unreadCount: sql`${conversations.unreadCount} + 1`,
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId));

    return { orgId, conversationId, contactId, messageId: message!.id };
  });
}

export async function getWebchatMessages(publicKey: string, visitorId: string) {
  const channel = await resolveWebchatChannel(publicKey);
  if (!channel || channel.status !== "active") {
    throw new DomainError("UNKNOWN_WEBCHAT", "This chat widget is not available.", 404);
  }
  const orgId = channel.orgId;
  const normalizedValue = `webchat:${visitorId}`;

  return withOrg(orgId, async (tx) => {
    const [contact] = await tx
      .select({ contactId: contactChannels.contactId })
      .from(contactChannels)
      .where(
        and(
          eq(contactChannels.orgId, orgId),
          eq(contactChannels.kind, "social"),
          eq(contactChannels.normalizedValue, normalizedValue),
        ),
      )
      .limit(1);
    if (!contact) return { conversationId: null, messages: [] };

    const [conversation] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.contactId, contact.contactId),
          eq(conversations.channelId, channel.channelId),
        ),
      )
      .orderBy(desc(conversations.createdAt))
      .limit(1);
    if (!conversation) return { conversationId: null, messages: [] };

    const rows = await tx
      .select({
        id: messages.id,
        direction: messages.direction,
        senderType: messages.senderType,
        body: messages.body,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .orderBy(messages.createdAt)
      .limit(200);

    return { conversationId: conversation.id, messages: rows };
  });
}

/* ------------------------------------------------------------------ */
/* mutation                                                            */
/* ------------------------------------------------------------------ */

export async function updateConversation(
  orgId: string,
  conversationId: string,
  patch: { status?: string; assigneeId?: string | null; priority?: number },
) {
  if (patch.assigneeId) {
    const member = await withOrg(orgId, (tx) =>
      tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, patch.assigneeId!)))
        .limit(1),
    );
    if (!member[0]) throw new DomainError("NOT_A_MEMBER", "That user is not in this workspace.", 422);
  }

  return withOrg(orgId, async (tx) => {
    const [updated] = await tx
      .update(conversations)
      .set({
        ...(patch.status ? { status: patch.status as "open" } : {}),
        ...(patch.assigneeId !== undefined ? { assigneeId: patch.assigneeId } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId))
      .returning();
    if (!updated) throw new DomainError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404);
    return updated;
  });
}

export async function markConversationRead(orgId: string, conversationId: string) {
  return withOrg(orgId, async (tx) => {
    await tx
      .update(conversations)
      .set({ unreadCount: 0, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  });
}

export async function addInternalNote(
  orgId: string,
  conversationId: string,
  authorId: string,
  body: string,
) {
  return withOrg(orgId, async (tx) => {
    const [note] = await tx
      .insert(internalNotes)
      .values({ orgId, conversationId, authorId, body })
      .returning();
    return note!;
  });
}

/** Resolve the contact id for a conversation (used by the inbox UI). */
export async function conversationContactId(orgId: string, conversationId: string) {
  return withOrg(orgId, async (tx) => {
    const [row] = await tx
      .select({ contactId: conversations.contactId })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    return row?.contactId ?? null;
  });
}

/** Agent-initiated thread from a contact profile. */
export async function startConversation(orgId: string, contactId: string, channelId: string | null) {
  return withOrg(orgId, async (tx) => {
    let locationId: string | null = null;
    if (channelId) {
      const [channel] = await tx
        .select({ locationId: channels.locationId })
        .from(channels)
        .where(eq(channels.id, channelId))
        .limit(1);
      locationId = channel?.locationId ?? null;
    }
    return ensureConversation(tx, orgId, contactId, channelId, locationId);
  });
}

/**
 * Finds or creates the conversation for a contact on the org's channel of the
 * given kind. Used by review requests so they show up in the shared inbox.
 */
export async function ensureConversationForContact(
  orgId: string,
  contactId: string,
  channelKind: "sms" | "email" | "webchat",
): Promise<string> {
  return withOrg(orgId, async (tx) => {
    let [channel] = await tx
      .select({ id: channels.id, locationId: channels.locationId })
      .from(channels)
      .where(and(eq(channels.orgId, orgId), eq(channels.kind, channelKind)))
      .limit(1);

    if (!channel) {
      // Lazily provision a channel so review requests work on workspaces that
      // predate a given channel kind. The provider falls back to its mock when
      // no credentials are configured.
      const [location] = await tx
        .select({ locationId: channels.locationId })
        .from(channels)
        .where(eq(channels.orgId, orgId))
        .limit(1);
      const [created] = await tx
        .insert(channels)
        .values({
          orgId,
          locationId: location?.locationId ?? null,
          kind: channelKind,
          provider: channelKind === "webchat" ? "appolo" : "mock",
          status: "active",
        })
        .returning({ id: channels.id, locationId: channels.locationId });
      channel = created ?? undefined;
    }

    return ensureConversation(tx, orgId, contactId, channel?.id ?? null, channel?.locationId ?? null);
  });
}
/** Channels the org can send on, for the UI. */
export async function listOrgChannels(orgId: string) {
  return withOrg(orgId, (tx) => tx.select().from(channels).where(eq(channels.orgId, orgId)).orderBy(channels.kind));
}

/** All members, for assignment dropdowns. */
export async function listMembers(orgId: string) {
  return withOrg(orgId, (tx) =>
    tx
      .select({ userId: users.id, name: users.name, email: users.email, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, orgId))
      .orderBy(users.name),
  );
}

/** Used by the seed and tests. */
export async function listMessagesForConversation(orgId: string, conversationId: string) {
  return withOrg(orgId, (tx) =>
    tx
      .select({
        id: messages.id,
        direction: messages.direction,
        senderType: messages.senderType,
        body: messages.body,
        status: messages.status,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt),
  );
}

/** Ids are handy for tests that assert consent state. */
export async function latestConsentForContact(orgId: string, contactId: string) {
  return withOrg(orgId, (tx) =>
    tx
      .select({ channel: consentRecords.channel, status: consentRecords.status })
      .from(consentRecords)
      .where(eq(consentRecords.contactId, contactId))
      .orderBy(desc(consentRecords.capturedAt))
      .limit(10),
  );
}

export async function conversationsForContact(orgId: string, contactId: string) {
  return withOrg(orgId, (tx) =>
    tx
      .select({ id: conversations.id, status: conversations.status, channelId: conversations.channelId })
      .from(conversations)
      .where(eq(conversations.contactId, contactId))
      .orderBy(desc(conversations.lastMessageAt)),
  );
}