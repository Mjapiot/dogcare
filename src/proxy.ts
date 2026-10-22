import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/env";

const PUBLIC_PATHS = ["/.well-known", "/confidentialite", "/assistance", "/login", "/auth", "/calendar", "/offline", "/manifest.webmanifest", "/sw.js"];

/**
 * Refreshes the Supabase session cookie on every navigation and sends
 * signed-out visitors to the login page. This is only an optimistic check:
 * every data access is still authorized by RLS in the database.
 */
export async function proxy(request: NextRequest) {
  const env = getSupabaseEnv();
  if (!env) {
    // not configured yet: only the login page (which explains it) is reachable
    const isPublicPath = PUBLIC_PATHS.some((p) => request.nextUrl.pathname === p || request.nextUrl.pathname.startsWith(`${p}/`));
    return isPublicPath ? NextResponse.next() : NextResponse.redirect(new URL("/login", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
    const redirect = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: [
    // everything except static assets and generated icons
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|pwa-icon|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)",
  ],
};
