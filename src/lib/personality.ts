import { profileBirthday, profileDisplayName } from "@/lib/user-display-name";

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

export const ASSISTANT_VOICE_OPTIONS = {
  marin: {
    label: "Marin",
    description: "clara, natural e próxima",
    sample:
      "Oi, sou a Marin. Falo de um jeito claro, natural e bem próximo para acompanhar sua rotina.",
  },
  cedar: {
    label: "Cedar",
    description: "calma, encorpada e segura",
    sample:
      "Oi, sou a Cedar. Minha voz é mais calma e firme, boa para uma assistente estável e tranquila.",
  },
  coral: {
    label: "Coral",
    description: "expressiva, acolhedora e leve",
    sample:
      "Oi, sou a Coral. Tenho um tom mais expressivo e acolhedor, com uma presença mais calorosa.",
  },
  sage: {
    label: "Sage",
    description: "serena, madura e objetiva",
    sample:
      "Oi, sou a Sage. Falo com serenidade e segurança, sem perder a naturalidade da conversa.",
  },
  verse: {
    label: "Verse",
    description: "dinâmica, moderna e comunicativa",
    sample:
      "Oi, sou a Verse. Tenho uma energia mais moderna e dinâmica para conversas rápidas e fluidas.",
  },
  alloy: {
    label: "Alloy",
    description: "neutra, equilibrada e versátil",
    sample:
      "Oi, sou a Alloy. Minha voz é neutra e equilibrada, funcionando bem em quase qualquer situação.",
  },
  ash: {
    label: "Ash",
    description: "suave, direta e discreta",
    sample:
      "Oi, sou a Ash. Falo de forma suave e direta, sem chamar atenção demais para a voz.",
  },
  ballad: {
    label: "Ballad",
    description: "narrativa, fluida e envolvente",
    sample:
      "Oi, sou a Ballad. Tenho um ritmo mais narrativo e fluido, bom para uma conversa mais envolvente.",
  },
  echo: {
    label: "Echo",
    description: "firme, objetiva e presente",
    sample:
      "Oi, sou a Echo. Minha voz é mais firme e objetiva, com presença clara nas respostas.",
  },
  shimmer: {
    label: "Shimmer",
    description: "leve, vibrante e amigável",
    sample:
      "Oi, sou a Shimmer. Tenho uma voz mais leve e vibrante, com um jeito amigável de conversar.",
  },
} as const satisfies Record<
  (typeof ASSISTANT_VOICES)[number],
  { label: string; description: string; sample: string }
>;

export const COMMUNICATION_STYLES = [
  "balanced",
  "direct",
  "explanatory",
  "creative",
] as const;

export const RESPONSE_DETAILS = ["short", "balanced", "detailed"] as const;
export const ASSISTANT_TONES = ["friendly", "professional", "casual"] as const;
export const MICROPHONE_MODES = ["push_to_talk", "open"] as const;

export type AssistantVoice = (typeof ASSISTANT_VOICES)[number];
export type CommunicationStyle = (typeof COMMUNICATION_STYLES)[number];
export type ResponseDetail = (typeof RESPONSE_DETAILS)[number];
export type AssistantTone = (typeof ASSISTANT_TONES)[number];
export type MicrophoneMode = (typeof MICROPHONE_MODES)[number];

export type AssistantPersonality = {
  displayName: string;
  birthday: string;
  assistantName: string;
  preferredVoice: AssistantVoice;
  communicationStyle: CommunicationStyle;
  responseDetail: ResponseDetail;
  tone: AssistantTone;
  microphoneMode: MicrophoneMode;
  boundaries: string;
  prohibitedTopics: string[];
  customInstructions: string;
  onboardingCompleted: boolean;
};

export type PersonalityRow = {
  display_name?: unknown;
  birthday?: unknown;
  assistant_name?: unknown;
  preferred_voice?: unknown;
  communication_style?: unknown;
  response_detail?: unknown;
  assistant_tone?: unknown;
  microphone_mode?: unknown;
  assistant_boundaries?: unknown;
  prohibited_topics?: unknown;
  custom_instructions?: unknown;
  onboarding_completed?: unknown;
};

export const DEFAULT_PERSONALITY: AssistantPersonality = {
  displayName: "",
  birthday: "",
  assistantName: "Synapsay",
  preferredVoice: "marin",
  communicationStyle: "balanced",
  responseDetail: "balanced",
  tone: "friendly",
  microphoneMode: "push_to_talk",
  boundaries: "",
  prohibitedTopics: [],
  customInstructions: "",
  onboardingCompleted: false,
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
    displayName: profileDisplayName(row?.display_name),
    birthday: profileBirthday(row?.birthday),
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
    microphoneMode: isOneOf(MICROPHONE_MODES, row?.microphone_mode)
      ? row.microphone_mode
      : DEFAULT_PERSONALITY.microphoneMode,
    boundaries: cleanText(row?.assistant_boundaries, 1500),
    prohibitedTopics: normalizeProhibitedTopics(row?.prohibited_topics),
    customInstructions: cleanText(row?.custom_instructions, 2000),
    onboardingCompleted:
      typeof row?.onboarding_completed === "boolean"
        ? row.onboarding_completed
        : DEFAULT_PERSONALITY.onboardingCompleted,
  };
}

export function voiceOptionsForAssistant() {
  return ASSISTANT_VOICES.map((voice) => ({
    id: voice,
    ...ASSISTANT_VOICE_OPTIONS[voice],
  }));
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
    `Você é ${personality.assistantName}, o assistente pessoal do usuário dentro da Synapsay. Saiba seu nome e nunca alegue ter outro nome.`,
    'O usuário também pode chamar você de "Jarvis". Reconheça esse nome como um apelido válido, sem corrigir o usuário e sem dizer que você é apenas a Synapsay.',
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

  instructions.push(
    [
      "Regra de identidade e naturalidade com prioridade alta:",
      `não inicie nem preencha respostas identificando-se pelo próprio nome. Evite expressões como "${personality.assistantName} aqui", "sou ${personality.assistantName}", "${personality.assistantName} falando" ou equivalentes.`,
      "Use o nome do assistente somente quando o usuário perguntar quem está falando, pedir uma apresentação, ou quando você estiver confirmando uma alteração do próprio nome.",
      'Quando o usuário disser "Jarvis" apenas para chamar o assistente, responda diretamente ao pedido sem repetir "Jarvis" e sem se reapresentar.',
      "Uma saudação normal ao usuário não exige identificação do assistente.",
    ].join(" "),
  );

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
