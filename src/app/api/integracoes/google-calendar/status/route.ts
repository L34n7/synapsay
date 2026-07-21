import { NextResponse } from "next/server";
import { authenticatedUserId, googleCalendarErrorResponse } from "@/lib/google-calendar/api";
import {
  getGoogleCalendarIntegration,
  publicIntegrationStatus,
  type GoogleCalendarIntegration,
} from "@/lib/google-calendar/client";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_SYNC_AFTER_MS = 135_000;

async function clearStaleSyncLock(integration: GoogleCalendarIntegration) {
  if (!integration.sync_started_at) return integration;
  const startedAt = new Date(integration.sync_started_at).getTime();
  if (!Number.isFinite(startedAt) || Date.now() - startedAt < STALE_SYNC_AFTER_MS) {
    return integration;
  }

  const completedAfterStart = Boolean(
    integration.last_sync_at &&
      new Date(integration.last_sync_at).getTime() >= startedAt,
  );
  const lastSyncError = completedAfterStart
    ? integration.last_sync_error
    : "A sincronização anterior foi interrompida antes de terminar. Tente sincronizar novamente.";
  const { error } = await createAdminClient()
    .from("google_calendar_integrations")
    .update({
      sync_started_at: null,
      sync_lock_token: null,
      last_sync_error: lastSyncError,
    })
    .eq("user_id", integration.user_id)
    .eq("sync_lock_token", integration.sync_lock_token);
  if (error) throw error;

  return {
    ...integration,
    sync_started_at: null,
    sync_lock_token: null,
    last_sync_error: lastSyncError,
  };
}

export async function GET() {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const integration = await getGoogleCalendarIntegration(userId);
    const recovered = integration ? await clearStaleSyncLock(integration) : null;
    return NextResponse.json(publicIntegrationStatus(recovered), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (reason) {
    return googleCalendarErrorResponse(reason);
  }
}
