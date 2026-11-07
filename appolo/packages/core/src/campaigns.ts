import { z } from "zod";

/* ------------------------------------------------------------------ */
/* campaign schemas                                                    */
/* ------------------------------------------------------------------ */

export const campaignChannels = ["sms", "email"] as const;
export type CampaignChannel = (typeof campaignChannels)[number];

export const campaignSegments = ["all", "tag"] as const;
export type CampaignSegment = (typeof campaignSegments)[number];

export const campaignSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(80),
    channel: z.enum(campaignChannels).default("sms"),
    segment: z.enum(campaignSegments).default("all"),
    tag: z.string().trim().max(60).optional(),
    subject: z.string().trim().max(160).optional(),
    body: z.string().trim().min(1, "Message body is required.").max(1000),
  })
  .superRefine((value, ctx) => {
    if (value.segment === "tag" && !value.tag?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Pick a tag for a tag segment.", path: ["tag"] });
    }
  });

export type CampaignInput = z.infer<typeof campaignSchema>;

export interface CampaignSegments {
  contacts: { id: string; name: string | null; tags?: string[] }[];
}

/** Number of recipients a segment resolves to, for the pre-send preview. */
export function countSegment(
  segment: CampaignSegment,
  tag: string | null | undefined,
  contacts: CampaignSegments["contacts"],
): number {
  return resolveSegment(segment, tag, contacts).length;
}

export function resolveSegment(
  segment: CampaignSegment,
  tag: string | null | undefined,
  contacts: CampaignSegments["contacts"],
): CampaignSegments["contacts"] {
  switch (segment) {
    case "tag":
      return contacts.filter((c) => (c.tags ?? []).includes((tag ?? "").toLowerCase()));
    case "all":
    default:
      return contacts;
  }
}
