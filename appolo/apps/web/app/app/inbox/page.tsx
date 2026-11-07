import { PhaseNotice } from "@/components/phase-notice";

export const metadata = { title: "Inbox" };

export default function InboxPage() {
  return (
    <PhaseNotice
      phase={1}
      title="Inbox"
      body="The shared inbox is the next milestone. It needs the message pipeline, consent enforcement, and realtime delivery in place before it can be trusted with real customer conversations."
      features={[
        "Conversations across SMS, webchat, email, and social DMs",
        "Assignment, status, priority, and internal notes",
        "Saved replies with template variables",
        "Consent ledger + STOP/HELP handling before every send",
        "Real-time updates over SSE",
      ]}
    />
  );
}