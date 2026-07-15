import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim().slice(0, 120) ?? "";
  const status = url.searchParams.get("status");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(
    30,
    Math.max(5, Number(url.searchParams.get("pageSize")) || 12),
  );
  const offset = (page - 1) * pageSize;

  const inactivityLimit = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await supabase
    .from("conversations")
    .update({
      status: "archived",
      ended_at: new Date().toISOString(),
      end_reason: "inactivity",
    })
    .eq("user_id", userId)
    .eq("status", "active")
    .not("last_message_at", "is", null)
    .lt("last_message_at", inactivityLimit);

  let matchingIds: string[] | null = null;
  if (search) {
    const pattern = `%${search}%`;
    const [{ data: titleMatches }, { data: messageMatches }] = await Promise.all([
      supabase
        .from("conversations")
        .select("id")
        .eq("user_id", userId)
        .ilike("title", pattern)
        .limit(1000),
      supabase
        .from("messages")
        .select("conversation_id")
        .eq("user_id", userId)
        .ilike("content", pattern)
        .limit(1000),
    ]);
    matchingIds = [
      ...new Set([
        ...(titleMatches ?? []).map((item) => item.id),
        ...(messageMatches ?? []).map((item) => item.conversation_id),
      ]),
    ];

    if (!matchingIds.length) {
      return NextResponse.json({
        conversations: [],
        pagination: { page, pageSize, total: 0, totalPages: 0 },
      });
    }
  }

  let query = supabase
    .from("conversations")
    .select(
      "id, title, title_source, channel, status, started_at, last_message_at, ended_at, end_reason, updated_at",
      { count: "exact" },
    )
    .eq("user_id", userId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("started_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (matchingIds) query = query.in("id", matchingIds);
  if (["active", "archived"].includes(status ?? "")) {
    query = query.eq("status", status);
  }
  const fromDate = from ? new Date(`${from}T00:00:00-03:00`) : null;
  const toDate = to ? new Date(`${to}T23:59:59.999-03:00`) : null;
  if (fromDate && !Number.isNaN(fromDate.getTime())) {
    query = query.gte("started_at", fromDate.toISOString());
  }
  if (toDate && !Number.isNaN(toDate.getTime())) {
    query = query.lte("started_at", toDate.toISOString());
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json(
      { error: "Não foi possível carregar as conversas." },
      { status: 500 },
    );
  }

  const total = count ?? 0;
  return NextResponse.json({
    conversations: data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    channel?: string;
  } | null;
  const channel = body?.channel === "text" ? "text" : "voice";

  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId, channel })
    .select("id, started_at")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Não foi possível iniciar o histórico da conversa." },
      { status: 500 },
    );
  }

  return NextResponse.json({ conversation: data }, { status: 201 });
}
