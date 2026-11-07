/**
 * Review platform ingestion.
 *
 * Phase 2 ships a `mock` adapter so the whole sync pipeline is testable
 * without credentials, plus a documented Google Business Profile adapter that
 * calls the public API with an OAuth access token. Nothing here scrapes a
 * private surface: the Google path uses the documented v4 REST API and simply
 * reports "not connected" when no token is configured.
 */
import { DomainError } from "./errors";

export interface NormalizedReview {
  externalId: string;
  authorName: string | null;
  rating: number;
  body: string | null;
  language: string | null;
  reviewedAt: Date;
  url: string | null;
  raw: unknown;
}

export interface FetchReviewsInput {
  /** e.g. "accounts/123/locations/456" for Google. */
  externalRef: string | null;
  credentialsRef: string | null;
  /** Only return reviews newer than this, when the platform supports it. */
  since?: Date | null;
}

export interface PublishReplyInput {
  externalRef: string | null;
  credentialsRef: string | null;
  /** The platform's id for the review being replied to. */
  reviewExternalId: string;
  body: string;
}

export interface PublishReplyResult {
  /** Platform id for the posted reply, when the API returns one. */
  externalId: string | null;
}

export interface ReviewPlatformClient {
  readonly kind: string;
  readonly live: boolean;
  fetchReviews(input: FetchReviewsInput): Promise<NormalizedReview[]>;
  /**
   * Publishes a reply to a public review. Optional: platforms without a
   * documented reply endpoint simply omit it, and the org can record the reply
   * as "posted locally" instead.
   */
  replyToReview?(input: PublishReplyInput): Promise<PublishReplyResult>;
}

/* ------------------------------------------------------------------ */
/* mock                                                                */
/* ------------------------------------------------------------------ */

/**
 * Deterministic sample reviews. Ids are stable per externalRef so repeated
 * syncs upsert rather than pile up new rows.
 */
function mockClient(): ReviewPlatformClient {
  return {
    kind: "mock",
    live: false,
    async fetchReviews({ externalRef }): Promise<NormalizedReview[]> {
      const scope = externalRef ?? "demo";
      const now = Date.now();
      const day = 86_400_000;
      return [
        {
          externalId: `mock-${scope}-1`,
          authorName: "Taylor M.",
          rating: 5,
          body: "Quick, friendly, and fair. Will be back.",
          language: "en",
          reviewedAt: new Date(now - day),
          url: null,
          raw: { source: "mock" },
        },
        {
          externalId: `mock-${scope}-2`,
          authorName: "Devon R.",
          rating: 4,
          body: "Good experience overall, slight wait at the desk.",
          language: "en",
          reviewedAt: new Date(now - 3 * day),
          url: null,
          raw: { source: "mock" },
        },
      ];
    },
    async replyToReview({ reviewExternalId }): Promise<PublishReplyResult> {
      return { externalId: `mock-reply-${reviewExternalId}` };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Google Business Profile (documented v4 API)                         */
/* ------------------------------------------------------------------ */

/** Shape of the fields we read; the API returns more. */
interface GbpReview {
  reviewId?: string;
  reviewer?: { displayName?: string };
  starRating?: "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE";
  comment?: string;
  createTime?: string;
  updateTime?: string;
  name?: string;
}

const STAR_TO_INT: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

function googleClient(accessToken: string): ReviewPlatformClient {
  return {
    kind: "google",
    live: true,
    async fetchReviews({ externalRef }): Promise<NormalizedReview[]> {
      if (!externalRef) {
        throw new DomainError("PLATFORM_NOT_CONFIGURED", "This Google platform has no location reference.", 422);
      }
      // Documented endpoint:
      // https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list
      const url = `https://mybusiness.googleapis.com/v4/${externalRef}/reviews?pageSize=50`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        throw new DomainError(
          "PLATFORM_ERROR",
          `Google Business Profile returned ${response.status}.`,
          502,
        );
      }
      const payload = (await response.json()) as { reviews?: GbpReview[] };
      return (payload.reviews ?? [])
        .filter((review) => review.reviewId && review.starRating)
        .map((review) => ({
          externalId: review.reviewId!,
          authorName: review.reviewer?.displayName ?? null,
          rating: STAR_TO_INT[review.starRating!] ?? 3,
          body: review.comment ?? null,
          language: null,
          reviewedAt: new Date(review.createTime ?? review.updateTime ?? Date.now()),
          url: null,
          raw: review,
        }));
    },
    async replyToReview({ externalRef, reviewExternalId, body }): Promise<PublishReplyResult> {
      if (!externalRef) {
        throw new DomainError("PLATFORM_NOT_CONFIGURED", "This Google platform has no location reference.", 422);
      }
      // Documented endpoint:
      // https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/updateReply
      const name = `${externalRef}/reviews/${reviewExternalId}`;
      const response = await fetch(`https://mybusiness.googleapis.com/v4/${name}/reply`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ comment: body }),
      });
      if (!response.ok) {
        throw new DomainError(
          "PLATFORM_ERROR",
          `Google Business Profile rejected the reply (${response.status}).`,
          502,
        );
      }
      const payload = (await response.json().catch(() => ({}))) as { name?: string };
      return { externalId: payload.name ?? name };
    },
  };
}

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_BUSINESS_ACCESS_TOKEN?.trim());
}

export function getReviewPlatformClient(kind: string): ReviewPlatformClient {
  if (kind === "google") {
    const token = process.env.GOOGLE_BUSINESS_ACCESS_TOKEN?.trim();
    if (token) return googleClient(token);
    // No token → report not connected rather than silently doing nothing.
    return {
      kind: "google",
      live: false,
      async fetchReviews(): Promise<NormalizedReview[]> {
        throw new DomainError(
          "PLATFORM_NOT_CONNECTED",
          "Google Business Profile is not connected. Set GOOGLE_BUSINESS_ACCESS_TOKEN on the server.",
          422,
        );
      },
      async replyToReview(): Promise<PublishReplyResult> {
        throw new DomainError(
          "PLATFORM_NOT_CONNECTED",
          "Google Business Profile is not connected. Set GOOGLE_BUSINESS_ACCESS_TOKEN on the server.",
          422,
        );
      },
    };
  }
  // Any platform without a live adapter falls back to the mock so the
  // pipeline stays exercisable in development.
  return mockClient();
}
