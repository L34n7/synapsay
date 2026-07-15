import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  isTaskStatus,
  normalizePriority,
  validDate,
} from "@/lib/tasks/types";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_SELECT =
  "id, title, description, status, priority, scheduled_at, due_at, all_day, timezone, recurrence_rule, created_by, completed_at, conversation_id, created_at, updated_at, reminders(id, task_id, remind_at, channel, status, delivered_at, dismissed_at)";

export async function PATCH(request: Request, context: RouteContext<"/api/tasks/[id]">) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Tarefa inválida." }, { status: 400 });
  }
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Alteração inválida." }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.title === "string") {
    const title = body.title.replace(/[\r\n]+/g, " ").trim();
    if (title.length < 2 || title.length > 160) {
      return NextResponse.json({ error: "Título inválido." }, { status: 400 });
    }
    update.title = title;
  }
  if (typeof body.description === "string") {
    if (body.description.length > 4000) {
      return NextResponse.json({ error: "Descrição muito longa." }, { status: 400 });
    }
    update.description = body.description.trim();
  }
  if (body.status !== undefined) {
    if (!isTaskStatus(body.status)) {
      return NextResponse.json({ error: "Status inválido." }, { status: 400 });
    }
    update.status = body.status;
    update.completed_at = body.status === "completed" ? new Date().toISOString() : null;
  }
  if (body.priority !== undefined) update.priority = normalizePriority(body.priority);
  if (body.scheduledAt !== undefined) {
    update.scheduled_at = body.scheduledAt === null ? null : validDate(body.scheduledAt);
    if (body.scheduledAt !== null && !update.scheduled_at) {
      return NextResponse.json({ error: "Data agendada inválida." }, { status: 400 });
    }
  }
  if (body.dueAt !== undefined) {
    update.due_at = body.dueAt === null ? null : validDate(body.dueAt);
    if (body.dueAt !== null && !update.due_at) {
      return NextResponse.json({ error: "Prazo inválido." }, { status: 400 });
    }
  }
  if (typeof body.allDay === "boolean") update.all_day = body.allDay;

  if (!Object.keys(update).length && body.reminderAt === undefined) {
    return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
  }

  let task: Record<string, unknown> | null = null;
  if (Object.keys(update).length) {
    const { data, error } = await supabase
      .from("tasks")
      .update(update)
      .eq("id", id)
      .eq("user_id", userId)
      .select(TASK_SELECT)
      .maybeSingle();
    if (error || !data) {
      return NextResponse.json(
        { error: "Não foi possível atualizar a tarefa.", detail: error?.message },
        { status: error ? 500 : 404 },
      );
    }
    task = data;
  }

  if (body.reminderAt !== undefined) {
    await supabase
      .from("reminders")
      .update({ status: "cancelled" })
      .eq("task_id", id)
      .eq("user_id", userId)
      .eq("status", "scheduled");
    const reminderAt = body.reminderAt === null ? null : validDate(body.reminderAt);
    if (body.reminderAt !== null && !reminderAt) {
      return NextResponse.json({ error: "Horário do lembrete inválido." }, { status: 400 });
    }
    if (reminderAt) {
      const { error } = await supabase.from("reminders").insert({
        task_id: id,
        user_id: userId,
        remind_at: reminderAt,
        channel: "browser",
      });
      if (error) {
        return NextResponse.json(
          { error: "Não foi possível atualizar o lembrete.", detail: error.message },
          { status: 500 },
        );
      }
    }
  }

  if (["completed", "cancelled"].includes(String(update.status))) {
    await supabase
      .from("reminders")
      .update({ status: "cancelled" })
      .eq("task_id", id)
      .eq("user_id", userId)
      .eq("status", "scheduled");
  }

  const { data: refreshed } = await supabase
    .from("tasks")
    .select(TASK_SELECT)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return NextResponse.json({ task: refreshed ?? task });
}

export async function DELETE(_request: Request, context: RouteContext<"/api/tasks/[id]">) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Tarefa inválida." }, { status: 400 });
  }
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const { error, count } = await supabase
    .from("tasks")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("user_id", userId);
  if (error || !count) {
    return NextResponse.json(
      { error: error ? "Não foi possível excluir a tarefa." : "Tarefa não encontrada." },
      { status: error ? 500 : 404 },
    );
  }
  return NextResponse.json({ deleted: true });
}

