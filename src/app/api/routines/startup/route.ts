import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { claimRoutineOpportunities, formatRoutineOpening } from "@/lib/routines/engine";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub ? String(authData.claims.sub) : null;
  if (!userId) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : null;

  try {
    const opportunities = await claimRoutineOpportunities({
      supabase,
      userId,
      conversationId,
    });
    return NextResponse.json({
      opportunities,
      openingInstruction: formatRoutineOpening(opportunities),
    });
  } catch (reason) {
    console.error("Falha ao avaliar rotinas:", reason);
    return NextResponse.json({ error: "Não foi possível avaliar as rotinas agora." }, { status: 500 });
  }
}
