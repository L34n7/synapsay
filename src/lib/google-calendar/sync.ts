import { randomUUID } from "node:crypto";
import {
  GoogleCalendarError,
  googleCalendarFetch,
  getGoogleCalendarIntegration,
  type GoogleCalendarIntegration,
} from "@/lib/google-calendar/client";
import {
  ensureGoogleCalendarWatches,
  eventSyncState,
  hasPendingGoogleCalendarChanges,
  saveEventSyncToken,
} from "@/lib/google-calendar/subscriptions";
import { createAdminClient } from "@/lib/supabase/admin";

type GoogleCalendarEntry = {
  id: string;
  summary?: string;
  description?: string;
  primary?: boolean;
  accessRole?: string;
  timeZone?: string;
  backgroundColor?: string;
  selected?: boolean;
};

type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  etag?: string;
  updated?: string;
  eventType?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  reminders?: {
    useDefault?: boolean;
    overrides?: Array<{ method?: string; minutes?: number }>;
  };
  extendedProperties?: { private?: Record<string, string> };
};

type TaskForGoogle = {
  id: string;
  user_id: string;
  title: string;
  description: string;
  status: string;
  scheduled_at: string | null;
  due_at: string | null;
  all_day: boolean;
  timezone: string;
  recurrence_rule: string | null;
  updated_at: string;
  reminders?: Array<{ remind_at: string; status: string }>;
};

type EventLink = {
  id: string;
  user_id: string;
  task_id: string;
  calendar_id: string;
  google_event_id: string;
  google_event_etag: string | null;
  google_event_updated_at: string | null;
  google_html_link: string | null;
  last_synced_at: string | null;
};

const TASK_SELECT =
  "id, user_id, title, description, status, scheduled_at, due_at, all_day, timezone, recurrence_rule, updated_at, reminders(remind_at, status)";
const SYNC_LOCK_TTL_MS = 135_000;
const SYNC_WORK_BUDGET_MS = 80_000;
const EXPORT_BATCH_SIZE = 4;
const MAX_EXPORTS_PER_RUN = 80;

type SyncGoogleCalendarOptions = {
  force?: boolean;
  minIntervalMs?: number;
};

function encodePath(value: string) {
  return encodeURIComponent(value);
}

