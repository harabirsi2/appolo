"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/podiums";

const TABS = [
  { href: "/app", label: "Home", icon: "home" as const },
  { href: "/app/search", label: "Search", icon: "search" as const },
  { href: "/app/profile", label: "Profile", icon: "person" as const },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-30">
      <div className="pointer-events-auto mx-auto w-full max-w-[560px] border-t border-white/[0.07] bg-black/80 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl">
        <div className="grid grid-cols-4 items-end px-3">
          {TABS.slice(0, 2).map((tab) => (
            <Tab key={tab.href} {...tab} active={isActive(pathname, tab.href)} />
          ))}

          <div className="flex justify-center">
            <Link
              href="/app/rate"
              aria-label="Rate something"
              className="-mt-6 grid h-14 w-14 place-items-center rounded-full bg-brand text-black shadow-[0_8px_30px_rgba(74,222,128,0.35)] transition-transform active:scale-95"
            >
              <Icon name="plus" className="h-7 w-7" />
            </Link>
          </div>

          <Tab {...TABS[2]!} active={isActive(pathname, TABS[2]!.href)} />
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
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: "home" | "search" | "person";
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex flex-col items-center gap-1 rounded-xl py-1 text-[10px] font-medium transition-colors ${
        active ? "text-ink" : "text-muted-2 hover:text-muted"
      }`}
    >
      <Icon name={icon} className="h-6 w-6" />
      {label}
    </Link>
  );
}