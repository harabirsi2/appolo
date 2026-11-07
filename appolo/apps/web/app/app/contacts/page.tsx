import Link from "next/link";
import { can } from "@appolo/core";
import { Badge, Button, Card, CardTitle, EmptyState, Field, Input } from "@appolo/ui";
import { requireSession } from "@/lib/session";
import { listContacts } from "@/lib/services/contacts";
import { createContactAction, importContactsAction } from "@/lib/actions";

export const metadata = { title: "Contacts" };

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; error?: string; ok?: string }>;
}) {
  const session = await requireSession();
  const { q, error, ok } = await searchParams;

  const contacts = await listContacts(session.org.id, { query: q, limit: 100 });
  const canWrite = can(session.membership.role, "contacts:write");
  const canExport = can(session.membership.role, "contacts:export");

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="mt-1 text-sm text-muted">
            One profile per customer, with every channel and its consent state in one place.
          </p>
        </div>
        {canExport ? (
          <a
            href="/api/contacts/export"
            className="inline-flex h-10 items-center rounded-lg border border-border bg-surface-2 px-4 text-sm text-ink hover:border-border-strong"
          >
            Export CSV
          </a>
        ) : null}
      </div>

      {error ? (
        <p className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
      ) : null}
      {ok ? (
        <p className="mb-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{ok}</p>
      ) : null}

      <Card className="mb-4 p-3">
        <form method="get" className="flex gap-2">
          <Input name="q" defaultValue={q ?? ""} placeholder="Search by name, company, phone, or email..." />
          <Button type="submit" variant="secondary">Search</Button>
          {q ? (
            <Link
              href="/app/contacts"
              className="inline-flex h-10 items-center rounded-lg px-3 text-sm text-muted hover:text-ink"
            >
              Clear
            </Link>
          ) : null}
        </form>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardTitle action={<Badge>{contacts.length} shown</Badge>}>People</CardTitle>

          {contacts.length === 0 ? (
            <EmptyState
              title="No contacts yet"
              body="Add someone by hand or import a CSV. Inbound SMS and web chat also create contacts automatically."
            />
          ) : (
            <ul className="divide-y divide-border">
              {contacts.map((contact) => {
                const primaryPhone = contact.channels.find((c) => c.kind === "phone");
                const primaryEmail = contact.channels.find((c) => c.kind === "email");
                return (
                  <li key={contact.id} className="py-3 first:pt-0 last:pb-0">
                    <Link href={`/app/contacts/${contact.id}`} className="block hover:opacity-90">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {contact.name ?? primaryPhone?.value ?? primaryEmail?.value ?? "Unnamed contact"}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted-2">
                            {[primaryPhone?.value, primaryEmail?.value, contact.company]
                              .filter(Boolean)
                              .join(" · ") || "No details on file"}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-1">
                          {contact.tags.slice(0, 3).map((tag) => (
                            <Badge key={tag} tone="brand">{tag}</Badge>
                          ))}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardTitle>Add a contact</CardTitle>
            {canWrite ? (
              <form action={createContactAction} className="space-y-4">
                <Field label="Name">
                  <Input name="name" placeholder="Jordan Lee" />
                </Field>
                <Field label="Phone">
                  <Input name="phone" placeholder="+1 555 555 0100" />
                </Field>
                <Field label="Email">
                  <Input name="email" type="email" placeholder="jordan@example.com" />
                </Field>
                <Field label="Company">
                  <Input name="company" placeholder="Acme Corp" />
                </Field>
                <Field label="Tags" hint="Separate with commas.">
                  <Input name="tags" placeholder="vip, repeat" />
                </Field>
                <Button type="submit" className="w-full">Create contact</Button>
              </form>
            ) : (
              <p className="text-sm text-muted">
                Your role ({session.membership.role}) cannot create contacts.
              </p>
            )}
          </Card>

          <Card>
            <CardTitle>Import CSV</CardTitle>
            {canWrite ? (
              <form action={importContactsAction} className="space-y-4">
                <Field label="CSV file" hint="Headers: name, phone, email, company, tags.">
                  <input
                    type="file"
                    name="file"
                    accept=".csv,text/csv"
                    required
                    className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface-2 file:px-3 file:py-2 file:text-sm file:text-ink"
                  />
                </Field>
                <Button type="submit" variant="secondary" className="w-full">Import contacts</Button>
                <p className="text-xs text-muted-2">
                  Duplicate phone numbers and emails are skipped automatically.
                </p>
              </form>
            ) : (
              <p className="text-sm text-muted">Your role cannot import contacts.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
