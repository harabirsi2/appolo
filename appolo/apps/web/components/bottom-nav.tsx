"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/podiums";

const TABS = [
  { href: "/app", label: "Home", icon: "home" as const },
  { href: "/app/browse", label: "Browse", icon: "grid" as const },
  { href: "/app/search", label: "Search", icon: "search" as const },
  { href: "/app/profile", label: "You", icon: "person" as const },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40">
      <div className="pointer-events-auto mx-auto w-full max-w-[560px] border-t border-white/[0.08] bg-black/75 px-2 pt-1.5 backdrop-blur-2xl safe-bottom">
        <div className="grid grid-cols-5 items-center">
          <Tab tab={TABS[0]!} active={isActive(pathname, TABS[0]!.href)} />
          <Tab tab={TABS[1]!} active={isActive(pathname, TABS[1]!.href)} />

          <div className="flex justify-center">
            <Link
              href="/app/rate"
              aria-label="Rate something"
              className="-mt-7 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-b from-brand-soft to-brand text-black shadow-[0_10px_30px_-6px_rgba(74,222,128,0.55)] ring-4 ring-black transition-transform active:scale-95"
            >
              <Icon name="plus" className="h-7 w-7" />
            </Link>
          </div>

          <Tab tab={TABS[2]!} active={isActive(pathname, TABS[2]!.href)} />
          <Tab tab={TABS[3]!} active={isActive(pathname, TABS[3]!.href)} />
        </div>
      </div>
    </nav>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Tab({
  tab,
  active,
}: {
  tab: { href: string; label: string; icon: "home" | "grid" | "search" | "person" };
  active: boolean;
}) {
  return (
    <Link
      href={tab.href}
      aria-current={active ? "page" : undefined}
      className={`group flex flex-col items-center gap-1 rounded-xl py-1 text-[10px] font-medium transition-colors ${
        active ? "text-ink" : "text-muted-2 hover:text-muted"
      }`}
    >
      <span className="relative grid h-7 w-9 place-items-center">
        <span
          className={`absolute inset-0 rounded-full transition-all ${
            active ? "bg-white/[0.09]" : "bg-transparent group-hover:bg-white/[0.04]"
          }`}
        />
        <Icon name={tab.icon} className={`relative h-[22px] w-[22px] ${active ? "stroke-[2.1]" : ""}`} />
      </span>
      {tab.label}
    </Link>
  );
}
