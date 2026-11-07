import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, Field, Input } from "@appolo/ui";
import { loginAction } from "@/lib/actions";
import { getSession } from "@/lib/session";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/app");

  const { error, next } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-sm font-bold text-white">A</div>
        <span className="text-lg font-semibold tracking-tight">Appolo</span>
      </Link>

      <Card>
        <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-muted">Sign in to your profile.</p>

        {error ? (
          <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <form action={loginAction} className="mt-6 space-y-4">
          <input type="hidden" name="next" value={next ?? "/app"} />
          <Field label="Email">
            <Input name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
          </Field>
          <Field label="Password">
            <Input name="password" type="password" autoComplete="current-password" required placeholder="••••••••••" />
          </Field>
          <Button type="submit" className="w-full">Sign in</Button>
        </form>

        <p className="mt-5 text-sm text-muted">
          No account?{" "}
          <Link href="/signup" className="text-brand-soft hover:underline">
            Create an account
          </Link>
        </p>
      </Card>

      <p className="mt-6 text-center text-xs text-muted-2">
        Demo: owner@appolo.test · appolo-demo-1234
      </p>
    </main>
  );
}