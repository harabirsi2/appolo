import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "appolo_session";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Sized like a UUID-ish token; anything else is treated as hostile input. */
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Correlation id for the whole request.
 *
 * An upstream proxy or a client retry may already carry one (`x-request-id`);
 * keep it so a retry is not split into two unrelated incidents in the logs.
 * Otherwise mint one. The id goes on the request (route handlers read it), on
 * every response (the user can quote it), and on the API access log line.
 */
function correlationId(request: NextRequest): string {
  const incoming = request.headers.get("x-request-id");
  return incoming && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
}

/** One JSON line per API request. Durations come from the route wrapper. */
function logApiRequest(request: NextRequest, id: string): void {
  if (!request.nextUrl.pathname.startsWith("/api/")) return;
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      event: "request_start",
      requestId: id,
      method: request.method,
      path: request.nextUrl.pathname,
    }),
  );
}

/**
 * Reject browser mutations that did not originate from this host.
 *
 * SameSite cookies are the first line of defence, but they are not enough for
 * every browser and do not cover form posts from a compromised same-site
 * origin. We validate Origin when the browser supplies it, fall back to
 * Referer, and use Sec-Fetch-Site when neither is present. A missing Origin is
 * allowed for non-browser clients (webhooks and API clients); a cross-site
 * fetch hint is never allowed.
 */
function mutationIsSameOrigin(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return true;

  const host = request.headers.get("host") ?? request.nextUrl.host;
  const origin = request.headers.get("origin");
  if (origin !== null) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  if (request.headers.get("sec-fetch-site") === "cross-site") return false;

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }

  // No browser provenance headers: allow non-browser clients such as signed
  // provider webhooks. Browser requests normally carry at least one of the
  // headers above, so a real cross-site form is still rejected.
  return true;
}

function securityHeaders(request: NextRequest, id: string): NextResponse {
  const nonce = btoa(crypto.randomUUID());
  const development = process.env.NODE_ENV !== "production";
  const isEmbed = request.nextUrl.pathname === "/embed" || request.nextUrl.pathname.startsWith("/embed/");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'" + (development ? " ws: wss:" : ""),
    "media-src 'self' https:",
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
    // Chat and review widgets are intentionally embeddable on customer sites;
    // every other route must not be framed.
    isEmbed ? "frame-ancestors *" : "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  // Next reads the nonce from the request CSP header and applies it to the
  // framework's inline bootstrap scripts. Keep the request header in sync with
  // the response header; a response-only CSP would block those scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-request-id", id);
  requestHeaders.set("Content-Security-Policy", csp);

  const next = NextResponse.next({ request: { headers: requestHeaders } });
  next.headers.set("x-request-id", id);
  next.headers.set("Content-Security-Policy", csp);
  next.headers.set("X-Content-Type-Options", "nosniff");
  if (!isEmbed) next.headers.set("X-Frame-Options", "DENY");
  next.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  next.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (!development) {
    next.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return next;
}

export function middleware(request: NextRequest): NextResponse {
  const id = correlationId(request);
  logApiRequest(request, id);

  if (!mutationIsSameOrigin(request)) {
    const rejected = NextResponse.json(
      { error: "Cross-origin request rejected.", code: "CSRF_REJECTED" },
      { status: 403 },
    );
    rejected.headers.set("x-request-id", id);
    return rejected;
  }

  const isApp = request.nextUrl.pathname === "/app" || request.nextUrl.pathname.startsWith("/app/");
  if (isApp && !request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", request.nextUrl.pathname);
    const redirect = NextResponse.redirect(url);
    redirect.headers.set("x-request-id", id);
    return redirect;
  }

  return securityHeaders(request, id);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff|woff2)$).*)",
  ],
};
