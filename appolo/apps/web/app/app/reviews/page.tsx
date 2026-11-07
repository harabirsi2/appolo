import { PhaseNotice } from "@/components/phase-notice";

export const metadata = { title: "Reviews" };

export default function ReviewsPage() {
  return (
    <PhaseNotice
      phase={3}
      title="Reviews"
      body="Review requests and the unified review inbox land after messaging, because every request is a message. The schema is already in place, and the dashboard reads live review data."
      features={[
        "SMS and email review requests with smart timing",
        "Multi-platform routing (Google, Facebook, BBB, DealerRater)",
        "Optional private feedback before the public ask",
        "Unified inbox with AI reply drafts and approval",
        "Analytics: volume, rating, response rate, platform mix",
      ]}
    />
  );
}