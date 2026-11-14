"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/podiums";

const LINKS = [
  { href: "/app", label: "Home", icon: "home" },
  { href: "/app/browse", label: "Browse", icon: "grid" },
  { href: "/app/search", label: "Search", icon: "search" },
  { href: "/app/rankings", label: "Rankings", icon: "rank" },
  { href: "/app/taste", label: "Taste", icon: "spark" },
  { href: "/app/profile", label: "You", icon: "person" },
] as const;

/** Persistent desktop navigation. Hidden below the lg breakpoint. */
export function DesktopNav() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col border-r border-white/[0.06] px-5 py-8 lg:flex">
      <Link href="/app" className="group block w-fit">
        <span className="font-display text-[29px] leading-none tracking-[-0.035em] text-ink">
          Appolo<span className="text-brand">.</span>
        </span>
        <span className="mt-2 block text-[9px] font-medium uppercase tracking-[0.22em] text-muted-2">
          A journal of taste
        </span>
      </Link>

      <nav aria-label="Primary" className="mt-10 space-y-0.5">
        {LINKS.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors ${
                active
                  ? "bg-white/[0.07] font-semibold text-ink"
                  : "font-medium text-muted hover:bg-white/[0.035] hover:text-ink"
              }`}
            >
              <Icon
                name={link.icon}
                className={`h-[18px] w-[18px] ${active ? "text-brand" : "text-muted-2"}`}
              />
              {link.label}
            </Link>
          );
        })}
      </nav>

      <Link
        href="/app/rate"
        className="mt-6 flex min-h-11 items-center justify-center gap-2 rounded-full bg-gradient-to-b from-brand-soft to-brand text-[13px] font-semibold text-black shadow-[0_10px_30px_-12px_rgba(74,222,128,0.6)] transition-transform active:scale-[0.98]"
      >
        <Icon name="plus" className="h-4 w-4" />
        Rate something
      </Link>

      <div className="mt-auto space-y-1 pt-8">
        <Link
          href="/app/settings"
          className={`flex min-h-10 items-center gap-3 rounded-lg px-3 text-[12px] transition-colors ${
            isActive(pathname, "/app/settings")
              ? "text-ink"
              : "text-muted-2 hover:bg-white/[0.035] hover:text-muted"
          }`}
        >
          <Icon name="settings" className="h-4 w-4" />
          Settings
        </Link>
        <p className="px-3 pt-2 text-[9px] uppercase tracking-[0.18em] text-muted-2">
          Appolo · 2026
        </p>
      </div>
    </aside>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}
