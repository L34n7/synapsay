import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  analyzeAndApplyTaskMessage,
  formatTaskBrainToolResult,
} from "@/lib/tasks/brain";
import { syncTaskToGoogle } from "@/lib/google-calendar/sync";
import { analyzeAndApplyRoutineMessage } from "@/lib/routines/brain";
import { buildRoutineConversationContext } from "@/lib/routines/context";
import { executeRoutine, resolvePendingRoutine } from "@/lib/routines/executor";
import { resolvePendingRoutineSuggestion } from "@/lib/routines/suggestions";

export const runtime = "nodejs";
export const maxDuration = 120;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function executionMarker(message: string) {
  const routineId = message.match(/routineId=([0-9a-f-]{36})/i)?.[1] ?? null;
  const referenceKey = message.match(/referenceKey=([^\s;]+)/i)?.[1] ?? null;
  return routineId && referenceKey ? { routineId, referenceKey } : null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

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
    return NextResponse.json({ error: "Pedido do assistente inválido." }, { status: 400 });
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
    const marker = executionMarker(message);
    if (marker) {
      const execution = await executeRoutine({
        supabase,
        userId,
        routineId: marker.routineId,
        referenceKey: marker.referenceKey,
      });
      return NextResponse.json({
        success: true,
        kind: "routine_execution",
        ...execution,
        instruction:
          execution.feedbackPrompt ??
          "Leia o conteúdo ao usuário e depois retome a conversa normal.",
      });
    }

    const pending = await resolvePendingRoutine({ supabase, userId, message });
    if (pending?.handled) {
      return NextResponse.json({
        success: true,
        kind: "routine_confirmation",
        ...pending,
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("timezone")
      .eq("id", userId)
      .maybeSingle();
    const timezone = profile?.timezone || "America/Sao_Paulo";

    const suggestion = await resolvePendingRoutineSuggestion({
      supabase,
      userId,
      message,
      timezone,
    });
    if (suggestion?.handled) {
      return NextResponse.json({
        success: true,
        kind: "routine_suggestion",
        ...suggestion,
      });
    }

    const analysisMessage = await buildRoutineConversationContext({
      supabase,
      userId,
      conversationId,
      currentMessage: message,
      sourceMessageId,
    });

    const routine = await analyzeAndApplyRoutineMessage({
      supabase,
      userId,
      message: analysisMessage,
      source: "voice",
      timezone,
    });
    if (routine.handled) {
      return NextResponse.json({
        success: true,
        kind: "routine_management",
        ...routine,
        instruction:
          "Confirme ao usuário exatamente o resumo da operação estruturada. Nunca solicite routineId para criar uma nova rotina.",
      });
    }

    const result = await analyzeAndApplyTaskMessage({
      supabase,
      userId,
      conversationId,
      sourceMessageId,
      currentMessage: message,
    });
    if (
      (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) &&
      result.applied.length
    ) {
      const taskIds = result.applied.map((item) => item.taskId);
      after(async () => {
        const settled = await Promise.allSettled(
          taskIds.map((taskId) => syncTaskToGoogle(userId, taskId)),
        );
        settled.forEach((item, index) => {
          if (item.status === "rejected") {
            console.warn(
              `Tarefa ${taskIds[index]} não sincronizada com o Google:`,
              item.reason,
            );
          }
        });
      });
    }
    return NextResponse.json(formatTaskBrainToolResult(result));
  } catch (reason) {
    console.error("Falha no cérebro unificado de tarefas e rotinas:", reason);
    return NextResponse.json(
      {
        error:
          reason instanceof Error ? reason.message : "Falha ao analisar o pedido.",
      },
      { status: 500 },
    );
  }
}
