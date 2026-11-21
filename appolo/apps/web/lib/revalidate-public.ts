import { revalidatePath, revalidateTag } from "next/cache";

/**
 * On-demand revalidation for the public surface.
 *
 * The sitemap is cached (ISR, 300s) and tagged per entity kind, so a new
 * profile, pod or review must drop the tag as well as the page. Pages that
 * render a single entity get their concrete path revalidated; when the caller
 * does not know it, the dynamic pattern is revalidated instead
 * (`revalidatePath("/[username]", "page")`), which covers every page in that
 * segment.
 *
 * Both APIs throw outside a request scope (background jobs, tests, seeds), so
 * a failure is logged and swallowed: revalidation is an optimisation and must
 * never turn a successful write into a 500.
 */

export const PUBLIC_TAGS = {
  profiles: "public:profiles",
  pods: "public:pods",
  reviews: "public:reviews",
} as const;

function attempt(label: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    console.warn(`[revalidate] ${label} skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** A profile changed (details, avatar, podiums, follower counts). */
export function revalidatePublicProfile(username?: string | null): void {
  attempt("profile tag", () => revalidateTag(PUBLIC_TAGS.profiles));
  attempt("profile page", () =>
    revalidatePath(username ? `/${username}` : "/[username]", "page"),
  );
}

/** A pod changed (created, edited, deleted, title list reordered). */
export function revalidatePublicPods(ownerUsername?: string | null, slug?: string | null): void {
  attempt("pod tag", () => revalidateTag(PUBLIC_TAGS.pods));
  attempt("pod by id", () => revalidatePath("/pods/[id]", "page"));
  attempt("pod by owner", () => revalidatePath("/[username]/[slug]", "page"));
  if (ownerUsername) attempt("owner profile", () => revalidatePath(`/${ownerUsername}`));
  if (ownerUsername && slug) attempt("pod page", () => revalidatePath(`/${ownerUsername}/${slug}`));
}

/** A review was written, edited, deleted, hidden or reported-and-actioned. */
export function revalidatePublicReview(reviewId?: string | null, username?: string | null): void {
  attempt("review tag", () => revalidateTag(PUBLIC_TAGS.reviews));
  attempt("review page", () =>
    revalidatePath(reviewId ? `/review/${reviewId}` : "/review/[id]", "page"),
  );
  if (username) attempt("author profile", () => revalidatePath(`/${username}`));
}

/** The share card for a profile's podium (it reads the latest ratings). */
export function revalidatePublicPodiumCard(username?: string | null): void {
  // `revalidatePath` takes only "page" | "layout" as a type; a Route Handler is
  // invalidated by its own path, so pass the concrete URL when it is known.
  attempt("podium card", () => revalidatePath("/api/og/podium/[username]"));
  if (username) attempt("podium card path", () => revalidatePath(`/api/og/podium/${username}`));
}

/** Any public mutation can add or remove a sitemap entry. */
export function revalidatePublicSitemap(): void {
  attempt("sitemap", () => revalidatePath("/sitemap.xml"));
}
