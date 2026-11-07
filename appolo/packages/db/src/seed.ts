import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, and, sql } from "drizzle-orm";
import { hashPassword, sha256, DEFAULT_REVIEW_TEMPLATES } from "@appolo/core";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
for (const candidate of [path.join(pkgRoot, ".env"), path.join(pkgRoot, "..", "..", ".env")]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

import { getAdminDb, withOrgAdmin } from "./client";
import * as schema from "./schema";
const {
  orgs,
  locations,
  users,
  memberships,
  contacts,
  contactChannels,
  consentRecords,
  channels,
  phoneNumbers,
  conversations,
  messages,
  savedReplies,
  reviewPlatforms,
  reviews,
  reviewRequests,
  reviewTemplates,
  reviewTokens,
  privateFeedback,
} = schema;

const db = getAdminDb();

const SEED_SLUG = "demo";
const email = (process.env.SEED_EMAIL ?? "owner@appolo.test").trim().toLowerCase();
const password = process.env.SEED_PASSWORD ?? "appolo-demo-1234";

async function main(): Promise<void> {
  let rows = await db.select().from(orgs).where(eq(orgs.slug, SEED_SLUG)).limit(1);
  let org = rows[0];
  if (!org) {
    rows = await db
      .insert(orgs)
      .values({ name: "Demo Business", slug: SEED_SLUG, planTier: "growth" })
      .returning();
    org = rows[0]!;
  }
  const orgId = org.id;

  let userRows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!userRows[0]) {
    userRows = await db
      .insert(users)
      .values({ email, name: "Demo Owner", passwordHash: hashPassword(password), emailVerifiedAt: new Date() })
      .returning();
  } else {
    await db.update(users).set({ passwordHash: hashPassword(password) }).where(eq(users.id, userRows[0].id));
  }
  const userId = userRows[0]!.id;

  const existingMembership = await db
    .select()
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .limit(1);
  if (!existingMembership[0]) {
    await db.insert(memberships).values({ orgId, userId, role: "owner", status: "active" });
  }

  let locRows = await db.select().from(locations).where(eq(locations.orgId, orgId)).limit(1);
  let location = locRows[0];
  if (!location) {
    locRows = await db
      .insert(locations)
      .values({
        orgId,
        name: "Main Street",
        address: "120 Main St, Springfield",
        phone: "+15555550100",
        timezone: "America/Denver",
        hours: { mon_fri: "09:00-18:00", sat: "10:00-16:00" },
      })
      .returning();
    location = locRows[0]!;
  }
  const locationId = location.id;

  const existingContacts = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(eq(contacts.orgId, orgId));
  if ((existingContacts[0]?.n ?? 0) > 0) {
    console.log(`seed: org "${SEED_SLUG}" already has data; credentials refreshed only`);
  } else {
    await withOrgAdmin(orgId, async (tx) => {
      const people = [
        { name: "Ava Thompson", company: "Thompson Dental" },
        { name: "Marcus Lee", company: null },
        { name: "Priya Patel", company: "Patel & Co." },
        { name: "Jon Rivera", company: null },
        { name: "Hannah Cole", company: "Cole Fitness" },
        { name: "Sam Okafor", company: null },
      ];
      const inserted = await tx
        .insert(contacts)
        .values(people.map((p) => ({ orgId, name: p.name, company: p.company, source: "seed" })))
        .returning({ id: contacts.id });

      const google = (
        await tx
          .insert(reviewPlatforms)
          .values({ orgId, kind: "google", displayName: "Google", externalRef: "accounts/demo/locations/demo" })
          .returning()
      )[0]!;
      const facebook = (
        await tx
          .insert(reviewPlatforms)
          .values({ orgId, kind: "facebook", displayName: "Facebook", externalRef: "page/demo" })
          .returning()
      )[0]!;

      const now = Date.now();
      const day = 86_400_000;
      await tx.insert(reviews).values([
        {
          orgId,
          locationId,
          platformId: google.id,
          externalId: "seed-g-1",
          authorName: "Ava T.",
          rating: 5,
          body: "Fast, friendly, and they explained everything. Highly recommend.",
          reviewedAt: new Date(now - 2 * day),
          replyStatus: "posted",
        },
        {
          orgId,
          locationId,
          platformId: google.id,
          externalId: "seed-g-2",
          authorName: "Marcus L.",
          rating: 4,
          body: "Great service, small wait at check-in.",
          reviewedAt: new Date(now - 6 * day),
          replyStatus: "draft",
        },
        {
          orgId,
          locationId,
          platformId: google.id,
          externalId: "seed-g-3",
          authorName: "Priya P.",
          rating: 5,
          body: "Second time here and still excellent.",
          reviewedAt: new Date(now - 11 * day),
          replyStatus: "posted",
        },
        {
          orgId,
          locationId,
          platformId: facebook.id,
          externalId: "seed-f-1",
          authorName: "Hannah C.",
          rating: 3,
          body: "Good work but the quote changed mid-job.",
          reviewedAt: new Date(now - 14 * day),
          replyStatus: "draft",
        },
        {
          orgId,
          locationId,
          platformId: google.id,
          externalId: "seed-g-4",
          authorName: "Sam O.",
          rating: 5,
          body: "Handled my emergency same day.",
          reviewedAt: new Date(now - 20 * day),
          replyStatus: "posted",
        },
      ]);

      await tx.insert(reviewRequests).values([
        {
          orgId,
          contactId: inserted[0]!.id,
          locationId,
          channel: "sms",
          status: "reviewed",
          sentAt: new Date(now - 3 * day),
          clickedAt: new Date(now - 2 * day),
          reviewedAt: new Date(now - 2 * day),
          platformKind: "google",
        },
        {
          orgId,
          contactId: inserted[1]!.id,
          locationId,
          channel: "sms",
          status: "clicked",
          sentAt: new Date(now - 2 * day),
          clickedAt: new Date(now - day),
        },
        {
          orgId,
          contactId: inserted[2]!.id,
          locationId,
          channel: "sms",
          status: "sent",
          sentAt: new Date(now - day),
        },
      ]);
    });
  }

  // --- Phase 1 fixtures: channels, consent, inbox -------------------
  // Idempotent: each item is created only if missing, so seed can rerun.
  await withOrgAdmin(orgId, async (tx) => {
    let smsChannel = (
      await tx
        .select()
        .from(channels)
        .where(and(eq(channels.orgId, orgId), eq(channels.kind, "sms")))
        .limit(1)
    )[0];
    if (!smsChannel) {
      smsChannel = (
        await tx
          .insert(channels)
          .values({
            orgId,
            locationId,
            kind: "sms",
            provider: "mock",
            providerRef: "+15555550100",
            status: "active",
          })
          .returning()
      )[0]!;
    }

    let webchatChannel = (
      await tx
        .select()
        .from(channels)
        .where(and(eq(channels.orgId, orgId), eq(channels.kind, "webchat")))
        .limit(1)
    )[0];
    if (!webchatChannel) {
      webchatChannel = (
        await tx
          .insert(channels)
          .values({
            orgId,
            locationId,
            kind: "webchat",
            provider: "appolo",
            providerRef: "demo-webchat",
            status: "active",
          })
          .returning()
      )[0]!;
    }

    let emailChannel = (
      await tx
        .select()
        .from(channels)
        .where(and(eq(channels.orgId, orgId), eq(channels.kind, "email")))
        .limit(1)
    )[0];
    if (!emailChannel) {
      emailChannel = (
        await tx
          .insert(channels)
          .values({
            orgId,
            locationId,
            kind: "email",
            provider: "mock",
            providerRef: process.env.EMAIL_FROM ?? null,
            status: "active",
          })
          .returning()
      )[0]!;
    }

    const existingNumber = await tx
      .select({ id: phoneNumbers.id })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.e164, "+15555550100"))
      .limit(1);
    if (!existingNumber[0]) {
      await tx.insert(phoneNumbers).values({
        orgId,
        e164: "+15555550100",
        providerSid: "PN_demo",
        capabilities: { sms: true, voice: false },
        a2pStatus: "registered",
        country: "US",
      });
    }

    const primaryContact = (
      await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.orgId, orgId), eq(contacts.name, "Ava Thompson")))
        .limit(1)
    )[0];

    if (primaryContact) {
      const existing = await tx
        .select({ kind: contactChannels.kind })
        .from(contactChannels)
        .where(eq(contactChannels.contactId, primaryContact.id));
      const kinds = new Set(existing.map((c) => c.kind));
      if (!kinds.has("phone")) {
        await tx.insert(contactChannels).values({
          orgId,
          contactId: primaryContact.id,
          kind: "phone",
          value: "+15555550111",
          normalizedValue: "+15555550111",
          isPrimary: true,
        });
      }
      if (!kinds.has("email")) {
        await tx.insert(contactChannels).values({
          orgId,
          contactId: primaryContact.id,
          kind: "email",
          value: "ava@thompsondental.test",
          normalizedValue: "ava@thompsondental.test",
        });
      }

      const granted = await tx
        .select({ id: consentRecords.id })
        .from(consentRecords)
        .where(and(eq(consentRecords.contactId, primaryContact.id), eq(consentRecords.channel, "sms")))
        .limit(1);
      if (!granted[0]) {
        await tx.insert(consentRecords).values({
          orgId,
          contactId: primaryContact.id,
          channel: "sms",
          status: "granted",
          source: "seed",
          evidence: { note: "seeded consent" },
        });
      }

      const existingConversation = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.contactId, primaryContact.id))
        .limit(1);
      if (!existingConversation[0]) {
        const conversation = (
          await tx
            .insert(conversations)
            .values({
              orgId,
              contactId: primaryContact.id,
              channelId: smsChannel.id,
              locationId,
              status: "open",
              unreadCount: 1,
              lastMessageAt: new Date(),
            })
            .returning()
        )[0]!;
        const now = Date.now();
        await tx.insert(messages).values([
          {
            orgId,
            conversationId: conversation.id,
            direction: "inbound",
            senderType: "contact",
            body: "Hi! Do you have any openings this week?",
            status: "received",
            sentAt: new Date(now - 3_600_000),
          },
          {
            orgId,
            conversationId: conversation.id,
            direction: "outbound",
            senderType: "user",
            senderId: userId,
            body: "Hi Ava! We have Thursday at 2pm open — want me to hold it for you?",
            status: "delivered",
            sentAt: new Date(now - 3_500_000),
          },
        ]);
      }
    }

    const existingReply = await tx
      .select({ id: savedReplies.id })
      .from(savedReplies)
      .where(eq(savedReplies.orgId, orgId))
      .limit(1);
    if (!existingReply[0]) {
      await tx.insert(savedReplies).values([
        {
          orgId,
          scope: "org",
          title: "Greeting",
          body: "Hi {{first_name}}! Thanks for reaching out to us. How can we help?",
        },
        {
          orgId,
          scope: "org",
          title: "Hours",
          body: "We're open Mon–Fri 9–6 and Sat 10–4. What time works best for you, {{first_name}}?",
        },
        {
          orgId,
          scope: "org",
          title: "Review ask",
          body: "Glad we could help! If you have a moment, a quick review would mean a lot to our team.",
        },
      ]);
    }

    void webchatChannel;
    void emailChannel;
  });

  // --- Phase 2 fixtures: review templates, public links, settings ---
  // Idempotent: safe to rerun against an already-seeded database.
  await withOrgAdmin(orgId, async (tx) => {
    const day = 86_400_000;

    const templateCount = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(reviewTemplates)
      .where(eq(reviewTemplates.orgId, orgId));
    if ((templateCount[0]?.n ?? 0) === 0) {
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
    }

    // Demo platforms point at public review URLs so the landing page has real
    // outbound links. Live Google sync still needs a real token + resource name.
    const platformRows = await tx.select().from(reviewPlatforms).where(eq(reviewPlatforms.orgId, orgId));
    const demoPlatforms: { kind: "google" | "facebook"; displayName: string; url: string }[] = [
      { kind: "google", displayName: "Google", url: "https://search.google.com/local/writereview?placeid=appolo-demo" },
      { kind: "facebook", displayName: "Facebook", url: "https://www.facebook.com/appolo-demo/reviews" },
    ];
    for (const demo of demoPlatforms) {
      const existing = platformRows.find((row) => row.kind === demo.kind);
      if (!existing) {
        await tx.insert(reviewPlatforms).values({
          orgId,
          kind: demo.kind,
          displayName: demo.displayName,
          externalRef: demo.url,
        });
      } else if (!/^https?:\/\//i.test(existing.externalRef ?? "")) {
        await tx
          .update(reviewPlatforms)
          .set({ externalRef: demo.url })
          .where(eq(reviewPlatforms.id, existing.id));
      }
    }

    // A stable demo token so the public landing page is easy to open.
    const demoToken = "demo-review-token-0001";
    const existingToken = await tx
      .select({ id: reviewTokens.id })
      .from(reviewTokens)
      .where(eq(reviewTokens.tokenHash, sha256(demoToken)))
      .limit(1);
    if (!existingToken[0]) {
      const demoContact = (
        await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.orgId, orgId), eq(contacts.name, "Ava Thompson")))
          .limit(1)
      )[0];
      if (demoContact) {
        const request = (
          await tx
            .insert(reviewRequests)
            .values({
              orgId,
              contactId: demoContact.id,
              locationId,
              channel: "sms",
              status: "sent",
              sentAt: new Date(Date.now() - day),
              platformKind: "google",
            })
            .returning({ id: reviewRequests.id })
        )[0]!;
        await tx.insert(reviewTokens).values({
          orgId,
          tokenHash: sha256(demoToken),
          requestId: request.id,
          expiresAt: new Date(Date.now() + 30 * day),
        });
      }
    }

    // Seed one piece of private feedback for the dashboard (not tied to the
    // demo landing token, so that form stays usable).
    const feedbackCount = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(privateFeedback)
      .where(eq(privateFeedback.orgId, orgId));
    if ((feedbackCount[0]?.n ?? 0) === 0) {
      const marcus = (
        await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.orgId, orgId), eq(contacts.name, "Marcus Lee")))
          .limit(1)
      )[0];
      await tx.insert(privateFeedback).values({
        orgId,
        contactId: marcus?.id ?? null,
        rating: 3,
        body: "Service was good but the quote changed at pickup. Would appreciate a heads-up next time.",
        status: "new",
      });
    }

    // Default review-request policy, only if the org has not set one yet.
    const [orgSettingsRow] = await tx
      .select({ settings: orgs.settings })
      .from(orgs)
      .where(eq(orgs.id, orgId))
      .limit(1);
    const settings = { ...((orgSettingsRow?.settings ?? {}) as Record<string, unknown>) };
    if (!settings.reviewRequests) {
      settings.reviewRequests = {
        quietHours: { enabled: true, start: "21:00", end: "08:00" },
        dailyCap: 200,
        timezone: "America/Denver",
        cooldownDays: 90,
        defaultPlatformKind: "google",
        followUp: {
          enabled: true,
          days: 3,
          max: 1,
          body: "Hi {{first_name}}, just a gentle reminder — if you have a moment, a quick review for {{business_name}} would really help us out: {{review_link}}",
        },
      };
      await tx.update(orgs).set({ settings }).where(eq(orgs.id, orgId));
    }
  });

  console.log("");
  console.log("  seed complete");
  console.log("  ----------------------------------------");
  console.log(`  email    : ${email}`);
  console.log(`  password : ${password}`);
  console.log(`  org      : ${org.name} (${SEED_SLUG})`);
  console.log("");
}

main()
  .then(async () => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("seed failed:", err);
    process.exit(1);
  });