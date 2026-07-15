import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_MODELS } from "@/lib/ai/models";

const EMBEDDING_DIMENSIONS = 1536;
const MAX_EMBEDDING_CHARS = 12_000;

type EmbeddingPayload = {
  data?: Array<{ index?: number; embedding?: number[] }>;
  error?: { message?: string };
};

function safeInput(value: string) {
  return value.trim().slice(0, MAX_EMBEDDING_CHARS);
}

export async function createHistoryEmbeddings({
  texts,
  userId,
}: {
  texts: string[];
  userId: string;
}): Promise<number[][]> {
  const input = texts.map(safeInput).filter(Boolean);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !input.length) return [];

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AI_MODELS.embedding,
      input,
      dimensions: EMBEDDING_DIMENSIONS,
      encoding_format: "float",
      user: createHash("sha256").update(userId).digest("hex"),
    }),
  }).catch(() => null);

  if (!response?.ok) {
    const payload = (await response?.json().catch(() => null)) as
      | EmbeddingPayload
      | null;
    console.warn(
      "Falha ao gerar embedding do histórico:",
      payload?.error?.message ?? response?.status ?? "sem resposta",
    );
    return [];
  }

  const payload = (await response.json()) as EmbeddingPayload;
  return (payload.data ?? [])
    .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
    .map((item) => item.embedding ?? [])
    .filter((embedding) => embedding.length === EMBEDDING_DIMENSIONS);
}

export async function embedHistoryMessage({
  supabase,
  userId,
  messageId,
  content,
}: {
  supabase: SupabaseClient;
  userId: string;
  messageId: string;
  content: string;
}) {
  const [embedding] = await createHistoryEmbeddings({
    texts: [content],
    userId,
  });
  if (!embedding) return false;

  const { error } = await supabase
    .from("messages")
    .update({
      embedding,
      embedding_model: AI_MODELS.embedding,
      embedding_updated_at: new Date().toISOString(),
    })
    .eq("id", messageId)
    .eq("user_id", userId);

  if (error) {
    console.warn("Falha ao salvar embedding da mensagem:", error.message);
    return false;
  }
  return true;
}

export async function backfillHistoryEmbeddings({
  supabase,
  userId,
  limit = 40,
}: {
  supabase: SupabaseClient;
  userId: string;
  limit?: number;
}) {
  const safeLimit = Math.min(100, Math.max(1, Math.round(limit) || 40));
  const { data: messages, error } = await supabase
    .from("messages")
    .select("id, content")
    .eq("user_id", userId)
    .eq("generation_status", "completed")
    .is("embedding", null)
    .neq("content", "")
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error || !messages?.length) {
    return { processed: 0, failed: error ? safeLimit : 0 };
  }

  const embeddings = await createHistoryEmbeddings({
    texts: messages.map((message) => String(message.content)),
    userId,
  });
  if (embeddings.length !== messages.length) {
    return { processed: 0, failed: messages.length };
  }

  const results = await Promise.all(
    messages.map((message, index) =>
      supabase
        .from("messages")
        .update({
          embedding: embeddings[index],
          embedding_model: AI_MODELS.embedding,
          embedding_updated_at: new Date().toISOString(),
        })
        .eq("id", message.id)
        .eq("user_id", userId),
    ),
  );
  const failed = results.filter((result) => result.error).length;
  return { processed: messages.length - failed, failed };
}
