import { NextResponse } from "next/server";
import { extractMemories } from "@/lib/memory/extract";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id, memory_processing_status, title_source")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (conversationError || !conversation) {
    return NextResponse.json(
      { error: "Conversa não encontrada." },
      { status: 404 },
    );
  }

  if (conversation.memory_processing_status === "processing") {
    return NextResponse.json(
      { error: "Esta conversa já está sendo analisada." },
      { status: 409 },
    );
  }

  const { data: messages, error: messagesError } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", id)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(300);

  if (messagesError) {
    return NextResponse.json(
      { error: "Não foi possível carregar a conversa." },
      { status: 500 },
    );
  }

  if (!messages?.some((message) => message.role === "user")) {
    return NextResponse.json(
      { error: "Converse um pouco antes de gerar memórias." },
      { status: 400 },
    );
  }

  await supabase
    .from("conversations")
    .update({
      memory_processing_status: "processing",
      memory_processing_error: null,
    })
    .eq("id", id)
    .eq("user_id", userId);

  try {
    const result = await extractMemories({
      supabase,
      userId,
      messages,
    });

    const candidates = result.memories.map((memory) => ({
      user_id: userId,
      conversation_id: id,
      title: memory.title,
      content: memory.content,
      category: memory.category,
      source: "conversation",
      importance: memory.importance,
      status: "active",
      review_status: "pending",
      memory_type: memory.memoryType,
      expires_at: memory.expiresAt,
      dedupe_key: memory.dedupeKey,
      metadata: {
        extracted_at: new Date().toISOString(),
        extracted_by: result.model,
        input_type: "voice",
      },
    }));

    let insertedCount = 0;
    if (candidates.length) {
      const { data: inserted, error: insertError } = await supabase
        .from("memories")
        .upsert(candidates, {
          onConflict: "user_id,dedupe_key",
          ignoreDuplicates: true,
        })
        .select("id");

      if (insertError) throw new Error("Não foi possível salvar as memórias.");
      insertedCount = inserted?.length ?? 0;
    }

    const finishedAt = new Date().toISOString();
    const conversationUpdate: Record<string, string | null> = {
      status: "archived",
      ended_at: finishedAt,
      end_reason: "user_finalized",
      memory_processed_at: finishedAt,
      memory_processing_status: "completed",
      memory_processing_error: null,
    };
    if (conversation.title_source !== "manual") {
      conversationUpdate.title = result.conversationTitle;
      conversationUpdate.title_source = "generated";
      conversationUpdate.title_generated_at = finishedAt;
    }

    await supabase
      .from("conversations")
      .update(conversationUpdate)
      .eq("id", id)
      .eq("user_id", userId);

    return NextResponse.json({
      candidateCount: candidates.length,
      insertedCount,
      duplicateCount: candidates.length - insertedCount,
    });
  } catch (reason) {
    const detail =
      reason instanceof Error ? reason.message : "Falha ao analisar a conversa.";

    await supabase
      .from("conversations")
      .update({
        memory_processing_status: "failed",
        memory_processing_error: detail.slice(0, 500),
      })
      .eq("id", id)
      .eq("user_id", userId);

    console.error("Falha ao extrair memórias:", reason);
    return NextResponse.json({ error: detail }, { status: 502 });
  }
}
