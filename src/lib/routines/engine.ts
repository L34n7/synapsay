import type { AssistantRoutine, RoutineOpportunity } from "./types";

type SupabaseLike = {
  from: (table: string) => any;
};

function zonedParts(date: Date, timeZone: string) {
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

function referenceKey(routine: AssistantRoutine, now: Date) {
  const local = zonedParts(now, routine.timezone);
  if (routine.recurrence_type === "once") return `once:${routine.id}`;
  if (routine.recurrence_type === "weekly") {
    const d = new Date(`${local.date}T12:00:00Z`);
    const thursday = new Date(d);
    thursday.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  return local.date;
}

function withinWindow(routine: AssistantRoutine, now: Date) {
  const local = zonedParts(now, routine.timezone);
  if (!routine.days_of_week.includes(local.weekday)) return false;
  if (routine.trigger_type === "location_detected" || routine.trigger_type === "calendar_event_finished") {
    return false;
  }
  const current = local.time.slice(0, 5);
  const start = routine.start_time?.slice(0, 5) ?? "00:00";
  const end = routine.end_time?.slice(0, 5) ?? "23:59";
  return current >= start && current <= end;
}

function expirationFor(routine: AssistantRoutine, now: Date) {
  if (!routine.end_time) return null;
  const local = zonedParts(now, routine.timezone);
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone: routine.timezone,
    timeZoneName: "longOffset",
  }).formatToParts(now).find((part) => part.type === "timeZoneName")?.value ?? "GMT-03:00";
  const isoOffset = offset.replace("GMT", "");
  return new Date(`${local.date}T${routine.end_time.slice(0, 8)}${isoOffset}`).toISOString();
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
    if (!withinWindow(routine, now)) continue;
    const key = referenceKey(routine, now);
    const status = routine.confirmation_mode === "ask_first" ? "awaiting_confirmation" : "processing";
    const { data: run, error: claimError } = await supabase
      .from("assistant_routine_runs")
      .insert({
        routine_id: routine.id,
        user_id: userId,
        reference_key: key,
        conversation_id: conversationId ?? null,
        status,
        offered_at: now.toISOString(),
        started_at: status === "processing" ? now.toISOString() : null,
        expires_at: expirationFor(routine, now),
      })
      .select("id")
      .maybeSingle();
    if (claimError && claimError.code !== "23505") throw claimError;
    if (!run) continue;
    opportunities.push({
      routine,
      referenceKey: key,
      expiresAt: expirationFor(routine, now),
      requiresConfirmation: routine.confirmation_mode === "ask_first",
    });
  }
  return opportunities;
}

export function formatRoutineOpening(opportunities: RoutineOpportunity[]) {
  if (!opportunities.length) return "";
  return opportunities.map(({ routine, requiresConfirmation }) => {
    const config = routine.configuration ?? {};
    const topics = [...(config.categories ?? []), ...(config.topics ?? [])].join(", ");
    const sources = (config.sources ?? []).map((source) => source.label || source.value).join(", ");
    if (requiresConfirmation) {
      return `Existe uma rotina disponível chamada \"${routine.name}\". Pergunte de forma breve se o usuário quer executá-la agora. Não execute antes da confirmação.`;
    }
    return `Execute agora a rotina \"${routine.name}\". Tipo: ${routine.action_type}. ${topics ? `Assuntos: ${topics}.` : ""} ${sources ? `Fontes: ${sources}.` : ""} ${config.sourcesOnly ? "Use somente as fontes configuradas." : "Fontes configuradas são preferenciais."} ${config.prompt ?? ""}`;
  }).join("\n");
}
