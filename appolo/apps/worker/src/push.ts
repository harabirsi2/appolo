import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, inArray, sql } from "drizzle-orm";
import webpush from "web-push";
import { schema, type Db } from "@appolo/db";

/**
 * Web push delivery.
 *
 * Two event sources, one sender:
 *   - "friends rated X": derived from `item_matchups` (the append-only log) by
 *     joining the voter's followers, so nothing extra is written on the vote
 *     path and a missed push can never corrupt the ranking history;
 *   - the weekly digest: one summary per account that has a subscription.
 *
 * Everything is best-effort. A push failure is logged and, after five
 * consecutive failures (or an immediate 404/410), the subscription is disabled;
 * it never throws into the job queue.
 */

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

interface SubscriptionRow {
  id: string;
  orgId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failureCount: number;
}

/** Window for "friends rated X". The job runs on the same cadence, so a vote
 * is announced once; widening the window without widening the cadence would
 * push the same comparison twice. */
const FRIEND_WINDOW = "6 minutes";
const MAX_FAILURES = 5;

interface ActivityRow {
  follower_org_id: string;
  actor_org_id: string;
  display_name: string;
  comparisons: number;
  latest_title: string | null;
}

export function pushConfigured(): boolean {
  return Boolean(process.env.PUSH_VAPID_PUBLIC_KEY && process.env.PUSH_VAPID_PRIVATE_KEY);
}

export interface PushSender {
  /** Push one payload to every enabled device on these accounts. */
  sendToOrgs(orgIds: string[], payload: PushPayload): Promise<number>;
  /** Announce what followers' votes produced in the last window. */
  sendFriendActivity(): Promise<number>;
  /** One "your week in comparisons" notification per subscribed account. */
  sendWeeklyDigest(): Promise<number>;
  close(): Promise<void>;
}

export function createPushSender(databaseUrl: string): PushSender {
  const client = postgres(databaseUrl, { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema }) as Db;
  const { pushSubscriptions } = schema;

  if (pushConfigured()) {
    webpush.setVapidDetails(
      process.env.PUSH_VAPID_SUBJECT ?? "mailto:hello@appolo.app",
      process.env.PUSH_VAPID_PUBLIC_KEY!,
      process.env.PUSH_VAPID_PRIVATE_KEY!,
    );
  }

  async function deliver(rows: SubscriptionRow[], payload: PushPayload): Promise<number> {
    if (!pushConfigured() || rows.length === 0) return 0;
    let sent = 0;
    for (const row of rows) {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 24 },
        );
        sent += 1;
        await db
          .update(pushSubscriptions)
          .set({ lastSuccessAt: new Date(), failureCount: 0, updatedAt: new Date() })
          .where(eq(pushSubscriptions.id, row.id));
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // 404/410 means the browser threw the subscription away; retrying it
        // forever would keep a dead device in the send list.
        const gone = status === 404 || status === 410;
        const failures = row.failureCount + 1;
        await db
          .update(pushSubscriptions)
          .set({
            failureCount: failures,
            lastFailureAt: new Date(),
            updatedAt: new Date(),
            enabled: !gone && failures < MAX_FAILURES,
          })
          .where(eq(pushSubscriptions.id, row.id));
        if (!gone) console.warn(`[push] delivery failed (${status ?? "network"}):`, (error as Error).message);
      }
    }
    return sent;
  }

  async function sendToOrgs(orgIds: string[], payload: PushPayload): Promise<number> {
    if (!pushConfigured() || orgIds.length === 0) return 0;
    const rows = await db
      .select({
        id: pushSubscriptions.id,
        orgId: pushSubscriptions.orgId,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
        failureCount: pushSubscriptions.failureCount,
      })
      .from(pushSubscriptions)
      .where(and(inArray(pushSubscriptions.orgId, orgIds), eq(pushSubscriptions.enabled, true)));
    return deliver(rows, payload);
  }

  async function sendFriendActivity(): Promise<number> {
    if (!pushConfigured()) return 0;
    const rows = (await db.execute<{
      follower_org_id: string;
      actor_org_id: string;
      display_name: string;
      comparisons: number;
      latest_title: string | null;
    }>(sql`
      select
        f.follower_org_id,
        im.org_id as actor_org_id,
        p.display_name,
        count(*)::int as comparisons,
        (array_agg(ci.title order by im.created_at desc))[1] as latest_title
      from public.item_matchups im
      join public.follows f on f.followee_org_id = im.org_id
      join public.profiles p on p.org_id = im.org_id
      join public.catalog_items ci on ci.id = im.item_id
      where im.created_at > now() - ${FRIEND_WINDOW}::interval
        and im.result in ('win', 'loss', 'tie')
        and f.follower_org_id <> im.org_id
      group by f.follower_org_id, im.org_id, p.display_name
      order by max(im.created_at) desc
    `)) as ActivityRow[];

    const byFollower = new Map<string, ActivityRow[]>();
    for (const row of rows) {
      const list = byFollower.get(row.follower_org_id) ?? [];
      list.push(row);
      byFollower.set(row.follower_org_id, list);
    }

    let sent = 0;
    for (const [followerOrgId, activity] of byFollower) {
      const first = activity[0]!;
      // One notification per follower per window: three friends voting is one
      // "your friends are ranking" moment, not three buzzes.
      const payload: PushPayload =
        activity.length === 1
          ? {
              title: `${first.display_name} just ranked ${first.latest_title ?? "something"}`,
              body:
                first.comparisons > 1
                  ? `${first.comparisons} comparisons — see where it landed.`
                  : "Tap to see their ranking and vote on the same pair.",
              url: "/app/feed",
              tag: "friend-activity",
            }
          : {
              title: `${activity.length} people you follow ranked something`,
              body: `${first.display_name} and ${activity.length - 1} more compared new titles.`,
              url: "/app/feed",
              tag: "friend-activity",
            };
      sent += await sendToOrgs([followerOrgId], payload);
    }
    return sent;
  }

  async function sendWeeklyDigest(): Promise<number> {
    if (!pushConfigured()) return 0;
    const rows = await db.execute<{
      org_id: string;
      comparisons: number;
      top_title: string | null;
    }>(sql`
      select
        im.org_id,
        count(*)::int as comparisons,
        (
          select ci.title
          from public.item_matchups m
          join public.catalog_items ci on ci.id = m.item_id
          where m.org_id = im.org_id
            and m.result = 'win'
            and m.created_at > now() - interval '7 days'
          group by ci.title
          order by count(*) desc
          limit 1
        ) as top_title
      from public.item_matchups im
      where im.created_at > now() - interval '7 days'
        and im.result in ('win', 'loss', 'tie')
      group by im.org_id
      having count(*) >= 5
    `);

    let sent = 0;
    for (const row of rows) {
      sent += await sendToOrgs([row.org_id], {
        title: "Your week in comparisons",
        body: row.top_title
          ? `${row.comparisons} comparisons. ${row.top_title} stayed on top.`
          : `${row.comparisons} comparisons this week.`,
        url: "/app",
        tag: "weekly-digest",
      });
    }
    return sent;
  }

  return {
    sendToOrgs,
    sendFriendActivity,
    sendWeeklyDigest,
    close: () => client.end({ timeout: 5 }),
  };
}
