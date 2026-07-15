import { createHash } from "node:crypto";
import { AI_MODELS } from "@/lib/ai/models";
import type { HistoryDirection } from "@/lib/history/search";

export type HistoryIntent = {
  shouldSearch: boolean;
  query: string;
  direction: HistoryDirection;
  anchorMessageId: string | null;
  window: number;
};

type ResponsesPayload = {
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

const schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "should_search",
    "query",
    "direction",
    "anchor_message_id",
    "window",
  ],
  properties: {
    should_search: { type: "boolean" },
    query: { type: "string" },
    direction: {
      type: "string",
      enum: ["around", "before", "after"],
    },
    anchor_message_id: { type: ["string", "null"] },
    window: { type: "integer", minimum: 2, maximum: 20 },
  },
};

function outputText(payload: ResponsesPayload) {
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text)
    .join("");
}

export async function interpretHistoryIntent({
  userId,
  currentMessage,
  recentMessages,
  lastSearch,
}: {
  userId: string;
  currentMessage: string;
  recentMessages: Array<{ role: string; content: string }>;
  lastSearch?: unknown;
}): Promise<HistoryIntent> {
  const fallback: HistoryIntent = {
    shouldSearch: false,
    query: "",
    direction: "around",
    anchorMessageId: null,
    window: 4,
  };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback;

  const context = recentMessages
    .slice(-12)
    .map(
      (message) =>
        `${message.role === "assistant" ? "SYNAPSAY" : "USUÁRIO"}: ${message.content.slice(0, 1200)}`,
    )
    .join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": createHash("sha256")
        .update(userId)
        .digest("hex"),
    },
    body: JSON.stringify({
      model: AI_MODELS.memoryBrain,
      store: false,
      max_output_tokens: 300,
      instructions: [
        "Você decide se a mensagem atual precisa consultar conversas antigas do mesmo usuário.",
        "Ative should_search quando o usuário perguntar se algo já foi dito, pedir para lembrar um acontecimento anterior, mencionar 'outro dia', 'eu falei', 'lembra disso', pedir para recuperar/ler/comentar um trecho antigo ou solicitar mais mensagens antes/depois de um resultado anterior.",
        "Não ative para perguntas respondidas apenas pelo contexto visível da conversa atual.",
        "Em query, escreva somente palavras-chave específicas do assunto procurado. Remova frases genéricas como 'você lembra'.",
        "Para expansão, use direction before ou after e reutilize a âncora adequada do último resultado. Para busca nova use around e âncora nula.",
        "Se o pedido de busca for vago demais e não houver assunto no contexto, ainda ative a busca com query vazia; o assistente pedirá um detalhe.",
      ].join(" "),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `MENSAGEM ATUAL: ${currentMessage}`,
                `CONVERSA RECENTE:\n${context || "Sem contexto anterior."}`,
                `ÚLTIMA BUSCA DE HISTÓRICO:\n${JSON.stringify(lastSearch ?? null)}`,
              ].join("\n\n"),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "synapsay_history_intent",
          strict: true,
          schema,
        },
      },
    }),
  }).catch(() => null);

  if (!response?.ok) return fallback;
  const payload = (await response.json()) as ResponsesPayload;
  const text = outputText(payload);
  if (!text) return fallback;

  try {
    const parsed = JSON.parse(text) as {
      should_search?: unknown;
      query?: unknown;
      direction?: unknown;
      anchor_message_id?: unknown;
      window?: unknown;
    };
    const direction: HistoryDirection = ["before", "after"].includes(
      String(parsed.direction),
    )
      ? (parsed.direction as HistoryDirection)
      : "around";

    return {
      shouldSearch: parsed.should_search === true,
      query: typeof parsed.query === "string" ? parsed.query.trim().slice(0, 300) : "",
      direction,
      anchorMessageId:
        typeof parsed.anchor_message_id === "string"
          ? parsed.anchor_message_id
          : null,
      window: Math.min(20, Math.max(2, Number(parsed.window) || 4)),
    };
  } catch {
    return fallback;
  }
}
