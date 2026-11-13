import { can } from "@appolo/core";
import { Badge, Card, CardTitle, Stat } from "@appolo/ui";
import { requireSession } from "@/lib/session";
import { contactsTouched, reviewReport } from "@/lib/services/reports";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const RANGES = [30, 90, 180, 365];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await requireSession();
  if (!can(session.membership.role, "reports:view")) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-2 text-sm text-muted">Your role cannot view reports.</p>
      </div>
    );
  }

  const { days } = await searchParams;
  const rangeDays = Math.min(Math.max(Number(days ?? "90") || 90, 7), 365);

  const [report, touched] = await Promise.all([
    reviewReport(session.org.id, rangeDays),
    contactsTouched(session.org.id, rangeDays),
  ]);

  const maxSeries = Math.max(1, ...report.series.map((point) => point.count));
  const maxDistribution = Math.max(1, ...report.distribution.map((row) => row.count));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-muted">Review performance, request conversion, and team activity.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((range) => (
            <a
              key={range}
              href={`/app/reports?days=${range}`}
              className={`inline-flex h-8 items-center rounded-lg border px-3 text-xs ${
                range === rangeDays
                  ? "border-brand/40 bg-brand/15 text-brand-soft"
                  : "border-border bg-surface-2 text-muted hover:border-border-strong hover:text-ink"
              }`}
            >
              {range} days
            </a>
          ))}
          <a
            href="/api/reviews/export"
            className="inline-flex h-8 items-center rounded-lg border border-border bg-surface-2 px-3 text-xs text-ink hover:border-border-strong"
          >
            Export CSV
          </a>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Public reviews" value={report.total} hint={`${report.average.toFixed(1)} average rating`} />
        <Stat label="Reply rate" value={`${report.replyRate}%`} hint={`${report.replied} replied`} />
        <Stat label="Requests sent" value={report.requestsSent} hint={`${report.requests} total in range`} />
        <Stat label="Conversion" value={`${report.conversionRate}%`} hint={`${report.reviewed} reviewed after a request`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle action={<Badge>{report.total} reviews</Badge>}>Rating distribution</CardTitle>
          <ul className="space-y-2">
            {[...report.distribution].reverse().map((row) => (
              <li key={row.rating} className="flex items-center gap-3">
                <span className="w-12 text-xs text-muted">{row.rating} star{row.rating === 1 ? "" : "s"}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${Math.round((row.count / maxDistribution) * 100)}%` }}
                  />
                </div>
                <span className="w-8 text-right text-xs text-muted-2">{row.count}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-2">
            {report.privateFeedback} private feedback item{report.privateFeedback === 1 ? "" : "s"} in this range ·{" "}
            {touched} contact{touched === 1 ? "" : "s"} touched
          </p>
        </Card>

        <Card>
          <CardTitle action={<Badge>{rangeDays} days</Badge>}>Review volume</CardTitle>
          {report.series.length === 0 ? (
            <p className="text-sm text-muted">No reviews in this range.</p>
          ) : (
            <div className="flex h-40 items-end gap-1.5">
              {report.series.map((point) => (
                <div key={point.date} className="group flex flex-1 flex-col items-center justify-end">
                  <div
                    className="w-full rounded-t bg-brand/70 transition-colors group-hover:bg-brand"
                    style={{ height: `${Math.max(4, Math.round((point.count / maxSeries) * 100))}%` }}
                    title={`${point.date}: ${point.count} review(s), ${point.average.toFixed(1)} avg`}
                  />
                  <span className="mt-1 hidden text-[10px] text-muted-2 sm:block">
                    {point.date.slice(5)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>By platform</CardTitle>
          {report.byPlatform.length === 0 ? (
            <p className="text-sm text-muted">No reviews yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-2">
                  <th className="pb-2 font-medium">Platform</th>
                  <th className="pb-2 font-medium">Reviews</th>
                  <th className="pb-2 font-medium">Average</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.byPlatform.map((row) => (
                  <tr key={row.kind}>
                    <td className="py-2 pr-3">{row.name}</td>
                    <td className="py-2 pr-3 text-muted">{row.count}</td>
                    <td className="py-2 text-muted">{row.average.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <CardTitle>By location</CardTitle>
          {report.byLocation.length === 0 ? (
            <p className="text-sm text-muted">No reviews yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-2">
                  <th className="pb-2 font-medium">Location</th>
                  <th className="pb-2 font-medium">Reviews</th>
                  <th className="pb-2 font-medium">Average</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.byLocation.map((row) => (
                  <tr key={row.name}>
                    <td className="py-2 pr-3">{row.name}</td>
                    <td className="py-2 pr-3 text-muted">{row.count}</td>
                    <td className="py-2 text-muted">{row.average.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle>Request funnel</CardTitle>
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <p className="text-xs text-muted-2">Requests</p>
            <p className="mt-1 text-xl font-semibold">{report.requests}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <p className="text-xs text-muted-2">Sent</p>
            <p className="mt-1 text-xl font-semibold">{report.requestsSent}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <p className="text-xs text-muted-2">Clicked</p>
            <p className="mt-1 text-xl font-semibold">{report.clicked}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <p className="text-xs text-muted-2">Reviewed</p>
            <p className="mt-1 text-xl font-semibold">{report.reviewed}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}