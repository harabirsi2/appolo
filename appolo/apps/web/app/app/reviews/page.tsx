import { Badge, Button, Card, CardTitle, EmptyState, Field, Input, Select, Stat, Stars, Textarea } from "@appolo/ui";
import { can, replyTones, reviewPlatformKinds } from "@appolo/core";
import { requireSession } from "@/lib/session";
import { withOrg, schema } from "@/lib/db";
import {
  ensureReviewWidget,
  getLandingBranding,
  getReviewSettings,
  listContactOptions,
  listPrivateFeedback,
  listReviewPlatforms,
  listReviewRequests,
  listReviews,
  listReviewTemplates,
  reviewStats,
} from "@/lib/services/reviews";
import { listMembers } from "@/lib/services/messaging";
import { isGoogleConfigured } from "@/lib/services/review-platforms";
import {
  assignReviewAction,
  bulkReviewRequestAction,
  createReviewTemplateAction,
  deleteReviewTemplateAction,
  draftReviewReplyAction,
  flagReviewAction,
  publishReviewReplyAction,
  replyToReviewAction,
  runFollowUpsAction,
  sendReviewRequestAction,
  syncReviewsAction,
  updateBrandingAction,
  updateReviewSettingsAction,
  updateWidgetAction,
} from "@/lib/actions";

const { locations } = schema;

export const metadata = { title: "Reviews" };
export const dynamic = "force-dynamic";

const REVIEW_FILTERS = [
  "platformKind",
  "rating",
  "replyStatus",
  "assignedTo",
  "flagged",
  "q",
] as const;

const STATUS_TONES: Record<string, "neutral" | "brand" | "success" | "warn" | "danger"> = {
  queued: "neutral",
  sent: "brand",
  clicked: "warn",
  reviewed: "success",
  declined: "danger",
  opted_out: "danger",
  failed: "danger",
};

