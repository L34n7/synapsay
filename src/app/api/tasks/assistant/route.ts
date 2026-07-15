import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { analyzeAndApplyTaskMessage } from "@/lib/tasks/brain";

export const runtime = "nodejs";
export const maxDuration = 120;

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
    conversationId?: string;
    sourceMessageId?: string | null;
    message?: string;
  } | null;
  const conversationId = body?.conversationId?.trim() ?? "";
  const message = body?.message?.trim() ?? "";
  const sourceMessageId = body?.sourceMessageId?.trim() || null;
  if (
    !UUID_PATTERN.test(conversationId) ||
    (sourceMessageId && !UUID_PATTERN.test(sourceMessageId)) ||
    !message ||
    message.length > 20_000
  ) {
    return NextResponse.json({ error: "Pedido de agenda inválido." }, { status: 400 });
  }
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!conversation) {
    return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
  }
  try {
    const result = await analyzeAndApplyTaskMessage({
      supabase,
      userId,
      conversationId,
      sourceMessageId,
      currentMessage: message,
    });
    return NextResponse.json(result);
  } catch (reason) {
    console.error("Falha no cérebro de tarefas:", reason);
    return NextResponse.json(
      { error: reason instanceof Error ? reason.message : "Falha ao analisar a agenda." },
      { status: 500 },
    );
  }
}

