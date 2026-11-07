import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { Badge, Button, Card, CardTitle, Field, Textarea } from "@appolo/ui";
import { resolveReviewLanding } from "@/lib/services/reviews";
import { submitPrivateFeedbackAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Share your experience",
  robots: { index: false, follow: false },
};

export default async function ReviewLandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { token } = await params;
  const { ok, error } = await searchParams;
  const h = await headers();

  const landing = await resolveReviewLanding(token, {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"),
    userAgent: h.get("user-agent"),
  });

  if (!landing) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12">
        <Card className="text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-xl">⌛</div>
          <h1 className="text-xl font-semibold tracking-tight">This link has expired</h1>
          <p className="mt-2 text-sm text-muted">
            Review links stay valid for a few weeks. Ask the business to send you a fresh one.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex h-10 items-center justify-center rounded-lg border border-border bg-surface-2 px-4 text-sm text-ink hover:border-border-strong"
          >
            Back to Appolo
          </Link>
        </Card>
      </main>
    );
  }

  const publicButtons = landing.platforms.filter((platform) => platform.url);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-12">
      <div className="mb-6 text-center">
        <Badge tone="brand">Review request</Badge>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          How was your visit to {landing.businessName}?
        </h1>
        <p className="mt-2 text-sm text-muted">
          {landing.contactName ? `Hi ${landing.contactName.split(/\s+/)[0]}, t` : "T"}hanks for stopping by
          {landing.locationName ? ` our ${landing.locationName} location` : ""}. Your feedback helps us improve
          and helps neighbours find us.
        </p>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="mb-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          Thank you — your private feedback is on its way to the team.
        </p>
      ) : null}

      <Card>
        <CardTitle>Leave a public review</CardTitle>
        <p className="text-sm text-muted">
          Pick a platform below. It only takes a minute, and it makes a real difference to a small business.
        </p>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {publicButtons.length > 0 ? (
            publicButtons.map((platform) => (
              <a
                key={`${platform.kind}-${platform.url}`}
                href={platform.url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center justify-center rounded-lg bg-brand px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-strong"
              >
                Review us on {platform.displayName}
              </a>
            ))
          ) : (
            <a
              href={landing.publicUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-brand px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-strong sm:col-span-2"
            >
              Leave a public review
            </a>
          )}
        </div>

        <p className="mt-3 text-xs text-muted-2">
          Opening a platform takes you to their site. Your review there is public.
        </p>
      </Card>

      <div id="feedback" className="mt-4">
        <Card>
          <CardTitle
            action={landing.alreadyResponded ? <Badge tone="success">Received</Badge> : <Badge>Optional</Badge>}
          >
            {landing.alreadyResponded ? "You already sent private feedback" : "Prefer to tell us privately?"}
          </CardTitle>

          {landing.alreadyResponded ? (
            <p className="text-sm text-muted">
              We got it — thank you. If you would still like to leave a public review, use the buttons above.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted">
                This goes only to the {landing.businessName} team. It is completely optional and does not
                affect the public review options above.
              </p>
              <form action={submitPrivateFeedbackAction} className="mt-4 space-y-3">
                <input type="hidden" name="token" value={token} />
                <Field label="How did it go?">
                  <div className="flex gap-1.5">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <label
                        key={value}
                        className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg border border-border bg-surface-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand/15"
                      >
                        <input
                          type="radio"
                          name="rating"
                          value={value}
                          className="sr-only"
                          defaultChecked={value === 5}
                        />
                        <span className="text-amber-400">★</span>
                        <span className="text-muted">{value}</span>
                      </label>
                    ))}
                  </div>
                </Field>
                <Field label="Your name" hint="Optional — leave blank to stay anonymous.">
                  <input
                    name="name"
                    defaultValue={landing.contactName ?? ""}
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-ink placeholder:text-muted-2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </Field>
                <Field label="What happened?">
                  <Textarea name="body" rows={4} placeholder="Tell us what went well or what we could do better." required />
                </Field>
                <Button type="submit" variant="secondary">Send private feedback</Button>
              </form>
            </>
          )}
        </Card>
      </div>

      <p className="mt-6 text-center text-xs text-muted-2">Powered by Appolo</p>
    </main>
  );
}