import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_MODELS } from "@/lib/ai/models";
import { createHash } from "node:crypto";
import {
  createMemoryDedupeKey,
  MEMORY_CATEGORIES,
  type MemoryCategory,
  type MemoryType,
} from "@/lib/memory/normalize";

type ConversationMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type RawMemory = {
  title?: unknown;
  content?: unknown;
  category?: unknown;
  importance?: unknown;
  memory_type?: unknown;
  expires_at?: unknown;
};

type RawExtraction = {
  conversation_title?: unknown;
  memories?: unknown;
};

export type ExtractedMemory = {
  title: string;
  content: string;
  category: MemoryCategory;
  importance: number;
  memoryType: MemoryType;
  expiresAt: string | null;
  dedupeKey: string;
};

type ResponsesPayload = {
  output?: Array<{
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  error?: { message?: string };
};

const memorySchema = {
  type: "object",
  additionalProperties: false,
  required: ["conversation_title", "memories"],
  properties: {
    conversation_title: { type: "string" },
    memories: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "content",
          "category",
          "importance",
          "memory_type",
          "expires_at",
        ],
        properties: {
          title: { type: "string" },
          content: { type: "string" },
          category: { type: "string", enum: MEMORY_CATEGORIES },
          importance: { type: "integer", minimum: 1, maximum: 5 },
          memory_type: {
            type: "string",
            enum: ["permanent", "temporary"],
          },
          expires_at: { type: ["string", "null"] },
        },
      },
    },
  },
};

function getOutputText(payload: ResponsesPayload) {
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text" && content.text)
    .map((content) => content.text)
    .join("");
}

function trimTranscript(messages: ConversationMessage[]) {
  const recent = messages.slice(-100);
  const transcript = recent
    .map((message) =>
      `${message.role === "user" ? "USUÁRIO" : message.role === "assistant" ? "ASSISTENTE" : "SISTEMA"}: ${message.content.trim()}`,
    )
    .join("\n");

  return transcript.length > 32_000
    ? transcript.slice(transcript.length - 32_000)
    : transcript;
}

function parseDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.getTime() <= Date.now()
    ? null
    : date.toISOString();
}

function defaultTemporaryExpiration() {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
}

function validateMemories(value: unknown): ExtractedMemory[] {
  if (!value || typeof value !== "object") return [];
  const memories = (value as { memories?: unknown }).memories;
  if (!Array.isArray(memories)) return [];

  const dedupe = new Set<string>();
  const valid: ExtractedMemory[] = [];

  for (const item of memories.slice(0, 12) as RawMemory[]) {
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const content = typeof item.content === "string" ? item.content.trim() : "";
    const category = MEMORY_CATEGORIES.includes(item.category as MemoryCategory)
      ? (item.category as MemoryCategory)
      : "general";
    const importance = Math.min(
      5,
      Math.max(1, Math.round(Number(item.importance) || 3)),
    );
    const memoryType: MemoryType =
      item.memory_type === "temporary" ? "temporary" : "permanent";
    const expiresAt =
      memoryType === "temporary"
        ? parseDate(item.expires_at) ?? defaultTemporaryExpiration()
        : null;

    if (title.length < 2 || content.length < 3) continue;
    const dedupeKey = createMemoryDedupeKey(category, content);
    if (dedupe.has(dedupeKey)) continue;
    dedupe.add(dedupeKey);

    valid.push({
      title: title.slice(0, 80),
      content: content.slice(0, 500),
      category,
      importance,
      memoryType,
      expiresAt,
      dedupeKey,
    });
  }

  return valid;
}

function validateConversationTitle(value: unknown) {
  if (!value || typeof value !== "object") return "Nova conversa";
  const title = (value as RawExtraction).conversation_title;
  if (typeof title !== "string") return "Nova conversa";
  const normalized = title.replace(/[\r\n]+/g, " ").trim();
  return normalized ? normalized.slice(0, 80) : "Nova conversa";
}

export async function extractMemories({
  supabase,
  userId,
  messages,
}: {
  supabase: SupabaseClient;
  userId: string;
  messages: ConversationMessage[];
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada.");

  const { data: existing } = await supabase
    .from("memories")
    .select("category, content")
    .eq("user_id", userId)
    .neq("status", "forgotten")
    .order("updated_at", { ascending: false })
    .limit(150);

  const existingContext = (existing ?? [])
    .map((memory, index) => `${index + 1}. [${memory.category}] ${memory.content}`)
    .join("\n")
    .slice(0, 18_000);

  const model = AI_MODELS.memoryBrain;
  const safetyIdentifier = createHash("sha256").update(userId).digest("hex");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": safetyIdentifier,
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions: [
        "Você é o extrator de memórias da Synapsay.",
        "Crie também um título curto e específico para a conversa, com 3 a 8 palavras, sem aspas e sem pontuação final.",
        "Extraia somente fatos, preferências, metas, projetos, relações, rotinas ou compromissos explicitamente declarados pelo USUÁRIO e úteis em conversas futuras.",
        "Nunca transforme suposições, perguntas, sugestões ou falas do ASSISTENTE em memória.",
        "Quando o USUÁRIO confirmar uma rotina sugerida pela assistente, como 'sim, toda terça eu vou à padaria', salve como category=routine, memory_type=permanent e importância 4 ou 5 conforme utilidade.",
        "Para padrões apenas suspeitos, sem confirmação explícita do USUÁRIO, não crie memória permanente.",
        "Ignore saudações, conversa casual, pedidos momentâneos e informações triviais.",
        "Nunca memorize senhas, tokens, números de documentos, dados bancários, códigos de autenticação ou outros segredos.",
        "Cada memória deve ser atômica, objetiva e escrita em terceira pessoa, sem inventar detalhes.",
        "Use temporary somente para contexto com validade claramente limitada; caso contrário use permanent.",
        "Não repita uma memória já existente com o mesmo significado.",
        "Se não houver nada útil e explícito, devolva o array vazio.",
      ].join(" "),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `MEMÓRIAS JÁ EXISTENTES:\n${existingContext || "Nenhuma."}\n\nCONVERSA A ANALISAR:\n${trimTranscript(messages)}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "synapsay_memory_candidates",
          strict: true,
          schema: memorySchema,
        },
      },
    }),
  });

  const payload = (await response.json()) as ResponsesPayload;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Falha ao analisar a conversa.");
  }

  const outputText = getOutputText(payload);
  if (!outputText) throw new Error("A análise não retornou um resultado válido.");

  try {
    const parsed = JSON.parse(outputText);
    return {
      model,
      conversationTitle: validateConversationTitle(parsed),
      memories: validateMemories(parsed),
    };
  } catch {
    throw new Error("A análise retornou um formato inválido.");
  }
}
