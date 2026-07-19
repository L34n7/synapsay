import { NextResponse } from "next/server";
import { executeRoutine } from "@/lib/routines/executor";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub ? String(authData.claims.sub) : null;
  if (!userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const routineId = typeof body?.routineId === "string" ? body.routineId : "";
  if (!routineId) {
    return NextResponse.json({ error: "Rotina inválida." }, { status: 400 });
  }

  const { data: routine } = await supabase
    .from("assistant_routines")
    .select("id")
    .eq("id", routineId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!routine) {
    return NextResponse.json({ error: "Rotina não encontrada." }, { status: 404 });
  }

  const referenceKey = `test:${crypto.randomUUID()}`;
  const { error: runError } = await supabase.from("assistant_routine_runs").insert({
    routine_id: routineId,
    user_id: userId,
    period_key: referenceKey,
    execution_number: 1,
    reference_key: referenceKey,
    status: "available",
    offered_at: new Date().toISOString(),
    is_test: true,
  });
  if (runError) {
    return NextResponse.json(
      { error: "Não foi possível iniciar o teste da rotina." },
      { status: 500 },
    );
  }

  try {
    return NextResponse.json(
      await executeRoutine({
        supabase,
        userId,
        routineId,
        referenceKey,
      }),
    );
  } catch (reason) {
    return NextResponse.json(
      {
        error:
          reason instanceof Error
            ? reason.message
            : "Não foi possível testar a rotina.",
      },
      { status: 500 },
    );
  }
}
