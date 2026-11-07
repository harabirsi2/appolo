/**
 * Reporting rollups and exports. Everything is org-scoped via withOrg (RLS).
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { withOrg, schema } from "@/lib/db";

const {
  reviews,
  reviewPlatforms,
  reviewRequests,
  privateFeedback,
  locations,
  messages,
  contactEvents,
  consentRecords,
  conversations,
} = schema;
export interface ReviewReport {
  rangeDays: number;
  total: number;
  average: number;
  replied: number;
  replyRate: number;
  requests: number;
  requestsSent: number;
  clicked: number;
  reviewed: number;
  privateFeedback: number;
  conversionRate: number;
  distribution: { rating: number; count: number }[];
  byPlatform: { kind: string; name: string; count: number; average: number }[];
  byLocation: { name: string; count: number; average: number }[];
  series: { date: string; count: number; average: number }[];
}

export async function reviewReport(orgId: string, rangeDays = 90): Promise<ReviewReport> {
  const since = new Date(Date.now() - rangeDays * 86_400_000);
  return withOrg(orgId, async (tx) => {
    const [reviewAgg] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        average: sql<number>`coalesce(avg(${reviews.rating}), 0)::float`,
        replied: sql<number>`count(*) filter (where ${reviews.replyStatus} = 'posted')::int`,
      })
      .from(reviews)
      .where(and(eq(reviews.orgId, orgId), gte(reviews.reviewedAt, since)));

    const distribution = await tx
      .select({ rating: reviews.rating, count: sql<number>`count(*)::int` })
      .from(reviews)
      .where(and(eq(reviews.orgId, orgId), gte(reviews.reviewedAt, since)))
      .groupBy(reviews.rating);

    const byPlatform = await tx
      .select({
        kind: reviewPlatforms.kind,
        name: reviewPlatforms.displayName,
        count: sql<number>`count(*)::int`,
        average: sql<number>`coalesce(avg(${reviews.rating}), 0)::float`,
      })
      .from(reviews)
      .leftJoin(reviewPlatforms, eq(reviewPlatforms.id, reviews.platformId))
      .where(and(eq(reviews.orgId, orgId), gte(reviews.reviewedAt, since)))
      .groupBy(reviewPlatforms.kind, reviewPlatforms.displayName);

    const byLocation = await tx
      .select({
        name: sql<string>`coalesce(${locations.name}, 'Unassigned')`,
        count: sql<number>`count(*)::int`,
        average: sql<number>`coalesce(avg(${reviews.rating}), 0)::float`,
      })
      .from(reviews)
      .leftJoin(locations, eq(locations.id, reviews.locationId))
      .where(and(eq(reviews.orgId, orgId), gte(reviews.reviewedAt, since)))
      .groupBy(locations.name);

    const series = await tx
      .select({
        date: sql<string>`to_char(date_trunc('day', ${reviews.reviewedAt}), 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
        average: sql<number>`coalesce(avg(${reviews.rating}), 0)::float`,
      })
      .from(reviews)
      .where(and(eq(reviews.orgId, orgId), gte(reviews.reviewedAt, since)))
      .groupBy(sql`date_trunc('day', ${reviews.reviewedAt})`)
      .orderBy(sql`date_trunc('day', ${reviews.reviewedAt})`);

    const [reqAgg] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        sent: sql<number>`count(*) filter (where ${reviewRequests.status} in ('sent','clicked','reviewed'))::int`,
        clicked: sql<number>`count(*) filter (where ${reviewRequests.status} in ('clicked','reviewed'))::int`,
        reviewed: sql<number>`count(*) filter (where ${reviewRequests.status} = 'reviewed')::int`,
      })
      .from(reviewRequests)
      .where(and(eq(reviewRequests.orgId, orgId), gte(reviewRequests.createdAt, since)));

    const [feedbackAgg] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(privateFeedback)
      .where(and(eq(privateFeedback.orgId, orgId), gte(privateFeedback.createdAt, since)));

    const total = reviewAgg?.total ?? 0;
    const replied = reviewAgg?.replied ?? 0;
    const requestsSent = reqAgg?.sent ?? 0;

    return {
      rangeDays,
      total,
      average: Number((reviewAgg?.average ?? 0).toFixed(2)),
      replied,
      replyRate: total > 0 ? Math.round((replied / total) * 100) : 0,
      requests: reqAgg?.total ?? 0,
      requestsSent,
      clicked: reqAgg?.clicked ?? 0,
      reviewed: reqAgg?.reviewed ?? 0,
      privateFeedback: feedbackAgg?.n ?? 0,
      conversionRate: requestsSent > 0 ? Math.round(((reqAgg?.reviewed ?? 0) / requestsSent) * 100) : 0,
      distribution: [1, 2, 3, 4, 5].map((rating) => ({
        rating,
        count: distribution.find((row) => row.rating === rating)?.count ?? 0,
      })),
      byPlatform: byPlatform.map((row) => ({
        kind: row.kind ?? "unknown",
        name: row.name ?? "Unknown",
        count: row.count,
        average: Number(row.average.toFixed(2)),
      })),
      byLocation: byLocation.map((row) => ({
        name: row.name,
        count: row.count,
        average: Number(row.average.toFixed(2)),
      })),
      series,
    };
  });
}

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export async function reviewsCsv(orgId: string): Promise<string> {
  const rows = await withOrg(orgId, (tx) =>
    tx
      .select({
        reviewedAt: reviews.reviewedAt,
        platform: reviewPlatforms.displayName,
        rating: reviews.rating,
        author: reviews.authorName,
        replyStatus: reviews.replyStatus,
        body: reviews.body,
      })
      .from(reviews)
      .leftJoin(reviewPlatforms, eq(reviewPlatforms.id, reviews.platformId))
      .where(eq(reviews.orgId, orgId))
      .orderBy(desc(reviews.reviewedAt)),
  );

  const header = ["date", "platform", "rating", "author", "reply_status", "review"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.reviewedAt instanceof Date ? row.reviewedAt.toISOString() : row.reviewedAt,
        row.platform,
        row.rating,
        row.author,
        row.replyStatus,
        row.body,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

export interface TimelineEntry {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  at: Date;
}

/** A merged contact timeline: events, messages, consent, and review requests. */
export async function contactTimeline(orgId: string, contactId: string): Promise<TimelineEntry[]> {
  return withOrg(orgId, async (tx) => {
    const events = await tx
      .select({ id: contactEvents.id, kind: contactEvents.kind, payload: contactEvents.payload, at: contactEvents.createdAt })
      .from(contactEvents)
      .where(and(eq(contactEvents.orgId, orgId), eq(contactEvents.contactId, contactId)));

    const msgs = await tx
      .select({
        id: messages.id,
        direction: messages.direction,
        body: messages.body,
        at: sql<Date>`coalesce(${messages.sentAt}, ${messages.createdAt})`,
      })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(eq(conversations.orgId, orgId), eq(conversations.contactId, contactId)));

    const consents = await tx
      .select({ id: consentRecords.id, channel: consentRecords.channel, status: consentRecords.status, at: consentRecords.capturedAt })
      .from(consentRecords)
      .where(and(eq(consentRecords.orgId, orgId), eq(consentRecords.contactId, contactId)));

    const reqs = await tx
      .select({ id: reviewRequests.id, status: reviewRequests.status, channel: reviewRequests.channel, at: reviewRequests.createdAt })
      .from(reviewRequests)
      .where(and(eq(reviewRequests.orgId, orgId), eq(reviewRequests.contactId, contactId)));

    const entries: TimelineEntry[] = [
      ...events.map((e) => ({
        id: `evt-${e.id}`,
        kind: e.kind,
        title: e.kind.replace(/[._]/g, " "),
        detail: null as string | null,
        at: e.at,
      })),
      ...msgs.map((m) => ({
        id: `msg-${m.id}`,
        kind: m.direction === "inbound" ? "message.inbound" : "message.outbound",
        title: m.direction === "inbound" ? "Message received" : "Message sent",
        detail: m.body,
        at: m.at,
      })),
      ...consents.map((c) => ({
        id: `con-${c.id}`,
        kind: "consent",
        title: `Consent ${c.status} (${c.channel})`,
        detail: null as string | null,
        at: c.at,
      })),
      ...reqs.map((r) => ({
        id: `req-${r.id}`,
        kind: "review_request",
        title: `Review request ${r.status} (${r.channel})`,
        detail: null as string | null,
        at: r.at,
      })),
    ];

    return entries
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 100);
  });
}

/** Small helper used by the dashboard to show contacts touched recently. */
export async function contactsTouched(orgId: string, days = 30): Promise<number> {
  const since = new Date(Date.now() - days * 86_400_000);
  return withOrg(orgId, async (tx) => {
    const [row] = await tx
      .select({ n: sql<number>`count(distinct ${contactEvents.contactId})::int` })
      .from(contactEvents)
      .where(and(eq(contactEvents.orgId, orgId), gte(contactEvents.createdAt, since)));
    return row?.n ?? 0;
  });
}
