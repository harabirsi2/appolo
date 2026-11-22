/**
 * The public profile and pod the `/demo` tour opens.
 *
 * `packages/db/src/seed.ts` creates both on every seed, with or without
 * `SEED_DEMO`, so the marketing tour never depends on publishing a login. They
 * live in core because the web app and the seed script must agree on the names.
 */
export const TOUR_PROFILE_USERNAME = "noah";
export const TOUR_POD_SLUG = "all-timers";
