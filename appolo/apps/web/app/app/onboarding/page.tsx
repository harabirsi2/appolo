import Link from "next/link";
import { Button } from "@appolo/ui";
import { MEDIA_KIND_LABELS } from "@appolo/core";
import { requireSession } from "@/lib/session";
import { interestOptions, listInterests, starterItem } from "@/lib/services/interests";
import { InterestPicker } from "@/components/interest-picker";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pick your interests" };

export default async function OnboardingPage() {
  const session = await requireSession();
  const [options, picks] = await Promise.all([interestOptions(), listInterests(session.org.id)]);
  const starter = await starterItem(session.org.id, picks);

  return (
    <div className="mx-auto max-w-2xl px-5 pb-16 pt-6">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-2">Cold start</p>
      <h1 className="mt-2 text-[30px] font-extrabold leading-tight tracking-tight text-ink">
        Pick what you love
      </h1>
      <p className="mt-2 text-[13px] text-muted">
        Choose a few genres and we will put a matching title in front of you for your first
        “which is better?” comparison. You can change this any time.
      </p>

      {options.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-[13px] text-muted">
          The catalog is empty right now. Browse it once titles arrive.
        </p>
      ) : (
        <InterestPicker options={options} initial={picks} />
      )}

      {starter ? (
        <section className="mt-8 rounded-2xl border border-brand/25 bg-brand/[0.07] p-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-brand/80">Start here</p>
          <p className="mt-1 text-[16px] font-semibold text-ink">
            {starter.title}
            <span className="ml-2 text-[12px] font-normal text-muted">
              {MEDIA_KIND_LABELS[starter.kind]}
            </span>
          </p>
          <p className="mt-1 text-[12px] text-muted">
            A first matchup from your interests seeds the ranking — every later score builds on it.
          </p>
          <Link href={`/app/rate/${starter.id}`} className="mt-3 inline-block">
            <Button size="md">Start comparing</Button>
          </Link>
        </section>
      ) : null}

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/app" className="text-[12px] text-muted-2 hover:text-ink">
          Skip to the app
        </Link>
        <Link href="/app/rate" className="text-[12px] text-muted-2 hover:text-ink">
          Browse everything
        </Link>
      </div>
    </div>
  );
}
