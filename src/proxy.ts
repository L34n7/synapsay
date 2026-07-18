import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  if (request.method === "POST" && request.nextUrl.pathname === "/api/chat") {
    try {
      const body = await request.clone().json();
      const message = typeof body?.content === "string" ? body.content.trim() : "";
      if (message) {
        await fetch(new URL("/api/routines/brain", request.url), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: request.headers.get("cookie") ?? "",
          },
          body: JSON.stringify({ message, source: "text" }),
          cache: "no-store",
        });
      }
    } catch (reason) {
      console.warn("Cérebro de rotinas não executado no proxy:", reason);
    }
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|js)$).*)",
  ],
};
