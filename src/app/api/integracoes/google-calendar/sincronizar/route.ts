import { NextResponse } from "next/server";
import { authenticatedUserId, googleCalendarErrorResponse } from "@/lib/google-calendar/api";
import { GoogleCalendarError } from "@/lib/google-calendar/client";
import { syncGoogleCalendarForUser } from "@/lib/google-calendar/sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

const LEGACY_LINK_BATCH_SIZE = 200;

async function backfillLegacyEventLinks(userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("google_calendar_event_links")
    .select("id")
    .eq("user_id", userId)
    .is("last_synced_at", null)
    .limit(1_000);

  if (error) throw new GoogleCalendarError(error.message);
  const links = data ?? [];
  if (!links.length) return 0;

  const syncedAt = new Date().toISOString();
  for (let index = 0; index < links.length; index += LEGACY_LINK_BATCH_SIZE) {
    const ids = links
      .slice(index, index + LEGACY_LINK_BATCH_SIZE)
      .map((link) => String(link.id));
    const { error: updateError } = await admin
      .from("google_calendar_event_links")
      .update({ last_synced_at: syncedAt })
      .in("id", ids)
      .eq("user_id", userId);
    if (updateError) throw new GoogleCalendarError(updateError.message);
  }

  console.info(
    `Google Calendar: ${links.length} vínculo(s) legado(s) marcado(s) como já sincronizado(s).`,
  );
  return links.length;
}

function normalizeInvalidStartError(reason: unknown) {
  if (
    reason instanceof GoogleCalendarError &&
    /invalid start time/i.test(reason.message)
  ) {
    return new GoogleCalendarError(
      "Um compromisso possui um horário inicial incompatível com o Google Agenda. A sincronização foi interrompida sem alterar os demais compromissos.",
      422,
      "google_invalid_start_time",
    );
  }
  return reason;
}

export async function POST() {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  try {
    const recoveredLegacyLinks = await backfillLegacyEventLinks(userId);
    const result = await syncGoogleCalendarForUser(userId, true);
    return NextResponse.json({
      result: {
        ...result,
        recoveredLegacyLinks,
      },
    });
  } catch (reason) {
    return googleCalendarErrorResponse(normalizeInvalidStartError(reason));
  }
}
