export const SESSION_COOKIE = "appolo_session";
export const SESSION_TTL_DAYS = 30;
export const APP_NAME = "Appolo";
export const APP_TAGLINE = "Reviews, messages, and an AI employee that never sleeps.";

export const PLAN_TIERS = ["trial", "starter", "growth", "scale"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];