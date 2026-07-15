import type { SupabaseClient } from "@supabase/supabase-js";
import {
  backfillHistoryEmbeddings,
  createHistoryEmbeddings,
} from "@/lib/history/embeddings";

export type HistoryDirection = "around" | "before" | "after";
export type HistoryScope = "current" | "global" | "all";

export type HistoryMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type HistoryExcerpt = {
  conversationId: string;
  conversationTitle: string;
  anchorMessageId: string;
  beforeAnchorId: string;
  afterAnchorId: string;
  similarity?: number;
  messages: HistoryMessage[];
};

export type HistorySearchResult = {
  found: boolean;
  query: string;
  direction: HistoryDirection;
  scope: HistoryScope;
  reason?: "not_found" | "query_too_vague" | "anchor_not_found";
  excerpts: HistoryExcerpt[];
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
};

type Candidate = MessageRow & { similarity?: number };

const STOP_WORDS = new Set([
  "a", "ao", "aos", "as", "de", "da", "das", "do", "dos", "e", "em",
  "eu", "isso", "isto", "me", "meu", "minha", "na", "nas", "no", "nos",
  "o", "os", "ou", "para", "por", "que", "se", "sobre", "um", "uma",
  "voce", "você", "lembra", "lembrar", "falei", "falamos", "conversamos",
  "conversa", "outro", "outra", "dia", "antes", "depois", "mais",
]);

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

function searchTerms(query: string) {
  return [
    ...new Set(
      query
        .split(/\s+/)
        .map((term) => term.replace(/[^\p{L}\p{N}@._-]/gu, "").trim())
        .filter((term) => term.length >= 3 && !STOP_WORDS.has(term.toLowerCase())),
    ),
  ].slice(0, 8);
}

function validDate(value?: string | null) {
  if (!value || Number.isNaN(new Date(value).getTime())) return null;
  return new Date(value).toISOString();
}

function mapMessage(row: {
  id: string;
  role: string;
  content: string;
  created_at: string;
}): HistoryMessage {
  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: String(row.content).slice(0, 2500),
    createdAt: row.created_at,
  };
}

type SearchFilterBuilder<T> = {
  eq(column: string, value: unknown): T;
  neq(column: string, value: unknown): T;
  gte(column: string, value: unknown): T;
  lt(column: string, value: unknown): T;
};

function applySearchFilters<T extends SearchFilterBuilder<T>>(
  builder: T,
  {
    scope,
    currentConversationId,
    excludeMessageId,
    from,
    to,
  }: {
    scope: HistoryScope;
    currentConversationId?: string | null;
    excludeMessageId?: string | null;
    from?: string | null;
    to?: string | null;
  },
) {
  let query = builder;
  if (scope === "current" && currentConversationId) {
    query = query.eq("conversation_id", currentConversationId);
  } else if (scope === "global" && currentConversationId) {
    query = query.neq("conversation_id", currentConversationId);
  }
  if (excludeMessageId) query = query.neq("id", excludeMessageId);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lt("created_at", to);
  return query;
}

async function excerptFromAnchor({
  supabase,
  userId,
  anchor,
  direction,
  window,
  excludeMessageId,
}: {
  supabase: SupabaseClient;
  userId: string;
  anchor: MessageRow;
  direction: HistoryDirection;
  window: number;
  excludeMessageId?: string | null;
}): Promise<HistoryExcerpt> {
  const beforeCount = direction === "after" ? 0 : window;
  const afterCount = direction === "before" ? 0 : window;

  const [conversationResult, beforeResult, afterResult] = await Promise.all([
    supabase
      .from("conversations")
      .select("title")
      .eq("id", anchor.conversation_id)
      .eq("user_id", userId)
      .maybeSingle(),
    beforeCount
      ? supabase
          .from("messages")
          .select("id, role, content, created_at")
          .eq("conversation_id", anchor.conversation_id)
          .eq("user_id", userId)
          .lt("created_at", anchor.created_at)
          .order("created_at", { ascending: false })
          .limit(beforeCount + 1)
      : Promise.resolve({ data: [] }),
    afterCount
      ? supabase
          .from("messages")
          .select("id, role, content, created_at")
          .eq("conversation_id", anchor.conversation_id)
          .eq("user_id", userId)
          .gt("created_at", anchor.created_at)
          .order("created_at", { ascending: true })
          .limit(afterCount + 1)
      : Promise.resolve({ data: [] }),
  ]);

  const before = [...(beforeResult.data ?? [])]
    .filter((row) => row.id !== excludeMessageId)
    .slice(0, beforeCount)
    .reverse();
  const after = (afterResult.data ?? [])
    .filter((row) => row.id !== excludeMessageId)
    .slice(0, afterCount);
  const rows = [
    ...before,
    {
      id: anchor.id,
      role: anchor.role,
      content: anchor.content,
      created_at: anchor.created_at,
    },
    ...after,
  ].filter((row) => row.id !== excludeMessageId);
  const messages = rows.map(mapMessage);

  return {
    conversationId: anchor.conversation_id,
    conversationTitle:
      conversationResult.data?.title?.trim() || "Conversa sem título",
    anchorMessageId: anchor.id,
    beforeAnchorId: messages[0]?.id ?? anchor.id,
    afterAnchorId: messages[messages.length - 1]?.id ?? anchor.id,
    similarity:
      "similarity" in anchor && typeof anchor.similarity === "number"
        ? anchor.similarity
        : undefined,
    messages,
  };
}

