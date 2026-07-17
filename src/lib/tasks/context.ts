import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskRecord } from "@/lib/tasks/types";

const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

function validTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone }).format();
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function localDateKey(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function addDaysKey(timeZone: string, offsetDays: number) {
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return localDateKey(base, timeZone);
}

function dateParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    day: get("day"),
    month: get("month"),
    year: get("year"),
  };
}

function weekday(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    weekday: "long",
  }).format(value);
}

function timeLabel(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

export function formatTaskSpeechDateTime(
  value: string | null,
  timeZone = DEFAULT_TIME_ZONE,
  dateOnly = false,
) {
  if (!value) return null;
  const safeTimeZone = validTimeZone(timeZone);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const key = localDateKey(date, safeTimeZone);
  const todayKey = addDaysKey(safeTimeZone, 0);
  const tomorrowKey = addDaysKey(safeTimeZone, 1);
  const dayAfterTomorrowKey = addDaysKey(safeTimeZone, 2);
  const { day, month, year } = dateParts(date, safeTimeZone);
  const currentYear = dateParts(new Date(), safeTimeZone).year;
  const dayName = weekday(date, safeTimeZone);
  const dateLabel =
    key === todayKey
      ? "hoje"
      : key === tomorrowKey
        ? "amanhã"
        : key === dayAfterTomorrowKey
          ? `depois de amanhã, ${day}/${month}, ${dayName}`
          : year === currentYear
            ? `${day}/${month}, ${dayName}`
            : `${day}/${month}/${year}, ${dayName}`;

  if (dateOnly) return dateLabel;
  return `${dateLabel}, às ${timeLabel(date, safeTimeZone)}`;
}

export function formatTaskDateTime(
  value: string | null,
  timeZone = DEFAULT_TIME_ZONE,
  dateOnly = false,
) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: validTimeZone(timeZone),
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const }),
  }).format(date);
}

export function taskForAssistant(task: TaskRecord) {
  const timeZone = validTimeZone(task.timezone || DEFAULT_TIME_ZONE);
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    scheduledLocal: formatTaskDateTime(task.scheduled_at, timeZone, task.all_day),
    scheduledSpeech: formatTaskSpeechDateTime(task.scheduled_at, timeZone, task.all_day),
    dueLocal: formatTaskDateTime(task.due_at, timeZone, task.all_day),
    dueSpeech: formatTaskSpeechDateTime(task.due_at, timeZone, task.all_day),
    allDay: task.all_day,
    timeZone,
    reminders: (task.reminders ?? [])
      .filter((reminder) => reminder.status === "scheduled")
      .map((reminder) => ({
        status: reminder.status,
        remindAtLocal: formatTaskDateTime(reminder.remind_at, timeZone),
        remindAtSpeech: formatTaskSpeechDateTime(reminder.remind_at, timeZone),
      })),
    details: task.description || null,
  };
}

export async function loadOpenTasks({
  supabase,
  userId,
  limit = 80,
}: {
  supabase: SupabaseClient;
  userId: string;
  limit?: number;
}) {
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, description, status, priority, scheduled_at, due_at, all_day, timezone, recurrence_rule, created_by, completed_at, conversation_id, created_at, updated_at, reminders(id, task_id, remind_at, channel, status, delivered_at, dismissed_at)",
    )
    .eq("user_id", userId)
    .in("status", ["pending", "in_progress"])
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as TaskRecord[];
}

export function formatTasksForModel(tasks: TaskRecord[]) {
  if (!tasks.length) return "Nenhuma tarefa ativa encontrada.";
  return tasks
    .map((task) => {
      const formatted = taskForAssistant(task);
      const reminders = formatted.reminders
        .map((reminder) => reminder.remindAtLocal)
        .filter(Boolean)
        .join(", ");
      return [
        `- ID ${task.id}`,
        `título: ${task.title}`,
        `status: ${task.status}`,
        `agendada no horário local: ${formatted.scheduledLocal ?? "sem horário"}`,
        `prazo no horário local: ${formatted.dueLocal ?? "sem prazo"}`,
        `fuso: ${formatted.timeZone}`,
        `dia inteiro: ${task.all_day ? "sim" : "não"}`,
        `lembretes no horário local: ${reminders || "nenhum"}`,
        task.description ? `detalhes: ${task.description.slice(0, 500)}` : "",
      ]
        .filter(Boolean)
        .join("; ");
    })
    .join("\n");
}

export function localDayRange(timeZone = "America/Sao_Paulo", offsetDays = 0) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  const base = new Date(`${get("year")}-${get("month")}-${get("day")}T12:00:00-03:00`);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
  return {
    from: new Date(`${date}T00:00:00-03:00`).toISOString(),
    to: new Date(`${date}T23:59:59.999-03:00`).toISOString(),
  };
}
