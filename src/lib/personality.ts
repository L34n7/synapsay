export const ASSISTANT_VOICES = [
  "marin",
  "cedar",
  "coral",
  "sage",
  "verse",
  "alloy",
  "ash",
  "ballad",
  "echo",
  "shimmer",
] as const;

export const COMMUNICATION_STYLES = [
  "balanced",
  "direct",
  "explanatory",
  "creative",
] as const;

export const RESPONSE_DETAILS = ["short", "balanced", "detailed"] as const;
export const ASSISTANT_TONES = ["friendly", "professional", "casual"] as const;

export type AssistantVoice = (typeof ASSISTANT_VOICES)[number];
export type CommunicationStyle = (typeof COMMUNICATION_STYLES)[number];
export type ResponseDetail = (typeof RESPONSE_DETAILS)[number];
export type AssistantTone = (typeof ASSISTANT_TONES)[number];

export type AssistantPersonality = {
  assistantName: string;
  preferredVoice: AssistantVoice;
  communicationStyle: CommunicationStyle;
  responseDetail: ResponseDetail;
  tone: AssistantTone;
  boundaries: string;
  prohibitedTopics: string[];
  customInstructions: string;
};

export type PersonalityRow = {
  assistant_name?: unknown;
  preferred_voice?: unknown;
  communication_style?: unknown;
  response_detail?: unknown;
  assistant_tone?: unknown;
  assistant_boundaries?: unknown;
  prohibited_topics?: unknown;
  custom_instructions?: unknown;
};

export const DEFAULT_PERSONALITY: AssistantPersonality = {
  assistantName: "Synapsay",
  preferredVoice: "marin",
  communicationStyle: "balanced",
  responseDetail: "balanced",
  tone: "friendly",
  boundaries: "",
  prohibitedTopics: [],
  customInstructions: "",
};

function isOneOf<T extends readonly string[]>(
  options: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && options.includes(value as T[number]);
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeProhibitedTopics(value: unknown) {
  if (!Array.isArray(value)) return [];

  return [
    ...new Set(
      value
        .filter((topic): topic is string => typeof topic === "string")
        .map((topic) => topic.trim().replace(/\s+/g, " ").slice(0, 80))
        .filter(Boolean),
    ),
  ].slice(0, 12);
}

export function normalizePersonalityRow(
  row?: PersonalityRow | null,
): AssistantPersonality {
  const assistantName = cleanText(row?.assistant_name, 40);

  return {
    assistantName:
      assistantName.length >= 2
        ? assistantName
        : DEFAULT_PERSONALITY.assistantName,
    preferredVoice: isOneOf(ASSISTANT_VOICES, row?.preferred_voice)
      ? row.preferred_voice
      : DEFAULT_PERSONALITY.preferredVoice,
    communicationStyle: isOneOf(
      COMMUNICATION_STYLES,
      row?.communication_style,
    )
      ? row.communication_style
      : DEFAULT_PERSONALITY.communicationStyle,
    responseDetail: isOneOf(RESPONSE_DETAILS, row?.response_detail)
      ? row.response_detail
      : DEFAULT_PERSONALITY.responseDetail,
    tone: isOneOf(ASSISTANT_TONES, row?.assistant_tone)
      ? row.assistant_tone
      : DEFAULT_PERSONALITY.tone,
    boundaries: cleanText(row?.assistant_boundaries, 1500),
    prohibitedTopics: normalizeProhibitedTopics(row?.prohibited_topics),
    customInstructions: cleanText(row?.custom_instructions, 2000),
  };
}

const styleInstructions: Record<CommunicationStyle, string> = {
  balanced:
    "Equilibre objetividade e contexto: responda primeiro o essencial e aprofunde quando isso for útil.",
  direct:
    "Vá direto ao ponto, elimine rodeios e destaque claramente a próxima ação.",
  explanatory:
    "Explique conceitos com sequência lógica, exemplos curtos e passos claros.",
  creative:
    "Use linguagem imaginativa, analogias e alternativas originais sem sacrificar a precisão.",
};

const detailInstructions: Record<ResponseDetail, string> = {
  short:
    "Prefira respostas curtas, normalmente de um a três parágrafos, salvo quando o usuário pedir detalhes.",
  balanced:
    "Use um nível moderado de detalhe e ajuste a extensão à complexidade da pergunta.",
  detailed:
    "Forneça contexto, etapas e exemplos relevantes; organize respostas longas para facilitar a leitura.",
};

const toneInstructions: Record<AssistantTone, string> = {
  friendly:
    "Adote um tom amigável, acolhedor e natural, mantendo honestidade e clareza.",
  professional:
    "Adote um tom profissional, preciso e respeitoso, sem soar frio ou burocrático.",
  casual:
    "Adote um tom descontraído e espontâneo, sem perder clareza ou respeito.",
};

export function buildPersonalityInstructions(
  personality: AssistantPersonality,
  channel: "voice" | "text",
) {
  const instructions = [
    `Você é ${personality.assistantName}, o assistente pessoal do usuário dentro da Synapsay. Use esse nome ao se apresentar e nunca alegue ter outro nome.`,
    "Responda em português do Brasil, a menos que o usuário peça explicitamente outro idioma. Seja verdadeiro, não invente fatos pessoais e admita incerteza quando necessário.",
    styleInstructions[personality.communicationStyle],
    detailInstructions[personality.responseDetail],
    toneInstructions[personality.tone],
    channel === "voice"
      ? "Esta é uma conversa por voz. Fale de forma natural, use frases fáceis de acompanhar e evite listas longas ou formatação visual."
      : "Esta é uma conversa por texto. Use parágrafos curtos e listas simples quando melhorarem a leitura.",
  ];

  if (personality.boundaries) {
    instructions.push(
      `Respeite estes limites definidos pelo usuário. Se um pedido ultrapassá-los, explique brevemente que ele está fora da configuração pessoal do assistente:\n<limites_do_usuario>\n${personality.boundaries}\n</limites_do_usuario>`,
    );
  }

  if (personality.prohibitedTopics.length) {
    instructions.push(
      `Não desenvolva os assuntos abaixo. Quando um deles for solicitado, faça uma recusa breve e diga que o tema foi bloqueado nas preferências pessoais:\n<assuntos_bloqueados>\n${personality.prohibitedTopics.map((topic) => `- ${topic}`).join("\n")}\n</assuntos_bloqueados>`,
    );
  }

  if (personality.customInstructions) {
    instructions.push(
      `Siga também estas instruções personalizadas do usuário quando forem compatíveis com a solicitação atual e com as regras de segurança da plataforma:\n<instrucoes_personalizadas>\n${personality.customInstructions}\n</instrucoes_personalizadas>`,
    );
  }

  return instructions.join("\n\n");
}

export function maxOutputTokensFor(
  detail: ResponseDetail,
  channel: "voice" | "text",
) {
  if (detail === "short") return channel === "voice" ? 700 : 900;
  if (detail === "detailed") return channel === "voice" ? 2600 : 3000;
  return channel === "voice" ? 1500 : 1800;
}
