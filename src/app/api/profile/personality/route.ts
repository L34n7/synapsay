import { NextResponse } from "next/server";
import {
  ASSISTANT_TONES,
  ASSISTANT_VOICES,
  COMMUNICATION_STYLES,
  RESPONSE_DETAILS,
  normalizePersonalityRow,
  normalizeProhibitedTopics,
} from "@/lib/personality";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const PROFILE_COLUMNS =
  "assistant_name, preferred_voice, communication_style, response_detail, assistant_tone, assistant_boundaries, prohibited_topics, custom_instructions, onboarding_completed" as const;

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
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Não foi possível carregar a personalidade. Verifique se a migração 006 foi aplicada." },
      { status: 500 },
    );
  }

  return NextResponse.json({ personality: normalizePersonalityRow(data) });
}

export async function PATCH(request: Request) {
  const { supabase, userId } = await authenticatedProfile();
  if (!userId) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const assistantName = typeof body?.assistantName === "string" ? body.assistantName.trim() : "";
  const boundaries = typeof body?.boundaries === "string" ? body.boundaries.trim() : "";
  const customInstructions = typeof body?.customInstructions === "string" ? body.customInstructions.trim() : "";
  const preferredVoice = typeof body?.preferredVoice === "string" ? body.preferredVoice : "";
  const communicationStyle = typeof body?.communicationStyle === "string" ? body.communicationStyle : "";
  const responseDetail = typeof body?.responseDetail === "string" ? body.responseDetail : "";
  const tone = typeof body?.tone === "string" ? body.tone : "";
  const prohibitedTopics = normalizeProhibitedTopics(body?.prohibitedTopics);

  if (assistantName.length < 2 || assistantName.length > 40) return NextResponse.json({ error: "O nome deve ter entre 2 e 40 caracteres." }, { status: 400 });
  if (!ASSISTANT_VOICES.includes(preferredVoice as never)) return NextResponse.json({ error: "Voz inválida." }, { status: 400 });
  if (!COMMUNICATION_STYLES.includes(communicationStyle as never)) return NextResponse.json({ error: "Estilo inválido." }, { status: 400 });
  if (!RESPONSE_DETAILS.includes(responseDetail as never)) return NextResponse.json({ error: "Nível de detalhe inválido." }, { status: 400 });
  if (!ASSISTANT_TONES.includes(tone as never)) return NextResponse.json({ error: "Tom inválido." }, { status: 400 });
  if (boundaries.length > 1500 || customInstructions.length > 2000) return NextResponse.json({ error: "Um dos campos de instruções excedeu o limite permitido." }, { status: 400 });

  const { data, error } = await supabase
    .from("profiles")
    .update({
      assistant_name: assistantName,
      preferred_voice: preferredVoice,
      communication_style: communicationStyle,
      response_detail: responseDetail,
      assistant_tone: tone,
      assistant_boundaries: boundaries,
      prohibited_topics: prohibitedTopics,
      custom_instructions: customInstructions,
      onboarding_completed: true,
    })
    .eq("id", userId)
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Não foi possível salvar a personalidade. Verifique a migração 006." },
      { status: 500 },
    );
  }

  return NextResponse.json({ personality: normalizePersonalityRow(data) });
}
