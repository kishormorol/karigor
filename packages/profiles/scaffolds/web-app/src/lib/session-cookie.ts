/** Shared by the server code and the middleware (which must not import the database). */
export const SESSION_COOKIE = "app_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

/**
 * Pages anyone may open without signing in. Add the app's own public pages here (a booking form,
 * a parent's lookup page); everything else needs a signed-in person.
 */
export const PUBLIC_PATHS: RegExp[] = [/^\/login\/?$/, /^\/welcome\/[^/]+\/?$/, /^\/api\/health\/?$/, /^\/api\/jobs\/?$/, /^\/icon\.svg$/, /^\/favicon\.ico$/, /^\/manifest\.webmanifest$/];
