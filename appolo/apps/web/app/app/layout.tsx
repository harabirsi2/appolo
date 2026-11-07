import Link from "next/link";
import { Badge, Button } from "@appolo/ui";
import { NAV_ITEMS } from "@/lib/constants";
import { requireSession } from "@/lib/session";
import { logoutAction } from "@/lib/actions";
import { NavLink } from "@/components/nav-link";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const initials = session.user.name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface/50 p-4 md:flex">
        <Link href="/app" className="mb-6 flex items-center gap-2 px-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-sm font-bold text-white">A</div>
          <span className="text-base font-semibold tracking-tight">Appolo</span>
        </Link>

        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} />
          ))}
        </nav>

        <div className="mt-auto space-y-3 pt-6">
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <p className="truncate text-sm font-medium">{session.org.name}</p>
            <p className="mt-0.5 text-xs text-muted-2">/{session.org.slug}</p>
            <div className="mt-2">
              <Badge tone="brand">{session.org.planTier}</Badge>
            </div>
          </div>
          <p className="px-1 text-[11px] text-muted-2">Phase 2 · reviews</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-border bg-bg/80 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{session.org.name}</p>
              <p className="text-xs text-muted-2">
                Signed in as {session.user.email} · {session.membership.role}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface-2 text-xs font-semibold">
                {initials || "?"}
              </div>
              <form action={logoutAction}>
                <Button variant="ghost" size="sm" type="submit">Sign out</Button>
              </form>
            </div>
          </div>

          <nav className="mt-3 flex gap-1 overflow-x-auto md:hidden">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>

        <main className="flex-1 px-4 py-6 md:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}