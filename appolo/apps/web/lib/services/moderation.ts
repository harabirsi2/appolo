import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getAdminDb, withOrg, schema } from "@/lib/db";
import {
  MODERATION_ACTIONS,
  REPORT_CONTENT_TYPES,
  REPORT_REASONS,
  type ModerationAction,
} from "@/lib/moderation-constants";
import { autoHideEnabled, triage, type DuplicateCandidate } from "./moderation-signals";
import { DomainError } from "./errors";

const { abuseReports, catalogItems, itemRatings, profiles, ratingComments } = schema;

export { MODERATION_ACTIONS, REPORT_CONTENT_TYPES, REPORT_REASONS } from "@/lib/moderation-constants";
export type { ModerationAction } from "@/lib/moderation-constants";

export const reportContentSchema = z.object({
  contentType: z.enum(REPORT_CONTENT_TYPES),
  contentId: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(1000).optional().nullable(),
});
export type ReportContentInput = z.infer<typeof reportContentSchema>;

export const moderationActionSchema = z.object({
  action: z.enum(MODERATION_ACTIONS),
});

type ModerationStatus = "visible" | "hidden" | "removed";

export interface ReportTarget {
  contentType: (typeof REPORT_CONTENT_TYPES)[number];
  contentId: string;
  contentOrgId: string;
  label: string;
  body: string | null;
  username: string | null;
  itemTitle: string | null;
  moderationStatus: ModerationStatus;
}

export interface ModerationQueueItem {
  id: string;
  contentType: ReportTarget["contentType"];
  contentId: string;
  contentOrgId: string;
  reason: string;
  details: string | null;
  status: string;
  action: string | null;
  /** Advisory priority from moderation-signals: none | flag | hide. */
  triageAction: string;
  triageScore: number;
  triageReason: string | null;
  createdAt: Date;
  reporter: { orgId: string; username: string; displayName: string } | null;
  target: ReportTarget | null;
  openReports: number;
}

