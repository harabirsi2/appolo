import { NextResponse, type NextRequest } from "next/server";
import { verifyTwilioSignature } from "@/lib/services/providers";
import { receiveInboundSms } from "@/lib/services/messaging";
import { runKeywordAutomations } from "@/lib/services/automations";
import { answerInboundMessage } from "@/lib/services/ai-employee";
import { isDomainError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

/**
 * Twilio inbound SMS webhook. Persists the raw message idempotently and
 * processes STOP/HELP keywords. Must reply quickly with TwiML.
 */
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
  const signature = request.headers.get("x-twilio-signature");

  if (!verifyTwilioSignature(signedUrl, params, signature)) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const to = params.To?.trim();
  const from = params.From?.trim();
  const body = params.Body ?? "";

  if (!to || !from) {
    return new NextResponse("Missing From/To", { status: 400 });
  }

  const mediaCount = Number.parseInt(params.NumMedia ?? "0", 10) || 0;
  const media: string[] = [];
  for (let i = 0; i < Math.min(mediaCount, 5); i += 1) {
    const url = params[`MediaUrl${i}`];
    if (url) media.push(url);
  }

  try {
    const result = await receiveInboundSms({
      to,
      from,
      body,
      providerSid: params.MessageSid ?? null,
      media,
    });

    // Keyword automations are best-effort: a failure must not make Twilio
    // retry, and STOP/HELP/START are handled above (action != "message").
    if (result.action === "message" && result.contactId) {
      let automationSent = false;
      try {
        const automation = await runKeywordAutomations(result.orgId, {
          contactId: result.contactId,
          channel: "sms",
          body,
        });
        automationSent = automation.sent;
      } catch (automationError) {
        console.error("[twilio/sms] automation failed:", automationError);
      }

      // The AI employee only answers when no keyword automation already did.
      if (!automationSent) {
        try {
          await answerInboundMessage(result.orgId, {
            contactId: result.contactId,
            channel: "sms",
            body,
            conversationId: result.conversationId ?? undefined,
          });
        } catch (aiError) {
          console.error("[twilio/sms] ai employee failed:", aiError);
        }
      }
    }

    return new NextResponse("<Response></Response>", {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  } catch (error) {
    if (isDomainError(error) && error.code === "UNKNOWN_NUMBER") {
      // Do not make Twilio retry a number we do not own.
      return new NextResponse("<Response></Response>", {
        status: 200,
        headers: { "Content-Type": "text/xml; charset=utf-8" },
      });
    }
    console.error("[twilio/sms] failed:", error);
    return new NextResponse("Error", { status: 500 });
  }
}