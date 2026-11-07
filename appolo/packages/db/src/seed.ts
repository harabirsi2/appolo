import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "@appolo/core";

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
  reviewPlatforms,
  reviews,
  reviewRequests,
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