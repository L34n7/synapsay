import { NextResponse } from "next/server";
import { authenticatedUserId, googleCalendarErrorResponse } from "@/lib/google-calendar/api";
import { syncGoogleCalendarForUser } from "@/lib/google-calendar/sync";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST() {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    return NextResponse.json({ result: await syncGoogleCalendarForUser(userId, true) });
  } catch (reason) {
    return googleCalendarErrorResponse(reason);
  }
}
