import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, Field, Input, Select } from "@appolo/ui";
import { signupAction } from "@/lib/actions";
import { getSession } from "@/lib/session";

export const metadata = { title: "Create a workspace" };

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

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/app");

  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-6 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-sm font-bold text-white">A</div>
        <span className="text-lg font-semibold tracking-tight">Appolo</span>
      </Link>

      <Card>
        <h1 className="text-xl font-semibold tracking-tight">Create your workspace</h1>
        <p className="mt-1 text-sm text-muted">
          One business, one location, and you as the owner. You can add more later.
        </p>

        {error ? (
          <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <form action={signupAction} className="mt-6 space-y-4">
          <Field label="Business name">
            <Input name="orgName" required placeholder="Northside Dental" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name">
              <Input name="name" required autoComplete="name" placeholder="Alex Morgan" />
            </Field>
            <Field label="First location">
              <Input name="locationName" placeholder="Main Street" />
            </Field>
          </div>
          <Field label="Work email">
            <Input name="email" type="email" required autoComplete="email" placeholder="you@business.com" />
          </Field>
          <Field label="Password" hint="At least 10 characters, with a letter and a number.">
            <Input name="password" type="password" required autoComplete="new-password" placeholder="••••••••••" />
          </Field>
          <Field label="Timezone">
            <Select name="timezone" defaultValue="America/Denver">
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </Select>
          </Field>
          <Button type="submit" className="w-full">Create workspace</Button>
        </form>

        <p className="mt-5 text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="text-brand-soft hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </main>
  );
}