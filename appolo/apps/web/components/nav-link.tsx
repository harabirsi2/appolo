"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@appolo/ui";

export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = href === "/app" ? pathname === "/app" : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
        active ? "bg-brand/15 text-brand-soft" : "text-muted hover:bg-surface-2 hover:text-ink",
      )}
    >
      <span>{label}</span>
      {active ? <span className="h-1.5 w-1.5 rounded-full bg-brand" /> : null}
    </Link>
  );
}