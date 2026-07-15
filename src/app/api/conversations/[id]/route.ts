import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function authenticate() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return { supabase, userId: data?.claims?.sub };
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
  }

  const { supabase, userId } = await authenticate();
  if (!userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("conversations")
    .select(
      "id, title, title_source, channel, status, started_at, last_message_at, ended_at, end_reason, created_at, updated_at",
    )
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
  }
  return NextResponse.json({ conversation: data });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
  }

  const { supabase, userId } = await authenticate();
  if (!userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    title?: string;
    status?: string;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "Alteração inválida." }, { status: 400 });
  }

  const update: Record<string, string | null> = {};
  if (body.title !== undefined) {
    const title = body.title.replace(/[\r\n]+/g, " ").trim();
    if (title.length < 2 || title.length > 80) {
      return NextResponse.json(
        { error: "O título deve ter entre 2 e 80 caracteres." },
        { status: 400 },
      );
    }
    update.title = title;
    update.title_source = "manual";
    update.title_generated_at = null;
  }

  if (body.status !== undefined) {
    if (!["active", "archived"].includes(body.status)) {
      return NextResponse.json({ error: "Status inválido." }, { status: 400 });
    }
    update.status = body.status;
    if (body.status === "active") {
      update.ended_at = null;
      update.end_reason = null;
      update.memory_processing_status = "pending";
      update.memory_processed_at = null;
      update.memory_processing_error = null;
    } else {
      update.ended_at = new Date().toISOString();
      update.end_reason = "user_archived";
    }
  }

  if (!Object.keys(update).length) {
    return NextResponse.json({ error: "Nenhuma alteração enviada." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("conversations")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId)
    .select(
      "id, title, title_source, channel, status, started_at, last_message_at, ended_at, end_reason, updated_at",
    )
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { error: "Não foi possível atualizar a conversa." },
      { status: error ? 500 : 404 },
    );
  }
  return NextResponse.json({ conversation: data });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
  }

  const { supabase, userId } = await authenticate();
  if (!userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const { error, count } = await supabase
    .from("conversations")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json(
      { error: "Não foi possível excluir a conversa." },
      { status: 500 },
    );
  }
  if (!count) {
    return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
