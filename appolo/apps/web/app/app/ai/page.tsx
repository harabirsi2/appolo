import { can } from "@appolo/core";
import { Badge, Button, Card, CardTitle, EmptyState, Field, Input, Stat, Textarea } from "@appolo/ui";
import { requireSession } from "@/lib/session";
import { aiStats, ensureAiAgent, listKnowledgeDocs } from "@/lib/services/ai-employee";
import {
  createKnowledgeDocAction,
  deleteKnowledgeDocAction,
  updateAiAgentAction,
} from "@/lib/actions";

export const metadata = { title: "AI Employee" };
export const dynamic = "force-dynamic";

export default async function AiPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const session = await requireSession();
  const { error, ok } = await searchParams;

  const [agent, docs, stats] = await Promise.all([
    ensureAiAgent(session.org.id),
    listKnowledgeDocs(session.org.id),
    aiStats(session.org.id),
  ]);
  const canManage = can(session.membership.role, "ai:manage");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Employee</h1>
          <p className="mt-1 text-sm text-muted">
            Answers inbound texts from your knowledge base, and escalates to a human whenever it is not confident.
          </p>
        </div>
        <Badge tone={agent.config.enabled ? "success" : "neutral"}>
          {agent.config.enabled ? "enabled" : "paused"}
        </Badge>
      </div>

      {error ? (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
      ) : null}
      {ok ? (
        <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{ok}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="AI conversations" value={stats.conversations} hint="Threads the AI joined" />
        <Stat label="AI replies" value={stats.replies} hint="Grounded answers sent" />
        <Stat label="Handoffs" value={stats.handoffs} hint="Escalated to a human" />
      </div>

      <Card>
        <CardTitle action={<Badge tone="brand">{agent.name}</Badge>}>Guardrails</CardTitle>
        {canManage ? (
          <form action={updateAiAgentAction} className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={agent.config.enabled}
                className="h-4 w-4 rounded border-border"
              />
              <span>Enable the AI employee on inbound messages</span>
            </label>

            <Field label="Greeting" hint="Prepended to every answer.">
              <Input name="greeting" defaultValue={agent.config.greeting} placeholder="Thanks for reaching out!" />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Escalation keywords" hint="Comma separated. Any match hands off to a human.">
                <Input name="escalationKeywords" defaultValue={agent.config.escalationKeywords.join(", ")} />
              </Field>
              <Field label="Blocked topics" hint="Comma separated. Never answered automatically.">
                <Input name="blockedTopics" defaultValue={agent.config.blockedTopics.join(", ")} />
              </Field>
            </div>

            <Field label="Confidence threshold" hint="0 to 1. Higher means the AI escalates more often.">
              <Input
                name="confidenceThreshold"
                type="number"
                min={0}
                max={1}
                step={0.05}
                defaultValue={agent.config.confidenceThreshold}
              />
            </Field>

            <Button type="submit">Save AI employee</Button>
          </form>
        ) : (
          <p className="text-sm text-muted">Your role cannot manage the AI employee.</p>
        )}
      </Card>

      <Card>
        <CardTitle action={<Badge>{docs.length} article{docs.length === 1 ? "" : "s"}</Badge>}>Knowledge base</CardTitle>
        <p className="text-sm text-muted">
          The AI only answers from these articles. Add your hours, services, pricing, and policies.
        </p>

        {docs.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No knowledge yet"
              body="Without articles the AI escalates every message to a human. Add one below to get started."
            />
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {docs.map((doc) => (
              <li key={doc.id} className="py-3 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{doc.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted">{doc.content}</p>
                  </div>
                  {canManage ? (
                    <form action={deleteKnowledgeDocAction}>
                      <input type="hidden" name="docId" value={doc.id} />
                      <Button type="submit" variant="ghost" size="sm">Delete</Button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canManage ? (
          <form action={createKnowledgeDocAction} className="mt-4 space-y-3 border-t border-border pt-4">
            <Field label="Title">
              <Input name="title" placeholder="Business hours" required />
            </Field>
            <Field label="Content" hint="Plain text. Short, factual answers work best.">
              <Textarea
                name="content"
                rows={4}
                placeholder="We are open Monday to Friday, 9am to 6pm, and Saturday 10am to 4pm."
                required
              />
            </Field>
            <Button type="submit" variant="secondary" size="sm">Add article</Button>
          </form>
        ) : null}
      </Card>

      <p className="text-xs text-muted-2">
        Guardrails are applied before any answer is sent, so escalation behaviour never depends on a model provider.
        Answers require a confident knowledge match; everything else becomes a human handoff with an internal note.
      </p>
    </div>
  );
}
