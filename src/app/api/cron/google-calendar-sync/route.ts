import { NextResponse } from "next/server";
import { syncGoogleCalendarForUser } from "@/lib/google-calendar/sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const { data, error } = await createAdminClient()
    .from("google_calendar_integrations")
    .select("user_id")
    .eq("sync_enabled", true)
    .order("last_sync_at", { ascending: true, nullsFirst: true })
    .limit(30);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{ userId: string; ok: boolean; error?: string }> = [];
  const integrations = data ?? [];
  for (let index = 0; index < integrations.length; index += 3) {
    const batch = integrations.slice(index, index + 3);
    const settled = await Promise.allSettled(
      batch.map((item) => syncGoogleCalendarForUser(item.user_id)),
    );
    settled.forEach((result, resultIndex) => {
      const userId = batch[resultIndex].user_id;
      results.push(
        result.status === "fulfilled"
          ? { userId, ok: true }
          : {
              userId,
              ok: false,
              error:
                result.reason instanceof Error
                  ? result.reason.message.slice(0, 300)
                  : "Falha desconhecida.",
            },
      );
    });
  }

  return NextResponse.json({
    processed: results.length,
    succeeded: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
  });
}
