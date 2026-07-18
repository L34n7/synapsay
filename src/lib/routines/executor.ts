type ExecuteRoutineArgs = {
  supabase: any;
  userId: string;
  routineId: string;
  referenceKey: string;
};

function buildPrompt(routine: any, memories: any[], feedback: any[]) {
  const config = routine.configuration ?? {};
  const topics = [...(config.categories ?? []), ...(config.topics ?? [])];
  const sources = (config.sources ?? []).map((source: any) => source.value).filter(Boolean);
  const sourceRule = sources.length
    ? config.sourcesOnly
      ? `Use exclusivamente informações publicadas nestes domínios: ${sources.join(", ")}.`
      : `Priorize estes domínios e complemente somente quando necessário: ${sources.join(", ")}.`
    : "Use fontes jornalísticas confiáveis e variadas.";
  const memoryContext = routine.adapt_from_memories && memories.length
    ? `Preferências e interesses aprovados do usuário, usados apenas para priorização leve: ${memories.map((m: any) => m.content).join(" | ")}`
    : "Não personalize por memória nesta execução.";
  const feedbackContext = feedback.length
    ? `Feedback recente sobre esta rotina: ${feedback.map((f: any) => f.message).join(" | ")}`
    : "Ainda não há feedback específico desta rotina.";
  return [
    `Produza um briefing em português do Brasil para a rotina "${routine.name}".`,
    topics.length ? `Assuntos definidos permanentemente: ${topics.join(", ")}.` : "Selecione os assuntos mais relevantes do momento.",
    sourceRule,
    memoryContext,
    feedbackContext,
    "Memórias apenas ajustam prioridade. Não altere silenciosamente a configuração permanente da rotina.",
    `Use no máximo ${Number(config.maxItems) || 5} itens e linguagem adequada para leitura em voz alta.`,
    `Duração aproximada máxima: ${Number(config.maxDurationSeconds) || 90} segundos.`,
    "Comece diretamente pelo resumo. Não invente fatos e diferencie notícia confirmada de informação em desenvolvimento.",
    config.prompt ? `Instrução adicional do usuário: ${config.prompt}` : "",
  ].filter(Boolean).join("\n");
}

function extractSources(data: any) {
  return (data.output ?? [])
    .flatMap((item: any) => item?.content ?? [])
    .flatMap((item: any) => item?.annotations ?? [])
    .filter((item: any) => item?.type === "url_citation")
    .map((item: any) => ({ title: item.title, url: item.url }));
}

