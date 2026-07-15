import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, context: RouteContext<"/api/reminders/[id]">) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Lembrete inválido." }, { status: 400 });
  }
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { status?: string } | null;
  if (!body || !["delivered", "dismissed", "cancelled"].includes(body.status ?? "")) {
    return NextResponse.json({ error: "Status inválido." }, { status: 400 });
  }
  const now = new Date().toISOString();
  const update = {
    status: body.status,
    delivered_at: body.status === "delivered" ? now : undefined,
    dismissed_at: body.status === "dismissed" ? now : undefined,
  };
  const { data, error } = await supabase
    .from("reminders")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId)
    .select("id, status, delivered_at, dismissed_at")
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json(
      { error: error ? "Não foi possível atualizar o lembrete." : "Lembrete não encontrado." },
      { status: error ? 500 : 404 },
    );
  }
  return NextResponse.json({ reminder: data });
}