function dateKey(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function offsetForDate(date: string, timeZone: string) {
  const value = new Date(`${date}T12:00:00Z`);
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(value)
    .find((item) => item.type === "timeZoneName")?.value;
  const match = part?.match(/GMT([+-]\d{2}:\d{2})/);
  return match?.[1] ?? "Z";
}

function allDayStart(date: string, timeZone: string) {
  return new Date(`${date}T00:00:00${offsetForDate(date, timeZone)}`).toISOString();
}

function eventDates(event: GoogleEvent, fallbackTimeZone: string) {
  const timeZone = event.start?.timeZone ?? event.end?.timeZone ?? fallbackTimeZone;
  if (event.start?.date) {
    const scheduledAt = allDayStart(event.start.date, timeZone);
    const exclusiveEnd = event.end?.date
      ? allDayStart(event.end.date, timeZone)
      : allDayStart(addDays(event.start.date, 1), timeZone);
    const dueAt =
      new Date(exclusiveEnd).getTime() - 1_000 > new Date(scheduledAt).getTime()
        ? new Date(new Date(exclusiveEnd).getTime() - 1_000).toISOString()
        : null;
    return { scheduledAt, dueAt, allDay: true, timeZone };
  }
  const scheduledAt = event.start?.dateTime
    ? new Date(event.start.dateTime).toISOString()
    : null;
  const dueAt = event.end?.dateTime ? new Date(event.end.dateTime).toISOString() : null;
  return {
    scheduledAt,
    dueAt: dueAt && scheduledAt && dueAt >= scheduledAt ? dueAt : null,
    allDay: false,
    timeZone,
  };
}

function googleReminder(task: TaskForGoogle, start: string) {
  const reminder = (task.reminders ?? []).find((item) => item.status === "scheduled");
  if (!reminder) return undefined;
  const minutes = Math.round(
    (new Date(start).getTime() - new Date(reminder.remind_at).getTime()) / 60_000,
  );
  if (minutes < 0 || minutes > 40_320) return undefined;
  return { useDefault: false, overrides: [{ method: "popup", minutes }] };
}

function taskAsGoogleEvent(task: TaskForGoogle) {
  const start = task.scheduled_at ?? task.due_at;
  if (!start) return null;
  const timeZone = task.timezone || "America/Sao_Paulo";
  const common = {
    summary: task.title,
    description: task.description || undefined,
    extendedProperties: { private: { synapsayTaskId: task.id } },
    reminders: googleReminder(task, start),
    recurrence: task.recurrence_rule ? [task.recurrence_rule] : undefined,
  };
  if (task.all_day) {
    const startDate = dateKey(start, timeZone);
    const dueDate = task.due_at ? dateKey(task.due_at, timeZone) : startDate;
    return {
      ...common,
      start: { date: startDate },
      end: { date: addDays(dueDate < startDate ? startDate : dueDate, 1) },
    };
  }
  const endCandidate = task.due_at ? new Date(task.due_at).getTime() : 0;
  const startTime = new Date(start).getTime();
  const end = new Date(endCandidate > startTime ? endCandidate : startTime + 3_600_000);
  return {
    ...common,
    start: { dateTime: new Date(start).toISOString(), timeZone },
    end: { dateTime: end.toISOString(), timeZone },
  };
}

async function saveEventLink({
  userId,
  taskId,
  calendarId,
  event,
}: {
  userId: string;
  taskId: string;
  calendarId: string;
  event: GoogleEvent;
}) {
  const { error } = await createAdminClient().from("google_calendar_event_links").upsert(
    {
      user_id: userId,
      task_id: taskId,
      calendar_id: calendarId,
      google_event_id: event.id,
      google_event_etag: event.etag ?? null,
      google_event_updated_at: event.updated ?? null,
      google_html_link: event.htmlLink ?? null,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "user_id,calendar_id,google_event_id" },
  );
  if (error) throw new GoogleCalendarError(error.message);
}

async function markCancelledLinkSynced(link: EventLink, event: GoogleEvent) {
  const { error } = await createAdminClient()
    .from("google_calendar_event_links")
    .update({
      google_event_etag: event.etag ?? link.google_event_etag,
      google_event_updated_at: event.updated ?? link.google_event_updated_at,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", link.id);
  if (error) throw new GoogleCalendarError(error.message);
}

export async function listGoogleCalendars(userId: string) {
  const calendars: GoogleCalendarEntry[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ maxResults: "250", showHidden: "false" });
    if (pageToken) params.set("pageToken", pageToken);
    const payload = await googleCalendarFetch<{
      items?: GoogleCalendarEntry[];
      nextPageToken?: string;
    }>({ userId, path: `/users/me/calendarList?${params}` });
    calendars.push(...(payload.items ?? []));
    pageToken = payload.nextPageToken ?? "";
  } while (pageToken && calendars.length < 1_000);

  return calendars
    .filter((calendar) => ["owner", "writer"].includes(calendar.accessRole ?? ""))
    .map((calendar) => ({
      id: calendar.id,
      name: calendar.summary ?? calendar.id,
      primary: calendar.primary === true,
      timezone: calendar.timeZone ?? "America/Sao_Paulo",
      color: calendar.backgroundColor ?? null,
    }))
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
}

async function deleteGoogleEventLink(userId: string, link: EventLink) {
  try {
    await googleCalendarFetch<null>({
      userId,
      path: `/calendars/${encodePath(link.calendar_id)}/events/${encodePath(link.google_event_id)}?sendUpdates=none`,
      method: "DELETE",
    });
  } catch (reason) {
    if (!(reason instanceof GoogleCalendarError) || reason.status !== 404) throw reason;
  }
  const { error } = await createAdminClient()
    .from("google_calendar_event_links")
    .delete()
    .eq("id", link.id);
  if (error) throw new GoogleCalendarError(error.message);
}

async function syncTaskWithContext({
  userId,
  integration,
  task,
  link,
}: {
  userId: string;
  integration: GoogleCalendarIntegration;
  task: TaskForGoogle;
  link: EventLink | null;
}) {
  if (task.status === "cancelled") {
    if (link) await deleteGoogleEventLink(userId, link);
    return { deleted: Boolean(link) };
  }
  if (task.status === "completed") return { skipped: true };
  const body = taskAsGoogleEvent(task);
  if (!body) return { skipped: true };

  let event: GoogleEvent;
  if (link) {
    try {
      event = await googleCalendarFetch<GoogleEvent>({
        userId,
        path: `/calendars/${encodePath(link.calendar_id)}/events/${encodePath(link.google_event_id)}?sendUpdates=none`,
        method: "PATCH",
        body,
      });
    } catch (reason) {
      if (!(reason instanceof GoogleCalendarError) || reason.status !== 404) throw reason;
      await createAdminClient().from("google_calendar_event_links").delete().eq("id", link.id);
      event = await googleCalendarFetch<GoogleEvent>({
        userId,
        path: `/calendars/${encodePath(integration.selected_calendar_id)}/events?sendUpdates=none`,
        method: "POST",
        body,
      });
    }
  } else {
    event = await googleCalendarFetch<GoogleEvent>({
      userId,
      path: `/calendars/${encodePath(integration.selected_calendar_id)}/events?sendUpdates=none`,
      method: "POST",
      body,
    });
  }
  await saveEventLink({
    userId,
    taskId: task.id,
    calendarId: link?.calendar_id ?? integration.selected_calendar_id,
    event,
  });
  return { eventId: event.id, htmlLink: event.htmlLink ?? null };
}

export async function syncTaskToGoogle(userId: string, taskId: string, force = false) {
  const integration = await getGoogleCalendarIntegration(userId);
  if (!integration) return { skipped: true };
  if (
    (!integration.sync_enabled && !force) ||
    integration.sync_direction === "google_to_synapsay"
  ) {
    return { skipped: true };
  }

  const admin = createAdminClient();
  const [{ data: task, error: taskError }, { data: existingLink, error: linkError }] =
    await Promise.all([
      admin.from("tasks").select(TASK_SELECT).eq("id", taskId).eq("user_id", userId).maybeSingle(),
      admin
        .from("google_calendar_event_links")
        .select("*")
        .eq("task_id", taskId)
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
  if (taskError) throw new GoogleCalendarError(taskError.message);
  if (linkError) throw new GoogleCalendarError(linkError.message);
  if (!task) return { skipped: true };
  return syncTaskWithContext({
    userId,
    integration,
    task: task as TaskForGoogle,
    link: (existingLink as EventLink | null) ?? null,
  });
}

export async function deleteTaskFromGoogle(userId: string, taskId: string) {
  const integration = await getGoogleCalendarIntegration(userId);
  if (!integration?.sync_enabled || integration.sync_direction === "google_to_synapsay") return;
  const { data, error } = await createAdminClient()
    .from("google_calendar_event_links")
    .select("*")
    .eq("task_id", taskId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new GoogleCalendarError(error.message);
  if (data) await deleteGoogleEventLink(userId, data as EventLink);
}

async function listChangedEvents({
  userId,
  calendarId,
  syncToken,
  lastSyncAt,
}: {
  userId: string;
  calendarId: string;
  syncToken: string | null;
  lastSyncAt: string | null;
}) {
  const events: GoogleEvent[] = [];
  let pageToken = "";
  let nextSyncToken = "";
  do {
    const params = new URLSearchParams({
      maxResults: "500",
      singleEvents: "true",
      showDeleted: "true",
    });
    if (syncToken) {
      params.set("syncToken", syncToken);
    } else {
      params.set("timeMin", new Date(Date.now() - 24 * 60 * 60_000).toISOString());
      params.set("timeMax", new Date(Date.now() + 366 * 24 * 60 * 60_000).toISOString());
      params.set("orderBy", "startTime");
    }
    if (!syncToken && lastSyncAt) {
      params.set(
        "updatedMin",
        new Date(new Date(lastSyncAt).getTime() - 5 * 60_000).toISOString(),
      );
    }
    if (pageToken) params.set("pageToken", pageToken);
    const payload = await googleCalendarFetch<{
      items?: GoogleEvent[];
      nextPageToken?: string;
      nextSyncToken?: string;
    }>({ userId, path: `/calendars/${encodePath(calendarId)}/events?${params}` });
    events.push(...(payload.items ?? []));
    pageToken = payload.nextPageToken ?? "";
    nextSyncToken = payload.nextSyncToken ?? nextSyncToken;
    if (pageToken && events.length >= 10_000) {
      throw new GoogleCalendarError(
        "A agenda possui alterações demais para uma única sincronização.",
        413,
        "google_sync_too_large",
      );
    }
  } while (pageToken);
  return { events, nextSyncToken };
}

async function importGoogleEvents({
  userId,
  calendarId,
  calendarTimezone,
  lastSyncAt,
  syncStartedAt,
  deadline,
}: {
  userId: string;
  calendarId: string;
  calendarTimezone: string;
  lastSyncAt: string | null;
  syncStartedAt: string;
  deadline: number;
}) {
  const admin = createAdminClient();
  const channel = await eventSyncState(userId, calendarId);
  let changes: Awaited<ReturnType<typeof listChangedEvents>>;
  try {
    changes = await listChangedEvents({
      userId,
      calendarId,
      syncToken: channel?.sync_token ?? null,
      lastSyncAt: channel ? null : lastSyncAt,
    });
  } catch (reason) {
    if (!(reason instanceof GoogleCalendarError) || reason.status !== 410 || !channel?.sync_token) {
      throw reason;
    }
    changes = await listChangedEvents({ userId, calendarId, syncToken: null, lastSyncAt: null });
  }

  const events = changes.events;
  const { data: linksData, error: linksError } = await admin
    .from("google_calendar_event_links")
    .select("*")
    .eq("user_id", userId)
    .eq("calendar_id", calendarId);
  if (linksError) throw new GoogleCalendarError(linksError.message);
  const linkByEvent = new Map(
    ((linksData ?? []) as EventLink[]).map((link) => [link.google_event_id, link]),
  );

  let imported = 0;
  let updated = 0;
  let cancelled = 0;
  let unchanged = 0;
  let processed = 0;

  for (const event of events) {
    if (Date.now() >= deadline) break;
    const link = linkByEvent.get(event.id);
    const alreadySynced = Boolean(
      link &&
        ((event.etag && link.google_event_etag === event.etag) ||
          (event.updated && link.google_event_updated_at === event.updated)),
    );
    if (alreadySynced) {
      unchanged += 1;
      processed += 1;
      continue;
    }

    if (event.status === "cancelled") {
      if (link) {
        const { error: taskError } = await admin
          .from("tasks")
          .update({ status: "cancelled", completed_at: null })
          .eq("id", link.task_id)
          .eq("user_id", userId);
        if (taskError) throw new GoogleCalendarError(taskError.message);
        const { error: reminderError } = await admin
          .from("reminders")
          .update({ status: "cancelled" })
          .eq("task_id", link.task_id)
          .eq("status", "scheduled");
        if (reminderError) throw new GoogleCalendarError(reminderError.message);
        await markCancelledLinkSynced(link, event);
        cancelled += 1;
      }
      processed += 1;
      continue;
    }
    if (["birthday", "workingLocation"].includes(event.eventType ?? "")) {
      processed += 1;
      continue;
    }

    const dates = eventDates(event, calendarTimezone);
    if (!dates.scheduledAt) {
      processed += 1;
      continue;
    }
    const title = (event.summary?.trim() || "Evento sem título").slice(0, 160);
    const description = [event.description?.trim(), event.location ? `Local: ${event.location}` : ""]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 4000);

    let taskId = link?.task_id ?? event.extendedProperties?.private?.synapsayTaskId;
    if (taskId && !link) {
      const { data: ownedTask, error: ownedTaskError } = await admin
        .from("tasks")
        .select("id")
        .eq("id", taskId)
        .eq("user_id", userId)
        .maybeSingle();
      if (ownedTaskError) throw new GoogleCalendarError(ownedTaskError.message);
      if (!ownedTask) taskId = undefined;
    }

    if (taskId) {
      const { error } = await admin
        .from("tasks")
        .update({
          title,
          description,
          scheduled_at: dates.scheduledAt,
          due_at: dates.dueAt,
          all_day: dates.allDay,
          timezone: dates.timeZone,
        })
        .eq("id", taskId)
        .eq("user_id", userId);
      if (error) throw new GoogleCalendarError(error.message);
      updated += 1;
    } else {
      const { data: created, error } = await admin
        .from("tasks")
        .insert({
          user_id: userId,
          title,
          description,
          scheduled_at: dates.scheduledAt,
          due_at: dates.dueAt,
          all_day: dates.allDay,
          timezone: dates.timeZone,
          created_by: "integration",
        })
        .select("id")
        .single();
      if (error || !created) {
        throw new GoogleCalendarError(error?.message ?? "Falha ao importar evento.");
      }
      taskId = created.id;
      imported += 1;
    }

    const override = event.reminders?.overrides
      ?.filter((item) => item.method === "popup" && Number.isFinite(item.minutes))
      .sort((a, b) => (a.minutes ?? 0) - (b.minutes ?? 0))[0];
    if (taskId && override?.minutes !== undefined) {
      const remindAt = new Date(
        new Date(dates.scheduledAt).getTime() - override.minutes * 60_000,
      ).toISOString();
      const { error: reminderError } = await admin.from("reminders").upsert(
        { task_id: taskId, user_id: userId, remind_at: remindAt, channel: "browser" },
        { onConflict: "task_id,remind_at,channel", ignoreDuplicates: true },
      );
      if (reminderError) throw new GoogleCalendarError(reminderError.message);
    }
    await saveEventLink({ userId, taskId: taskId!, calendarId, event });
    processed += 1;
  }

  const complete = processed >= events.length;
  if (complete && channel && changes.nextSyncToken) {
    await saveEventSyncToken({ channel, syncToken: changes.nextSyncToken, syncStartedAt });
  }
  return {
    received: events.length,
    imported,
    updated,
    cancelled,
    unchanged,
    complete,
    pending: Math.max(0, events.length - processed),
  };
}

function taskNeedsExport(task: TaskForGoogle, link: EventLink | undefined) {
  if (!link) return true;
  if (!link.last_synced_at) return true;
  return new Date(task.updated_at).getTime() > new Date(link.last_synced_at).getTime() + 1_000;
}

async function exportSynapsayTasks({
  userId,
  integration,
  lastSyncAt,
  deadline,
}: {
  userId: string;
  integration: GoogleCalendarIntegration;
  lastSyncAt: string | null;
  deadline: number;
}) {
  const admin = createAdminClient();
  let query = admin
    .from("tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .in("status", ["pending", "in_progress", "cancelled"])
    .or("scheduled_at.not.is.null,due_at.not.is.null")
    .order("updated_at", { ascending: true })
    .limit(500);
  if (lastSyncAt) query = query.gte("updated_at", lastSyncAt);
  const { data, error } = await query;
  if (error) throw new GoogleCalendarError(error.message);
  const tasks = (data ?? []) as TaskForGoogle[];
  if (!tasks.length) return { exported: 0, unchanged: 0, pending: 0, complete: true };

  const { data: linksData, error: linksError } = await admin
    .from("google_calendar_event_links")
    .select("*")
    .eq("user_id", userId)
    .in("task_id", tasks.map((task) => task.id));
  if (linksError) throw new GoogleCalendarError(linksError.message);
  const links = new Map(((linksData ?? []) as EventLink[]).map((link) => [link.task_id, link]));
  const changed = tasks.filter((task) => taskNeedsExport(task, links.get(task.id)));
  const unchanged = tasks.length - changed.length;
  const queue = changed.slice(0, MAX_EXPORTS_PER_RUN);
  let exported = 0;
  let processed = 0;

  for (let index = 0; index < queue.length; index += EXPORT_BATCH_SIZE) {
    if (Date.now() >= deadline) break;
    const batch = queue.slice(index, index + EXPORT_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((task) =>
        syncTaskWithContext({
          userId,
          integration,
          task,
          link: links.get(task.id) ?? null,
        }),
      ),
    );
    for (const result of results) {
      processed += 1;
      if (result.status === "rejected") throw result.reason;
      if (!("skipped" in result.value) || !result.value.skipped) exported += 1;
    }
  }

  const pending = Math.max(0, changed.length - processed);
  return { exported, unchanged, pending, complete: pending === 0 };
}

function normalizeSyncOptions(options: boolean | SyncGoogleCalendarOptions = {}) {
  return typeof options === "boolean" ? { force: options } : options;
}

function isFresh(lastSyncAt: string | null, minIntervalMs = 0) {
  return Boolean(
    lastSyncAt &&
      minIntervalMs > 0 &&
      Date.now() - new Date(lastSyncAt).getTime() < minIntervalMs,
  );
}

function recentFailureCooldown(integration: GoogleCalendarIntegration, minIntervalMs = 0) {
  return Boolean(
    integration.last_sync_error &&
      minIntervalMs > 0 &&
      Date.now() - new Date(integration.updated_at).getTime() < minIntervalMs,
  );
}

async function acquireSyncLock(integration: GoogleCalendarIntegration) {
  const admin = createAdminClient();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - SYNC_LOCK_TTL_MS).toISOString();
  const token = randomUUID();
  const { data, error } = await admin
    .from("google_calendar_integrations")
    .update({
      sync_started_at: now.toISOString(),
      sync_lock_token: token,
      last_sync_error: null,
    })
    .eq("user_id", integration.user_id)
    .or(`sync_started_at.is.null,sync_started_at.lt.${staleBefore}`)
    .select("*")
    .maybeSingle();
  if (error) throw new GoogleCalendarError(error.message);
  if (!data) {
    throw new GoogleCalendarError(
      "Uma sincronização do Google Agenda já está em andamento.",
      409,
      "google_sync_in_progress",
    );
  }
  return { integration: data as GoogleCalendarIntegration, token, startedAt: now.toISOString() };
}

async function releaseSyncLock({
  userId,
  token,
  lastSyncAt,
  errorMessage,
}: {
  userId: string;
  token: string;
  lastSyncAt?: string;
  errorMessage?: string;
}) {
  const update: Record<string, string | null> = {
    sync_started_at: null,
    sync_lock_token: null,
  };
  if (lastSyncAt) {
    update.last_sync_at = lastSyncAt;
    update.last_sync_error = null;
  } else if (errorMessage) {
    update.last_sync_error = errorMessage.slice(0, 1000);
  }
  const { error } = await createAdminClient()
    .from("google_calendar_integrations")
    .update(update)
    .eq("user_id", userId)
    .eq("sync_lock_token", token);
  if (error) throw new GoogleCalendarError(error.message);
}

export async function syncGoogleCalendarForUser(
  userId: string,
  options: boolean | SyncGoogleCalendarOptions = {},
) {
  const { force = false, minIntervalMs = 0 } = normalizeSyncOptions(options);
  const integration = await getGoogleCalendarIntegration(userId);
  if (!integration) {
    throw new GoogleCalendarError("Google Agenda não conectado.", 404, "google_not_connected");
  }
  if (!integration.sync_enabled && !force) return { skipped: true };
  const pendingChanges = await hasPendingGoogleCalendarChanges(
    userId,
    integration.selected_calendar_id,
  );
  if (!pendingChanges && isFresh(integration.last_sync_at, minIntervalMs)) {
    return { skipped: true, reason: "recent_sync", syncedAt: integration.last_sync_at };
  }
  if (!force && recentFailureCooldown(integration, minIntervalMs)) {
    return { skipped: true, reason: "recent_sync_error" };
  }

  const lock = await acquireSyncLock(integration);
  const pendingAfterLock = await hasPendingGoogleCalendarChanges(
    userId,
    lock.integration.selected_calendar_id,
  );
  if (!pendingAfterLock && isFresh(lock.integration.last_sync_at, minIntervalMs)) {
    await releaseSyncLock({ userId, token: lock.token });
    return { skipped: true, reason: "recent_sync", syncedAt: lock.integration.last_sync_at };
  }

  const deadline = Date.now() + SYNC_WORK_BUDGET_MS;
  try {
    await ensureGoogleCalendarWatches(userId, lock.integration).catch((reason) => {
      console.warn("Notificações do Google Agenda não configuradas:", reason);
    });

    const exportResult =
      lock.integration.sync_direction === "google_to_synapsay"
        ? { exported: 0, unchanged: 0, pending: 0, complete: true }
        : await exportSynapsayTasks({
            userId,
            integration: lock.integration,
            lastSyncAt: lock.integration.last_sync_at,
            deadline,
          });

    const pull =
      lock.integration.sync_direction === "synapsay_to_google"
        ? {
            received: 0,
            imported: 0,
            updated: 0,
            cancelled: 0,
            unchanged: 0,
            pending: 0,
            complete: true,
          }
        : await importGoogleEvents({
            userId,
            calendarId: lock.integration.selected_calendar_id,
            calendarTimezone: lock.integration.selected_calendar_timezone,
            lastSyncAt: lock.integration.last_sync_at,
            syncStartedAt: lock.startedAt,
            deadline,
          });

    const complete = exportResult.complete && pull.complete;
    await releaseSyncLock({
      userId,
      token: lock.token,
      lastSyncAt: complete ? lock.startedAt : undefined,
    });
    return {
      ...pull,
      exported: exportResult.exported,
      unchanged: pull.unchanged + exportResult.unchanged,
      pending: pull.pending + exportResult.pending,
      partial: !complete,
      syncedAt: complete ? lock.startedAt : lock.integration.last_sync_at,
    };
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Falha ao sincronizar agendas.";
    await releaseSyncLock({ userId, token: lock.token, errorMessage: message }).catch((releaseError) => {
      console.error("Falha ao liberar bloqueio da sincronização do Google Agenda:", releaseError);
    });
    throw reason;
  }
}
