import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  GoogleCalendarError,
  googleCalendarFetch,
  getGoogleCalendarIntegration,
  type GoogleCalendarIntegration,
} from "@/lib/google-calendar/client";
import { googleCalendarConfig } from "@/lib/google-calendar/config";
import { createAdminClient } from "@/lib/supabase/admin";

export const GOOGLE_CALENDAR_LIST_KEY = "__calendar_list__";

const CHANNEL_LIFETIME_MS = 6 * 24 * 60 * 60_000;
const CHANNEL_RENEWAL_WINDOW_MS = 24 * 60 * 60_000;

export type GoogleCalendarSyncChannel = {
  id: string;
  user_id: string;
  resource_type: "events" | "calendar_list";
  calendar_id: string;
  channel_id: string;
  channel_token_hash: string;
  resource_id: string;
  resource_uri: string | null;
  expiration_at: string;
  sync_token: string | null;
  change_pending: boolean;
  last_notification_at: string | null;
  last_synced_at: string | null;
};

type WatchResponse = {
  id?: string;
  resourceId?: string;
  resourceUri?: string;
  expiration?: string;
};

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function webhookAddress() {
  const configured = process.env.GOOGLE_CALENDAR_WEBHOOK_URL?.trim();
  const fallback = new URL(googleCalendarConfig().redirectUri);
  const url = configured
    ? new URL(configured)
    : new URL("/api/integracoes/google-calendar/webhook", fallback.origin);
  return url.protocol === "https:" ? url.toString() : null;
}

async function stopChannel(userId: string, channel: GoogleCalendarSyncChannel) {
  await googleCalendarFetch<null>({
    userId,
    path: "/channels/stop",
    method: "POST",
    body: { id: channel.channel_id, resourceId: channel.resource_id },
  }).catch(() => undefined);
}

async function createChannel({
  userId,
  resourceType,
  calendarId,
  address,
  previous,
}: {
  userId: string;
  resourceType: GoogleCalendarSyncChannel["resource_type"];
  calendarId: string;
  address: string;
  previous?: GoogleCalendarSyncChannel;
}) {
  const channelId = randomUUID();
  const channelToken = randomBytes(32).toString("base64url");
  const requestedExpiration = Date.now() + CHANNEL_LIFETIME_MS;
  const path =
    resourceType === "events"
      ? `/calendars/${encodeURIComponent(calendarId)}/events/watch`
      : "/users/me/calendarList/watch";
  const response = await googleCalendarFetch<WatchResponse>({
    userId,
    path,
    method: "POST",
    body: {
      id: channelId,
      type: "web_hook",
      address,
      token: channelToken,
      expiration: requestedExpiration,
    },
  });
  if (!response.resourceId) {
    throw new GoogleCalendarError(
      "O Google não confirmou o canal de notificações da agenda.",
      502,
      "google_watch_failed",
    );
  }

  const expirationMs = Number(response.expiration) || requestedExpiration;
  const { error } = await createAdminClient().from("google_calendar_sync_channels").upsert(
    {
      user_id: userId,
      resource_type: resourceType,
      calendar_id: calendarId,
      channel_id: channelId,
      channel_token_hash: tokenHash(channelToken),
      resource_id: response.resourceId,
      resource_uri: response.resourceUri ?? null,
      expiration_at: new Date(expirationMs).toISOString(),
      change_pending: previous?.change_pending ?? true,
      last_notification_at: previous?.last_notification_at ?? null,
    },
    { onConflict: "user_id,resource_type,calendar_id" },
  );
  if (error) throw new GoogleCalendarError(error.message);
  if (previous && previous.channel_id !== channelId) await stopChannel(userId, previous);
}

