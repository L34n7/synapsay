import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function buildPrompt(routine: any) {
  const config = routine.configuration ?? {};
  const topics = [...(config.categories ?? []), ...(config.topics ?? [])];
  const sources = (config.sources ?? []).map((source: any) => source.value).filter(Boolean);
  const sourceRule = sources.length
    ? config.sourcesOnly
      ? `Use exclusivamente informações publicadas nestes domínios: ${sources.join(", ")}.`
      : `Priorize estes domínios e complemente somente quando necessário: ${sources.join(", ")}.`
    : "Use fontes jornalísticas confiáveis e variadas.";
  return [
    `Produza um briefing em português do Brasil para a rotina \"${routine.name}\".`,
    topics.length ? `Assuntos: ${topics.join(", ")}.` : "Selecione os assuntos mais relevantes do momento.",
    sourceRule,
    `Use no máximo ${Number(config.maxItems) || 5} itens e linguagem adequada para leitura em voz alta.`,
    `Duração aproximada máxima: ${Number(config.maxDurationSeconds) || 90} segundos.`,
    "Comece diretamente pelo resumo, sem explicar como pesquisou.",
    "Não invente fatos. Diferencie fato confirmado de informação ainda em desenvolvimento.",
    config.prompt ? `Instrução adicional do usuário: ${config.prompt}` : "",
  ].filter(Boolean).join("\n");
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub ? String(authData.claims.sub) : null;
  if (!userId) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const routineId = typeof body?.routineId === "string" ? body.routineId : "";
  const referenceKey = typeof body?.referenceKey === "string" ? body.referenceKey : "";
  if (!routineId || !referenceKey) return NextResponse.json({ error: "Execução inválida." }, { status: 400 });

  const [{ data: routine }, { data: cached }] = await Promise.all([
    supabase.from("assistant_routines").select("*").eq("id", routineId).eq("user_id", userId).eq("active", true).maybeSingle(),
    supabase.from("assistant_routine_content_cache").select("content_text, sources, generated_at").eq("routine_id", routineId).eq("reference_key", referenceKey).eq("user_id", userId).maybeSingle(),
  ]);
  if (!routine) return NextResponse.json({ error: "Rotina não encontrada." }, { status: 404 });
  if (cached) return NextResponse.json({ content: cached.content_text, sources: cached.sources, cached: true });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY não configurada." }, { status: 500 });
  await supabase.from("assistant_routine_runs").update({ status: "processing", started_at: new Date().toISOString() }).eq("routine_id", routineId).eq("reference_key", referenceKey).eq("user_id", userId);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5-mini",
        tools: routine.action_type === "news_briefing" ? [{ type: "web_search" }] : [],
        input: buildPrompt(routine),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message ?? "Falha ao gerar briefing.");
    const content = String(data.output_text ?? "").trim();
    if (!content) throw new Error("O briefing retornou vazio.");
    const sources = (data.output ?? []).flatMap((item: any) => item?.content ?? []).flatMap((item: any) => item?.annotations ?? []).filter((item: any) => item?.type === "url_citation").map((item: any) => ({ title: item.title, url: item.url }));
    await supabase.from("assistant_routine_content_cache").insert({ routine_id: routineId, user_id: userId, reference_key: referenceKey, content_text: content, sources });
    await supabase.from("assistant_routine_runs").update({ status: "completed", completed_at: new Date().toISOString(), result: { content, sources } }).eq("routine_id", routineId).eq("reference_key", referenceKey).eq("user_id", userId);
    return NextResponse.json({ content, sources, cached: false });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Não foi possível executar a rotina.";
    await supabase.from("assistant_routine_runs").update({ status: "failed", error_message: message }).eq("routine_id", routineId).eq("reference_key", referenceKey).eq("user_id", userId);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
