import { NextResponse } from "next/server";
import {
  createMemoryDedupeKey,
  MEMORY_CATEGORIES,
  type MemoryCategory,
} from "@/lib/memory/normalize";
import { createClient } from "@/lib/supabase/server";

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 50;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const review = url.searchParams.get("review");
  const status = url.searchParams.get("status");
  const requestedPage = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const requestedPageSize = Number.parseInt(
    url.searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE),
    10,
  );
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize = Number.isFinite(requestedPageSize)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, requestedPageSize))
    : DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("memories")
    .select(
      "id, title, content, category, importance, status, review_status, memory_type, expires_at, source, created_at, updated_at",
      { count: "exact" },
    )
    .eq("user_id", userId)
    .neq("status", "forgotten")
    .order("updated_at", { ascending: false });

  if (["pending", "approved", "rejected"].includes(review ?? "")) {
    query = query.eq("review_status", review);
  }
  if (["active", "archived"].includes(status ?? "")) {
    query = query.eq("status", status);
  }

  const [pageResult, activeResult, archivedResult, totalResult] = await Promise.all([
    query.range(from, to),
    supabase
      .from("memories")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("review_status", "approved")
      .eq("status", "active"),
    supabase
      .from("memories")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "archived"),
    supabase
      .from("memories")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .neq("status", "forgotten"),
  ]);

  if (
    pageResult.error ||
    activeResult.error ||
    archivedResult.error ||
    totalResult.error
  ) {
    return NextResponse.json(
      { error: "Não foi possível carregar as memórias." },
      { status: 500 },
    );
  }

  const total = pageResult.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return NextResponse.json({
    memories: pageResult.data ?? [],
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
    },
    counts: {
      approved: activeResult.count ?? 0,
      archived: archivedResult.count ?? 0,
      all: totalResult.count ?? 0,
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
    title?: string;
    content?: string;
    category?: string;
    importance?: number;
    memoryType?: string;
    expiresAt?: string | null;
  } | null;

  const title = body?.title?.trim();
  const content = body?.content?.trim();
  const category = MEMORY_CATEGORIES.includes(body?.category as MemoryCategory)
    ? (body?.category as MemoryCategory)
    : "general";
  const importance = Math.min(5, Math.max(1, Math.round(body?.importance ?? 3)));
  const memoryType = body?.memoryType === "temporary" ? "temporary" : "permanent";
  let expiresAt: string | null = null;
  if (memoryType === "temporary") {
    const date = body?.expiresAt
      ? new Date(body.expiresAt)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "A expiração precisa estar no futuro." },
        { status: 400 },
      );
    }
    expiresAt = date.toISOString();
  }

  if (!title || title.length > 80 || !content || content.length > 500) {
    return NextResponse.json({ error: "Memória inválida." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("memories")
    .insert({
      user_id: userId,
      title,
      content,
      category,
      importance,
      memory_type: memoryType,
      expires_at: expiresAt,
      review_status: "approved",
      status: "active",
      source: "manual",
      dedupe_key: createMemoryDedupeKey(category, content),
    })
    .select(
      "id, title, content, category, importance, status, review_status, memory_type, expires_at, source, created_at, updated_at",
    )
    .single();

  if (error) {
    const duplicate = error.code === "23505";
    return NextResponse.json(
      {
        error: duplicate
          ? "Essa memória já existe."
          : "Não foi possível criar a memória.",
      },
      { status: duplicate ? 409 : 500 },
    );
  }

  return NextResponse.json({ memory: data }, { status: 201 });
}
