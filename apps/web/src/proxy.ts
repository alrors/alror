import { NextResponse, type NextRequest } from "next/server";

// Optimistic auth check for the console: only looks for the session cookie.
// The layout, the data layer and every action and route validate the session
// against Redis (src/lib/server/auth), so this is not the only gate.
const SESSION_COOKIE = "alror_sid";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname.startsWith("/app") && !hasSession) {
    const url = new URL("/login", req.url);
    if (pathname !== "/app") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // The admin area answers a real 404 to anyone who is not a platform admin (no
  // redirect, so the route is not revealed). Pages stream under the root loading
  // boundary, so their own notFound() could not set the status; the proxy asks
  // the admin access handler instead. /admin/api/* checks access itself.
  if ((pathname === "/admin" || pathname.startsWith("/admin/")) && !pathname.startsWith("/admin/api/")) {
    if (!hasSession || !(await isPlatformAdmin(req))) {
      return NextResponse.rewrite(new URL("/_admin-not-found", req.url), { status: 404 });
    }
  }

  return NextResponse.next();
}

/** Asks the app (src/app/admin/api/[action]) whether this session is a platform admin; fails closed. */
async function isPlatformAdmin(req: NextRequest): Promise<boolean> {
  try {
    const res = await fetch(new URL("/admin/api/access", req.url), {
      headers: { cookie: req.headers.get("cookie") ?? "" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    return res.status === 204;
  } catch {
    return false;
  }
}

export const config = {
  matcher: ["/app", "/app/:path*", "/admin", "/admin/:path*"],
};
