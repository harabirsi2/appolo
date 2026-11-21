import { NextResponse, type NextRequest } from "next/server";
import { firstIssue, webchatCustomerSchema } from "@appolo/core";
import { apiError, jsonError } from "@/lib/api";
import { getWebchatMessages, receiveWebchatMessage } from "@/lib/services/messaging";
import { runKeywordAutomations } from "@/lib/services/automations";
import { answerInboundMessage } from "@/lib/services/ai-employee";
import { consumeWebchat } from "@/lib/services/action-rate-limit";
import { tooManyAttemptsMessage } from "@/lib/services/auth-rate-limit";
import { issueVisitorToken, readVisitorToken } from "@/lib/services/webchat-token";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string }> };

/** First hop of `x-forwarded-for`, falling back to the proxy's real-ip header. */
function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim() || null;
  return request.headers.get("x-real-ip");
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const { key } = await params;

    // Unauthenticated endpoint that can create a contact, fire a real SMS
    // automation and spend an AI reply. Meter it before doing any of that.
    const quota = await consumeWebchat(key, clientIp(request));
    if (!quota.allowed) {
      return NextResponse.json(
        {
          error: tooManyAttemptsMessage(quota.retryAfterSeconds),
          code: "RATE_LIMITED",
        },
        { status: 429, headers: { "retry-after": String(quota.retryAfterSeconds) } },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_JSON");
    }

    const parsed = webchatCustomerSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_INPUT");

    // The visitor id is server-minted. A presented token just continues an
    // existing conversation; anything else starts a new one under a new id.
    const session = issueVisitorToken(readVisitorToken(parsed.data.token) ?? undefined);

    const result = await receiveWebchatMessage(key, {
      visitorId: session.visitorId,
      body: parsed.data.body,
      name: parsed.data.name,
    });

    if (result.contactId) {
      let automationSent = false;
      try {
        const automation = await runKeywordAutomations(result.orgId, {
          contactId: result.contactId,
          channel: "webchat",
          body: parsed.data.body,
        });
        automationSent = automation.sent;
      } catch (automationError) {
        console.error("[webchat] automation failed:", automationError);
      }

      if (!automationSent) {
        try {
          await answerInboundMessage(result.orgId, {
            contactId: result.contactId,
            channel: "webchat",
            body: parsed.data.body,
            conversationId: result.conversationId,
          });
        } catch (aiError) {
          console.error("[webchat] ai employee failed:", aiError);
        }
      }
    }

    return NextResponse.json(
      { ...result, visitorId: session.visitorId, visitorToken: session.token },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const { key } = await params;

    // Only the holder of the signed token may read that transcript. The old
    // `?visitorId=` parameter is deliberately gone: an id the client chooses
    // proves nothing.
    const token =
      request.nextUrl.searchParams.get("token") ?? request.headers.get("x-webchat-token");
    const visitorId = readVisitorToken(token);
    if (!visitorId) {
      return jsonError(
        "This chat session is missing or has expired.",
        401,
        "INVALID_VISITOR_TOKEN",
      );
    }

    const result = await getWebchatMessages(key, visitorId);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
