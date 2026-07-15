import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!conversation) {
    return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
  }

  const url = new URL(request.url);
  const limit = Math.min(
    100,
    Math.max(10, Number(url.searchParams.get("limit")) || 50),
  );
  const cursor = url.searchParams.get("cursor");

  let query = supabase
    .from("messages")
    .select("id, role, content, input_type, external_event_id, generation_status, error_message, metadata, created_at")
    .eq("conversation_id", id)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (cursor && !Number.isNaN(new Date(cursor).getTime())) {
    query = query.lt("created_at", new Date(cursor).toISOString());
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: "Não foi possível carregar as mensagens." },
      { status: 500 },
    );
  }

  const hasMore = (data?.length ?? 0) > limit;
  const page = (data ?? []).slice(0, limit).reverse();
  return NextResponse.json({
    messages: page,
    hasMore,
    nextCursor: hasMore ? page[0]?.created_at ?? null : null,
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as {
    role?: string;
    content?: string;
    inputType?: string;
    externalEventId?: string;
  } | null;

  const content = body?.content?.trim();
  const role = body?.role;
  const inputType = body?.inputType;
  const externalEventId = body?.externalEventId?.trim() || null;

  if (
    !content ||
    content.length > 40_000 ||
    !["user", "assistant"].includes(role ?? "") ||
    !["voice", "text"].includes(inputType ?? "") ||
    (externalEventId && externalEventId.length > 255)
  ) {
    return NextResponse.json({ error: "Mensagem inválida." }, { status: 400 });
  }

  const payload = {
    conversation_id: id,
    user_id: userId,
    role,
    content,
    input_type: inputType,
    external_event_id: externalEventId,
  };

  const query = externalEventId
    ? supabase
        .from("messages")
        .upsert(payload, {
          onConflict: "conversation_id,external_event_id",
          ignoreDuplicates: true,
        })
        .select("id")
        .maybeSingle()
    : supabase.from("messages").insert(payload).select("id").single();

  const { data, error } = await query;

  if (error) {
    console.error("Erro ao salvar mensagem no Supabase:", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      conversationId: id,
      userId,
      role,
      inputType,
      externalEventId,
    });

    return NextResponse.json(
      {
        error: "Não foi possível salvar a mensagem.",
        code: error.code,
      },
      { status: 500 },
    );
  }

  const { data: conversation } = await supabase
    .from("conversations")
    .select("title, title_source")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  const update: {
    last_message_at: string;
    status: string;
    ended_at: null;
    end_reason: null;
    title?: string;
    title_source?: string;
  } = {
    last_message_at: new Date().toISOString(),
    status: "active",
    ended_at: null,
    end_reason: null,
  };
  if (role === "user" && !conversation?.title) {
    update.title = content.slice(0, 80);
    update.title_source = "first_message";
  }

  await supabase
    .from("conversations")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId);

  return NextResponse.json({ message: data, duplicate: !data }, { status: 201 });
}
