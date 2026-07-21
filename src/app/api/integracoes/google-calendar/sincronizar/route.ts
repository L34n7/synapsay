import { NextResponse } from "next/server";
import { authenticatedUserId, googleCalendarErrorResponse } from "@/lib/google-calendar/api";
import {
  getGoogleCalendarIntegration,
  GoogleCalendarError,
} from "@/lib/google-calendar/client";
import {
  syncGoogleCalendarForUser,
  syncTaskToGoogle,
} from "@/lib/google-calendar/sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

const LEGACY_LINK_BATCH_SIZE = 200;
const PREFLIGHT_BATCH_SIZE = 4;
const PREFLIGHT_LIMIT = 80;

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

type PreflightTask = {
  id: string;
  title: string;
  updated_at: string;
};

type PreflightLink = {
  id: string;
  task_id: string;
  google_event_id: string;
  last_synced_at: string | null;
};

function isInvalidStartTime(reason: unknown) {
  return (
    reason instanceof GoogleCalendarError &&
    /invalid start time/i.test(reason.message)
  );
}

async function isolateInvalidLinkedEvents(userId: string) {
  const integration = await getGoogleCalendarIntegration(userId);
  if (!integration || integration.sync_direction === "google_to_synapsay") {
    return [] as string[];
  }

  const admin = createAdminClient();
  let taskQuery = admin
    .from("tasks")
    .select("id, title, updated_at")
    .eq("user_id", userId)
    .in("status", ["pending", "in_progress", "cancelled"])
    .or("scheduled_at.not.is.null,due_at.not.is.null")
    .order("updated_at", { ascending: true })
    .limit(500);
  if (integration.last_sync_at) {
    taskQuery = taskQuery.gte("updated_at", integration.last_sync_at);
  }

  const { data: taskData, error: taskError } = await taskQuery;
  if (taskError) throw new GoogleCalendarError(taskError.message);
  const tasks = (taskData ?? []) as PreflightTask[];
  if (!tasks.length) return [] as string[];

  const { data: linkData, error: linkError } = await admin
    .from("google_calendar_event_links")
    .select("id, task_id, google_event_id, last_synced_at")
    .eq("user_id", userId)
    .in("task_id", tasks.map((task) => task.id));
  if (linkError) throw new GoogleCalendarError(linkError.message);

  const links = new Map(
    ((linkData ?? []) as PreflightLink[]).map((link) => [link.task_id, link]),
  );
  const candidates = tasks
    .filter((task) => {
      const link = links.get(task.id);
      if (!link) return false;
      if (!link.last_synced_at) return true;
      return (
        new Date(task.updated_at).getTime() >
        new Date(link.last_synced_at).getTime() + 1_000
      );
    })
    .slice(0, PREFLIGHT_LIMIT);

  const isolated: string[] = [];
  for (let index = 0; index < candidates.length; index += PREFLIGHT_BATCH_SIZE) {
    const batch = candidates.slice(index, index + PREFLIGHT_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((task) => syncTaskToGoogle(userId, task.id, true)),
    );

    for (let position = 0; position < results.length; position += 1) {
      const result = results[position];
      if (result.status === "fulfilled") continue;
      if (!isInvalidStartTime(result.reason)) throw result.reason;

      const task = batch[position];
      const link = links.get(task.id);
      if (!link) continue;

      const { error: quarantineError } = await admin
        .from("google_calendar_event_links")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", link.id)
        .eq("user_id", userId);
      if (quarantineError) {
        throw new GoogleCalendarError(quarantineError.message);
      }

      isolated.push(task.title || "Compromisso sem título");
      console.warn("Google Calendar: evento incompatível isolado", {
        taskId: task.id,
        eventId: link.google_event_id,
        title: task.title,
      });
    }
  }

  return isolated;
}

function invalidEventsWarning(titles: string[]) {
  if (!titles.length) return "";
  const visible = titles.slice(0, 3).map((title) => `“${title}”`).join(", ");
  const remaining = titles.length - Math.min(titles.length, 3);
  return [
    `${titles.length} compromisso${titles.length === 1 ? "" : "s"} não pôde${titles.length === 1 ? "" : "eram"} ter o horário atualizado no Google Agenda: ${visible}${remaining > 0 ? ` e mais ${remaining}` : ""}.`,
    "Os demais compromissos foram sincronizados normalmente. Edite o horário desses itens na Synapsay ou no Google para tentar novamente.",
  ].join(" ");
}

export async function POST() {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  try {
    const recoveredLegacyLinks = await backfillLegacyEventLinks(userId);
    const isolatedInvalidEvents = await isolateInvalidLinkedEvents(userId);
    const result = await syncGoogleCalendarForUser(userId, true);
    const warning = invalidEventsWarning(isolatedInvalidEvents);

    if (warning) {
      const { error } = await createAdminClient()
        .from("google_calendar_integrations")
        .update({ last_sync_error: warning })
        .eq("user_id", userId);
      if (error) console.error("Falha ao registrar aviso da sincronização:", error);
    }

    return NextResponse.json({
      result: {
        ...result,
        recoveredLegacyLinks,
        isolatedInvalidEvents,
        warning: warning || undefined,
      },
    });
  } catch (reason) {
    return googleCalendarErrorResponse(reason);
  }
}