async function semanticCandidates({
  supabase,
  userId,
  query,
  scope,
  currentConversationId,
  excludeMessageId,
  from,
  to,
}: {
  supabase: SupabaseClient;
  userId: string;
  query: string;
  scope: HistoryScope;
  currentConversationId?: string | null;
  excludeMessageId?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<Candidate[]> {
  await backfillHistoryEmbeddings({ supabase, userId, limit: 40 });
  const [queryEmbedding] = await createHistoryEmbeddings({
    texts: [query],
    userId,
  });
  if (!queryEmbedding) return [];

  const { data, error } = await supabase.rpc("match_message_history", {
    query_embedding: queryEmbedding,
    match_count: 30,
    filter_conversation_id:
      scope === "current" ? currentConversationId ?? null : null,
    exclude_conversation_id:
      scope === "global" ? currentConversationId ?? null : null,
    exclude_message_id: excludeMessageId ?? null,
    filter_from: from ?? null,
    filter_to: to ?? null,
  });

  if (error) {
    console.warn("Busca semântica indisponível; usando busca literal:", error.message);
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    conversation_id: String(row.conversation_id),
    role: String(row.role),
    content: String(row.content),
    created_at: String(row.created_at),
    similarity: Number(row.similarity) || 0,
  }));
}

export async function searchConversationHistory({
  supabase,
  userId,
  query,
  direction = "around",
  scope = "all",
  anchorMessageId,
  window = 4,
  currentConversationId,
  excludeMessageId,
  from,
  to,
}: {
  supabase: SupabaseClient;
  userId: string;
  query: string;
  direction?: HistoryDirection;
  scope?: HistoryScope;
  anchorMessageId?: string | null;
  window?: number;
  currentConversationId?: string | null;
  excludeMessageId?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<HistorySearchResult> {
  const safeQuery = query.trim().slice(0, 300);
  const safeWindow = Math.min(20, Math.max(2, Math.round(window) || 4));
  const safeFrom = validDate(from);
  const safeTo = validDate(to);
  const safeScope = scope === "current" || scope === "global" ? scope : "all";

  if (anchorMessageId) {
    const { data: anchor } = await supabase
      .from("messages")
      .select("id, conversation_id, role, content, created_at")
      .eq("id", anchorMessageId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!anchor) {
      return {
        found: false,
        query: safeQuery,
        direction,
        scope: safeScope,
        reason: "anchor_not_found",
        excerpts: [],
      };
    }

    const excerpt = await excerptFromAnchor({
      supabase,
      userId,
      anchor,
      direction,
      window: safeWindow,
      excludeMessageId,
    });
    return {
      found: true,
      query: safeQuery,
      direction,
      scope: safeScope,
      excerpts: [excerpt],
    };
  }

  if (!safeQuery) {
    return {
      found: false,
      query: safeQuery,
      direction,
      scope: safeScope,
      reason: "query_too_vague",
      excerpts: [],
    };
  }

  const terms = searchTerms(safeQuery);
  const searches = await Promise.all(
    terms.map((term) => {
      const builder = supabase
        .from("messages")
        .select("id, conversation_id, role, content, created_at")
        .eq("user_id", userId)
        .eq("generation_status", "completed")
        .ilike("content", `%${term}%`);
      return applySearchFilters(builder, {
        scope: safeScope,
        currentConversationId,
        excludeMessageId,
        from: safeFrom,
        to: safeTo,
      })
        .order("created_at", { ascending: false })
        .limit(30);
    }),
  );

  const semantic = await semanticCandidates({
    supabase,
    userId,
    query: safeQuery,
    scope: safeScope,
    currentConversationId,
    excludeMessageId,
    from: safeFrom,
    to: safeTo,
  });

  const candidates = new Map<string, Candidate>();
  for (const result of searches) {
    for (const row of result.data ?? []) candidates.set(row.id, row);
  }
  for (const row of semantic) {
    const existing = candidates.get(row.id);
    candidates.set(row.id, {
      ...(existing ?? row),
      similarity: Math.max(existing?.similarity ?? 0, row.similarity ?? 0),
    });
  }

  const normalizedQuery = normalized(safeQuery);
  const normalizedTerms = terms.map(normalized);
  const ranked = [...candidates.values()]
    .map((row) => {
      const text = normalized(row.content);
      const matches = normalizedTerms.filter((term) => text.includes(term)).length;
      const exact = normalizedQuery.length >= 4 && text.includes(normalizedQuery);
      const lexicalScore = matches * 4 + (exact ? 12 : 0);
      const similarity = row.similarity ?? 0;
      return {
        row,
        score:
          lexicalScore + similarity * 12 + (row.role === "user" ? 1 : 0),
        relevant: lexicalScore >= 4 || similarity >= 0.45,
      };
    })
    .filter((item) => item.relevant)
    .sort(
      (a, b) =>
        b.score - a.score ||
        new Date(b.row.created_at).getTime() - new Date(a.row.created_at).getTime(),
    );

  const selected: typeof ranked = [];
  const usedConversations = new Set<string>();
  for (const item of ranked) {
    if (usedConversations.has(item.row.conversation_id)) continue;
    selected.push(item);
    usedConversations.add(item.row.conversation_id);
    if (selected.length === 3) break;
  }

  if (!selected.length) {
    return {
      found: false,
      query: safeQuery,
      direction,
      scope: safeScope,
      reason: "not_found",
      excerpts: [],
    };
  }

  const excerpts = await Promise.all(
    selected.map(({ row }) =>
      excerptFromAnchor({
        supabase,
        userId,
        anchor: row,
        direction: "around",
        window: safeWindow,
        excludeMessageId,
      }),
    ),
  );

  return {
    found: true,
    query: safeQuery,
    direction,
    scope: safeScope,
    excerpts,
  };
}

export function formatHistoryForModel(result: HistorySearchResult) {
  if (!result.found) {
    return [
      "<resultado_busca_historico>",
      `Nenhum trecho foi encontrado para: ${result.query || "consulta sem assunto definido"}.`,
      "Não invente nem presuma que isso foi conversado. Diga de modo humano que não encontrou esse assunto e, se útil, peça uma palavra-chave ou detalhe curto.",
      result.reason === "query_too_vague"
        ? "A pergunta ficou vaga; peça ao usuário um detalhe curto sobre o assunto."
        : "",
      "Não faça afirmações sobre limitações técnicas, retenção, banco de dados ou por quanto tempo o sistema guarda conversas.",
      "</resultado_busca_historico>",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const excerpts = result.excerpts
    .map((excerpt, index) => {
      const messages = excerpt.messages
        .map(
          (message) =>
            `[${message.id}] ${message.createdAt} — ${message.role === "user" ? "USUÁRIO" : "SYNAPSAY"}: ${message.content}`,
        )
        .join("\n");
      return [
        `TRECHO ${index + 1} — ${excerpt.conversationTitle}`,
        `Âncora para expandir antes: ${excerpt.beforeAnchorId}`,
        `Âncora para expandir depois: ${excerpt.afterAnchorId}`,
        messages,
      ].join("\n");
    })
    .join("\n\n");

  return [
    "<resultado_busca_historico>",
    "Os trechos abaixo são evidências recuperadas. Diferencie claramente o que foi dito pelo usuário do que foi respondido pela Synapsay.",
    "Responda apenas com base nessas evidências. Você pode resumir, comentar ou ler o trecho, conforme o pedido.",
    "Nunca diga que encontrou algo que não esteja nos trechos e não faça afirmações sobre a arquitetura ou retenção do sistema.",
    excerpts,
    "</resultado_busca_historico>",
  ].join("\n");
}
