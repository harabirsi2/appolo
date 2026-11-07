import { Badge, Button, Card, CardTitle, Field, Input, Select } from "@appolo/ui";
import { requireSession } from "@/lib/session";
import { withOrg, schema } from "@/lib/db";
import { createLocationAction } from "@/lib/actions";
import { can } from "@appolo/core";

const { locations } = schema;

export const metadata = { title: "Locations" };

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Australia/Sydney",
];

export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const session = await requireSession();
  const { error, ok } = await searchParams;

  const rows = await withOrg(session.org.id, (tx) =>
    tx.select().from(locations).orderBy(locations.createdAt),
  );

  const canManage = can(session.membership.role, "locations:manage");

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Locations</h1>
        <p className="mt-1 text-sm text-muted">
          Each location has its own hours, review links, and (later) phone number and AI playbook.
        </p>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
      ) : null}
      {ok ? (
        <p className="mb-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          Location created.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardTitle action={<Badge>{rows.length} total</Badge>}>Your locations</CardTitle>

          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No locations yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((loc) => (
                <li key={loc.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{loc.name}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-2">
                        {loc.address ?? "No address"} · {loc.timezone}
                      </p>
                      {loc.phone ? <p className="mt-0.5 text-xs text-muted-2">{loc.phone}</p> : null}
                    </div>
                    <Badge tone={loc.gbpAccountId ? "success" : "neutral"}>
                      {loc.gbpAccountId ? "GBP linked" : "GBP not linked"}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Add a location</CardTitle>

          {canManage ? (
            <form action={createLocationAction} className="space-y-4">
              <Field label="Name">
                <Input name="name" required placeholder="Downtown" />
              </Field>
              <Field label="Address">
                <Input name="address" placeholder="44 Market St" />
              </Field>
              <Field label="Phone">
                <Input name="phone" placeholder="+1 555 555 0100" />
              </Field>
              <Field label="Timezone">
                <Select name="timezone" defaultValue="America/Denver">
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" className="w-full">Create location</Button>
            </form>
          ) : (
            <p className="text-sm text-muted">
              Your role ({session.membership.role}) cannot create locations. Ask an owner, admin, or manager.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}