import { NextResponse } from "next/server";
import { refreshContinuityCache } from "@/lib/continuity/cache";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

type RouteContext = { params: Promise<{ id: string }> };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

export async function POST(_request: Request, context: RouteContext) {
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

  const { data: conversation, error } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !conversation) {
    return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
  }

  try {
    return NextResponse.json(
      await refreshContinuityCache({
        supabase,
        userId,
        conversationId: id,
      }),
    );
  } catch (reason) {
    const message =
      reason instanceof Error ? reason.message : "Falha ao atualizar continuidade.";
    console.error("Falha ao atualizar continuidade:", reason);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
