import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { analyzeAndApplyRoutineMessage } from "@/lib/routines/brain";
import { buildRoutineConversationContext } from "@/lib/routines/context";
import { resolvePendingRoutine } from "@/lib/routines/executor";
import { resolvePendingRoutineSuggestion } from "@/lib/routines/suggestions";

const STRONG_ROUTINE_INTENT =
  /(?:rotina|agend(?:a|ar|e)|program(?:a|ar|e)|automatiz(?:a|ar|e)|todo dia|todos os dias|primeira conversa|a partir das|sempre que)/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub ? String(authData.claims.sub) : null;
  if (!userId) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const source = body?.source === "voice" ? "voice" : "text";
  const conversationId =
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
    const pending = await resolvePendingRoutine({ supabase, userId, message });
    if (pending?.handled) return NextResponse.json(pending);

    const suggestion = await resolvePendingRoutineSuggestion({
      supabase,
      userId,
      message,
      timezone,
    });
    if (suggestion?.handled) return NextResponse.json(suggestion);

    const analysisMessage = await buildRoutineConversationContext({
      supabase,
      userId,
      conversationId,
      currentMessage: message,
    });

    const result = await analyzeAndApplyRoutineMessage({
      supabase,
      userId,
      message: analysisMessage,
      source,
      timezone,
    });

    if (!result.handled && STRONG_ROUTINE_INTENT.test(analysisMessage)) {
      return NextResponse.json({
        handled: true,
        operation: "clarification",
        summary:
          "Não consegui concluir o salvamento desta rotina nesta tentativa. Você não precisa informar ID, chave técnica, fuso ou nome interno. Diga apenas a ação, o horário e se quer confirmação antes de executar.",
      });
    }

    return NextResponse.json(result);
  } catch (reason) {
    console.error("Falha no cérebro de rotinas:", reason);
    return NextResponse.json(
      {
        handled: true,
        operation: "error",
        summary:
          "Não consegui salvar a rotina por uma falha interna. Você não precisa fornecer nenhum ID técnico. Tente novamente mantendo ação e horário na mesma frase.",
      },
      { status: 200 },
    );
  }
}
