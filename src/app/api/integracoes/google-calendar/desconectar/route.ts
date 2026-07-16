import { NextResponse } from "next/server";
import { authenticatedUserId, googleCalendarErrorResponse } from "@/lib/google-calendar/api";
import { decryptGoogleToken } from "@/lib/google-calendar/crypto";
import { getGoogleCalendarIntegration } from "@/lib/google-calendar/client";
import { stopGoogleCalendarWatches } from "@/lib/google-calendar/subscriptions";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function DELETE() {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const integration = await getGoogleCalendarIntegration(userId);
    if (!integration) return NextResponse.json({ disconnected: true });
    const token = integration.refresh_token_ciphertext
      ? decryptGoogleToken(integration.refresh_token_ciphertext)
      : decryptGoogleToken(integration.access_token_ciphertext);
    await stopGoogleCalendarWatches(userId);
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      cache: "no-store",
    }).catch(() => undefined);
    const { error } = await createAdminClient()
      .from("google_calendar_integrations")
      .delete()
      .eq("user_id", userId);
    if (error) throw error;
    return NextResponse.json({ disconnected: true });
  } catch (reason) {
    return googleCalendarErrorResponse(reason);
  }
}
