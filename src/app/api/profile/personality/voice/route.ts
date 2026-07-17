import { NextResponse } from "next/server";
import {
  ASSISTANT_VOICE_OPTIONS,
  ASSISTANT_VOICES,
  type AssistantVoice,
  voiceOptionsForAssistant,
} from "@/lib/personality";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VOICE_SELECT_TIMEOUT_SECONDS = 90;

function isAssistantVoice(value: unknown): value is AssistantVoice {
  return typeof value === "string" && ASSISTANT_VOICES.includes(value as never);
}

async function authenticatedProfile() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  return { supabase, userId: authData?.claims?.sub ?? null };
}

export async function GET() {
  const { supabase, userId } = await authenticatedProfile();
  if (!userId) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const { data, error } = await supabase
    .from("profiles")
    .select("preferred_voice, assistant_name")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Não foi possível carregar as vozes." },
      { status: 500 },
    );
  }

  const currentVoice = isAssistantVoice(data?.preferred_voice)
    ? data.preferred_voice
    : "marin";

  return NextResponse.json({
    currentVoice,
    currentVoiceLabel: ASSISTANT_VOICE_OPTIONS[currentVoice].label,
    assistantName:
      typeof data?.assistant_name === "string" && data.assistant_name.trim()
        ? data.assistant_name.trim()
        : "Synapsay",
    voices: voiceOptionsForAssistant(),
    timeoutSeconds: VOICE_SELECT_TIMEOUT_SECONDS,
  });
}

export async function POST(request: Request) {
  const { supabase, userId } = await authenticatedProfile();
  if (!userId) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    voice?: unknown;
  } | null;
  const action = typeof body?.action === "string" ? body.action : "list";

  const { data: profile } = await supabase
    .from("profiles")
    .select("preferred_voice, assistant_name")
    .eq("id", userId)
    .maybeSingle();

  const currentVoice = isAssistantVoice(profile?.preferred_voice)
    ? profile.preferred_voice
    : "marin";

  if (action === "cancel") {
    return NextResponse.json({
      status: "cancelled",
      currentVoice,
      currentVoiceLabel: ASSISTANT_VOICE_OPTIONS[currentVoice].label,
      message: "Troca de voz cancelada. A voz atual foi mantida.",
    });
  }

  if (action === "preview") {
    const previewVoice = body?.voice;
    if (!isAssistantVoice(previewVoice)) {
      return NextResponse.json({ error: "Escolha uma voz válida para ouvir." }, { status: 400 });
    }

    const option = ASSISTANT_VOICE_OPTIONS[previewVoice];
    return NextResponse.json({
      status: "preview",
      previewVoice,
      previewVoiceLabel: option.label,
      sample: option.sample,
      message:
        "Demonstre esta opção agora e pergunte se o usuário quer salvar, ouvir outra voz ou cancelar.",
      timeoutSeconds: VOICE_SELECT_TIMEOUT_SECONDS,
    });
  }

  if (action === "set") {
    const selectedVoice = body?.voice;
    if (!isAssistantVoice(selectedVoice)) {
      return NextResponse.json({ error: "Escolha uma voz válida para salvar." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("profiles")
      .update({
        preferred_voice: selectedVoice,
        onboarding_completed: true,
      })
      .eq("id", userId)
      .select("preferred_voice, assistant_name")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Não foi possível salvar a voz agora." },
        { status: 500 },
      );
    }

    const savedVoice = isAssistantVoice(data.preferred_voice)
      ? data.preferred_voice
      : selectedVoice;
    const option = ASSISTANT_VOICE_OPTIONS[savedVoice];

    return NextResponse.json({
      status: "saved",
      currentVoice: savedVoice,
      currentVoiceLabel: option.label,
      assistantName:
        typeof data.assistant_name === "string" && data.assistant_name.trim()
          ? data.assistant_name.trim()
          : "Synapsay",
      message:
        "Voz salva. Confirme de forma natural e ofereça ajustar nome, tom ou estilo de resposta.",
    });
  }

  return NextResponse.json({
    status: "selecting",
    currentVoice,
    currentVoiceLabel: ASSISTANT_VOICE_OPTIONS[currentVoice].label,
    voices: voiceOptionsForAssistant(),
    timeoutSeconds: VOICE_SELECT_TIMEOUT_SECONDS,
    message:
      "Mostre as opções de voz de forma breve. Diga que o usuário pode pedir para ouvir uma delas, escolher pelo nome ou cancelar.",
  });
}
