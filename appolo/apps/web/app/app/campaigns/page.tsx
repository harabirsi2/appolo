import { can } from "@appolo/core";
import { Badge, Button, Card, CardTitle, EmptyState, Field, Input, Select, Textarea } from "@appolo/ui";
import { requireSession } from "@/lib/session";
import { listCampaigns, segmentContacts } from "@/lib/services/campaigns";
import { getReviewSettings } from "@/lib/services/reviews";
import { createCampaignAction, deleteCampaignAction, sendCampaignAction } from "@/lib/actions";

export const metadata = { title: "Campaigns" };
export const dynamic = "force-dynamic";

const STATUS_TONES: Record<string, "neutral" | "brand" | "success" | "warn" | "danger"> = {
  draft: "neutral",
  sending: "warn",
  sent: "success",
  failed: "danger",
};

function formatDate(value: Date | string | null): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const session = await requireSession();
  const { error, ok } = await searchParams;

  const [campaigns, contacts, settings] = await Promise.all([
    listCampaigns(session.org.id),
    segmentContacts(session.org.id),
    getReviewSettings(session.org.id),
  ]);

  const canSend = can(session.membership.role, "messages:send");
  const tagOptions = [...new Set(contacts.flatMap((contact) => contact.tags))].sort();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        <p className="mt-1 text-sm text-muted">
          Send one broadcast to a segment. Each recipient is checked for consent, and sends pause during quiet hours.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
      ) : null}
      {ok ? (
        <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{ok}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-2">Contacts</p>
          <p className="mt-2 text-2xl font-semibold">{contacts.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-2">Daily cap</p>
          <p className="mt-2 text-2xl font-semibold">{settings.dailyCap > 0 ? settings.dailyCap : "Unlimited"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-2">Quiet hours</p>
          <p className="mt-2 text-sm font-medium">
            {settings.quietHours.enabled ? `${settings.quietHours.start} – ${settings.quietHours.end}` : "Off"}
          </p>
          <p className="mt-1 text-xs text-muted-2">{settings.timezone}</p>
        </Card>
      </div>

      <Card>
        <CardTitle action={<Badge>{campaigns.length} total</Badge>}>Broadcasts</CardTitle>
        {campaigns.length === 0 ? (
          <EmptyState
            title="No campaigns yet"
            body="Create a broadcast below to reach a segment of your contacts in one go."
          />
        ) : (
          <ul className="divide-y divide-border">
            {campaigns.map((campaign) => (
              <li key={campaign.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{campaign.name}</p>
                  <Badge tone={STATUS_TONES[campaign.status] ?? "neutral"}>{campaign.status}</Badge>
                  <Badge tone="brand">{campaign.channel}</Badge>
                  <span className="ml-auto text-xs text-muted-2">{formatDate(campaign.createdAt)}</span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {campaign.total} recipient{campaign.total === 1 ? "" : "s"} · {campaign.sent} sent · {campaign.skipped} skipped ·{" "}
                  {campaign.failed} failed · {campaign.pending} pending
                </p>
                {canSend ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {campaign.status === "draft" ? (
                      <form action={sendCampaignAction}>
                        <input type="hidden" name="campaignId" value={campaign.id} />
                        <Button type="submit" size="sm">Send now</Button>
                      </form>
                    ) : null}
                    <form action={deleteCampaignAction}>
                      <input type="hidden" name="campaignId" value={campaign.id} />
                      <Button type="submit" variant="ghost" size="sm">Delete</Button>
                    </form>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canSend ? (
        <Card>
          <CardTitle>New campaign</CardTitle>
          <form action={createCampaignAction} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <Input name="name" placeholder="Spring promotion" required />
              </Field>
              <Field label="Channel">
                <Select name="channel" defaultValue="sms">
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                </Select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Segment">
                <Select name="segment" defaultValue="all">
                  <option value="all">All contacts</option>
                  <option value="tag">Contacts with a tag</option>
                </Select>
              </Field>
              <Field label="Tag" hint={tagOptions.length > 0 ? `Try: ${tagOptions.join(", ")}` : "No tags yet."}>
                <Input name="tag" placeholder="vip" />
              </Field>
            </div>
            <Field label="Subject" hint="Email only.">
              <Input name="subject" placeholder="A little something for you" />
            </Field>
            <Field label="Message" hint="Use {{first_name}} and {{business_name}}. Recipients without consent are skipped.">
              <Textarea
                name="body"
                rows={3}
                placeholder="Hi {{first_name}}, thanks for being a customer of {{business_name}}!"
                required
              />
            </Field>
            <Button type="submit">Queue campaign</Button>
          </form>
        </Card>
      ) : (
        <p className="text-sm text-muted">Your role cannot send campaigns.</p>
      )}
    </div>
  );
}