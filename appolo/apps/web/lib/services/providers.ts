import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export interface SendSmsInput {
  to: string;
  from?: string | null;
  body: string;
  /** Stable per-message key so provider retries cannot duplicate a send. */
  idempotencyKey: string;
}

export interface SendSmsResult {
  provider: string;
  providerSid: string;
  status: "sent" | "delivered" | "queued";
}

export interface SmsProvider {
  readonly name: string;
  sendSms(input: SendSmsInput): Promise<SendSmsResult>;
}

/**
 * Dev/provider-less adapter. Records the send locally and reports delivery so
 * the full inbox pipeline can be exercised without external credentials.
 */
function mockProvider(): SmsProvider {
  return {
    name: "mock",
    async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
      return {
        provider: "mock",
        providerSid: `SM_MOCK_${input.idempotencyKey.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}_${randomUUID().slice(0, 6)}`,
        status: "delivered",
      };
    },
  };
}

function twilioProvider(accountSid: string, authToken: string, defaultFrom: string): SmsProvider {
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  return {
    name: "twilio",
    async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
      const form = new URLSearchParams();
      form.set("To", input.to);
      form.set("From", input.from || defaultFrom);
      form.set("Body", input.body);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        sid?: string;
        status?: string;
        message?: string;
      };

      if (!response.ok || !payload.sid) {
        throw new Error(`Twilio send failed (${response.status}): ${payload.message ?? "unknown error"}`);
      }

      const status = payload.status === "delivered" ? "delivered" : payload.status === "queued" ? "queued" : "sent";
      return { provider: "twilio", providerSid: payload.sid, status };
    },
  };
}

export function isTwilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_FROM_NUMBER?.trim(),
  );
}

export function getSmsProvider(): SmsProvider {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim();
  if (sid && token && from) return twilioProvider(sid, token, from);
  return mockProvider();
}

/* ------------------------------------------------------------------ */
/* email                                                               */
/* ------------------------------------------------------------------ */

export interface SendEmailInput {
  to: string;
  from?: string | null;
  subject?: string | null;
  body: string;
  /** Stable per-message key so provider retries cannot duplicate a send. */
  idempotencyKey: string;
}

export interface SendEmailResult {
  provider: string;
  providerSid: string;
  status: "sent" | "delivered" | "queued";
}

export interface EmailProvider {
  readonly name: string;
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
}

const DEFAULT_EMAIL_FROM = "Appolo <reviews@appolo.local>";
const DEFAULT_EMAIL_SUBJECT = "A message from our team";

/** Dev/provider-less adapter; records the send locally as delivered. */
function mockEmailProvider(): EmailProvider {
  return {
    name: "mock",
    async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
      return {
        provider: "mock",
        providerSid: `EM_MOCK_${input.idempotencyKey.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}_${randomUUID().slice(0, 6)}`,
        status: "delivered",
      };
    },
  };
}

function resendProvider(apiKey: string, defaultFrom: string): EmailProvider {
  return {
    name: "resend",
    async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: input.from || defaultFrom,
          to: [input.to],
          subject: input.subject?.trim() || DEFAULT_EMAIL_SUBJECT,
          text: input.body,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
      };

      if (!response.ok || !payload.id) {
        throw new Error(`Resend send failed (${response.status}): ${payload.message ?? "unknown error"}`);
      }

      return { provider: "resend", providerSid: payload.id, status: "sent" };
    },
  };
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

export function getEmailProvider(): EmailProvider {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (apiKey && from) return resendProvider(apiKey, from);
  return mockEmailProvider();
}

/**
 * Validates Twilio's X-Twilio-Signature: base64(HMAC-SHA1(authToken,
 * url + sorted(key+value))). Skipped when no auth token is configured, which
 * is the local/mock path.
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null,
): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!token) return true;
  if (!signature) return false;

  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + (params[key] ?? ""), url);

  const expected = createHmac("sha1", token).update(data).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}