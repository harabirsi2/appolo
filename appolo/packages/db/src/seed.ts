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
  reviewWidgets,
  automations,
  automationSteps,
  campaigns,
  campaignRecipients,
  tags,
  contactTags,
  aiAgents,
  aiKnowledgeDocs,
  aiKnowledgeChunks,
  catalogItems,
  itemRatings,
} = schema;

const db = getAdminDb();

const SEED_SLUG = "demo";
const email = (process.env.SEED_EMAIL ?? "owner@appolo.test").trim().toLowerCase();
const password = process.env.SEED_PASSWORD ?? "appolo-demo-1234";

type CatalogSeed = {
  kind: "movie" | "tv" | "music" | "podcast" | "book";
  title: string;
  subtitle: string;
  year: number;
  tags: string[];
  /** Demo taste profile: pre-rated items for the seeded org. */
  elo?: number;
  matches?: number;
  wins?: number;
  losses?: number;
};

/**
 * A small, curated demo catalog. Metadata here is factual (title, creator,
 * year) so the app works offline; real provider adapters can replace this
 * later behind env keys. No provider content is copied.
 */
const MEDIA_CATALOG: CatalogSeed[] = [
  // movies
  { kind: "movie", title: "The Godfather", subtitle: "Francis Ford Coppola", year: 1972, tags: ["crime", "drama"], elo: 1700, matches: 14, wins: 11, losses: 3 },
  { kind: "movie", title: "Parasite", subtitle: "Bong Joon-ho", year: 2019, tags: ["thriller", "drama"] },
  { kind: "movie", title: "Spirited Away", subtitle: "Hayao Miyazaki", year: 2001, tags: ["animation", "fantasy"], elo: 1740, matches: 12, wins: 10, losses: 2 },
  { kind: "movie", title: "The Dark Knight", subtitle: "Christopher Nolan", year: 2008, tags: ["superhero", "action"] },
  { kind: "movie", title: "Everything Everywhere All at Once", subtitle: "Daniels", year: 2022, tags: ["sci-fi", "comedy"] },
  { kind: "movie", title: "Pulp Fiction", subtitle: "Quentin Tarantino", year: 1994, tags: ["crime", "drama"] },
  { kind: "movie", title: "In the Mood for Love", subtitle: "Wong Kar-wai", year: 2000, tags: ["romance", "drama"] },
  { kind: "movie", title: "Mad Max: Fury Road", subtitle: "George Miller", year: 2015, tags: ["action", "sci-fi"] },
  { kind: "movie", title: "Get Out", subtitle: "Jordan Peele", year: 2017, tags: ["horror", "thriller"] },
  { kind: "movie", title: "The Grand Budapest Hotel", subtitle: "Wes Anderson", year: 2014, tags: ["comedy", "drama"] },
  { kind: "movie", title: "Interstellar", subtitle: "Christopher Nolan", year: 2014, tags: ["sci-fi", "drama"] },
  { kind: "movie", title: "Whiplash", subtitle: "Damien Chazelle", year: 2014, tags: ["drama", "music"] },
  // tv
  { kind: "tv", title: "The Sopranos", subtitle: "David Chase", year: 1999, tags: ["crime", "drama"] },
  { kind: "tv", title: "Breaking Bad", subtitle: "Vince Gilligan", year: 2008, tags: ["crime", "drama"], elo: 1770, matches: 15, wins: 13, losses: 2 },
  { kind: "tv", title: "The Wire", subtitle: "David Simon", year: 2002, tags: ["crime", "drama"] },
  { kind: "tv", title: "Fleabag", subtitle: "Phoebe Waller-Bridge", year: 2016, tags: ["comedy", "drama"], elo: 1680, matches: 9, wins: 7, losses: 2 },
  { kind: "tv", title: "Succession", subtitle: "Jesse Armstrong", year: 2018, tags: ["drama", "comedy"] },
  { kind: "tv", title: "The Bear", subtitle: "Christopher Storer", year: 2022, tags: ["drama", "comedy"], elo: 1690, matches: 10, wins: 8, losses: 2 },
  { kind: "tv", title: "Twin Peaks", subtitle: "David Lynch", year: 1990, tags: ["mystery", "drama"] },
  { kind: "tv", title: "Arcane", subtitle: "Christian Linke", year: 2021, tags: ["animation", "action"] },
  { kind: "tv", title: "Better Call Saul", subtitle: "Vince Gilligan", year: 2015, tags: ["crime", "drama"] },
  { kind: "tv", title: "Severance", subtitle: "Dan Erickson", year: 2022, tags: ["sci-fi", "thriller"], elo: 1670, matches: 8, wins: 6, losses: 2 },
  // music
  { kind: "music", title: "Blonde", subtitle: "Frank Ocean", year: 2016, tags: ["r&b", "alternative"], elo: 1650, matches: 11, wins: 8, losses: 3 },
  { kind: "music", title: "Kid A", subtitle: "Radiohead", year: 2000, tags: ["alternative", "electronic"], elo: 1660, matches: 10, wins: 8, losses: 2 },
  { kind: "music", title: "To Pimp a Butterfly", subtitle: "Kendrick Lamar", year: 2015, tags: ["hip-hop", "jazz"], elo: 1720, matches: 12, wins: 10, losses: 2 },
  { kind: "music", title: "Rumours", subtitle: "Fleetwood Mac", year: 1977, tags: ["rock", "classic"] },
  { kind: "music", title: "Blue", subtitle: "Joni Mitchell", year: 1971, tags: ["folk", "singer-songwriter"] },
  { kind: "music", title: "The Dark Side of the Moon", subtitle: "Pink Floyd", year: 1973, tags: ["rock", "progressive"] },
  { kind: "music", title: "In Rainbows", subtitle: "Radiohead", year: 2007, tags: ["alternative", "rock"] },
  { kind: "music", title: "Vespertine", subtitle: "Björk", year: 2001, tags: ["electronic", "art pop"] },
  { kind: "music", title: "The Miseducation of Lauryn Hill", subtitle: "Lauryn Hill", year: 1998, tags: ["hip-hop", "r&b"] },
  { kind: "music", title: "Sound of Silver", subtitle: "LCD Soundsystem", year: 2007, tags: ["electronic", "dance"] },
  // podcasts
  { kind: "podcast", title: "Serial", subtitle: "Sarah Koenig", year: 2014, tags: ["true crime", "investigative"], elo: 1640, matches: 7, wins: 5, losses: 2 },
  { kind: "podcast", title: "Radiolab", subtitle: "Jad Abumrad", year: 2002, tags: ["science", "storytelling"] },
  { kind: "podcast", title: "The Daily", subtitle: "The New York Times", year: 2017, tags: ["news", "daily"], elo: 1600, matches: 6, wins: 4, losses: 2 },
  { kind: "podcast", title: "99% Invisible", subtitle: "Roman Mars", year: 2010, tags: ["design", "culture"] },
  { kind: "podcast", title: "Hardcore History", subtitle: "Dan Carlin", year: 2006, tags: ["history", "long-form"] },
  { kind: "podcast", title: "My Favorite Murder", subtitle: "Karen Kilgariff", year: 2016, tags: ["true crime", "comedy"] },
  { kind: "podcast", title: "Reply All", subtitle: "PJ Vogt", year: 2014, tags: ["technology", "internet"] },
  { kind: "podcast", title: "The Ezra Klein Show", subtitle: "Ezra Klein", year: 2016, tags: ["politics", "interviews"] },
  // books
  { kind: "book", title: "Beloved", subtitle: "Toni Morrison", year: 1987, tags: ["literary", "historical"], elo: 1680, matches: 8, wins: 6, losses: 2 },
  { kind: "book", title: "One Hundred Years of Solitude", subtitle: "Gabriel García Márquez", year: 1967, tags: ["magical realism", "literary"] },
  { kind: "book", title: "The Left Hand of Darkness", subtitle: "Ursula K. Le Guin", year: 1969, tags: ["sci-fi", "literary"] },
  { kind: "book", title: "Dune", subtitle: "Frank Herbert", year: 1965, tags: ["sci-fi", "epic"], elo: 1620, matches: 7, wins: 5, losses: 2 },
  { kind: "book", title: "Normal People", subtitle: "Sally Rooney", year: 2018, tags: ["romance", "contemporary"] },
  { kind: "book", title: "The Secret History", subtitle: "Donna Tartt", year: 1992, tags: ["mystery", "literary"] },
  { kind: "book", title: "Piranesi", subtitle: "Susanna Clarke", year: 2020, tags: ["fantasy", "mystery"], elo: 1700, matches: 9, wins: 7, losses: 2 },
  { kind: "book", title: "East of Eden", subtitle: "John Steinbeck", year: 1952, tags: ["classic", "literary"] },
  { kind: "book", title: "The Remains of the Day", subtitle: "Kazuo Ishiguro", year: 1989, tags: ["literary", "historical"] },
  { kind: "book", title: "Project Hail Mary", subtitle: "Andy Weir", year: 2021, tags: ["sci-fi", "adventure"] },
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Seed the shared catalog and, on first run, a demo org's taste profile. */
async function seedMedia(orgId: string): Promise<void> {
  await db
    .insert(catalogItems)
    .values(
      MEDIA_CATALOG.map((item) => ({
        kind: item.kind,
        title: item.title,
        subtitle: item.subtitle,
        year: item.year,
        externalRef: `demo:${item.kind}:${slugify(item.title)}`,
        tags: item.tags,
      })),
    )
    .onConflictDoNothing();

  const rows = await db
    .select({ id: catalogItems.id, kind: catalogItems.kind, title: catalogItems.title })
    .from(catalogItems);
  const idByKey = new Map(rows.map((row) => [`${row.kind}:${row.title}`, row.id]));

  await withOrgAdmin(orgId, async (tx) => {
    for (const item of MEDIA_CATALOG) {
      if (item.elo === undefined) continue;
      const itemId = idByKey.get(`${item.kind}:${item.title}`);
      if (!itemId) continue;
      await tx
        .insert(itemRatings)
        .values({
          orgId,
          itemId,
          elo: item.elo,
          matches: item.matches ?? 0,
          wins: item.wins ?? 0,
          losses: item.losses ?? 0,
        })
        .onConflictDoNothing();
    }
  });
}

async function main(): Promise<void> {
  let rows = await db.select().from(orgs).where(eq(orgs.slug, SEED_SLUG)).limit(1);
  let org = rows[0];
  if (!org) {
    rows = await db
      .insert(orgs)
      .values({ name: "Demo Profile", slug: SEED_SLUG, planTier: "growth" })
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

  // --- Phase 3 fixtures: widget, keyword automation, draft campaign ---
  // Idempotent: each item is created only if its table is empty for the org.
  await withOrgAdmin(orgId, async (tx) => {
    const widgetCount = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(reviewWidgets)
      .where(eq(reviewWidgets.orgId, orgId));
    if ((widgetCount[0]?.n ?? 0) === 0) {
      await tx.insert(reviewWidgets).values({
        orgId,
        publicKey: "rw_demo000000000000000000",
        config: {
          headline: "What our customers say",
          theme: "dark",
          layout: "list",
          minRating: 4,
          limit: 6,
          showRating: true,
        },
      });
    }

    // A demo tag so tag-segment campaigns have something to target.
    const primaryContact = (
      await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.orgId, orgId), eq(contacts.name, "Ava Thompson")))
        .limit(1)
    )[0];
    if (primaryContact) {
      let vipTag = (
        await tx
          .select({ id: tags.id })
          .from(tags)
          .where(and(eq(tags.orgId, orgId), eq(tags.name, "vip")))
          .limit(1)
      )[0];
      if (!vipTag) {
        vipTag = (await tx.insert(tags).values({ orgId, name: "vip", color: "#f59e0b" }).returning({ id: tags.id }))[0]!;
      }
      await tx
        .insert(contactTags)
        .values({ orgId, contactId: primaryContact.id, tagId: vipTag.id })
        .onConflictDoNothing();
    }

    const automationCount = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(automations)
      .where(eq(automations.orgId, orgId));
    if ((automationCount[0]?.n ?? 0) === 0) {
      const [automation] = await tx
        .insert(automations)
        .values({
          orgId,
          name: "Hours question",
          trigger: "keyword",
          conditions: { keywords: ["hours", "open", "closing"], matchType: "contains", channels: [] },
          enabled: true,
        })
        .returning({ id: automations.id });
      await tx.insert(automationSteps).values({
        orgId,
        automationId: automation!.id,
        order: 1,
        kind: "auto_reply",
        config: {
          body: "Hi {{first_name}}, we're open Mon-Fri 9-6 and Sat 10-4. Reply here and we'll help!",
        },
      });
    }

    const campaignCount = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(campaigns)
      .where(eq(campaigns.orgId, orgId));
    if ((campaignCount[0]?.n ?? 0) === 0) {
      const contactRows = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.orgId, orgId))
        .limit(3);
      if (contactRows.length > 0) {
        const [campaign] = await tx
          .insert(campaigns)
          .values({
            orgId,
            name: "Thank-you broadcast",
            channel: "sms",
            segment: {
              type: "all",
              body: "Hi {{first_name}}, thanks for being a customer of {{business_name}}!",
            },
            status: "draft",
          })
          .returning({ id: campaigns.id });
        await tx.insert(campaignRecipients).values(
          contactRows.map((contact) => ({
            orgId,
            campaignId: campaign!.id,
            contactId: contact.id,
            status: "pending",
          })),
        );
      }
    }
  });

  // --- Phase 4 fixtures: AI employee (disabled by default) + knowledge base ---
  await withOrgAdmin(orgId, async (tx) => {
    const agentCount = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(aiAgents)
      .where(eq(aiAgents.orgId, orgId));
    if ((agentCount[0]?.n ?? 0) === 0) {
      await tx.insert(aiAgents).values({
        orgId,
        name: "AI Employee",
        enabled: false,
        voiceProfile: {
          enabled: false,
          greeting: "Thanks for reaching out!",
          escalationKeywords: ["human", "manager", "refund", "complaint"],
          blockedTopics: ["medical advice", "legal advice"],
          confidenceThreshold: 0.34,
        },
      });
    }

    const docCount = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(aiKnowledgeDocs)
      .where(eq(aiKnowledgeDocs.orgId, orgId));
    if ((docCount[0]?.n ?? 0) === 0) {
      const docs = [
        {
          title: "Business hours",
          content: "We are open Monday to Friday, 9am to 6pm, and Saturday 10am to 4pm. We are closed on Sundays.",
        },
        {
          title: "Location and parking",
          content: "We are at 100 Main Street. Free parking is available behind the building, enter from Oak Avenue.",
        },
      ];
      for (const doc of docs) {
        const [created] = await tx
          .insert(aiKnowledgeDocs)
          .values({
            orgId,
            title: doc.title,
            sourceType: "text",
            status: "ready",
            checksum: Buffer.from(doc.content).toString("base64url").slice(0, 32),
          })
          .returning({ id: aiKnowledgeDocs.id });
        await tx.insert(aiKnowledgeChunks).values({
          orgId,
          docId: created!.id,
          content: doc.content,
          tokenCount: Math.ceil(doc.content.length / 4),
        });
      }
    }
  });

  // --- Media catalog (shared) + demo taste profile (org-scoped) ---
  await seedMedia(orgId);

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