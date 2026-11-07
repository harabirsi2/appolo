import { Badge, Card, CardTitle } from "@appolo/ui";

export function PhaseNotice({
  phase,
  title,
  body,
  features,
}: {
  phase: number;
  title: string;
  body: string;
  features: string[];
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <Badge tone="warn">Phase {phase}</Badge>
      </div>
      <Card>
        <CardTitle>Not built yet — and that is deliberate</CardTitle>
        <p className="text-sm text-muted">{body}</p>
        <ul className="mt-5 space-y-2 text-sm">
          {features.map((f) => (
            <li key={f} className="flex gap-2 text-muted">
              <span className="text-brand">→</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-xs text-muted-2">
          See <span className="font-mono">FEATURE_MAP.md</span> and{" "}
          <span className="font-mono">ROADMAP.md</span> at the repo root for the full plan.
        </p>
      </Card>
    </div>
  );
}