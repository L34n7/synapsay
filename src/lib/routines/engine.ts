import type { AssistantRoutine, RoutineOpportunity } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

type SupabaseLike = SupabaseClient;

type ClaimedRun = {
  id: string;
  reference_key: string;
  status: string;
  confirmed_at?: string | null;
};

const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

export function validRoutineTimeZone(timeZone: string | null | undefined) {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: timeZone || DEFAULT_TIME_ZONE }).format();
    return timeZone || DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function zonedParts(date: Date, requestedTimeZone: string) {
  const timeZone = validRoutineTimeZone(requestedTimeZone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${map.hour}:${map.minute}:${map.second}`,
    weekday: weekdayMap[map.weekday] ?? 0,
  };
}

function addDateKeyDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return date.toISOString().slice(0, 10);
}

function zonedDateTime(dateKey: string, time: string, timeZone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour = 0, minute = 0, second = 0] = time.split(":").map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = targetAsUtc;

  // Duas passagens cobrem mudancas de offset por horario de verao sem
  // depender de uma biblioteca de timezone no cliente.
  for (let pass = 0; pass < 2; pass += 1) {
    const local = zonedParts(new Date(guess), timeZone);
    const [localYear, localMonth, localDay] = local.date.split("-").map(Number);
    const [localHour, localMinute, localSecond] = local.time.split(":").map(Number);
    const representedAsUtc = Date.UTC(
      localYear,
      localMonth - 1,
      localDay,
      localHour,
      localMinute,
      localSecond,
    );
    guess += targetAsUtc - representedAsUtc;
  }

  return new Date(guess);
}

function localRoutineContext(routine: AssistantRoutine, now: Date) {
  const local = zonedParts(now, routine.timezone);
  const current = local.time.slice(0, 5);
  const start = routine.start_time?.slice(0, 5) ?? "00:00";
  const end = routine.end_time?.slice(0, 5) ?? "23:59";
  const overnight = start > end;
  const belongsToPreviousDay = overnight && current <= end;

  return {
    local,
    current,
    start,
    end,
    overnight,
    periodDate: belongsToPreviousDay ? addDateKeyDays(local.date, -1) : local.date,
    periodWeekday: belongsToPreviousDay ? (local.weekday + 6) % 7 : local.weekday,
  };
}

function periodKey(routine: AssistantRoutine, now: Date) {
  const context = localRoutineContext(routine, now);
  if (routine.recurrence_type === "once") return `once:${routine.id}`;
  if (routine.recurrence_type === "weekly") {
    const date = new Date(`${context.periodDate}T12:00:00Z`);
    const thursday = new Date(date);
    thursday.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
    const week = Math.ceil(
      ((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
    );
    return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  return context.periodDate;
}

export function isRoutineWithinWindow(routine: AssistantRoutine, now = new Date()) {
  const context = localRoutineContext(routine, now);
  if (routine.starts_on && context.periodDate < routine.starts_on) return false;
  if (routine.ends_on && context.periodDate > routine.ends_on) return false;
  if (!routine.days_of_week.includes(context.periodWeekday)) return false;
  if (["location_detected", "calendar_event_finished"].includes(routine.trigger_type)) {
    return false;
  }
  if (context.overnight) {
    return context.current >= context.start || context.current <= context.end;
  }
  return context.current >= context.start && context.current <= context.end;
}

function expirationFor(routine: AssistantRoutine, now: Date) {
  if (!routine.end_time) return null;
  const context = localRoutineContext(routine, now);
  const expirationDate = context.overnight
    ? addDateKeyDays(context.periodDate, 1)
    : context.periodDate;
  return zonedDateTime(
    expirationDate,
    routine.end_time.slice(0, 8),
    validRoutineTimeZone(routine.timezone),
  ).toISOString();
}

function missingClaimFunction(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    ["42883", "PGRST202"].includes(error.code ?? "") ||
    /claim_assistant_routine_run/i.test(error.message ?? "")
  );
}

async function claimRun({
  supabase,
  routine,
  userId,
  conversationId,
  now,
}: {
  supabase: SupabaseLike;
  routine: AssistantRoutine;
  userId: string;
  conversationId?: string | null;
  now: Date;
}): Promise<ClaimedRun | null> {
  const currentPeriod = periodKey(routine, now);
  const expiresAt = expirationFor(routine, now);

  if (supabase.rpc) {
    const query = supabase.rpc("claim_assistant_routine_run", {
      p_routine_id: routine.id,
      p_period_key: currentPeriod,
      p_conversation_id: conversationId ?? null,
      p_expires_at: expiresAt,
    });
    const { data, error } = await query;
    if (!error) {
      const run = Array.isArray(data) ? data[0] : data;
      return run && typeof run === "object" ? (run as ClaimedRun) : null;
    }
    if (!missingClaimFunction(error)) throw error;
  }

  // Compatibilidade durante uma publicacao em que o codigo chegue antes da
  // migration. Nesse modo antigo continua garantida uma execucao por periodo.
  const status =
    routine.confirmation_mode === "ask_first" ? "awaiting_confirmation" : "available";
  const { data: run, error } = await supabase
    .from("assistant_routine_runs")
    .insert({
      routine_id: routine.id,
      user_id: userId,
      reference_key: currentPeriod,
      conversation_id: conversationId ?? null,
      status,
      offered_at: now.toISOString(),
      expires_at: expiresAt,
    })
    .select("id,reference_key,status,confirmed_at")
    .maybeSingle();
  if (error && error.code !== "23505") throw error;
  return (run as ClaimedRun | null) ?? null;
}

export async function claimRoutineOpportunities({
  supabase,
  userId,
  conversationId,
  now = new Date(),
}: {
  supabase: SupabaseLike;
  userId: string;
  conversationId?: string | null;
  now?: Date;
}): Promise<RoutineOpportunity[]> {
  const { data, error } = await supabase
    .from("assistant_routines")
    .select("*")
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const opportunities: RoutineOpportunity[] = [];
  for (const routine of (data ?? []) as AssistantRoutine[]) {
    if (!isRoutineWithinWindow(routine, now)) continue;
    const run = await claimRun({ supabase, routine, userId, conversationId, now });
    if (!run) continue;
    const interval = Math.max(1, routine.feedback_interval || 3);
    opportunities.push({
      routine,
      referenceKey: run.reference_key,
      expiresAt: expirationFor(routine, now),
      requiresConfirmation:
        routine.confirmation_mode === "ask_first" && !run.confirmed_at,
      shouldAskFeedback: Boolean(
        routine.suggest_adjustments &&
          routine.execution_count > 0 &&
          routine.execution_count % interval === 0,
      ),
    });
  }
  return opportunities;
}

export function formatRoutineOpening(opportunities: RoutineOpportunity[]) {
  return opportunities
    .filter((opportunity) => opportunity.requiresConfirmation)
    .map(({ routine }) => {
      const config = routine.configuration ?? {};
      const topics = [...(config.categories ?? []), ...(config.topics ?? [])].join(", ");
      const topicLabel = topics ? ` sobre ${topics}` : "";
      return [
        `Antes de mudar de assunto, avise que a rotina "${routine.name}"${topicLabel} está disponível.`,
        "Pergunte de forma breve se o usuário quer executá-la agora e aguarde a resposta.",
        "Não execute, não antecipe o conteúdo e não mencione IDs ou chaves técnicas.",
        "Quando o usuário responder, use manage_routines, inclusive para respostas curtas como sim, mais tarde ou hoje não.",
      ].join(" ");
    })
    .join("\n");
}

export async function findRoutineSuggestion(supabase: SupabaseLike, userId: string) {
  const { data } = await supabase
    .from("assistant_routine_signals")
    .select("*")
    .eq("user_id", userId)
    .is("dismissed_at", null)
    .is("converted_routine_id", null)
    .is("suggested_at", null)
    .gte("occurrences", 4)
    .order("occurrences", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  await supabase
    .from("assistant_routine_signals")
    .update({ suggested_at: new Date().toISOString() })
    .eq("id", data.id)
    .eq("user_id", userId);
  const period =
    data.local_period === "morning"
      ? "pela manhã"
      : data.local_period === "afternoon"
        ? "à tarde"
        : "à noite";
  return `Você costuma conversar sobre ${data.topic} ${period}. Pergunte, sem criar automaticamente, se o usuário gostaria de transformar esse padrão em uma rotina. Se ele aceitar, chame manage_routines enviando a fala completa.`;
}
