import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const now = new Date();
  const oldest = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("reminders")
    .select(
      "id, remind_at, channel, status, task:tasks!inner(id, title, description, status, scheduled_at, due_at)",
    )
    .eq("user_id", userId)
    .eq("status", "scheduled")
    .gte("remind_at", oldest)
    .lte("remind_at", now.toISOString())
    .in("task.status", ["pending", "in_progress"])
    .order("remind_at", { ascending: true })
    .limit(20);

  if (error) {
    return NextResponse.json(
      { error: "Não foi possível consultar os lembretes.", detail: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ reminders: data ?? [] });
}

