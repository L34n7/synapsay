import type { SupabaseClient } from "@supabase/supabase-js";

export type HistoryDirection = "around" | "before" | "after";

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
  messages: HistoryMessage[];
};

export type HistorySearchResult = {
  found: boolean;
  query: string;
  direction: HistoryDirection;
  reason?: "not_found" | "query_too_vague" | "anchor_not_found";
  excerpts: HistoryExcerpt[];
};

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
    .toLocaleLowerCase("pt-BR");
}

function searchTerms(query: string) {
  return [
    ...new Set(
      query
        .split(/\s+/)
        .map((term) => term.replace(/[^\p{L}\p{N}@._-]/gu, "").trim())
        .filter((term) => term.length >= 3 && !STOP_WORDS.has(term.toLowerCase())),
    ),
  ].slice(0, 6);
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

async function excerptFromAnchor({
  supabase,
  userId,
  anchor,
  direction,
  window,
}: {
  supabase: SupabaseClient;
  userId: string;
  anchor: {
    id: string;
    conversation_id: string;
    role: string;
    content: string;
    created_at: string;
  };
  direction: HistoryDirection;
  window: number;
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
          .limit(beforeCount)
      : Promise.resolve({ data: [] }),
    afterCount
      ? supabase
          .from("messages")
          .select("id, role, content, created_at")
          .eq("conversation_id", anchor.conversation_id)
          .eq("user_id", userId)
          .gt("created_at", anchor.created_at)
          .order("created_at", { ascending: true })
          .limit(afterCount)
      : Promise.resolve({ data: [] }),
  ]);

  const before = [...(beforeResult.data ?? [])].reverse();
  const rows = [
    ...before,
    {
      id: anchor.id,
      role: anchor.role,
      content: anchor.content,
      created_at: anchor.created_at,
    },
    ...(afterResult.data ?? []),
  ];
  const messages = rows.map(mapMessage);

  return {
    conversationId: anchor.conversation_id,
    conversationTitle:
      conversationResult.data?.title?.trim() || "Conversa sem título",
    anchorMessageId: anchor.id,
    beforeAnchorId: messages[0]?.id ?? anchor.id,
    afterAnchorId: messages[messages.length - 1]?.id ?? anchor.id,
    messages,
  };
}

export async function searchConversationHistory({
  supabase,
  userId,
  query,
  direction = "around",
  anchorMessageId,
  window = 4,
  excludeConversationId,
}: {
  supabase: SupabaseClient;
  userId: string;
  query: string;
  direction?: HistoryDirection;
  anchorMessageId?: string | null;
  window?: number;
  excludeConversationId?: string | null;
}): Promise<HistorySearchResult> {
  const safeQuery = query.trim().slice(0, 300);
  const safeWindow = Math.min(20, Math.max(2, Math.round(window) || 4));

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
    });
    return {
      found: true,
      query: safeQuery,
      direction,
      excerpts: [excerpt],
    };
  }

  const terms = searchTerms(safeQuery);
  if (!terms.length) {
    return {
      found: false,
      query: safeQuery,
      direction,
      reason: "query_too_vague",
      excerpts: [],
    };
  }

  const searches = await Promise.all(
    terms.map((term) =>
      supabase
        .from("messages")
        .select("id, conversation_id, role, content, created_at")
        .eq("user_id", userId)
        .ilike("content", `%${term}%`)
        .order("created_at", { ascending: false })
        .limit(30),
    ),
  );

  const candidates = new Map<
    string,
    {
      id: string;
      conversation_id: string;
      role: string;
      content: string;
      created_at: string;
    }
  >();

  for (const result of searches) {
    for (const row of result.data ?? []) {
      if (excludeConversationId && row.conversation_id === excludeConversationId) {
        continue;
      }
      candidates.set(row.id, row);
    }
  }

  const normalizedQuery = normalized(safeQuery);
  const normalizedTerms = terms.map(normalized);
  const ranked = [...candidates.values()]
    .map((row) => {
      const text = normalized(row.content);
      const matches = normalizedTerms.filter((term) => text.includes(term)).length;
      const exact = normalizedQuery.length >= 4 && text.includes(normalizedQuery);
      return {
        row,
        score: matches * 4 + (exact ? 12 : 0) + (row.role === "user" ? 1 : 0),
      };
    })
    .filter((item) => item.score >= Math.max(4, normalizedTerms.length * 2))
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
      }),
    ),
  );

  return {
    found: true,
    query: safeQuery,
    direction,
    excerpts,
  };
}

export function formatHistoryForModel(result: HistorySearchResult) {
  if (!result.found) {
    return [
      "<resultado_busca_historico>",
      `Nenhum trecho foi encontrado para: ${result.query || "consulta sem assunto definido"}.`,
      "Não invente nem presuma que isso foi conversado. Responda de forma amigável que não encontrou essa conversa e não sabe do que se trata.",
      result.reason === "query_too_vague"
        ? "A pergunta ficou vaga; peça ao usuário um detalhe curto sobre o assunto."
        : "",
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
    "Use somente os trechos abaixo para responder. Diferencie claramente o que foi dito pelo usuário do que foi respondido pela Synapsay.",
    "Você pode resumir, comentar ou ler o trecho, conforme o pedido. Não afirme nada além do conteúdo encontrado.",
    excerpts,
    "</resultado_busca_historico>",
  ].join("\n");
}
