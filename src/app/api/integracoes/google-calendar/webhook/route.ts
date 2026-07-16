import {
  findGoogleCalendarChannel,
  validGoogleCalendarChannelToken,
} from "@/lib/google-calendar/subscriptions";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const channelId = request.headers.get("x-goog-channel-id") ?? "";
  const channelToken = request.headers.get("x-goog-channel-token") ?? "";
  const resourceId = request.headers.get("x-goog-resource-id") ?? "";
  const resourceState = request.headers.get("x-goog-resource-state") ?? "";
  if (!channelId || !channelToken || !resourceId) return new Response(null, { status: 204 });

  const channel = await findGoogleCalendarChannel(channelId).catch(() => null);
  if (
    !channel ||
    channel.resource_id !== resourceId ||
    !validGoogleCalendarChannelToken(channel, channelToken)
  ) {
    return new Response(null, { status: 204 });
  }

  if (["exists", "not_exists"].includes(resourceState)) {
    const { error } = await createAdminClient()
      .from("google_calendar_sync_channels")
      .update({ change_pending: true, last_notification_at: new Date().toISOString() })
      .eq("id", channel.id)
      .eq("channel_id", channelId);
    if (error) return new Response(null, { status: 500 });
  }
  return new Response(null, { status: 204 });
}
