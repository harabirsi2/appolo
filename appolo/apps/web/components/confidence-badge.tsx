import type { ScoreInterval } from "@appolo/core";

/**
 * The score, its 95% interval and how many comparisons produced them.
 *
 * The interval comes from the fitted model (`scoreInterval` in core), which
 * carries a Pearson overdispersion correction and an outward bias allowance —
 * it is not `score ± something made up`. A disclosure rather than a hover
 * tooltip, because a tooltip is unreachable on the phone where most of this is
 * read.
 *
 * Under three comparisons the interval is too wide to be informative, so the
 * badge says what is actually true instead of printing a number with a huge ±.
 */
export function ConfidenceBadge({
  interval,
  className = "",
}: {
  interval: ScoreInterval;
  className?: string;
}) {
  const { score, margin, comparisons, lower, upper } = interval;

  if (comparisons < 3) {
    return (
      <p className={`text-[11px] text-muted-2 ${className}`}>
        {comparisons === 0 ? "No comparisons yet" : `${comparisons} comparison${comparisons === 1 ? "" : "s"} — too early to call`}
      </p>
    );
  }

  const strength = comparisons >= 20 ? "settled" : comparisons >= 8 ? "holding" : "provisional";

  return (
    <details className={`group text-[11px] ${className}`}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-muted marker:content-none">
        <span className="num font-semibold text-ink">{score.toFixed(1)}</span>
        <span className="num text-muted">± {margin.toFixed(1)}</span>
        <span className="text-muted-2">
          · {comparisons} comparison{comparisons === 1 ? "" : "s"}
        </span>
        <span className="rounded-full border border-white/10 bg-white/[0.05] px-1.5 py-px text-[9px] uppercase tracking-[0.08em] text-muted-2">
          {strength}
        </span>
      </summary>
      <p className="mt-1.5 max-w-[46ch] text-[11px] leading-relaxed text-muted-2">
        95% range {lower.toFixed(1)}–{upper.toFixed(1)} from {comparisons} comparisons. Early
        scores shrink toward the middle until enough votes land, so a new title starts near 5 and
        moves as you compare — the ± is how much it could still move.
      </p>
    </details>
  );
}
