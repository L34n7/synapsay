import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticatedUserId } from "@/lib/google-calendar/api";
import {
  exchangeGoogleAuthorizationCode,
  saveGoogleAuthorization,
} from "@/lib/google-calendar/client";

export const runtime = "nodejs";

function safeStateEqual(received: string, expected: string) {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function agendaRedirect(request: Request, status: "connected" | "error", message?: string) {
  const url = new URL("/agenda", request.url);
  url.searchParams.set("google_calendar", status);
  if (message) url.searchParams.set("message", message.slice(0, 300));
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const responseError = request.nextUrl.searchParams.get("error");
  const errorDescription = request.nextUrl.searchParams.get("error_description");
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const expectedState = request.cookies.get("synapsay_google_calendar_oauth_state")?.value ?? "";

  let response: NextResponse;
  try {
    if (responseError) {
      throw new Error(
        responseError === "access_denied"
          ? "A conexão com o Google foi cancelada."
          : errorDescription ?? "O Google não autorizou a conexão.",
      );
    }
    if (!code || !state || !expectedState || !safeStateEqual(state, expectedState)) {
      throw new Error("A autorização expirou ou não pôde ser validada. Tente conectar novamente.");
    }
    const userId = await authenticatedUserId();
    if (!userId) throw new Error("Sua sessão expirou. Entre novamente antes de conectar o Google.");
    const tokens = await exchangeGoogleAuthorizationCode(code);
    await saveGoogleAuthorization({
      userId,
      tokens: { ...tokens, access_token: tokens.access_token! },
    });
    response = agendaRedirect(request, "connected");
  } catch (reason) {
    response = agendaRedirect(
      request,
      "error",
      reason instanceof Error ? reason.message : "Falha ao conectar o Google Agenda.",
    );
  }
  response.cookies.set("synapsay_google_calendar_oauth_state", "", {
    httpOnly: true,
    expires: new Date(0),
    path: "/api/integracoes/google-calendar",
    sameSite: "lax",
  });
  return response;
}
