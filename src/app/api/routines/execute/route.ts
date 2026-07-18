import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { executeRoutine } from "@/lib/routines/executor";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub ? String(authData.claims.sub) : null;
  if (!userId) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const routineId = typeof body?.routineId === "string" ? body.routineId : "";
  const referenceKey = typeof body?.referenceKey === "string" ? body.referenceKey : "";
  if (!routineId || !referenceKey) return NextResponse.json({ error: "Execução inválida." }, { status: 400 });
  try {
    return NextResponse.json(await executeRoutine({ supabase, userId, routineId, referenceKey }));
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Não foi possível executar a rotina.";
    const status = message.includes("aguarda confirmação") ? 409 : message.includes("expirou") ? 410 : message.includes("não encontrada") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
