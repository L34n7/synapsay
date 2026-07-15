import { NextResponse } from "next/server";
import {
  searchConversationHistory,
  type HistoryDirection,
} from "@/lib/history/search";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    query?: unknown;
    direction?: unknown;
    anchorMessageId?: unknown;
    window?: unknown;
    currentConversationId?: unknown;
  } | null;

  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const direction: HistoryDirection = ["before", "after"].includes(
    String(body?.direction),
  )
    ? (body?.direction as HistoryDirection)
    : "around";
  const anchorMessageId =
    typeof body?.anchorMessageId === "string" &&
    UUID_PATTERN.test(body.anchorMessageId)
      ? body.anchorMessageId
      : null;
  const currentConversationId =
    typeof body?.currentConversationId === "string" &&
    UUID_PATTERN.test(body.currentConversationId)
      ? body.currentConversationId
      : null;
  const window = Math.min(20, Math.max(2, Number(body?.window) || 4));

  if (!anchorMessageId && (!query || query.length > 300)) {
    return NextResponse.json(
      { error: "Informe o assunto que deve ser procurado." },
      { status: 400 },
    );
  }

  const result = await searchConversationHistory({
    supabase,
    userId,
    query,
    direction,
    anchorMessageId,
    window,
    excludeConversationId: anchorMessageId ? null : currentConversationId,
  });

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
