import Link from "next/link";
import { Button } from "@appolo/ui";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[560px] flex-col items-center justify-center border-x border-white/[0.04] px-6 text-center">
      <p className="text-[11px] uppercase tracking-[0.3em] text-muted-2">404</p>
      <h1 className="mt-3 text-[44px] font-extrabold leading-none tracking-[-0.04em] text-ink">Off the podium</h1>
      <p className="mt-3 max-w-[280px] text-[14px] leading-relaxed text-muted">
        This page does not exist — or the title was removed from the catalog.
      </p>
      <div className="mt-6 flex gap-2">
        <Link href="/app">
          <Button size="md">Back home</Button>
        </Link>
        <Link href="/app/browse">
          <Button size="md" variant="secondary">Browse titles</Button>
        </Link>
      </div>
    </div>
  );
}