function formatDate(value: Date | string | null): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    ok?: string;
    platformKind?: string;
    rating?: string;
    replyStatus?: string;
    assignedTo?: string;
    flagged?: string;
    q?: string;
  }>;
}) {
  const session = await requireSession();
  const { error, ok, ...filterParams } = await searchParams;
  const orgId = session.org.id;

  const [stats, requests, reviews, feedback, templates, platforms, contacts, settings, branding, locationRows, members, widget] =
    await Promise.all([
      reviewStats(orgId),
      listReviewRequests(orgId, { limit: 25 }),
      listReviews(orgId, {
        limit: 25,
        platformKind: filterParams.platformKind || undefined,
        rating: filterParams.rating ? Number(filterParams.rating) : undefined,
        replyStatus: filterParams.replyStatus || undefined,
        assignedTo: filterParams.assignedTo || undefined,
        flagged: filterParams.flagged === "true" || undefined,
        search: filterParams.q || undefined,
      }),
      listPrivateFeedback(orgId, 15),
      listReviewTemplates(orgId),
      listReviewPlatforms(orgId),
      listContactOptions(orgId),
      getReviewSettings(orgId),
      getLandingBranding(orgId),
      withOrg(orgId, (tx) => tx.select({ id: locations.id, name: locations.name }).from(locations)),
      listMembers(orgId),
      ensureReviewWidget(orgId),
    ]);

  const canRequest = can(session.membership.role, "reviews:request");
  const canRespond = can(session.membership.role, "reviews:respond");
  const smsTemplates = templates.filter((template) => template.channel === "sms" && template.active);
  const defaultTemplate = templates.find((template) => template.isDefault && template.channel === "sms") ?? smsTemplates[0];
  const clickRate = stats.requestsSent > 0 ? Math.round((stats.clicked / stats.requestsSent) * 100) : 0;

  const activeFilterCount = REVIEW_FILTERS.filter((key) => Boolean(filterParams[key])).length;
  const baseUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const widgetSnippet = `<iframe src="${baseUrl}/embed/reviews/${widget.publicKey}" title="Customer reviews" style="width:100%;height:440px;border:0" loading="lazy"></iframe>`;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
          <p className="mt-1 text-sm text-muted">
            Ask every happy customer for a review, catch private feedback, and keep platforms in sync.
          </p>
        </div>
        {platforms.length > 0 && canRespond ? (
          <form action={syncReviewsAction}>
            <Button type="submit" variant="secondary" size="sm">Sync platforms</Button>
          </form>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
      ) : null}
      {ok ? (
        <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{ok}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Public reviews" value={stats.total} hint={`${stats.averageRating.toFixed(1)} average rating`} />
        <Stat label="Requests sent" value={stats.requestsSent} hint={`${stats.requests} total requests`} />
        <Stat label="Click-through" value={`${clickRate}%`} hint={`${stats.clicked} clicked the link`} />
        <Stat label="Private feedback" value={stats.privateFeedback} hint="Only visible to your team" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle action={<Badge>{contacts.length} contacts</Badge>}>Send a review request</CardTitle>
          {contacts.length === 0 ? (
            <EmptyState
              title="No contacts yet"
              body="Add a contact with a phone number or email first, then ask them for a review."
            />
          ) : (
            <form action={sendReviewRequestAction} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Contact">
                  <Select name="contactId" required defaultValue="">
                    <option value="" disabled>Pick a contact</option>
                    {contacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>{contact.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Channel">
                  <Select name="channel" defaultValue="sms">
                    <option value="sms">SMS</option>
                    <option value="email">Email</option>
                  </Select>
                </Field>
                <Field label="Template">
                  <Select name="templateId" defaultValue="">
                    <option value="">Auto-pick the default</option>
                    {templates.filter((template) => template.active).map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} ({template.channel})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Platform">
                  <Select name="platformKind" defaultValue="">
                    <option value="">Default platform</option>
                    {reviewPlatformKinds.map((kind) => (
                      <option key={kind} value={kind}>{kind}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Location">
                  <Select name="locationId" defaultValue="">
                    <option value="">Primary location</option>
                    {locationRows.map((loc) => (
                      <option key={loc.id} value={loc.id}>{loc.name}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Button type="submit" disabled={!canRequest}>Send request</Button>
              {!canRequest ? <p className="text-xs text-muted-2">Your role cannot send review requests.</p> : null}
            </form>
          )}
        </Card>

        <Card>
          <CardTitle>Quiet hours &amp; caps</CardTitle>
          {canRequest ? (
            <>
            <form action={updateReviewSettingsAction} className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="quietEnabled" defaultChecked={settings.quietHours.enabled} className="h-4 w-4 rounded border-border" />
                <span>Pause sends during quiet hours</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Quiet start">
                  <Input name="quietStart" defaultValue={settings.quietHours.start} placeholder="21:00" />
                </Field>
                <Field label="Quiet end">
                  <Input name="quietEnd" defaultValue={settings.quietHours.end} placeholder="08:00" />
                </Field>
                <Field label="Daily cap">
                  <Input name="dailyCap" type="number" min={0} defaultValue={settings.dailyCap} />
                </Field>
                <Field label="Cooldown (days)">
                  <Input name="cooldownDays" type="number" min={0} defaultValue={settings.cooldownDays} />
                </Field>
              </div>
              <Field label="Timezone">
                <Input name="timezone" defaultValue={settings.timezone} placeholder="America/New_York" />
              </Field>
              <Field label="Default platform">
                <Select name="defaultPlatformKind" defaultValue={settings.defaultPlatformKind}>
                  {reviewPlatformKinds.map((kind) => (
                    <option key={kind} value={kind}>{kind}</option>
                  ))}
                </Select>
              </Field>

              <div className="space-y-3 border-t border-border pt-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="followUpEnabled" defaultChecked={settings.followUp.enabled} className="h-4 w-4 rounded border-border" />
                  <span>Send follow-up reminders</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="After (days)">
                    <Input name="followUpDays" type="number" min={0} defaultValue={settings.followUp.days} />
                  </Field>
                  <Field label="Max follow-ups">
                    <Input name="followUpMax" type="number" min={0} defaultValue={settings.followUp.max} />
                  </Field>
                </div>
                <Field label="Follow-up message" hint="Same variables as templates, including {{review_link}}.">
                  <Textarea name="followUpBody" rows={3} defaultValue={settings.followUp.body} />
                </Field>
              </div>

              <Button type="submit" variant="secondary" size="sm">Save settings</Button>
            </form>
            <form action={runFollowUpsAction} className="mt-3 border-t border-border pt-3">
              <Button type="submit" variant="ghost" size="sm">Run due follow-ups</Button>
              <p className="mt-1 text-xs text-muted-2">
                Sends one reminder to requests quiet for {settings.followUp.days}+ days, up to{" "}
                {settings.followUp.max} time{settings.followUp.max === 1 ? "" : "s"}.
              </p>
            </form>
            </>
          ) : (
            <p className="text-sm text-muted">Your role cannot change review settings.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle action={<Badge>{requests.length} recent</Badge>}>Review requests</CardTitle>
          {requests.length === 0 ? (
            <p className="text-sm text-muted">No requests yet. Send your first one above.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-2">
                    <th className="pb-2 font-medium">Contact</th>
                    <th className="pb-2 font-medium">Channel</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Follow-ups</th>
                    <th className="pb-2 font-medium">Sent</th>
                    <th className="pb-2 font-medium">Clicked</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {requests.map((request) => (
                    <tr key={request.id}>
                      <td className="py-3 pr-3">{request.contactName ?? "Unknown"}</td>
                      <td className="py-3 pr-3 text-muted">{request.channel}</td>
                      <td className="py-3 pr-3">
                        <Badge tone={STATUS_TONES[request.status] ?? "neutral"}>{request.status}</Badge>
                      </td>
                      <td className="py-3 pr-3 text-muted">{request.followUpCount}</td>
                      <td className="py-3 pr-3 text-muted">{formatDate(request.sentAt)}</td>
                      <td className="py-3 text-muted">{formatDate(request.clickedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canRequest && contacts.length > 1 ? (
            <details className="mt-4 border-t border-border pt-4">
              <summary className="cursor-pointer text-sm font-medium text-muted">Bulk request</summary>
              <form action={bulkReviewRequestAction} className="mt-3 space-y-3">
                <Field label="Contacts" hint="Ctrl/Cmd-click to select more than one.">
                  <select
                    name="contactIds"
                    multiple
                    size={5}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  >
                    {contacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>{contact.name}</option>
                    ))}
                  </select>
                </Field>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Channel">
                    <Select name="channel" defaultValue="sms">
                      <option value="sms">SMS</option>
                      <option value="email">Email</option>
                    </Select>
                  </Field>
                  <Field label="Template">
                    <Select name="templateId" defaultValue="">
                      <option value="">Auto-pick</option>
                      {templates.filter((template) => template.active).map((template) => (
                        <option key={template.id} value={template.id}>{template.name}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Platform">
                    <Select name="platformKind" defaultValue="">
                      <option value="">Default</option>
                      {reviewPlatformKinds.map((kind) => (
                        <option key={kind} value={kind}>{kind}</option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Button type="submit" variant="secondary" size="sm">Send bulk requests</Button>
              </form>
            </details>
          ) : null}
        </Card>

        <Card>
          <CardTitle action={<Badge>{platforms.length} connected</Badge>}>Platforms</CardTitle>
          {platforms.length === 0 ? (
            <p className="text-sm text-muted">
              No platforms configured. Seed or connect Google Business Profile to sync public reviews.
            </p>
          ) : (
            <ul className="space-y-3">
              {platforms.map((platform) => (
                <li key={platform.id} className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{platform.displayName}</p>
                    <p className="text-xs text-muted-2">{platform.kind}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={platform.kind === "google" && !isGoogleConfigured() ? "warn" : "success"}>
                      {platform.kind === "google" && !isGoogleConfigured() ? "token needed" : "ready"}
                    </Badge>
                    {canRespond ? (
                      <form action={syncReviewsAction}>
                        <input type="hidden" name="platformId" value={platform.id} />
                        <Button type="submit" variant="ghost" size="sm">Sync</Button>
                      </form>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-2">
            Google uses the documented Business Profile API with <span className="font-mono">GOOGLE_BUSINESS_ACCESS_TOKEN</span>.
            Other platforms use the built-in demo adapter until connected.
          </p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle action={<Badge>{templates.length} templates</Badge>}>Request templates</CardTitle>
          <ul className="divide-y divide-border">
            {templates.map((template) => (
              <li key={template.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{template.name}</p>
                  <Badge tone="neutral">{template.channel}</Badge>
                  {template.isDefault ? <Badge tone="brand">default</Badge> : null}
                  {canRequest ? (
                    <form action={deleteReviewTemplateAction} className="ml-auto">
                      <input type="hidden" name="templateId" value={template.id} />
                      <Button type="submit" variant="ghost" size="sm">Delete</Button>
                    </form>
                  ) : null}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted">{template.body}</p>
              </li>
            ))}
            {templates.length === 0 ? (
              <li className="py-2 text-sm text-muted">No templates yet — create one below.</li>
            ) : null}
          </ul>

          {canRequest ? (
            <details className="mt-4 border-t border-border pt-4">
              <summary className="cursor-pointer text-sm font-medium text-muted">New template</summary>
              <form action={createReviewTemplateAction} className="mt-3 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name">
                    <Input name="name" placeholder="Post-visit SMS" required />
                  </Field>
                  <Field label="Channel">
                    <Select name="channel" defaultValue="sms">
                      <option value="sms">SMS</option>
                      <option value="email">Email</option>
                    </Select>
                  </Field>
                </div>
                <Field label="Subject" hint="Email only.">
                  <Input name="subject" placeholder="How was your visit?" />
                </Field>
                <Field label="Body" hint="Use {{first_name}}, {{business_name}}, and {{review_link}}.">
                  <Textarea
                    name="body"
                    rows={3}
                    defaultValue={defaultTemplate?.body ?? "Hi {{first_name}}, thanks for visiting {{business_name}}! A quick review would mean a lot: {{review_link}}"}
                    required
                  />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="isDefault" className="h-4 w-4 rounded border-border" />
                  <span>Make this the default for its channel</span>
                </label>
                <Button type="submit" variant="secondary" size="sm">Create template</Button>
              </form>
            </details>
          ) : null}
        </Card>

        <Card>
          <CardTitle action={<Badge tone="warn">{feedback.length} new</Badge>}>Private feedback</CardTitle>
          {feedback.length === 0 ? (
            <p className="text-sm text-muted">No private feedback yet. It never blocks the public review link.</p>
          ) : (
            <ul className="divide-y divide-border">
              {feedback.map((item) => (
                <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{item.contactName ?? "Anonymous"}</p>
                    <div className="flex items-center gap-2">
                      {item.rating ? <Stars rating={item.rating} /> : null}
                      <span className="text-xs text-muted-2">{formatDate(item.createdAt)}</span>
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-muted">{item.body}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle action={<Badge tone="brand">{branding.accentColor}</Badge>}>Landing page branding</CardTitle>
        {canRequest ? (
          <form action={updateBrandingAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Logo URL" hint="Shown above the review prompt.">
              <Input name="logoUrl" defaultValue={branding.logoUrl ?? ""} placeholder="https://example.com/logo.png" />
            </Field>
            <Field label="Accent colour">
              <Input
                name="accentColor"
                type="color"
                defaultValue={branding.accentColor}
                className="h-10 w-full cursor-pointer p-1"
              />
            </Field>
            <Field label="Tagline">
              <Input name="tagline" defaultValue={branding.tagline ?? ""} placeholder="Friendly care, every visit." />
            </Field>
            <Field label="Support email">
              <Input name="supportEmail" type="email" defaultValue={branding.supportEmail ?? ""} placeholder="hello@business.com" />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" variant="secondary" size="sm">Save branding</Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted">Your role cannot change branding.</p>
        )}
        <p className="mt-3 text-xs text-muted-2">
          Applies to every <span className="font-mono">/r/[token]</span> review page. Clear a field to use the default.
        </p>
      </Card>

      <Card>
        <CardTitle
          action={
            <div className="flex items-center gap-2">
              {activeFilterCount > 0 ? <Badge tone="brand">{activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"}</Badge> : null}
              <Badge>{reviews.length} shown</Badge>
            </div>
          }
        >
          Review inbox
        </CardTitle>

        <form method="get" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Search">
            <Input name="q" defaultValue={filterParams.q ?? ""} placeholder="Author or text" />
          </Field>
          <Field label="Platform">
            <Select name="platformKind" defaultValue={filterParams.platformKind ?? ""}>
              <option value="">All</option>
              {reviewPlatformKinds.map((kind) => (
                <option key={kind} value={kind}>{kind}</option>
              ))}
            </Select>
          </Field>
          <Field label="Rating">
            <Select name="rating" defaultValue={filterParams.rating ?? ""}>
              <option value="">All</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>{n} star{n === 1 ? "" : "s"}</option>
              ))}
            </Select>
          </Field>
          <Field label="Reply">
            <Select name="replyStatus" defaultValue={filterParams.replyStatus ?? ""}>
              <option value="">All</option>
              <option value="none">Needs a reply</option>
              <option value="draft">Draft saved</option>
              <option value="posted">Replied</option>
            </Select>
          </Field>
          <Field label="Assignee">
            <Select name="assignedTo" defaultValue={filterParams.assignedTo ?? ""}>
              <option value="">Anyone</option>
              <option value="unassigned">Unassigned</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>{member.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Flagged">
            <Select name="flagged" defaultValue={filterParams.flagged ?? ""}>
              <option value="">Any</option>
              <option value="true">Flagged only</option>
            </Select>
          </Field>
          <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-6">
            <Button type="submit" size="sm">Apply filters</Button>
            <a href="/app/reviews" className="text-xs text-muted hover:text-ink">Reset</a>
          </div>
        </form>

        {reviews.length === 0 ? (
          <EmptyState
            title={activeFilterCount > 0 ? "No reviews match those filters" : "No public reviews synced yet"}
            body={
              activeFilterCount > 0
                ? "Reset the filters or widen your search."
                : "Connect a platform and sync, or let incoming requests convert into reviews. The demo adapter imports two sample reviews."
            }
            action={canRespond && activeFilterCount === 0 ? (
              <form action={syncReviewsAction}>
                <Button type="submit" size="sm">Sync now</Button>
              </form>
            ) : undefined}
          />
        ) : (
          <ul className="divide-y divide-border">
            {reviews.map((review) => (
              <li key={review.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Stars rating={review.rating} />
                  <p className="text-sm font-medium">{review.authorName ?? "Anonymous"}</p>
                  <Badge tone="neutral">{review.platformName ?? review.platformKind ?? "review"}</Badge>
                  {review.flagged ? <Badge tone="danger">flagged</Badge> : null}
                  {review.assigneeName ? <Badge tone="brand">{review.assigneeName}</Badge> : null}
                  <span className="ml-auto text-xs text-muted-2">{formatDate(review.reviewedAt)}</span>
                  <Badge tone={review.replyStatus === "posted" ? "success" : review.replyStatus === "draft" ? "warn" : "neutral"}>
                    {review.replyStatus === "posted" ? "replied" : review.replyStatus === "draft" ? "draft" : "unanswered"}
                  </Badge>
                </div>

                {review.reply ? (
                  <div className="mt-2 rounded-lg border border-border bg-surface-2 p-3">
                    <p className="text-xs font-medium text-muted-2">
                      {review.reply.status === "posted" ? "Posted reply" : "Draft reply"}
                      {review.reply.aiGenerated ? " · AI-assisted" : ""}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{review.reply.body}</p>
                  </div>
                ) : null}
                {review.body ? <p className="mt-1 text-sm text-muted">{review.body}</p> : null}
{canRespond ? (
                  <div className="mt-2 space-y-2">
                    <form action={replyToReviewAction} className="flex flex-col gap-2 sm:flex-row">
                      <input type="hidden" name="reviewId" value={review.id} />
                      <Input name="body" placeholder="Write a reply" required />
                      <Button type="submit" variant="secondary" size="sm">Save draft</Button>
                    </form>
                    <div className="flex flex-wrap items-center gap-2">
                      <form action={draftReviewReplyAction} className="flex items-center gap-2">
                        <input type="hidden" name="reviewId" value={review.id} />
                        <Select name="tone" defaultValue="friendly" className="h-8 w-32 text-xs">
                          {replyTones.map((tone) => (
                            <option key={tone} value={tone}>{tone}</option>
                          ))}
                        </Select>
                        <Button type="submit" variant="ghost" size="sm">AI draft</Button>
                      </form>
                      {review.reply && review.reply.status !== "posted" ? (
                        <form action={publishReviewReplyAction}>
                          <input type="hidden" name="reviewId" value={review.id} />
                          <Button type="submit" size="sm">Publish reply</Button>
                        </form>
                      ) : null}
                      <form action={assignReviewAction} className="flex items-center gap-2">
                        <input type="hidden" name="reviewId" value={review.id} />
                        <Select name="assignedTo" defaultValue={review.assignedTo ?? "unassigned"} className="h-8 w-40 text-xs">
                          <option value="unassigned">Unassigned</option>
                          {members.map((member) => (
                            <option key={member.userId} value={member.userId}>{member.name}</option>
                          ))}
                        </Select>
                        <Button type="submit" variant="ghost" size="sm">Assign</Button>
                      </form>
                      <form action={flagReviewAction}>
                        <input type="hidden" name="reviewId" value={review.id} />
                        <input type="hidden" name="flagged" value={review.flagged ? "" : "on"} />
                        <Button type="submit" variant="ghost" size="sm">{review.flagged ? "Unflag" : "Flag"}</Button>
                      </form>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
)}

        <div className="mt-4 flex justify-end border-t border-border pt-4">
          <a
            href="/api/reviews/export"
            className="inline-flex h-8 items-center rounded-lg border border-border bg-surface-2 px-3 text-xs text-ink hover:border-border-strong"
          >
            Export CSV
          </a>
        </div>
      </Card>

      <Card>
        <CardTitle action={<Badge tone="brand">embed</Badge>}>Review widget</CardTitle>
        <p className="text-sm text-muted">
          Show your best {widget.config.minRating}+ star reviews on any website. Paste this snippet before{" "}
          <span className="font-mono">&lt;/body&gt;</span>.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted">
          {widgetSnippet}
        </pre>
        <p className="mt-2 text-xs text-muted-2">
          Public data: <span className="font-mono">/api/public/widgets/{widget.publicKey}</span>
        </p>

        {canRequest ? (
          <form action={updateWidgetAction} className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
            <Field label="Headline">
              <Input name="headline" defaultValue={widget.config.headline} />
            </Field>
            <Field label="Theme">
              <Select name="theme" defaultValue={widget.config.theme}>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </Select>
            </Field>
            <Field label="Layout">
              <Select name="layout" defaultValue={widget.config.layout}>
                <option value="list">List</option>
                <option value="carousel">Carousel</option>
                <option value="badge">Badge</option>
              </Select>
            </Field>
            <Field label="Minimum rating">
              <Select name="minRating" defaultValue={String(widget.config.minRating)}>
                {[3, 4, 5].map((n) => (
                  <option key={n} value={n}>{n}+ stars</option>
                ))}
              </Select>
            </Field>
            <Field label="How many reviews">
              <Input name="limit" type="number" min={1} max={20} defaultValue={widget.config.limit} />
            </Field>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" name="showRating" defaultChecked={widget.config.showRating} className="h-4 w-4 rounded border-border" />
              <span>Show the average rating</span>
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" variant="secondary" size="sm">Save widget</Button>
            </div>
          </form>
        ) : null}
      </Card>
    </div>
  );
}