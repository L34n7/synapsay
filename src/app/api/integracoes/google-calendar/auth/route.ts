import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authenticatedUserId } from "@/lib/google-calendar/api";
import { GOOGLE_CALENDAR_SCOPES, googleCalendarConfig } from "@/lib/google-calendar/config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) {
    return NextResponse.redirect(new URL("/?erro=login_necessario", request.url));
  }

  try {
    const config = googleCalendarConfig();
    const state = randomBytes(32).toString("base64url");
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: GOOGLE_CALENDAR_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    const response = NextResponse.redirect(
      `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    );
    response.cookies.set("synapsay_google_calendar_oauth_state", state, {
      httpOnly: true,
      secure: new URL(request.url).protocol === "https:",
      sameSite: "lax",
      path: "/api/integracoes/google-calendar",
      maxAge: 10 * 60,
    });
    return response;
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "configuracao_invalida";
    const url = new URL("/agenda", request.url);
    url.searchParams.set("google_calendar", "error");
    url.searchParams.set("message", message);
    return NextResponse.redirect(url);
  }
}
