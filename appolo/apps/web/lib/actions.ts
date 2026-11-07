"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  can,
  firstIssue,
  locationSchema,
  loginSchema,
  signupSchema,
  type Capability,
} from "@appolo/core";
import { signIn, signOut, signUp } from "./services/auth";
import { requireSession } from "./session";
import { withOrg, schema } from "./db";

const { locations } = schema;

function safeNext(value: FormDataEntryValue | null): string {
  const raw = typeof value === "string" ? value : "";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/app";
}

export async function signupAction(formData: FormData): Promise<void> {
  const parsed = signupSchema.safeParse({
    orgName: formData.get("orgName"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    locationName: formData.get("locationName") || undefined,
    timezone: formData.get("timezone") || "UTC",
  });

  if (!parsed.success) {
    redirect(`/signup?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  const result = await signUp(parsed.data);
  if (!result.ok) {
    redirect(`/signup?error=${encodeURIComponent(result.error)}`);
  }

  redirect("/app");
}

export async function loginAction(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    redirect(`/login?error=${encodeURIComponent(firstIssue(parsed.error))}&next=${encodeURIComponent(next)}`);
  }

  const result = await signIn(parsed.data);
  if (!result.ok) {
    redirect(`/login?error=${encodeURIComponent(result.error)}&next=${encodeURIComponent(next)}`);
  }

  redirect(next);
}

export async function logoutAction(): Promise<void> {
  await signOut();
  redirect("/login");
}

export async function createLocationAction(formData: FormData): Promise<void> {
  const session = await requireSession();

  const denied = (capability: Capability) =>
    redirect(`/app/locations?error=${encodeURIComponent(`Your role cannot ${capability}.`)}`);

  if (!can(session.membership.role, "locations:manage")) denied("locations:manage");

  const parsed = locationSchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address") || undefined,
    phone: formData.get("phone") || undefined,
    timezone: formData.get("timezone") || "UTC",
  });

  if (!parsed.success) {
    redirect(`/app/locations?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  await withOrg(session.org.id, (tx) =>
    tx.insert(locations).values({
      orgId: session.org.id,
      name: parsed.data.name,
      address: parsed.data.address ?? null,
      phone: parsed.data.phone ?? null,
      timezone: parsed.data.timezone,
    }),
  );

  revalidatePath("/app/locations");
  revalidatePath("/app");
  redirect("/app/locations?ok=1");
}