import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskRecord } from "@/lib/tasks/types";

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
      const reminders = (task.reminders ?? [])
        .filter((reminder) => reminder.status === "scheduled")
        .map((reminder) => reminder.remind_at)
        .join(", ");
      return [
        `- ID ${task.id}`,
        `título: ${task.title}`,
        `status: ${task.status}`,
        `agendada: ${task.scheduled_at ?? "sem horário"}`,
        `prazo: ${task.due_at ?? "sem prazo"}`,
        `dia inteiro: ${task.all_day ? "sim" : "não"}`,
        `lembretes: ${reminders || "nenhum"}`,
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

