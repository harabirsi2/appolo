import { NextResponse, type NextRequest } from "next/server";
import { firstIssue, webchatCustomerSchema } from "@appolo/core";
import { apiError, jsonError } from "@/lib/api";
import { getWebchatMessages, receiveWebchatMessage } from "@/lib/services/messaging";
import { runKeywordAutomations } from "@/lib/services/automations";
import { answerInboundMessage } from "@/lib/services/ai-employee";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string }> };

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const { key } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_JSON");
    }

    const parsed = webchatCustomerSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_INPUT");

    const result = await receiveWebchatMessage(key, parsed.data);
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
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const { key } = await params;
    const visitorId = request.nextUrl.searchParams.get("visitorId")?.trim();
    if (!visitorId) return jsonError("visitorId is required.", 400, "MISSING_VISITOR");

    const result = await getWebchatMessages(key, visitorId);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}