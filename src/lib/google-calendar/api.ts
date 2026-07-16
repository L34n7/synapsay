import { NextResponse } from "next/server";
import { GoogleCalendarError } from "@/lib/google-calendar/client";
import { createClient } from "@/lib/supabase/server";

export async function authenticatedUserId() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ?? null;
}

export function googleCalendarErrorResponse(reason: unknown) {
  console.error("Google Calendar:", reason);
  if (reason instanceof GoogleCalendarError) {
    return NextResponse.json(
      { error: reason.message, code: reason.code },
      { status: reason.status >= 400 && reason.status < 600 ? reason.status : 500 },
    );
  }
  return NextResponse.json(
    { error: reason instanceof Error ? reason.message : "Falha na integração com o Google Agenda." },
    { status: 500 },
  );
}