export interface ModerationResult {
  changed: boolean;
  reportStatus: string;
  contentStatus: ModerationStatus | null;
  action: ModerationAction;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Resolve a polymorphic report target. `requireVisible` is true when a user is
 * filing a report (content must still be public); the queue uses false so a
 * report remains inspectable after another action hid its target.
 */
async function loadTarget(
  contentType: ReportTarget["contentType"],
  contentId: string,
  requireVisible: boolean,
): Promise<ReportTarget | null> {
  if (!isUuid(contentId)) return null;
  const db = getAdminDb();

  if (contentType === "review") {
    const rows = await db
      .select({ rating: itemRatings, profile: profiles, item: catalogItems })
      .from(itemRatings)
      .innerJoin(profiles, eq(profiles.orgId, itemRatings.orgId))
      .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
      .where(eq(itemRatings.id, contentId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (requireVisible && (row.rating.moderationStatus !== "visible" || row.profile.moderationStatus !== "visible")) {
      return null;
    }
    return {
      contentType,
      contentId,
      contentOrgId: row.rating.orgId,
      label: `Review by @${row.profile.username} on ${row.item.title}`,
      body: row.rating.reviewText ?? null,
      username: row.profile.username,
      itemTitle: row.item.title,
      moderationStatus: row.rating.moderationStatus as ModerationStatus,
    };
  }

  if (contentType === "profile") {
    const rows = await db.select().from(profiles).where(eq(profiles.orgId, contentId)).limit(1);
    const profile = rows[0];
    if (!profile) return null;
    if (requireVisible && profile.moderationStatus !== "visible") return null;
    return {
      contentType,
      contentId,
      contentOrgId: profile.orgId,
      label: `Profile @${profile.username}`,
      body: profile.bio ?? null,
      username: profile.username,
      itemTitle: null,
      moderationStatus: profile.moderationStatus as ModerationStatus,
    };
  }

  const rows = await db
    .select({ comment: ratingComments, profile: profiles, rating: itemRatings, item: catalogItems })
    .from(ratingComments)
    .innerJoin(profiles, eq(profiles.orgId, ratingComments.orgId))
    .innerJoin(itemRatings, eq(itemRatings.id, ratingComments.ratingId))
    .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
    .where(eq(ratingComments.id, contentId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (
    requireVisible &&
    (row.comment.moderationStatus !== "visible" ||
      row.rating.moderationStatus !== "visible" ||
      row.profile.moderationStatus !== "visible")
  ) {
    return null;
  }
  return {
    contentType,
    contentId,
    contentOrgId: row.comment.orgId,
    label: `Comment by @${row.profile.username} on ${row.item.title}`,
    body: row.comment.body,
    username: row.profile.username,
    itemTitle: row.item.title,
    moderationStatus: row.comment.moderationStatus as ModerationStatus,
  };
}

/** How many of the author's earlier bodies a new report is compared against. */
const DUPLICATE_WINDOW = 200;

/**
 * Run the moderation signals for a report that is about to be inserted.
 *
 * Candidates are the author's own recent bodies of the same content type: that
 * is what "posted the same paragraph twice" looks like, and it keeps the query
 * inside one org's rows even though the queue runs through the admin client.
 * Profiles carry no body, so they skip the query entirely and land on 'none'.
 *
 * The result is advisory — nothing is hidden here. `hide` is recorded when the
 * signal is unambiguous and auto-hide is switched on, and it still waits for a
 * moderator; see docs/MODERATION.md.
 */
async function triageReport(target: ReportTarget, contentId: string) {
  const body = target.body?.trim() ?? "";
  if (body.length === 0) return triage({ body });

  const admin = getAdminDb();
  const candidates: DuplicateCandidate[] = [];

  if (target.contentType === "review") {
    const rows = await admin
      .select({ id: itemRatings.id, body: itemRatings.reviewText })
      .from(itemRatings)
      .where(
        and(
          eq(itemRatings.orgId, target.contentOrgId),
          ne(itemRatings.id, contentId),
          isNotNull(itemRatings.reviewText),
        ),
      )
      .orderBy(desc(itemRatings.createdAt))
      .limit(DUPLICATE_WINDOW);
    for (const row of rows) if (row.body) candidates.push({ id: row.id, body: row.body });
  } else if (target.contentType === "comment") {
    const rows = await admin
      .select({ id: ratingComments.id, body: ratingComments.body })
      .from(ratingComments)
      .where(and(eq(ratingComments.orgId, target.contentOrgId), ne(ratingComments.id, contentId)))
      .orderBy(desc(ratingComments.createdAt))
      .limit(DUPLICATE_WINDOW);
    for (const row of rows) if (row.body) candidates.push({ id: row.id, body: row.body });
  }

  return triage({ body, candidates, autoHideEnabled: autoHideEnabled() });
}

/**
 * File a report. The unique reporter/content key means a repeated report from
 * the same workspace returns the existing report instead of creating noise.
 */
export async function reportContent(
  reporterOrgId: string,
  input: ReportContentInput,
): Promise<{ id: string; created: boolean; status: string }> {
  const target = await loadTarget(input.contentType, input.contentId, true);
  if (!target) {
    throw new DomainError("CONTENT_NOT_FOUND", "That content is no longer available.", 404);
  }
  if (target.contentOrgId === reporterOrgId) {
    throw new DomainError("SELF_REPORT", "You cannot report your own content.", 400);
  }

  // Computed before the insert so the queue never has to re-scan the author's
  // history, and persisted so a threshold change cannot rewrite past reports.
  const decision = await triageReport(target, input.contentId);

  const inserted = await withOrg(reporterOrgId, (tx) =>
    tx
      .insert(abuseReports)
      .values({
        reporterOrgId,
        contentOrgId: target.contentOrgId,
        contentType: input.contentType,
        contentId: input.contentId,
        reason: input.reason,
        details: input.details?.trim() || null,
        triageAction: decision.action,
        triageScore: Math.round(decision.spam.score),
        triageReason: decision.action === "none" ? null : decision.reason,
      })
      .onConflictDoNothing()
      .returning({ id: abuseReports.id }),
  );
  if (inserted[0]) return { id: inserted[0].id, created: true, status: "open" };

  const existing = await withOrg(reporterOrgId, (tx) =>
    tx
      .select({ id: abuseReports.id, status: abuseReports.status })
      .from(abuseReports)
      .where(
        and(
          eq(abuseReports.reporterOrgId, reporterOrgId),
          eq(abuseReports.contentType, input.contentType),
          eq(abuseReports.contentId, input.contentId),
        ),
      )
      .limit(1),
  );
  if (!existing[0]) {
    throw new DomainError("REPORT_FAILED", "Could not save that report.", 500);
  }
  return { id: existing[0].id, created: false, status: existing[0].status };
}

/** Open reports for the platform moderation queue, newest first. */
export async function moderationQueue(limit = 100): Promise<ModerationQueueItem[]> {
  const admin = getAdminDb();
  // Priority first, then newest: a flagged duplicate or advert should not wait
  // behind a day of "this review is mean" reports. 'hide' sorts above 'flag'
  // because it means the signal was unambiguous.
  const priority = sql`case ${abuseReports.triageAction} when 'hide' then 0 when 'flag' then 1 else 2 end`;
  const rows = await admin
    .select()
    .from(abuseReports)
    .where(eq(abuseReports.status, "open"))
    .orderBy(priority, desc(abuseReports.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  if (rows.length === 0) return [];

  const reporterIds = [...new Set(rows.map((row) => row.reporterOrgId))];
  const reporters = await admin
    .select({ orgId: profiles.orgId, username: profiles.username, displayName: profiles.displayName })
    .from(profiles)
    .where(inArray(profiles.orgId, reporterIds));
  const reporterByOrg = new Map(reporters.map((profile) => [profile.orgId, profile]));

  const counts = await admin
    .select({
      contentType: abuseReports.contentType,
      contentId: abuseReports.contentId,
      count: sql<number>`count(*)::int`,
    })
    .from(abuseReports)
    .where(eq(abuseReports.status, "open"))
    .groupBy(abuseReports.contentType, abuseReports.contentId);
  const countByKey = new Map(counts.map((row) => [`${row.contentType}:${row.contentId}`, row.count]));

  const targets = await Promise.all(
    rows.map((row) => loadTarget(row.contentType as ReportTarget["contentType"], row.contentId, false)),
  );

  return rows.map((row, index) => ({
    id: row.id,
    contentType: row.contentType as ReportTarget["contentType"],
    contentId: row.contentId,
    contentOrgId: row.contentOrgId,
    reason: row.reason,
    details: row.details,
    status: row.status,
    action: row.action,
    triageAction: row.triageAction,
    triageScore: row.triageScore,
    triageReason: row.triageReason,
    createdAt: row.createdAt,
    reporter: reporterByOrg.get(row.reporterOrgId) ?? null,
    target: targets[index] ?? null,
    openReports: countByKey.get(`${row.contentType}:${row.contentId}`) ?? 1,
  }));
}

/**
 * Apply a moderation decision. All writes are conditional so replaying the
 * same decision is a no-op: the content status changes once, and only open
 * reports for that content are resolved once.
 */
export async function moderateReport(
  moderatorId: string,
  reportId: string,
  action: ModerationAction,
): Promise<ModerationResult> {
  if (!isUuid(reportId)) throw new DomainError("REPORT_NOT_FOUND", "That report does not exist.", 404);
  const admin = getAdminDb();
  const [report] = await admin.select().from(abuseReports).where(eq(abuseReports.id, reportId)).limit(1);
  if (!report) throw new DomainError("REPORT_NOT_FOUND", "That report does not exist.", 404);

  const now = new Date();
  const target = await loadTarget(report.contentType as ReportTarget["contentType"], report.contentId, false);

  if (action === "dismiss") {
    const updated = await admin
      .update(abuseReports)
      .set({ status: "dismissed", action: "dismiss", moderatedBy: moderatorId, moderatedAt: now })
      .where(and(eq(abuseReports.id, reportId), eq(abuseReports.status, "open")))
      .returning({ id: abuseReports.id });
    return {
      changed: updated.length > 0,
      reportStatus: "dismissed",
      contentStatus: target?.moderationStatus ?? null,
      action,
    };
  }

  if (!target) {
    throw new DomainError("CONTENT_NOT_FOUND", "That content no longer exists.", 404);
  }

  const next: ModerationStatus = action === "hide" ? "hidden" : "removed";
  let changed = false;
  // A hide must not downgrade a previous removal.
  if (target.moderationStatus !== next && !(next === "hidden" && target.moderationStatus === "removed")) {
    if (report.contentType === "review") {
      const updated = await admin
        .update(itemRatings)
        .set({ moderationStatus: next, moderatedAt: now, moderatedBy: moderatorId })
        .where(and(eq(itemRatings.id, report.contentId), eq(itemRatings.moderationStatus, target.moderationStatus)))
        .returning({ id: itemRatings.id });
      changed = updated.length > 0;
    } else if (report.contentType === "profile") {
      const updated = await admin
        .update(profiles)
        .set({ moderationStatus: next, moderatedAt: now, moderatedBy: moderatorId })
        .where(and(eq(profiles.orgId, report.contentId), eq(profiles.moderationStatus, target.moderationStatus)))
        .returning({ orgId: profiles.orgId });
      changed = updated.length > 0;
    } else if (report.contentType === "comment") {
      const updated = await admin
        .update(ratingComments)
        .set({ moderationStatus: next, moderatedAt: now, moderatedBy: moderatorId })
        .where(
          and(
            eq(ratingComments.id, report.contentId),
            eq(ratingComments.moderationStatus, target.moderationStatus),
          ),
        )
        .returning({ id: ratingComments.id });
      changed = updated.length > 0;
    }
  }

  await admin
    .update(abuseReports)
    .set({ status: "actioned", action, moderatedBy: moderatorId, moderatedAt: now })
    .where(
      and(
        eq(abuseReports.contentType, report.contentType),
        eq(abuseReports.contentId, report.contentId),
        eq(abuseReports.status, "open"),
      ),
    );

  const refreshed = await loadTarget(report.contentType as ReportTarget["contentType"], report.contentId, false);
  return {
    changed,
    reportStatus: report.status === "open" ? "actioned" : report.status,
    contentStatus: refreshed?.moderationStatus ?? null,
    action,
  };
}
