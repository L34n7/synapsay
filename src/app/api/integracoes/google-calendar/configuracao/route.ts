import { NextResponse } from "next/server";
import { authenticatedUserId, googleCalendarErrorResponse } from "@/lib/google-calendar/api";
import { type GoogleCalendarIntegration, type SyncDirection } from "@/lib/google-calendar/client";
import { ensureGoogleCalendarWatches } from "@/lib/google-calendar/subscriptions";
import { listGoogleCalendars } from "@/lib/google-calendar/sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const DIRECTIONS: SyncDirection[] = [
  "bidirectional",
  "google_to_synapsay",
  "synapsay_to_google",
];

export async function PATCH(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    calendarId?: string;
    syncEnabled?: boolean;
    syncDirection?: SyncDirection;
  } | null;
  if (!body) return NextResponse.json({ error: "Configuração inválida." }, { status: 400 });

  try {
    const update: Record<string, unknown> = {};
    if (typeof body.syncEnabled === "boolean") update.sync_enabled = body.syncEnabled;
    if (body.syncDirection !== undefined) {
      if (!DIRECTIONS.includes(body.syncDirection)) {
        return NextResponse.json({ error: "Direção de sincronização inválida." }, { status: 400 });
      }
      update.sync_direction = body.syncDirection;
    }
    if (body.calendarId !== undefined) {
      const calendars = await listGoogleCalendars(userId);
      const calendar = calendars.find((item) => item.id === body.calendarId);
      if (!calendar) {
        return NextResponse.json(
          { error: "A agenda escolhida não existe ou não permite edição." },
          { status: 400 },
        );
      }
      update.selected_calendar_id = calendar.id;
      update.selected_calendar_name = calendar.name;
      update.selected_calendar_timezone = calendar.timezone;
      update.last_sync_at = null;
      update.last_sync_error = null;
    }
    if (!Object.keys(update).length) {
      return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
    }
    const { data, error } = await createAdminClient()
      .from("google_calendar_integrations")
      .update(update)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Integração não encontrada." },
        { status: error ? 500 : 404 },
      );
    }
    await ensureGoogleCalendarWatches(userId, data as GoogleCalendarIntegration).catch((reason) => {
      console.warn("Notificações do Google Agenda não atualizadas:", reason);
    });
    return NextResponse.json({ updated: true, integration: data });
  } catch (reason) {
    return googleCalendarErrorResponse(reason);
  }
}
