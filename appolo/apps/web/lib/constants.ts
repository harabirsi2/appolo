export const SESSION_COOKIE = "appolo_session";

/** Primary navigation for the media ranking app. */
export const NAV_ITEMS = [
  { href: "/app", label: "Home" },
  { href: "/app/search", label: "Search" },
  { href: "/app/profile", label: "Profile" },
] as const;

/**
 * The public profile and pod the `/demo` tour opens. Both are seeded on every
 * deployment (see `packages/core/src/tour.ts`), so the tour never depends on a
 * published login.
 */
export { TOUR_POD_SLUG, TOUR_PROFILE_USERNAME } from "@appolo/core";
