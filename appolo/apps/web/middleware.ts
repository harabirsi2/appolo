import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "appolo_session";

export function middleware(request: NextRequest): NextResponse {
  if (!request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app", "/app/:path*"],
};