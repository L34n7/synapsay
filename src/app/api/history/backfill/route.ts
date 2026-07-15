import { NextResponse } from "next/server";
import { backfillHistoryEmbeddings } from "@/lib/history/embeddings";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    limit?: unknown;
  } | null;
  const limit = Math.min(100, Math.max(1, Number(body?.limit) || 50));
  const result = await backfillHistoryEmbeddings({
    supabase,
    userId,
    limit,
  });

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