export async function executeRoutine({ supabase, userId, routineId, referenceKey }: ExecuteRoutineArgs) {
  const [{ data: routine }, { data: cached }, { data: memories }, { data: feedback }, { data: run }] = await Promise.all([
    supabase.from("assistant_routines").select("*").eq("id", routineId).eq("user_id", userId).eq("active", true).maybeSingle(),
    supabase.from("assistant_routine_content_cache").select("content_text,sources,generated_at").eq("routine_id", routineId).eq("reference_key", referenceKey).eq("user_id", userId).maybeSingle(),
    supabase.from("memories").select("content,category,importance").eq("user_id", userId).eq("status", "active").eq("review_status", "approved").order("importance", { ascending: false }).limit(20),
    supabase.from("assistant_routine_feedback").select("message,sentiment,adjustments").eq("routine_id", routineId).eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
    supabase.from("assistant_routine_runs").select("id,status,expires_at").eq("routine_id", routineId).eq("reference_key", referenceKey).eq("user_id", userId).maybeSingle(),
  ]);
  if (!routine) throw new Error("Rotina não encontrada ou pausada.");
  if (!run) throw new Error("Oportunidade de rotina não encontrada.");
  if (run.status === "awaiting_confirmation") throw new Error("Esta rotina ainda aguarda confirmação.");
  if (run.expires_at && new Date(run.expires_at).getTime() < Date.now()) throw new Error("A oportunidade desta rotina expirou.");
  if (cached) {
    return {
      content: cached.content_text,
      sources: cached.sources ?? [],
      cached: true,
      askFeedback: false,
      routineId,
      referenceKey,
    };
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada.");
  await supabase.from("assistant_routine_runs").update({ status: "processing", started_at: new Date().toISOString() }).eq("id", run.id).eq("user_id", userId);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5-mini",
        tools: routine.action_type === "news_briefing" ? [{ type: "web_search" }] : [],
        input: buildPrompt(routine, memories ?? [], feedback ?? []),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message ?? "Falha ao gerar briefing.");
    const content = String(data.output_text ?? "").trim();
    if (!content) throw new Error("O briefing retornou vazio.");
    const sources = extractSources(data);
    await supabase.from("assistant_routine_content_cache").insert({ routine_id: routineId, user_id: userId, reference_key: referenceKey, content_text: content, sources });
    await supabase.from("assistant_routine_runs").update({ status: "completed", completed_at: new Date().toISOString(), result: { content, sources } }).eq("id", run.id).eq("user_id", userId);
    await supabase.rpc("increment_routine_execution", { p_routine_id: routineId, p_user_id: userId });
    const nextCount = Number(routine.execution_count ?? 0) + 1;
    const interval = Math.max(1, Number(routine.feedback_interval) || 3);
    return {
      content,
      sources,
      cached: false,
      routineId,
      referenceKey,
      askFeedback: Boolean(routine.suggest_adjustments && nextCount % interval === 0),
      feedbackPrompt: routine.suggest_adjustments && nextCount % interval === 0
        ? "Ao terminar, pergunte brevemente se o usuário está gostando ou deseja mudar duração, assuntos ou fontes."
        : null,
    };
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Não foi possível executar a rotina.";
    await supabase.from("assistant_routine_runs").update({ status: "failed", error_message: message }).eq("id", run.id).eq("user_id", userId);
    throw new Error(message);
  }
}

export async function resolvePendingRoutine({ supabase, userId, message }: { supabase: any; userId: string; message: string }) {
  const normalized = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const affirmative = /^(sim|pode|claro|quero|execute|executa|fale|manda|vamos|ok|okay|confirmo)\b/.test(normalized);
  const decline = /^(nao|agora nao|hoje nao|deixa pra la|dispenso|pular|pule)\b/.test(normalized);
  const disable = /(nao quero mais|desative|desliga|pare essa rotina|cancele essa rotina)/.test(normalized);
  if (!affirmative && !decline && !disable) return null;
  const { data: run } = await supabase
    .from("assistant_routine_runs")
    .select("id,routine_id,reference_key,expires_at,assistant_routines(name)")
    .eq("user_id", userId)
    .eq("status", "awaiting_confirmation")
    .order("offered_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!run) return null;
  if (run.expires_at && new Date(run.expires_at).getTime() < Date.now()) {
    await supabase.from("assistant_routine_runs").update({ status: "expired" }).eq("id", run.id).eq("user_id", userId);
    return { handled: true, status: "expired", summary: "A janela dessa rotina já terminou. Ela ficará disponível novamente na próxima oportunidade." };
  }
  if (disable) {
    await Promise.all([
      supabase.from("assistant_routines").update({ active: false }).eq("id", run.routine_id).eq("user_id", userId),
      supabase.from("assistant_routine_runs").update({ status: "declined" }).eq("id", run.id).eq("user_id", userId),
    ]);
    return { handled: true, status: "disabled", summary: "Rotina desativada. Ela não será oferecida novamente até ser reativada." };
  }
  if (decline) {
    await supabase.from("assistant_routine_runs").update({ status: "declined" }).eq("id", run.id).eq("user_id", userId);
    return { handled: true, status: "declined", summary: "Tudo bem. Não vou executar essa rotina nesta oportunidade." };
  }
  await supabase.from("assistant_routine_runs").update({ status: "processing", confirmed_at: new Date().toISOString(), started_at: new Date().toISOString() }).eq("id", run.id).eq("user_id", userId);
  const execution = await executeRoutine({ supabase, userId, routineId: run.routine_id, referenceKey: run.reference_key });
  return { handled: true, status: "completed", summary: execution.content, ...execution };
}
