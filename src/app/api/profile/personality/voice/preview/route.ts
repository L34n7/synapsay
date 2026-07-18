import { NextResponse } from "next/server";
import {
  ASSISTANT_TONES,
  ASSISTANT_VOICE_OPTIONS,
  ASSISTANT_VOICES,
  COMMUNICATION_STYLES,
  type AssistantTone,
  type AssistantVoice,
  type CommunicationStyle,
} from "@/lib/personality";
import { createClient } from "@/lib/supabase/server";
import { firstProfileName } from "@/lib/user-display-name";
import { voicePreviewCacheKey } from "@/lib/voice-preview-cache";

export const runtime = "nodejs";

function isAssistantVoice(value: unknown): value is AssistantVoice {
  return typeof value === "string" && ASSISTANT_VOICES.includes(value as never);
}

function isAssistantTone(value: unknown): value is AssistantTone {
  return typeof value === "string" && ASSISTANT_TONES.includes(value as never);
}

function isCommunicationStyle(value: unknown): value is CommunicationStyle {
  return (
    typeof value === "string" &&
    COMMUNICATION_STYLES.includes(value as never)
  );
}

function previewText(name: string, tone: AssistantTone) {
  if (!name) {
    return tone === "professional"
      ? "Olá. Como posso ajudar?"
      : tone === "casual"
        ? "Oi! Tudo bem por aí?"
        : "Oi! Que bom falar com você.";
  }

  if (tone === "professional") return `Olá, ${name}. Como posso ajudar?`;
  if (tone === "casual") return `Oi, ${name}! Tudo bem por aí?`;
  return `Oi, ${name}! Que bom falar com você.`;
}

function previewInstructions(
  voice: AssistantVoice,
  tone: AssistantTone,
  style: CommunicationStyle,
) {
  const toneInstruction = {
    friendly: "Fale de forma amigável, acolhedora e natural.",
    professional: "Fale de forma profissional, segura e cordial.",
    casual: "Fale de forma descontraída, espontânea e próxima.",
  }[tone];
  const styleInstruction = {
    balanced: "Use ritmo equilibrado e conversacional.",
    direct: "Seja breve, direta e objetiva.",
    explanatory: "Use dicção clara, calma e fácil de acompanhar.",
    creative: "Use entonação expressiva e um toque de personalidade.",
  }[style];

  return `${toneInstruction} ${styleInstruction} Preserve as características naturais da voz ${ASSISTANT_VOICE_OPTIONS[voice].label}. Pronuncie o nome em português do Brasil e mantenha a demonstração bem curta.`;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub ?? null;

  if (!userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const searchParams = new URL(request.url).searchParams;
  const requestedVoice = searchParams.get("voice");
  const requestedTone = searchParams.get("tone");
  const requestedStyle = searchParams.get("communicationStyle");
  const requestedCacheKey = searchParams.get("cacheKey");

  if (!isAssistantVoice(requestedVoice)) {
    return NextResponse.json({ error: "Escolha uma voz válida." }, { status: 400 });
  }

  const tone = isAssistantTone(requestedTone) ? requestedTone : "friendly";
  const communicationStyle = isCommunicationStyle(requestedStyle)
    ? requestedStyle
    : "balanced";
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY não configurada." },
      { status: 500 },
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  if (
    requestedCacheKey &&
    requestedCacheKey !== voicePreviewCacheKey(userId, profile?.display_name)
  ) {
    return NextResponse.json(
      { error: "A chave da prévia de voz expirou. Atualize a página." },
      { status: 400 },
    );
  }
  const name = firstProfileName(profile?.display_name);
  const openAIResponse = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: requestedVoice,
      input: previewText(name, tone),
      instructions: previewInstructions(requestedVoice, tone, communicationStyle),
    }),
  });

  if (!openAIResponse.ok) {
    const detail = await openAIResponse.text().catch(() => "");
    console.error(
      "Falha ao gerar prévia de voz:",
      openAIResponse.status,
      detail.slice(0, 500),
    );
    return NextResponse.json(
      { error: "Não foi possível gerar a prévia desta voz agora." },
      { status: openAIResponse.status === 429 ? 429 : 502 },
    );
  }

  return new Response(await openAIResponse.arrayBuffer(), {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, max-age=2592000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
