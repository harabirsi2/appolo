import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { Badge, Button, Card, CardTitle, Stars, Stat } from "@appolo/ui";
import { requireSession } from "@/lib/session";
import { withOrg, schema } from "@/lib/db";

const { reviews, reviewPlatforms, reviewRequests, contacts, conversations, locations } = schema;

export const metadata = { title: "Overview" };

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export default async function DashboardPage() {
  const session = await requireSession();
  const orgId = session.org.id;

  const [reviewStats, requestStats, contactCount, openConvos, locationRows, recent] = await Promise.all([
    withOrg(orgId, (tx) =>
      tx
        .select({
          total: sql<number>`count(*)::int`,
          avg: sql<number>`coalesce(avg(${reviews.rating}), 0)::float`,
        })
        .from(reviews),
    ),
    withOrg(orgId, (tx) =>
      tx
        .select({
          total: sql<number>`count(*)::int`,
          reviewed: sql<number>`count(*) filter (where ${reviewRequests.status} = 'reviewed')::int`,
        })
        .from(reviewRequests),
    ),
    withOrg(orgId, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(contacts)),
    withOrg(orgId, (tx) =>
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(conversations)
        .where(eq(conversations.status, "open")),
    ),
    withOrg(orgId, (tx) => tx.select({ id: locations.id, name: locations.name }).from(locations)),
    withOrg(orgId, (tx) =>
      tx
        .select({
          id: reviews.id,
          author: reviews.authorName,
          rating: reviews.rating,
          body: reviews.body,
          reviewedAt: reviews.reviewedAt,
          platform: reviewPlatforms.displayName,
        })
        .from(reviews)
        .innerJoin(reviewPlatforms, eq(reviews.platformId, reviewPlatforms.id))
        .orderBy(desc(reviews.reviewedAt))
        .limit(5),
    ),
  ]);

  const review = reviewStats[0] ?? { total: 0, avg: 0 };
  const requests = requestStats[0] ?? { total: 0, reviewed: 0 };
  const responseRate = requests.total > 0 ? requests.reviewed / requests.total : 0;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-muted">
            Reputation at a glance for {session.org.name}.
          </p>
        </div>
        <Badge tone="brand">RLS enforced · {locationRows.length} location{locationRows.length === 1 ? "" : "s"}</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Reviews" value={review.total} hint="synced across platforms" />
        <Stat label="Average rating" value={review.avg > 0 ? review.avg.toFixed(1) : "—"} hint="all connected platforms" />
        <Stat label="Request → review" value={requests.total > 0 ? pct(responseRate) : "—"} hint={`${requests.reviewed} of ${requests.total} requests`} />
        <Stat label="Open conversations" value={openConvos[0]?.n ?? 0} hint={`${contactCount[0]?.n ?? 0} contacts`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.55fr_1fr]">
        <Card>
          <CardTitle
            action={
              <Link href="/app/reviews">
                <Button variant="ghost" size="sm">View all</Button>
              </Link>
            }
          >
            Recent reviews
          </CardTitle>

          {recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              No reviews yet. Connect a platform or run the seed to see demo data.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((r) => (
                <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{r.author ?? "Anonymous"}</span>
                      <Badge>{r.platform}</Badge>
                    </div>
                    <Stars rating={r.rating} />
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm text-muted">{r.body ?? "No comment"}</p>
                  <p className="mt-1 text-[11px] text-muted-2">
                    {r.reviewedAt ? new Date(r.reviewedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardTitle>Phase 0 · shipped</CardTitle>
            <ul className="space-y-2 text-sm">
              {[
                "Multi-tenant orgs + locations",
                "Session auth with hashed tokens",
                "RBAC permission matrix",
                "Postgres row-level security",
                "Audit-ready schema (45 tables)",
                "Worker + queue scaffolding",
              ].map((item) => (
                <li key={item} className="flex gap-2 text-muted">
                  <span className="text-success">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardTitle>Next up</CardTitle>
            <p className="text-sm text-muted">
              Phase 1 adds contacts, the shared inbox, SMS via Twilio, and the embeddable webchat
              widget — with the consent ledger gating every send.
            </p>
            <div className="mt-4 flex gap-2">
              <Link href="/app/locations">
                <Button variant="secondary" size="sm">Manage locations</Button>
              </Link>
              <Link href="/app/settings">
                <Button variant="ghost" size="sm">Workspace settings</Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}