export async function ensureGoogleCalendarWatches(
  userId: string,
  integration?: GoogleCalendarIntegration,
) {
  const address = webhookAddress();
  if (!address) return { enabled: false, reason: "https_required" };
  const current = integration ?? (await getGoogleCalendarIntegration(userId));
  if (!current?.sync_enabled) return { enabled: false, reason: "sync_disabled" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("google_calendar_sync_channels")
    .select("*")
    .eq("user_id", userId);
  if (error) throw new GoogleCalendarError(error.message);
  const channels = (data ?? []) as GoogleCalendarSyncChannel[];

  const desired: Array<{
    resourceType: GoogleCalendarSyncChannel["resource_type"];
    calendarId: string;
  }> = [];
  if (current.sync_direction !== "synapsay_to_google") {
    desired.push(
      { resourceType: "calendar_list", calendarId: GOOGLE_CALENDAR_LIST_KEY },
      { resourceType: "events", calendarId: current.selected_calendar_id },
    );
  }

  const obsolete = channels.filter(
    (channel) =>
      !desired.some(
        (target) =>
          channel.resource_type === target.resourceType &&
          channel.calendar_id === target.calendarId,
      ),
  );
  for (const channel of obsolete) {
    await stopChannel(userId, channel);
    const { error: deleteError } = await admin
      .from("google_calendar_sync_channels")
      .delete()
      .eq("id", channel.id);
    if (deleteError) throw new GoogleCalendarError(deleteError.message);
  }

  const activeChannels = channels.filter((channel) => !obsolete.includes(channel));
  let renewed = 0;
  for (const target of desired) {
    const existing = activeChannels.find(
      (channel) =>
        channel.resource_type === target.resourceType &&
        channel.calendar_id === target.calendarId,
    );
    const healthy =
      existing &&
      new Date(existing.expiration_at).getTime() > Date.now() + CHANNEL_RENEWAL_WINDOW_MS;
    if (healthy) continue;
    await createChannel({ userId, address, previous: existing, ...target });
    renewed += 1;
  }
  return { enabled: true, renewed };
}

export async function eventSyncState(userId: string, calendarId: string) {
  const { data, error } = await createAdminClient()
    .from("google_calendar_sync_channels")
    .select("*")
    .eq("user_id", userId)
    .eq("resource_type", "events")
    .eq("calendar_id", calendarId)
    .maybeSingle();
  if (error) throw new GoogleCalendarError(error.message);
  return data as GoogleCalendarSyncChannel | null;
}

export async function hasPendingGoogleCalendarChanges(userId: string, calendarId: string) {
  const { data, error } = await createAdminClient()
    .from("google_calendar_sync_channels")
    .select("resource_type, calendar_id, change_pending")
    .eq("user_id", userId)
    .eq("change_pending", true);
  if (error) throw new GoogleCalendarError(error.message);
  return (data ?? []).some(
    (channel) =>
      channel.resource_type === "calendar_list" || channel.calendar_id === calendarId,
  );
}

export async function saveEventSyncToken({
  channel,
  syncToken,
  syncStartedAt,
}: {
  channel: GoogleCalendarSyncChannel;
  syncToken: string;
  syncStartedAt: string;
}) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("google_calendar_sync_channels")
    .update({ sync_token: syncToken, last_synced_at: new Date().toISOString() })
    .eq("id", channel.id);
  if (error) throw new GoogleCalendarError(error.message);

  const { error: pendingError } = await admin
    .from("google_calendar_sync_channels")
    .update({ change_pending: false })
    .eq("id", channel.id)
    .or(`last_notification_at.is.null,last_notification_at.lte.${syncStartedAt}`);
  if (pendingError) throw new GoogleCalendarError(pendingError.message);

  const { error: listError } = await admin
    .from("google_calendar_sync_channels")
    .update({ change_pending: false, last_synced_at: new Date().toISOString() })
    .eq("user_id", channel.user_id)
    .eq("resource_type", "calendar_list")
    .or(`last_notification_at.is.null,last_notification_at.lte.${syncStartedAt}`);
  if (listError) throw new GoogleCalendarError(listError.message);
}

export async function findGoogleCalendarChannel(channelId: string) {
  const { data, error } = await createAdminClient()
    .from("google_calendar_sync_channels")
    .select("*")
    .eq("channel_id", channelId)
    .maybeSingle();
  if (error) throw new GoogleCalendarError(error.message);
  return data as GoogleCalendarSyncChannel | null;
}

export function validGoogleCalendarChannelToken(
  channel: GoogleCalendarSyncChannel,
  token: string,
) {
  const received = Buffer.from(tokenHash(token), "hex");
  const expected = Buffer.from(channel.channel_token_hash, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function stopGoogleCalendarWatches(userId: string) {
  const { data } = await createAdminClient()
    .from("google_calendar_sync_channels")
    .select("*")
    .eq("user_id", userId);
  await Promise.allSettled(
    ((data ?? []) as GoogleCalendarSyncChannel[]).map((channel) =>
      stopChannel(userId, channel),
    ),
  );
}
