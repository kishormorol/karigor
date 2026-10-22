import { NextResponse, type NextRequest } from "next/server";
import { PUBLIC_PATHS, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session-cookie";

/**
 * An early redirect only: it checks that the sign-in cookie is there and never touches the database.
 * The real checks (requireUser, requirePermission, requireAction) run in layouts, pages and actions.
 */
export function middleware(req: NextRequest) {
  if (PUBLIC_PATHS.some((p) => p.test(req.nextUrl.pathname))) return NextResponse.next();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  // 303 so a form posted without a session becomes a plain GET of the login page.
  if (!token) return NextResponse.redirect(new URL("/login", req.url), 303);
  // Layouts cannot see the path; the sidebar reads it from this header to mark the current section.
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  const res = NextResponse.next({ request: { headers } });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
