export const REPORT_CONTENT_TYPES = ["review", "profile", "comment"] as const;
export type ReportContentType = (typeof REPORT_CONTENT_TYPES)[number];

export const REPORT_REASONS = [
  "spam",
  "harassment",
  "hate",
  "sexual",
  "violence",
  "misinformation",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam or advertising",
  harassment: "Harassment or bullying",
  hate: "Hate speech",
  sexual: "Sexual content",
  violence: "Violence or threats",
  misinformation: "Misinformation",
  other: "Something else",
};

export const MODERATION_ACTIONS = ["hide", "remove", "dismiss"] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];
