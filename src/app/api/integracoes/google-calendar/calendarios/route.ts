import { NextResponse } from "next/server";
import { authenticatedUserId, googleCalendarErrorResponse } from "@/lib/google-calendar/api";
import { listGoogleCalendars } from "@/lib/google-calendar/sync";

export const runtime = "nodejs";

export async function GET() {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    return NextResponse.json({ calendars: await listGoogleCalendars(userId) });
  } catch (reason) {
    return googleCalendarErrorResponse(reason);
  }
}
