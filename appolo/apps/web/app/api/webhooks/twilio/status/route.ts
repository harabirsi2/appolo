import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getAdminDb, withOrg, schema } from "@/lib/db";
import { verifyTwilioSignature } from "@/lib/services/providers";

export const dynamic = "force-dynamic";

const { messages, messageEvents } = schema;

type MessageStatus = "queued" | "sent" | "delivered" | "failed" | "received";

function mapTwilioStatus(value: string | undefined): MessageStatus | null {
  switch ((value ?? "").toLowerCase()) {
    case "accepted":
    case "sending":
      return "sent";
    case "queued":
      return "queued";
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "failed":
    case "undelivered":
      return "failed";
    default:
      return null;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const form = await request.formData().catch(() => null);
  const params: Record<string, string> = {};
  if (form) {
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") params[key] = value;
    }
  }

  const base = (process.env.APP_URL ?? request.nextUrl.origin).replace(/\/$/, "");
  const signedUrl = `${base}${request.nextUrl.pathname}`;
  if (!verifyTwilioSignature(signedUrl, params, request.headers.get("x-twilio-signature"))) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const sid = params.MessageSid?.trim();
  const status = mapTwilioStatus(params.MessageStatus);
  if (!sid || !status) return NextResponse.json({ ok: true, ignored: true });

  const [existing] = await getAdminDb()
    .select({ id: messages.id, orgId: messages.orgId })
    .from(messages)
    .where(eq(messages.providerSid, sid))
    .limit(1);

  if (!existing) return NextResponse.json({ ok: true, ignored: true });

  await withOrg(existing.orgId, async (tx) => {
    await tx
      .update(messages)
      .set({
        status,
        ...(status === "failed" ? { errorCode: params.ErrorCode ?? "PROVIDER_ERROR" } : {}),
      })
      .where(eq(messages.id, existing.id));

    await tx.insert(messageEvents).values({
      orgId: existing.orgId,
      messageId: existing.id,
      event: `status.${status}`,
      payload: { providerStatus: params.MessageStatus ?? null, errorCode: params.ErrorCode ?? null },
    });
  });

  return NextResponse.json({ ok: true });
}