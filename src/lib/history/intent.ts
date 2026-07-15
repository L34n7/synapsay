import { createHash } from "node:crypto";
import { AI_MODELS } from "@/lib/ai/models";
import type {
  HistoryDirection,
  HistoryScope,
} from "@/lib/history/search";

export type HistoryIntent = {
  shouldSearch: boolean;
  query: string;
  direction: HistoryDirection;
  scope: HistoryScope;
  anchorMessageId: string | null;
  window: number;
  from: string | null;
  to: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    "scope",
    "anchor_message_id",
    "window",
    "from",
    "to",
  ],
  properties: {
    should_search: { type: "boolean" },
    query: { type: "string" },
    direction: {
      type: "string",
      enum: ["around", "before", "after"],
    },
    scope: {
      type: "string",
      enum: ["current", "global", "all"],
    },
    anchor_message_id: { type: ["string", "null"] },
    window: { type: "integer", minimum: 2, maximum: 20 },
    from: { type: ["string", "null"] },
    to: { type: ["string", "null"] },
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
    scope: "all",
    anchorMessageId: null,
    window: 4,
    from: null,
    to: null,
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
        "Não ative quando a resposta estiver explícita no contexto visível e não houver pedido de verificação, leitura ou recuperação do trecho.",
        "Em query, reescreva o significado do assunto procurado em uma frase curta e específica. Inclua sinônimos naturais quando ajudarem; remova frases genéricas como 'você lembra'.",
        "Para perguntas de rotina com uma data, como 'o que tenho para hoje/amanhã?', use uma query neutra de assunto, por exemplo 'tarefas, compromissos e planejamento', e use from/to exclusivamente para delimitar a data. Assim a busca pode sugerir compromissos próximos sem confundir os dias.",
        "Use scope=current para 'agora há pouco', 'alguns minutos atrás', 'nesta conversa' e referências à sessão atual. Use scope=global para 'ontem', 'outro dia', 'conversa antiga' ou quando o usuário excluir a conversa atual. Use scope=all quando não estiver claro em qual conversa ocorreu.",
        "Preencha from e to em ISO 8601 quando houver uma referência temporal útil. Para intervalos relativos, calcule com base na data atual informada. Caso contrário use null.",
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
                `AGORA (UTC): ${new Date().toISOString()}`,
                "FUSO PADRÃO DO USUÁRIO: America/Sao_Paulo",
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
      scope?: unknown;
      anchor_message_id?: unknown;
      window?: unknown;
      from?: unknown;
      to?: unknown;
    };
    const direction: HistoryDirection = ["before", "after"].includes(
      String(parsed.direction),
    )
      ? (parsed.direction as HistoryDirection)
      : "around";
    let scope: HistoryScope = ["current", "global"].includes(
      String(parsed.scope),
    )
      ? (parsed.scope as HistoryScope)
      : "all";
    const normalizedMessage = currentMessage
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (
      /(?:agora ha pouco|nesta conversa|nessa conversa|alguns? minutos?|minutos? atras)/.test(
        normalizedMessage,
      )
    ) {
      scope = "current";
    }
    const safeDate = (value: unknown) => {
      if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
        return null;
      }
      return new Date(value).toISOString();
    };

    return {
      shouldSearch: parsed.should_search === true,
      query: typeof parsed.query === "string" ? parsed.query.trim().slice(0, 300) : "",
      direction,
      scope,
      anchorMessageId:
        typeof parsed.anchor_message_id === "string" &&
        UUID_PATTERN.test(parsed.anchor_message_id)
          ? parsed.anchor_message_id
          : null,
      window: Math.min(20, Math.max(2, Number(parsed.window) || 4)),
      from: safeDate(parsed.from),
      to: safeDate(parsed.to),
    };
  } catch {
    return fallback;
  }
}
