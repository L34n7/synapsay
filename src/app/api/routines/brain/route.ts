import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { analyzeAndApplyRoutineMessage } from "@/lib/routines/brain";
import { buildRoutineConversationContext } from "@/lib/routines/context";
import { executeRoutine, resolvePendingRoutine } from "@/lib/routines/executor";
import { tryCreateNewsRoutineFallback } from "@/lib/routines/fallback";
import { resolvePendingRoutineSuggestion } from "@/lib/routines/suggestions";

const STRONG_ROUTINE_INTENT =
  /(?:rotina|agend(?:a|ar|e)|program(?:a|ar|e)|automatiz(?:a|ar|e)|todo dia|todos os dias|primeira conversa|próxima conversa|proxima conversa|a partir das|sempre que)/i;

function executionMarker(message: string) {
  const routineId = message.match(/routineId=([0-9a-f-]{36})/i)?.[1] ?? null;
  const referenceKey = message.match(/referenceKey=([^\s;]+)/i)?.[1] ?? null;
  return routineId && referenceKey ? { routineId, referenceKey } : null;
}

function extractUserRoutineText(analysisMessage: string) {
  const lines = analysisMessage.split("\n");
  const userLines = lines
    .filter(
      (line) => /^\d+\.\s/.test(line) || line.startsWith("PEDIDO ATUAL:"),
    )
    .map((line) =>
      line
        .replace(/^\d+\.\s*/, "")
        .replace(/^PEDIDO ATUAL:\s*/, "")
        .trim(),
    )
    .filter(Boolean);
  return userLines.length ? userLines.join("\n") : analysisMessage;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub ? String(authData.claims.sub) : null;
  if (!userId) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const source = body?.source === "voice" ? "voice" : "text";
  const sourceMessageId =
    typeof body?.sourceMessageId === "string" ? body.sourceMessageId.trim() : null;
  let conversationId =
    typeof body?.conversationId === "string" ? body.conversationId.trim() : null;

  if (!message) {
    return NextResponse.json({ error: "Mensagem obrigatória." }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle();
  const timezone = profile?.timezone || "America/Sao_Paulo";

  try {
    const marker = executionMarker(message);
    if (marker) {
      const execution = await executeRoutine({
        supabase,
        userId,
        routineId: marker.routineId,
        referenceKey: marker.referenceKey,
      });
      return NextResponse.json({
        handled: true,
        operation: "execute",
        summary: execution.content,
        ...execution,
      });
    }

    const pending = await resolvePendingRoutine({ supabase, userId, message });
    if (pending?.handled) return NextResponse.json(pending);

    const suggestion = await resolvePendingRoutineSuggestion({
      supabase,
      userId,
      message,
      timezone,
    });
    if (suggestion?.handled) return NextResponse.json(suggestion);

    // A ferramenta de voz nem sempre envia o ID da conversa. Nesse caso,
    // recuperamos a conversa ativa mais recente para reconstruir pedidos
    // divididos em várias falas, como horário -> assunto -> confirmação.
    if (!conversationId && source === "voice") {
      const { data: activeConversation } = await supabase
        .from("conversations")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      conversationId = activeConversation?.id ?? null;
    }

    const analysisMessage = await buildRoutineConversationContext({
      supabase,
      userId,
      conversationId,
      currentMessage: message,
      sourceMessageId,
    });
    const userRoutineText = extractUserRoutineText(analysisMessage);

    const result = await analyzeAndApplyRoutineMessage({
      supabase,
      userId,
      message: analysisMessage,
      source,
      timezone,
    });
    if (result.handled) return NextResponse.json(result);

    // Pedidos simples e completos de notícias não podem depender apenas da
    // classificação generativa. O fallback usa apenas as falas do usuário,
    // cria a rotina e evita duplicatas.
    const fallback = await tryCreateNewsRoutineFallback({
      supabase,
      userId,
      message: userRoutineText,
      source,
      timezone,
    });
    if (fallback) return NextResponse.json(fallback);

    if (STRONG_ROUTINE_INTENT.test(userRoutineText)) {
      return NextResponse.json({
        handled: true,
        operation: "clarification",
        summary:
          "Ainda falta um dado funcional para salvar a rotina. Diga o que devo fazer e o horário inicial. Você não precisa informar ID, chave técnica, nome interno ou fuso.",
      });
    }

    return NextResponse.json(result);
  } catch (reason) {
    console.error("Falha no cérebro de rotinas:", reason);
    return NextResponse.json({
      handled: true,
      operation: "error",
      summary:
        "Não consegui salvar a rotina por uma falha interna. Nenhum ID técnico é necessário. O pedido não foi salvo nesta tentativa.",
    });
  }
}
