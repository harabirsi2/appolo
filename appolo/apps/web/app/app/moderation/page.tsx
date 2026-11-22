import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { moderationQueue } from "@/lib/services/moderation";
import { REPORT_REASON_LABELS, type ReportReason } from "@/lib/moderation-constants";
import { ModerationActions } from "@/components/moderation-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Moderation" };

const CONTENT_LABELS = { review: "Review", profile: "Profile", comment: "Comment" } as const;

function reasonLabel(reason: string): string {
  return REPORT_REASON_LABELS[reason as ReportReason] ?? reason;
}

export default async function ModerationPage() {
  const session = await requireSession();
  if (!session.user.isModerator) notFound();

  const reports = await moderationQueue(200);

  return (
    <div className="space-y-4 px-5 pt-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-ink">Moderation queue</h1>
          <p className="mt-1 text-[13px] text-muted">
            {reports.length === 0
              ? "No open reports."
              : `${reports.length} open report${reports.length === 1 ? "" : "s"} across reviews, profiles, and comments.`}
          </p>
        </div>
        <Link href="/app" className="text-[12px] text-muted-2 hover:text-ink">
          Back to app
        </Link>
      </div>

      {reports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
          <p className="text-sm font-medium text-ink">Queue is clear</p>
          <p className="mt-1 text-[13px] text-muted">Reported content will appear here for review.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {reports.map((report) => (
            <li key={report.id} className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                      {CONTENT_LABELS[report.contentType]}
                    </span>
                    <span className="text-[13px] font-semibold text-ink">{reasonLabel(report.reason)}</span>
                    {report.openReports > 1 ? (
                      <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10px] text-brand">
                        {report.openReports} reports
                      </span>
                    ) : null}
                    {report.target && report.target.moderationStatus !== "visible" ? (
                      <span className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[10px] text-danger">
                        {report.target.moderationStatus}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[12px] text-muted-2">
                    {report.target?.label ?? "Content no longer exists."}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-2">
                    Reported by{" "}
                    {report.reporter ? `@${report.reporter.username}` : "a deleted profile"} ·{" "}
                    {report.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </div>
              </div>

              {report.target?.body ? (
                <p className="mt-3 whitespace-pre-line rounded-xl border border-white/[0.06] bg-black/25 p-3 text-[12px] leading-relaxed text-muted">
                  {report.target.body.slice(0, 600)}
                  {report.target.body.length > 600 ? "…" : ""}
                </p>
              ) : null}

              {report.details ? (
                <p className="mt-2 text-[12px] text-muted">
                  <span className="text-muted-2">Reporter note:</span> {report.details}
                </p>
              ) : null}

              {report.target ? (
                <ModerationActions reportId={report.id} />
              ) : (
                <p className="mt-3 text-[11px] text-muted-2">
                  Nothing to hide or remove — dismiss this report to clear it.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
