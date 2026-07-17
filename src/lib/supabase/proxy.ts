import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function copyCookies(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach((cookie) => to.cookies.set(cookie));
  return to;
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const authenticated = Boolean(data?.claims?.sub);
  const path = request.nextUrl.pathname;
  const privatePath =
    path.startsWith("/dashboard") ||
    path.startsWith("/memorias") ||
    path.startsWith("/historico") ||
    path.startsWith("/agenda") ||
    path.startsWith("/personalidade") ||
    path === "/redefinir-senha";

  if (privatePath && !authenticated) {
    const url = new URL("/", request.url);
    url.searchParams.set("erro", "sessao_expirada");
    return copyCookies(response, NextResponse.redirect(url));
  }

  if (authenticated && data?.claims?.sub) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarding_completed")
      .eq("id", data.claims.sub)
      .maybeSingle();
    const needsOnboarding = profile?.onboarding_completed === false;

    if (needsOnboarding && path !== "/personalidade") {
      return copyCookies(
        response,
        NextResponse.redirect(new URL("/personalidade?onboarding=1", request.url)),
      );
    }
  }

  if (path === "/" && authenticated) {
    return copyCookies(response, NextResponse.redirect(new URL("/dashboard", request.url)));
  }

  return response;
}
