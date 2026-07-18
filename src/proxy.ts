import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

function ndjsonResponse({
  assistantId,
  userMessageId,
  content,
}: {
  assistantId: string;
  userMessageId: string | null;
  content: string;
}) {
  const payload =
    [
      { type: "start", assistantId, userMessageId },
      { type: "delta", delta: content },
      { type: "done", assistantId, status: "completed" },
    ]
      .map((item) => JSON.stringify(item))
      .join("\n") + "\n";

  return new Response(payload, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function proxy(request: NextRequest) {
  if (request.method === "POST" && request.nextUrl.pathname === "/api/chat") {
    try {
      const body = await request.clone().json();
      const message = typeof body?.content === "string" ? body.content.trim() : "";
      const conversationId =
        typeof body?.conversationId === "string" ? body.conversationId : "";
      const clientMessageId =
        typeof body?.clientMessageId === "string"
          ? body.clientMessageId
          : crypto.randomUUID();

      if (message && conversationId) {
        const commonHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          cookie: request.headers.get("cookie") ?? "",
        };
        const authorization = request.headers.get("authorization");
        if (authorization) commonHeaders.authorization = authorization;

        const brainResponse = await fetch(
          new URL("/api/routines/brain", request.url),
          {
            method: "POST",
            headers: commonHeaders,
            body: JSON.stringify({
              message,
              source: "text",
              conversationId,
            }),
            cache: "no-store",
          },
        );
        const brain = (await brainResponse.json().catch(() => null)) as {
          handled?: boolean;
          summary?: string;
        } | null;

        if (brainResponse.ok && brain?.handled && brain.summary) {
          const messagesUrl = new URL(
            `/api/conversations/${conversationId}/messages`,
            request.url,
          );

          const userSave = await fetch(messagesUrl, {
            method: "POST",
            headers: commonHeaders,
            body: JSON.stringify({
              role: "user",
              content: message,
              inputType: "text",
              externalEventId: `text:${clientMessageId}`,
            }),
          });
          const userData = (await userSave.json().catch(() => null)) as {
            message?: { id?: string } | null;
          } | null;

          const assistantSave = await fetch(messagesUrl, {
            method: "POST",
            headers: commonHeaders,
            body: JSON.stringify({
              role: "assistant",
              content: brain.summary,
              inputType: "text",
              externalEventId: `assistant:text:${clientMessageId}`,
            }),
          });
          const assistantData = (await assistantSave.json().catch(() => null)) as {
            message?: { id?: string } | null;
          } | null;

          return ndjsonResponse({
            assistantId: assistantData?.message?.id ?? crypto.randomUUID(),
            userMessageId: userData?.message?.id ?? null,
            content: brain.summary,
          });
        }
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
