export const TASK_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export type ReminderRecord = {
  id: string;
  task_id: string;
  remind_at: string;
  channel: "browser" | "in_app";
  status: "scheduled" | "delivered" | "dismissed" | "cancelled" | "failed";
  delivered_at: string | null;
  dismissed_at: string | null;
};

export type TaskRecord = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  scheduled_at: string | null;
  due_at: string | null;
  all_day: boolean;
  timezone: string;
  recurrence_rule: string | null;
  created_by: "manual" | "assistant" | "integration";
  completed_at: string | null;
  conversation_id: string | null;
  created_at: string;
  updated_at: string;
  reminders?: ReminderRecord[];
};

export function validDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizePriority(value: unknown) {
  return Math.min(5, Math.max(1, Math.round(Number(value) || 3)));
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return TASK_STATUSES.includes(value as TaskStatus);
}

export function taskMoment(task: Pick<TaskRecord, "scheduled_at" | "due_at">) {
  return task.scheduled_at ?? task.due_at;
}

