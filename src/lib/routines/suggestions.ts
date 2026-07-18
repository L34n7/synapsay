function normalize(message: string) {
  return message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export async function resolvePendingRoutineSuggestion({ supabase, userId, message, timezone = "America/Sao_Paulo" }: { supabase: any; userId: string; message: string; timezone?: string }) {
  const normalized = normalize(message);
  const affirmative = /^(sim|pode|claro|quero|vamos|ok|okay|confirmo)\b/.test(normalized);
  const decline = /^(nao|agora nao|deixa pra la|dispenso)\b/.test(normalized);
  if (!affirmative && !decline) return null;
  const { data: signal } = await supabase
    .from("assistant_routine_signals")
    .select("id,topic,local_period,suggested_at")
    .eq("user_id", userId)
    .is("converted_routine_id", null)
    .is("dismissed_at", null)
    .gte("suggested_at", new Date(Date.now() - 10 * 60_000).toISOString())
    .order("suggested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!signal) return null;
  if (decline) {
    await supabase.from("assistant_routine_signals").update({ dismissed_at: new Date().toISOString() }).eq("id", signal.id).eq("user_id", userId);
    return { handled: true, status: "suggestion_declined", summary: "Tudo bem. Não vou transformar esse padrão em rotina." };
  }
  const windows: Record<string, { start: string; end: string; label: string }> = {
    morning: { start: "08:00", end: "11:59", label: "pela manhã" },
    afternoon: { start: "12:00", end: "16:59", label: "à tarde" },
    evening: { start: "17:00", end: "22:59", label: "à noite" },
  };
  const window = windows[signal.local_period] ?? windows.morning;
  const { data: routine, error } = await supabase.from("assistant_routines").insert({
    user_id: userId,
    name: `Acompanhar ${signal.topic}`.slice(0, 120),
    description: "Rotina criada após confirmação de um padrão recorrente de interesse.",
    active: true,
    trigger_type: "conversation_window",
    recurrence_type: "daily",
    timezone,
    start_time: window.start,
    end_time: window.end,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    max_executions_per_period: 1,
    confirmation_mode: "ask_first",
    action_type: "news_briefing",
    adapt_from_memories: true,
    suggest_adjustments: true,
    feedback_interval: 3,
    configuration: { topics: [signal.topic], categories: [], sources: [], sourcesOnly: false, maxDurationSeconds: 90, delivery: "both" },
    created_via: "system",
  }).select("id,name").single();
  if (error || !routine) throw error ?? new Error("Não foi possível criar a rotina sugerida.");
  await supabase.from("assistant_routine_signals").update({ converted_routine_id: routine.id }).eq("id", signal.id).eq("user_id", userId);
  return { handled: true, status: "suggestion_accepted", routineId: routine.id, summary: `Rotina criada para acompanhar ${signal.topic} ${window.label}. Vou pedir confirmação antes de executar.` };
}
