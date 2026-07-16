import { NextResponse } from "next/server";
import { authenticatedUserId, googleCalendarErrorResponse } from "@/lib/google-calendar/api";
import { getGoogleCalendarIntegration, publicIntegrationStatus } from "@/lib/google-calendar/client";

export const runtime = "nodejs";

export async function GET() {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    return NextResponse.json(
      publicIntegrationStatus(await getGoogleCalendarIntegration(userId)),
    );
  } catch (reason) {
    return googleCalendarErrorResponse(reason);
  }
}
