import { z } from "zod";
import { CONSENT_CHANNELS } from "./consent";

export const contactChannelKinds = ["phone", "email", "social"] as const;
export type ContactChannelKind = (typeof contactChannelKinds)[number];

export const contactChannelSchema = z.object({
  kind: z.enum(contactChannelKinds),
  value: z.string().trim().min(2, "Channel value is too short.").max(200),
  isPrimary: z.boolean().optional(),
});

export const contactCreateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  company: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
  channels: z.array(contactChannelSchema).max(10).default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  source: z.string().trim().max(60).optional(),
});

export const contactUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).nullish(),
  company: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export const consentInputSchema = z.object({
  channel: z.enum(CONSENT_CHANNELS),
  status: z.enum(["granted", "revoked"]),
  source: z.string().trim().min(1).max(80).default("manual"),
  evidence: z.record(z.unknown()).optional(),
});

export const contactQuerySchema = z.object({
  query: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ContactChannelInput = z.infer<typeof contactChannelSchema>;
export type ContactCreateInput = z.infer<typeof contactCreateSchema>;
export type ContactUpdateInput = z.infer<typeof contactUpdateSchema>;
export type ConsentInput = z.infer<typeof consentInputSchema>;