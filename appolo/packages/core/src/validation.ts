import { z } from "zod";
import { ROLES } from "./permissions";

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.");

export const signupSchema = z.object({
  orgName: z.string().trim().min(2, "Business name is too short.").max(120),
  name: z.string().trim().min(2, "Your name is too short.").max(120),
  email: emailSchema,
  password: z.string().min(10, "Password must be at least 10 characters.").max(200),
  locationName: z.string().trim().min(2).max(120).optional(),
  timezone: z.string().trim().min(1).max(64).default("UTC"),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required.").max(200),
});

export const locationSchema = z.object({
  name: z.string().trim().min(2, "Location name is too short.").max(120),
  address: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(40).optional(),
  timezone: z.string().trim().min(1).max(64).default("UTC"),
});

export const memberInviteSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(2).max(120),
  role: z.enum(ROLES).default("agent"),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type LocationInput = z.infer<typeof locationSchema>;
export type MemberInviteInput = z.infer<typeof memberInviteSchema>;

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input.";
}