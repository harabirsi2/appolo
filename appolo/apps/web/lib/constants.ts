export const SESSION_COOKIE = "appolo_session";

export const NAV_ITEMS = [
  { href: "/app", label: "Overview", phase: 0 },
  { href: "/app/inbox", label: "Inbox", phase: 1 },
  { href: "/app/reviews", label: "Reviews", phase: 3 },
  { href: "/app/automations", label: "Automations", phase: 3 },
  { href: "/app/campaigns", label: "Campaigns", phase: 3 },
  { href: "/app/reports", label: "Reports", phase: 3 },
  { href: "/app/ai", label: "AI Employee", phase: 4 },
  { href: "/app/contacts", label: "Contacts", phase: 1 },
  { href: "/app/locations", label: "Locations", phase: 0 },
  { href: "/app/audit", label: "Audit log", phase: 3 },
  { href: "/app/settings", label: "Settings", phase: 0 },
] as const;

export const DEMO_HINT = "owner@appolo.test / appolo-demo-1234";