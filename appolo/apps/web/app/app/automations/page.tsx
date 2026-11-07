import { can } from "@appolo/core";
import { Badge, Button, Card, CardTitle, EmptyState, Field, Input, Select, Textarea } from "@appolo/ui";
import { requireSession } from "@/lib/session";
import { listAutomations } from "@/lib/services/automations";
import {
  createAutomationAction,
  deleteAutomationAction,
  toggleAutomationAction,
  updateAutomationAction,
} from "@/lib/actions";

export const metadata = { title: "Automations" };
export const dynamic = "force-dynamic";

interface Conditions {
  keywords?: string[];
  matchType?: "contains" | "exact";
  channels?: string[];
}

function conditionsOf(raw: unknown): Conditions {
  return (raw ?? {}) as Conditions;
}

function replyBodyOf(steps: { kind: string; config: unknown }[]): string {
  const step = steps.find((s) => s.kind === "auto_reply");
  const body = (step?.config as { body?: unknown } | undefined)?.body;
  return typeof body === "string" ? body : "";
}

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const session = await requireSession();
  const { error, ok } = await searchParams;
  const automations = await listAutomations(session.org.id);
  const canManage = can(session.membership.role, "automations:manage");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Automations</h1>
        <p className="mt-1 text-sm text-muted">
          Reply instantly when customers text a keyword like <span className="font-mono">hours</span> or{" "}
          <span className="font-mono">pricing</span>. Every reply still respects consent and STOP.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
      ) : null}
      {ok ? (
        <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{ok}</p>
      ) : null}

      <Card>
        <CardTitle action={<Badge>{automations.length} total</Badge>}>Keyword automations</CardTitle>
        {automations.length === 0 ? (
          <EmptyState
            title="No automations yet"
            body="Create one below to answer common questions around the clock without a human in the loop."
          />
        ) : (
          <ul className="divide-y divide-border">
            {automations.map((automation) => {
              const conditions = conditionsOf(automation.conditions);
              const keywords = conditions.keywords ?? [];
              const reply = replyBodyOf(automation.steps);
              return (
                <li key={automation.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{automation.name}</p>
                    <Badge tone={automation.enabled ? "success" : "neutral"}>
                      {automation.enabled ? "enabled" : "paused"}
                    </Badge>
                    <Badge tone="brand">{automation.trigger}</Badge>
                    <Badge tone="neutral">{conditions.matchType ?? "contains"}</Badge>
                    <div className="ml-auto flex items-center gap-2">
                      {canManage ? (
                        <>
                          <form action={toggleAutomationAction}>
                            <input type="hidden" name="automationId" value={automation.id} />
                            <input type="hidden" name="enabled" value={automation.enabled ? "" : "on"} />
                            <Button type="submit" variant="ghost" size="sm">
                              {automation.enabled ? "Pause" : "Enable"}
                            </Button>
                          </form>
                          <form action={deleteAutomationAction}>
                            <input type="hidden" name="automationId" value={automation.id} />
                            <Button type="submit" variant="ghost" size="sm">Delete</Button>
                          </form>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {keywords.map((keyword) => (
                      <Badge key={keyword} tone="neutral">{keyword}</Badge>
                    ))}
                    {(conditions.channels ?? []).map((channel) => (
                      <Badge key={channel} tone="brand">{channel}</Badge>
                    ))}
                  </div>
                  {reply ? (
                    <p className="mt-2 rounded-lg border border-border bg-surface-2 p-3 text-sm text-muted">{reply}</p>
                  ) : null}

                  {canManage ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-medium text-muted hover:text-ink">Edit</summary>
                      <form action={updateAutomationAction} className="mt-3 space-y-3">
                        <input type="hidden" name="automationId" value={automation.id} />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="Name">
                            <Input name="name" defaultValue={automation.name} required />
                          </Field>
                          <Field label="Trigger">
                            <Select name="trigger" defaultValue={automation.trigger}>
                              <option value="keyword">Keyword</option>
                              <option value="new_contact">New contact</option>
                              <option value="review_received">Review received</option>
                            </Select>
                          </Field>
                        </div>
                        <Field label="Keywords" hint="Comma separated, case-insensitive.">
                          <Input name="keywords" defaultValue={keywords.join(", ")} />
                        </Field>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="Match">
                            <Select name="matchType" defaultValue={conditions.matchType ?? "contains"}>
                              <option value="contains">Contains</option>
                              <option value="exact">Exact message</option>
                            </Select>
                          </Field>
                          <Field label="Channels" hint="Leave all unchecked for every channel.">
                            <div className="flex flex-wrap gap-3 pt-2 text-sm">
                              {["sms", "email", "webchat"].map((channel) => (
                                <label key={channel} className="flex items-center gap-1.5">
                                  <input
                                    type="checkbox"
                                    name="channels"
                                    value={channel}
                                    defaultChecked={(conditions.channels ?? []).includes(channel)}
                                    className="h-4 w-4 rounded border-border"
                                  />
                                  <span>{channel}</span>
                                </label>
                              ))}
                            </div>
                          </Field>
                        </div>
                        <Field label="Auto-reply" hint="Use {{first_name}} and {{business_name}}.">
                          <Textarea name="replyBody" rows={3} defaultValue={reply} required />
                        </Field>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" name="enabled" defaultChecked={automation.enabled} className="h-4 w-4 rounded border-border" />
                          <span>Enabled</span>
                        </label>
                        <Button type="submit" variant="secondary" size="sm">Save automation</Button>
                      </form>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {canManage ? (
        <Card>
          <CardTitle>New automation</CardTitle>
          <form action={createAutomationAction} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <Input name="name" placeholder="Hours question" required />
              </Field>
              <Field label="Trigger">
                <Select name="trigger" defaultValue="keyword">
                  <option value="keyword">Keyword</option>
                  <option value="new_contact">New contact</option>
                  <option value="review_received">Review received</option>
                </Select>
              </Field>
            </div>
            <Field label="Keywords" hint="Comma separated, e.g. hours, open, closing.">
              <Input name="keywords" placeholder="hours, open, closing" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Match">
                <Select name="matchType" defaultValue="contains">
                  <option value="contains">Contains</option>
                  <option value="exact">Exact message</option>
                </Select>
              </Field>
              <Field label="Channels" hint="Leave all unchecked for every channel.">
                <div className="flex flex-wrap gap-3 pt-2 text-sm">
                  {["sms", "email", "webchat"].map((channel) => (
                    <label key={channel} className="flex items-center gap-1.5">
                      <input type="checkbox" name="channels" value={channel} className="h-4 w-4 rounded border-border" />
                      <span>{channel}</span>
                    </label>
                  ))}
                </div>
              </Field>
            </div>
            <Field label="Auto-reply" hint="Use {{first_name}} and {{business_name}}.">
              <Textarea
                name="replyBody"
                rows={3}
                placeholder="Hi {{first_name}}, we're open Mon-Fri 9-5. Reply here if we can help!"
                required
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="enabled" className="h-4 w-4 rounded border-border" />
              <span>Enable immediately</span>
            </label>
            <Button type="submit">Create automation</Button>
          </form>
        </Card>
      ) : (
        <p className="text-sm text-muted">Your role cannot manage automations.</p>
      )}
    </div>
  );
}