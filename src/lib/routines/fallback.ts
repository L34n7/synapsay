import type { SupabaseClient } from "@supabase/supabase-js";

type SupabaseLike = SupabaseClient;

type FallbackRoutineResult = {
  handled: true;
  operation: "create" | "existing";
  routineId: string;
  summary: string;
};

type FallbackArgs = {
  supabase: SupabaseLike;
  userId: string;
  message: string;
  source: "text" | "voice";
  timezone: string;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function toTime(hourValue: string, minuteValue?: string) {
  const hour = Number(hourValue);
  const minute = Number(minuteValue || "0");
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function extractStartTime(message: string) {
  const normalized = normalize(message);
  const patterns = [
    /(?:a partir d(?:as|e)|depois d(?:as|e)|apos as|a partir das horas?|desde as)\s*(\d{1,2})(?:\s*h\s*|:)?(\d{2})?/i,
    /\b(\d{1,2})\s*h\s*(\d{2})\b/i,
    /\b(\d{1,2}):(\d{2})\b/i,
    /\b(\d{1,2})\s*h\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const time = toTime(match[1], match[2]);
    if (time) return time;
  }
  return null;
}

function isNewsRoutine(message: string) {
  const normalized = normalize(message);
  return /\bnotici(?:a|as)\b|\bbriefing\b/.test(normalized);
}

function hasCreateIntent(message: string) {
  const normalized = normalize(message);
  if (/(?:pause|desative|exclua|apague|cancele)\b/.test(normalized)) return false;
  return /(?:quero que|crie|criar|agende|agendar|programe|programar|automatize|automatizar|primeira conversa|proxima conversa|a partir d)/.test(
    normalized,
  );
}

function confirmationMode(message: string) {
  const normalized = normalize(message);
  if (/(?:pergunte|perguntar|confirme se|pergunte se eu quero|quer ouvir)/.test(normalized)) {
    return "ask_first" as const;
  }
  if (
    /(?:automaticamente|sem perguntar|direto|na primeira conversa[^.\n]*(?:fale|diga|traga|mostre)|quero que[^.\n]*(?:fale|diga|traga|mostre))/.test(
      normalized,
    )
  ) {
    return "automatic" as const;
  }
  return "ask_first" as const;
}

function durationSeconds(message: string) {
  const normalized = normalize(message);
  if (/(?:resumo curto|bem curto|rapidinho|breve)/.test(normalized)) return 60;
  if (/(?:detalhado|completo|aprofundado)/.test(normalized)) return 180;
  return 90;
}

function routineName(message: string) {
  const normalized = normalize(message);
  if (/(?:noticias.*mundo|mundo.*noticias|noticias gerais|principais noticias)/.test(normalized)) {
    return "Principais notícias do mundo";
  }
  return "Resumo de notícias";
}

function summaryFor(routine: {
  name: string;
  start_time: string;
  end_time: string;
  confirmation_mode: string;
}, existing = false) {
  const start = routine.start_time.slice(0, 5);
  const end = routine.end_time.slice(0, 5);
  const behavior =
    routine.confirmation_mode === "automatic"
      ? "Vou apresentar o resumo automaticamente na primeira conversa dentro dessa janela."
      : "Na primeira conversa dentro dessa janela, vou perguntar se você quer ouvir o resumo.";
  return `${existing ? "Essa rotina já estava cadastrada" : "Rotina criada"}: ${routine.name}, todos os dias, entre ${start} e ${end}. ${behavior}`;
}

/**
 * Garante o caso essencial sem depender da classificação generativa. É usado
 * somente quando há intenção clara, notícias e um horário explícito.
 */
export async function tryCreateNewsRoutineFallback({
  supabase,
  userId,
  message,
  source,
  timezone,
}: FallbackArgs): Promise<FallbackRoutineResult | null> {
  if (!hasCreateIntent(message) || !isNewsRoutine(message)) return null;
  const startTime = extractStartTime(message);
  if (!startTime) return null;

  const name = routineName(message);
  const mode = confirmationMode(message);
  const endTime = "23:59";

  const { data: existingRows, error: existingError } = await supabase
    .from("assistant_routines")
    .select("id,name,start_time,end_time,confirmation_mode,action_type,active")
    .eq("user_id", userId)
    .eq("active", true)
    .eq("action_type", "news_briefing")
    .order("updated_at", { ascending: false })
    .limit(30);
  if (existingError) throw existingError;

  const existing = (existingRows ?? []).find(
    (routine) => String(routine.start_time ?? "").slice(0, 5) === startTime,
  );
  if (existing) {
    return {
      handled: true,
      operation: "existing",
      routineId: existing.id,
      summary: summaryFor(
        {
          name: existing.name,
          start_time: existing.start_time,
          end_time: existing.end_time || endTime,
          confirmation_mode: existing.confirmation_mode,
        },
        true,
      ),
    };
  }

  const payload = {
    user_id: userId,
    name,
    description: "Resumo recorrente criado pela conversa com o assistente.",
    active: true,
    trigger_type: "conversation_window",
    recurrence_type: "daily",
    timezone,
    start_time: startTime,
    end_time: endTime,
    starts_on: null,
    ends_on: null,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    max_executions_per_period: 1,
    confirmation_mode: mode,
    action_type: "news_briefing",
    adapt_from_memories: true,
    suggest_adjustments: true,
    feedback_interval: 3,
    configuration: {
      topics: ["principais notícias do mundo"],
      categories: ["mundo"],
      sources: [],
      sourcesOnly: false,
      maxItems: 5,
      maxDurationSeconds: durationSeconds(message),
      delivery: source === "voice" ? "voice" : "both",
    },
    created_via: source === "voice" ? "voice" : "conversation",
  };

  const { data, error } = await supabase
    .from("assistant_routines")
    .insert(payload)
    .select("id,name,start_time,end_time,confirmation_mode")
    .single();
  if (error) throw error;

  return {
    handled: true,
    operation: "create",
    routineId: data.id,
    summary: summaryFor(data),
  };
}
