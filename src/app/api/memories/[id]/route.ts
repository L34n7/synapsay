import { NextResponse } from "next/server";
import {
  createMemoryDedupeKey,
  MEMORY_CATEGORIES,
  type MemoryCategory,
} from "@/lib/memory/normalize";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Memória inválida." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const { data: current } = await supabase
    .from("memories")
    .select("id, title, content, category, importance, memory_type, expires_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!current) {
    return NextResponse.json({ error: "Memória não encontrada." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    title?: string;
    content?: string;
    category?: string;
    importance?: number;
    memoryType?: string;
    expiresAt?: string | null;
    reviewStatus?: string;
    status?: string;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "Alteração inválida." }, { status: 400 });
  }

  const title = body.title === undefined ? current.title : body.title.trim();
  const content =
    body.content === undefined ? current.content : body.content.trim();
  const category =
    body.category === undefined
      ? current.category
      : MEMORY_CATEGORIES.includes(body.category as MemoryCategory)
        ? body.category
        : null;
  const importance =
    body.importance === undefined
      ? current.importance
      : Math.round(Number(body.importance));
  const memoryType =
    body.memoryType === undefined ? current.memory_type : body.memoryType;

  if (
    !title ||
    title.length > 80 ||
    !content ||
    content.length > 500 ||
    !category ||
    importance < 1 ||
    importance > 5 ||
    !["permanent", "temporary"].includes(memoryType) ||
    (body.reviewStatus !== undefined &&
      !["pending", "approved", "rejected"].includes(body.reviewStatus)) ||
    (body.status !== undefined && !["active", "archived"].includes(body.status))
  ) {
    return NextResponse.json({ error: "Alteração inválida." }, { status: 400 });
  }

  let expiresAt = current.expires_at;
  if (memoryType === "permanent") expiresAt = null;
  if (body.expiresAt !== undefined && memoryType === "temporary") {
    if (body.expiresAt === null || body.expiresAt === "") expiresAt = null;
    else {
      const date = new Date(body.expiresAt);
      if (Number.isNaN(date.getTime())) {
        return NextResponse.json({ error: "Data inválida." }, { status: 400 });
      }
      expiresAt = date.toISOString();
    }
  }
  if (memoryType === "temporary" && !expiresAt) {
    expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  const update: Record<string, string | number | null> = {
    title,
    content,
    category,
    importance,
    memory_type: memoryType,
    expires_at: expiresAt,
    dedupe_key: createMemoryDedupeKey(category, content),
  };
  if (body.reviewStatus !== undefined) update.review_status = body.reviewStatus;
  if (body.status !== undefined) update.status = body.status;

  const { data, error } = await supabase
    .from("memories")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId)
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
          : "Não foi possível atualizar a memória.",
      },
      { status: duplicate ? 409 : 500 },
    );
  }

  return NextResponse.json({ memory: data });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Memória inválida." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const { error, count } = await supabase
    .from("memories")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json(
      { error: "Não foi possível esquecer a memória." },
      { status: 500 },
    );
  }
  if (!count) {
    return NextResponse.json({ error: "Memória não encontrada." }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
