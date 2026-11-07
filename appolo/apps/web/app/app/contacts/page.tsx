import { PhaseNotice } from "@/components/phase-notice";

export const metadata = { title: "Contacts" };

export default function ContactsPage() {
  return (
    <PhaseNotice
      phase={1}
      title="Contacts"
      body="Contact management is the first half of Phase 1. The tables support channels, tags, custom fields, consent records, and a unified timeline."
      features={[
        "Unified profile with phone, email, and social channels",
        "CSV import and export with duplicate detection",
        "Tags, segments, and org-scoped custom fields",
        "Consent state surfaced and enforced on every channel",
        "Timeline of messages, reviews, appointments, and notes",
      ]}
    />
  );
}