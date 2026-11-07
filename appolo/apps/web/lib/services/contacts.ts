import { randomUUID } from "node:crypto";
import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import {
  normalizeEmail,
  normalizePhone,
  type ContactChannelKind,
  type ContactCreateInput,
  type ContactUpdateInput,
} from "@appolo/core";
import { withOrg, schema, type Tx } from "@/lib/db";
import { parseCsv, splitTags, toCsv } from "@/lib/csv";
import { DomainError } from "./errors";

const {
  contacts,
  contactChannels,
  tags,
  contactTags,
  contactEvents,
  conversations,
  channels,
  users,
} = schema;

export interface NormalizedChannel {
  kind: ContactChannelKind;
  value: string;
  normalizedValue: string;
  isPrimary: boolean;
}

export function normalizeChannel(kind: ContactChannelKind, value: string): NormalizedChannel {
  const trimmed = value.trim();
  if (kind === "phone") {
    return { kind, value: trimmed, normalizedValue: normalizePhone(trimmed), isPrimary: false };
  }
  if (kind === "email") {
    return { kind, value: trimmed, normalizedValue: normalizeEmail(trimmed), isPrimary: false };
  }
  return { kind, value: trimmed, normalizedValue: trimmed.toLowerCase(), isPrimary: false };
}

async function ensureTagId(tx: Tx, orgId: string, name: string): Promise<string> {
  const existing = await tx
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.orgId, orgId), eq(tags.name, name)))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const [created] = await tx
    .insert(tags)
    .values({ orgId, name })
    .returning({ id: tags.id });
  return created!.id;
}

async function replaceTags(tx: Tx, orgId: string, contactId: string, names: string[]): Promise<void> {
  await tx.delete(contactTags).where(eq(contactTags.contactId, contactId));
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, 20);
  for (const name of unique) {
    const tagId = await ensureTagId(tx, orgId, name);
    await tx.insert(contactTags).values({ orgId, contactId, tagId }).onConflictDoNothing();
  }
}

