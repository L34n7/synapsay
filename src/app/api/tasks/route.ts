import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  isTaskStatus,
  normalizePriority,
  validDate,
} from "@/lib/tasks/types";

export const runtime = "nodejs";

const TASK_SELECT =
  "id, title, description, status, priority, scheduled_at, due_at, all_day, timezone, recurrence_rule, created_by, completed_at, conversation_id, created_at, updated_at, reminders(id, task_id, remind_at, channel, status, delivered_at, dismissed_at)";

async function authenticatedClient() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return { supabase, userId: data?.claims?.sub ?? null };
}

export async function GET(request: Request) {
  const { supabase, userId } = await authenticatedClient();
  if (!userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const from = validDate(url.searchParams.get("from"));
  const to = validDate(url.searchParams.get("to"));
  const status = url.searchParams.get("status");
  const search = url.searchParams
    .get("search")
    ?.replace(/[,().%_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const limit = Math.min(250, Math.max(10, Number(url.searchParams.get("limit")) || 150));

  let query = supabase
    .from("tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (status && isTaskStatus(status)) query = query.eq("status", status);
  if (status === "open") query = query.in("status", ["pending", "in_progress"]);
  if (from) query = query.or(`scheduled_at.gte.${from},due_at.gte.${from}`);
  if (to) query = query.or(`scheduled_at.lt.${to},due_at.lt.${to}`);
  if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: "Não foi possível carregar a agenda.", detail: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ tasks: data ?? [] });
}

export async function POST(request: Request) {
  const { supabase, userId } = await authenticatedClient();
  if (!userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    title?: string;
    description?: string;
    priority?: number;
    scheduledAt?: string | null;
    dueAt?: string | null;
    reminderAt?: string | null;
    allDay?: boolean;
    timezone?: string;
  } | null;

  const title = body?.title?.replace(/[\r\n]+/g, " ").trim() ?? "";
  const description = body?.description?.trim() ?? "";
  const scheduledAt = validDate(body?.scheduledAt);
  const dueAt = validDate(body?.dueAt);
  const reminderAt = validDate(body?.reminderAt);
  const timezone = body?.timezone?.trim().slice(0, 80) || "America/Sao_Paulo";

  if (
    title.length < 2 ||
    title.length > 160 ||
    description.length > 4000 ||
    (scheduledAt && dueAt && dueAt < scheduledAt)
  ) {
    return NextResponse.json({ error: "Tarefa inválida." }, { status: 400 });
  }

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      user_id: userId,
      title,
      description,
      priority: normalizePriority(body?.priority),
      scheduled_at: scheduledAt,
      due_at: dueAt,
      all_day: body?.allDay === true,
      timezone,
      created_by: "manual",
    })
    .select(TASK_SELECT)
    .single();

  if (error || !task) {
    return NextResponse.json(
      { error: "Não foi possível criar a tarefa.", detail: error?.message },
      { status: 500 },
    );
  }

  if (reminderAt) {
    const { error: reminderError } = await supabase.from("reminders").insert({
      task_id: task.id,
      user_id: userId,
      remind_at: reminderAt,
      channel: "browser",
    });
    if (reminderError) {
      await supabase.from("tasks").delete().eq("id", task.id).eq("user_id", userId);
      return NextResponse.json(
        { error: "Não foi possível criar o lembrete.", detail: reminderError.message },
        { status: 500 },
      );
    }
  }

  const { data: created } = await supabase
    .from("tasks")
    .select(TASK_SELECT)
    .eq("id", task.id)
    .eq("user_id", userId)
    .single();

  return NextResponse.json({ task: created ?? task }, { status: 201 });
}