export async function createContact(orgId: string, input: ContactCreateInput) {
  return withOrg(orgId, async (tx) => {
    const [contact] = await tx
      .insert(contacts)
      .values({
        orgId,
        name: input.name ?? null,
        company: input.company ?? null,
        notes: input.notes ?? null,
        source: input.source ?? "manual",
      })
      .returning();
    if (!contact) throw new DomainError("CONTACT_CREATE_FAILED", "Could not create the contact.", 500);

    const seen = new Set<string>();
    for (const [index, channel] of input.channels.entries()) {
      const normalized = normalizeChannel(channel.kind, channel.value);
      const key = `${normalized.kind}:${normalized.normalizedValue}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await tx.insert(contactChannels).values({
        orgId,
        contactId: contact.id,
        kind: normalized.kind,
        value: normalized.value,
        normalizedValue: normalized.normalizedValue,
        isPrimary: channel.isPrimary ?? index === 0,
      });
    }

    if (input.tags.length > 0) await replaceTags(tx, orgId, contact.id, input.tags);

    await tx.insert(contactEvents).values({
      orgId,
      contactId: contact.id,
      kind: "contact.created",
      payload: { source: contact.source },
    });

    return contact;
  });
}

export interface ContactListRow {
  id: string;
  name: string | null;
  company: string | null;
  createdAt: Date;
  channels: { kind: string; value: string; isPrimary: boolean }[];
  tags: string[];
}

export async function listContacts(
  orgId: string,
  options: { query?: string; limit?: number } = {},
): Promise<ContactListRow[]> {
  const limit = Math.min(options.limit ?? 50, 100);
  const search = options.query?.trim();

  return withOrg(orgId, async (tx) => {
    let channelMatches: string[] = [];
    if (search) {
      const matches = await tx
        .select({ contactId: contactChannels.contactId })
        .from(contactChannels)
        .where(
          or(
            ilike(contactChannels.value, `%${search}%`),
            ilike(contactChannels.normalizedValue, `%${search}%`),
          ),
        )
        .limit(200);
      channelMatches = [...new Set(matches.map((m) => m.contactId))];
    }

    const conditions = [];
    if (search) {
      conditions.push(ilike(contacts.name, `%${search}%`));
      conditions.push(ilike(contacts.company, `%${search}%`));
      if (channelMatches.length > 0) conditions.push(inArray(contacts.id, channelMatches));
    }

    const rows = await tx
      .select({
        id: contacts.id,
        name: contacts.name,
        company: contacts.company,
        createdAt: contacts.createdAt,
      })
      .from(contacts)
      .where(conditions.length > 0 ? or(...conditions) : undefined)
      .orderBy(desc(contacts.createdAt))
      .limit(limit);

    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return [];

    const channelRows = await tx
      .select({
        contactId: contactChannels.contactId,
        kind: contactChannels.kind,
        value: contactChannels.value,
        isPrimary: contactChannels.isPrimary,
      })
      .from(contactChannels)
      .where(inArray(contactChannels.contactId, ids));

    const tagRows = await tx
      .select({ contactId: contactTags.contactId, name: tags.name })
      .from(contactTags)
      .innerJoin(tags, eq(tags.id, contactTags.tagId))
      .where(inArray(contactTags.contactId, ids));

    return rows.map((row) => ({
      ...row,
      channels: channelRows.filter((c) => c.contactId === row.id),
      tags: tagRows.filter((t) => t.contactId === row.id).map((t) => t.name),
    }));
  });
}

export async function getContact(orgId: string, contactId: string) {
  return withOrg(orgId, async (tx) => {
    const [contact] = await tx.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
    if (!contact) return null;

    const [channelRows, tagRows, eventRows, conversationRows] = await Promise.all([
      tx
        .select()
        .from(contactChannels)
        .where(eq(contactChannels.contactId, contactId))
        .orderBy(desc(contactChannels.isPrimary)),
      tx
        .select({ name: tags.name })
        .from(contactTags)
        .innerJoin(tags, eq(tags.id, contactTags.tagId))
        .where(eq(contactTags.contactId, contactId)),
      tx
        .select()
        .from(contactEvents)
        .where(eq(contactEvents.contactId, contactId))
        .orderBy(desc(contactEvents.createdAt))
        .limit(30),
      tx
        .select({
          id: conversations.id,
          status: conversations.status,
          lastMessageAt: conversations.lastMessageAt,
          unreadCount: conversations.unreadCount,
          channelKind: channels.kind,
          assigneeName: users.name,
        })
        .from(conversations)
        .leftJoin(channels, eq(channels.id, conversations.channelId))
        .leftJoin(users, eq(users.id, conversations.assigneeId))
        .where(eq(conversations.contactId, contactId))
        .orderBy(desc(conversations.lastMessageAt)),
    ]);

    return {
      contact,
      channels: channelRows,
      tags: tagRows.map((t) => t.name),
      events: eventRows,
      conversations: conversationRows,
    };
  });
}

export async function updateContact(orgId: string, contactId: string, input: ContactUpdateInput) {
  return withOrg(orgId, async (tx) => {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.company !== undefined) patch.company = input.company;
    if (input.notes !== undefined) patch.notes = input.notes;

    if (Object.keys(patch).length > 1) {
      await tx.update(contacts).set(patch).where(eq(contacts.id, contactId));
    } else {
      await tx.update(contacts).set({ updatedAt: new Date() }).where(eq(contacts.id, contactId));
    }

    if (input.tags) await replaceTags(tx, orgId, contactId, input.tags);

    const [updated] = await tx.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
    if (!updated) throw new DomainError("CONTACT_NOT_FOUND", "Contact not found.", 404);
    return updated;
  });
}

export interface ImportStats {
  created: number;
  skipped: number;
  errors: string[];
}

/** Expected headers: name, phone, email, company, tags (any order, case-insensitive). */
export async function importContactsCsv(orgId: string, text: string): Promise<ImportStats> {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new DomainError("CSV_EMPTY", "The CSV file is empty.");

  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const indexOf = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const nameIdx = indexOf("name", "full name", "contact");
  const phoneIdx = indexOf("phone", "mobile", "phone number");
  const emailIdx = indexOf("email", "e-mail");
  const companyIdx = indexOf("company", "business");
  const tagsIdx = indexOf("tags", "tag");

  if (nameIdx === -1 && phoneIdx === -1 && emailIdx === -1) {
    throw new DomainError(
      "CSV_HEADERS",
      "CSV needs at least one of: name, phone, email columns.",
    );
  }

  const stats: ImportStats = { created: 0, skipped: 0, errors: [] };

  await withOrg(orgId, async (tx) => {
    const seen = new Set<string>();
    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i]!;
      const cell = (idx: number) => (idx >= 0 ? (row[idx] ?? "").trim() : "");
      const name = cell(nameIdx);
      const phone = cell(phoneIdx);
      const email = cell(emailIdx);
      const company = cell(companyIdx);
      const tagNames = splitTags(cell(tagsIdx));

      if (!name && !phone && !email) {
        stats.skipped += 1;
        continue;
      }

      const channelInputs: { kind: ContactChannelKind; value: string }[] = [];
      if (phone) channelInputs.push({ kind: "phone", value: phone });
      if (email) channelInputs.push({ kind: "email", value: email });

      const keys = channelInputs.map((c) => {
        const n = normalizeChannel(c.kind, c.value);
        return `${n.kind}:${n.normalizedValue}`;
      });

      if (keys.some((k) => seen.has(k))) {
        stats.skipped += 1;
        continue;
      }

      let duplicate = false;
      for (const channel of channelInputs) {
        const normalized = normalizeChannel(channel.kind, channel.value);
        const existing = await tx
          .select({ id: contactChannels.id })
          .from(contactChannels)
          .where(
            and(
              eq(contactChannels.orgId, orgId),
              eq(contactChannels.kind, channel.kind),
              eq(contactChannels.normalizedValue, normalized.normalizedValue),
            ),
          )
          .limit(1);
        if (existing[0]) {
          duplicate = true;
          break;
        }
      }
      if (duplicate) {
        stats.skipped += 1;
        continue;
      }

      const [contact] = await tx
        .insert(contacts)
        .values({
          orgId,
          name: name || null,
          company: company || null,
          source: "csv_import",
        })
        .returning();
      if (!contact) {
        stats.errors.push(`Row ${i + 1}: insert failed`);
        continue;
      }

      for (const [index, channel] of channelInputs.entries()) {
        const normalized = normalizeChannel(channel.kind, channel.value);
        await tx.insert(contactChannels).values({
          orgId,
          contactId: contact.id,
          kind: normalized.kind,
          value: normalized.value,
          normalizedValue: normalized.normalizedValue,
          isPrimary: index === 0,
        });
      }
      if (tagNames.length > 0) await replaceTags(tx, orgId, contact.id, tagNames);
      await tx.insert(contactEvents).values({
        orgId,
        contactId: contact.id,
        kind: "contact.imported",
        payload: { row: i + 1 },
      });

      for (const key of keys) seen.add(key);
      stats.created += 1;
    }
  });

  return stats;
}

export async function exportContactsCsv(orgId: string): Promise<string> {
  const data = await withOrg(orgId, async (tx) => {
    const contactRows = await tx
      .select({ id: contacts.id, name: contacts.name, company: contacts.company })
      .from(contacts)
      .orderBy(desc(contacts.createdAt));
    const ids = contactRows.map((row) => row.id);
    if (ids.length === 0) return [] as (string | null | undefined)[][];

    const channelRows = await tx
      .select({
        contactId: contactChannels.contactId,
        kind: contactChannels.kind,
        value: contactChannels.value,
      })
      .from(contactChannels)
      .where(inArray(contactChannels.contactId, ids));

    const tagRows = await tx
      .select({ contactId: contactTags.contactId, name: tags.name })
      .from(contactTags)
      .innerJoin(tags, eq(tags.id, contactTags.tagId))
      .where(inArray(contactTags.contactId, ids));

    return contactRows.map((row) => {
      const channelsFor = channelRows.filter((c) => c.contactId === row.id);
      const phone = channelsFor.find((c) => c.kind === "phone")?.value ?? "";
      const email = channelsFor.find((c) => c.kind === "email")?.value ?? "";
      const names = tagRows.filter((t) => t.contactId === row.id).map((t) => t.name);
      return [row.name ?? "", phone, email, row.company ?? "", names.join(";")];
    });
  });

  return toCsv(["name", "phone", "email", "company", "tags"], data);
}

/** Used by tests and the seed to attach a channel without duplicating one. */
export async function addChannel(
  orgId: string,
  contactId: string,
  kind: ContactChannelKind,
  value: string,
) {
  const normalized = normalizeChannel(kind, value);
  return withOrg(orgId, async (tx) => {
    const existing = await tx
      .select({ id: contactChannels.id })
      .from(contactChannels)
      .where(
        and(
          eq(contactChannels.orgId, orgId),
          eq(contactChannels.kind, kind),
          eq(contactChannels.normalizedValue, normalized.normalizedValue),
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0].id;
    const [created] = await tx
      .insert(contactChannels)
      .values({
        orgId,
        contactId,
        kind,
        value: normalized.value,
        normalizedValue: normalized.normalizedValue,
      })
      .returning({ id: contactChannels.id });
    return created!.id;
  });
}

export function newVisitorChannelValue() {
  return `webchat:${randomUUID()}`;
}