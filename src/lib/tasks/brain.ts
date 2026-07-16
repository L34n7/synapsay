import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_MODELS } from "@/lib/ai/models";
import {
  formatTasksForModel,
  loadOpenTasks,
  localDayRange,
  taskForAssistant,
} from "@/lib/tasks/context";
import {
  normalizePriority,
  taskMoment,
  validDate,
  type TaskRecord,
} from "@/lib/tasks/types";

type RawAction = {
  action_type?: unknown;
  task_id?: unknown;
  title?: unknown;
  description?: unknown;
  priority?: unknown;
  scheduled_at?: unknown;
  due_at?: unknown;
  all_day?: unknown;
  reminder_at?: unknown;
};

type BrainDecision = {
  intent: "none" | "query" | "mutate";
  queryScope: "none" | "today" | "tomorrow" | "upcoming" | "overdue" | "all";
  needsClarification: boolean;
  clarificationQuestion: string;
  actions: RawAction[];
};

export type TaskBrainResult = {
  intent: BrainDecision["intent"];
  queryScope: BrainDecision["queryScope"];
  needsClarification: boolean;
  clarificationQuestion: string;
  applied: Array<{ action: string; taskId: string; title: string }>;
  appliedTasks: TaskRecord[];
  tasks: TaskRecord[];
  relatedTasks: TaskRecord[];
};

type ResponsesPayload = {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const taskDecisionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "intent",
    "query_scope",
    "needs_clarification",
    "clarification_question",
    "actions",
  ],
  properties: {
    intent: { type: "string", enum: ["none", "query", "mutate"] },
    query_scope: {
      type: "string",
      enum: ["none", "today", "tomorrow", "upcoming", "overdue", "all"],
    },
    needs_clarification: { type: "boolean" },
    clarification_question: { type: "string" },
    actions: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "action_type",
          "task_id",
          "title",
          "description",
          "priority",
          "scheduled_at",
          "due_at",
          "all_day",
          "reminder_at",
        ],
        properties: {
          action_type: {
            type: "string",
            enum: ["create", "update", "complete", "cancel"],
          },
          task_id: { type: ["string", "null"] },
          title: { type: "string" },
          description: { type: "string" },
          priority: { type: "integer", minimum: 1, maximum: 5 },
          scheduled_at: { type: ["string", "null"] },
          due_at: { type: ["string", "null"] },
          all_day: { type: "boolean" },
          reminder_at: { type: ["string", "null"] },
        },
      },
    },
  },
};

function outputText(payload: ResponsesPayload) {
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text)
    .join("");
}

function parseDecision(value: string): BrainDecision {
  const parsed = JSON.parse(value) as {
    intent?: unknown;
    query_scope?: unknown;
    needs_clarification?: unknown;
    clarification_question?: unknown;
    actions?: unknown;
  };
  const intent = ["query", "mutate"].includes(String(parsed.intent))
    ? (parsed.intent as BrainDecision["intent"])
    : "none";
  const queryScope = ["today", "tomorrow", "upcoming", "overdue", "all"].includes(
    String(parsed.query_scope),
  )
    ? (parsed.query_scope as BrainDecision["queryScope"])
    : "none";
  return {
    intent,
    queryScope,
    needsClarification: parsed.needs_clarification === true,
    clarificationQuestion:
      typeof parsed.clarification_question === "string"
        ? parsed.clarification_question.trim().slice(0, 240)
        : "",
    actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 8) : [],
  };
}

function tasksForScope(tasks: TaskRecord[], scope: BrainDecision["queryScope"]) {
  const today = localDayRange("America/Sao_Paulo", 0);
  const tomorrow = localDayRange("America/Sao_Paulo", 1);
  const now = Date.now();
  return tasks.filter((task) => {
    const moment = taskMoment(task);
    if (scope === "all" || scope === "none") return true;
    if (!moment) return scope === "upcoming";
    if (scope === "overdue") return new Date(moment).getTime() < now;
    if (scope === "today") return moment >= today.from && moment <= today.to;
    if (scope === "tomorrow") return moment >= tomorrow.from && moment <= tomorrow.to;
    return new Date(moment).getTime() >= now;
  });
}

async function insertReminder({
  supabase,
  userId,
  taskId,
  reminderAt,
}: {
  supabase: SupabaseClient;
  userId: string;
  taskId: string;
  reminderAt: string;
}) {
  await supabase.from("reminders").upsert(
    {
      task_id: taskId,
      user_id: userId,
      remind_at: reminderAt,
      channel: "browser",
      status: "scheduled",
      delivered_at: null,
      dismissed_at: null,
    },
    { onConflict: "task_id,remind_at,channel" },
  );
}

export async function analyzeAndApplyTaskMessage({
  supabase,
  userId,
  conversationId,
  sourceMessageId,
  currentMessage,
}: {
  supabase: SupabaseClient;
  userId: string;
  conversationId: string;
  sourceMessageId?: string | null;
  currentMessage: string;
}): Promise<TaskBrainResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada.");

  const [{ data: recent }, openTasks] = await Promise.all([
    supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(18),
    loadOpenTasks({ supabase, userId, limit: 100 }),
  ]);

  const transcript = (recent ?? [])
    .reverse()
    .map(
      (message) =>
        `${message.role === "user" ? "USUÁRIO" : "SYNAPSAY"}: ${String(message.content).slice(0, 1200)}`,
    )
    .join("\n")
    .slice(-18_000);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": createHash("sha256").update(userId).digest("hex"),
    },
    body: JSON.stringify({
      model: AI_MODELS.memoryBrain,
      store: false,
      max_output_tokens: 1200,
      instructions: [
        "Você é o cérebro de tarefas e lembretes da Synapsay. Analise a mensagem atual junto do contexto recente e das tarefas existentes.",
        "Use intent=query quando a pessoa perguntar o que tem para fazer, pedir a agenda ou consultar tarefas. Use intent=mutate para criar, alterar, concluir ou cancelar. Caso contrário use none.",
        "Crie tarefas apenas a partir de planos, compromissos, obrigações ou pedidos explicitamente declarados pelo USUÁRIO. Nunca transforme sugestões da SYNAPSAY, hipóteses ou exemplos em tarefa.",
        "Uma mensagem pode criar várias tarefas. Faça cada tarefa atômica, com título direto e descrição fiel, sem inventar nomes, horários ou locais.",
        "Ignore frases interrompidas, reticências e pensamentos que ficaram sem complemento. Nunca associe um horário dito em uma frase completa posterior a uma frase anterior incompleta. Só combine trechos quando o usuário completar explicitamente a mesma informação.",
        "Para hoje/amanhã sem horário exato, use uma data desse dia em scheduled_at, marque all_day=true e deixe reminder_at=null. Para expressões vagas como 'mais tarde', 'depois da igreja' ou 'daqui a pouco', nunca invente horário.",
        "Ao converter um horário falado pelo usuário para ISO 8601, interprete-o primeiro em America/Sao_Paulo e inclua o deslocamento local -03:00 no valor gerado.",
        "Só preencha reminder_at quando houver horário exato ou um deslocamento calculável. Se o usuário pedir para ser avisado mas não informar horário suficiente, registre a tarefa, defina needs_clarification=true e faça uma pergunta curta pedindo o horário.",
        "Ao alterar, concluir ou cancelar, use exclusivamente um task_id fornecido na lista de tarefas. Se houver ambiguidade, não aplique ação e peça esclarecimento.",
        "Não duplique uma tarefa existente com o mesmo significado; atualize-a quando a nova mensagem completar data, horário, descrição ou lembrete.",
        `AGORA: ${new Date().toISOString()}. FUSO: America/Sao_Paulo.`,
      ].join(" "),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `MENSAGEM ATUAL: ${currentMessage}`,
                `CONTEXTO RECENTE:\n${transcript || "Sem contexto."}`,
                `TAREFAS ATIVAS:\n${formatTasksForModel(openTasks)}`,
              ].join("\n\n"),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "synapsay_task_decision",
          strict: true,
          schema: taskDecisionSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message ?? "Falha ao analisar tarefas.");
  }
  const text = outputText((await response.json()) as ResponsesPayload);
  const decision = text ? parseDecision(text) : parseDecision("{}");
  const existingById = new Map(openTasks.map((task) => [task.id, task]));
  const applied: TaskBrainResult["applied"] = [];

  for (const [index, action] of decision.actions.entries()) {
    const actionType = String(action.action_type);
    if (!["create", "update", "complete", "cancel"].includes(actionType)) continue;

    if (actionType === "create") {
      const title = typeof action.title === "string" ? action.title.trim().slice(0, 160) : "";
      if (title.length < 2) continue;

      let existing: { id: string; title: string } | null = null;
      if (sourceMessageId && UUID_PATTERN.test(sourceMessageId)) {
        const result = await supabase
          .from("tasks")
          .select("id, title")
          .eq("user_id", userId)
          .eq("source_message_id", sourceMessageId)
          .eq("source_action_index", index)
          .maybeSingle();
        existing = result.data;
      }

      let taskId = existing?.id;
      if (!taskId) {
        const scheduledAt = validDate(action.scheduled_at);
        const dueAt = validDate(action.due_at);
        const { data: inserted, error } = await supabase
          .from("tasks")
          .insert({
            user_id: userId,
            conversation_id: conversationId,
            source_message_id:
              sourceMessageId && UUID_PATTERN.test(sourceMessageId) ? sourceMessageId : null,
            source_action_index:
              sourceMessageId && UUID_PATTERN.test(sourceMessageId) ? index : null,
            title,
            description:
              typeof action.description === "string"
                ? action.description.trim().slice(0, 4000)
                : "",
            priority: normalizePriority(action.priority),
            scheduled_at: scheduledAt,
            due_at: dueAt && (!scheduledAt || dueAt >= scheduledAt) ? dueAt : null,
            all_day: action.all_day === true,
            timezone: "America/Sao_Paulo",
            created_by: "assistant",
          })
          .select("id, title")
          .single();
        if (error || !inserted) continue;
        taskId = inserted.id;
      }

      if (!taskId) continue;

      const reminderAt = validDate(action.reminder_at);
      if (reminderAt && new Date(reminderAt).getTime() >= Date.now() - 60_000) {
        await insertReminder({ supabase, userId, taskId, reminderAt });
      }
      applied.push({ action: "created", taskId, title: existing?.title ?? title });
      continue;
    }

    const taskId = typeof action.task_id === "string" ? action.task_id : "";
    const current = existingById.get(taskId);
    if (!current) continue;

    if (actionType === "complete" || actionType === "cancel") {
      const status = actionType === "complete" ? "completed" : "cancelled";
      const { error } = await supabase
        .from("tasks")
        .update({
          status,
          completed_at: status === "completed" ? new Date().toISOString() : null,
        })
        .eq("id", taskId)
        .eq("user_id", userId);
      if (error) continue;
      await supabase
        .from("reminders")
        .update({ status: "cancelled" })
        .eq("task_id", taskId)
        .eq("user_id", userId)
        .eq("status", "scheduled");
      applied.push({ action: status, taskId, title: current.title });
      continue;
    }

    const scheduledAt = validDate(action.scheduled_at);
    const dueAt = validDate(action.due_at);
    const title =
      typeof action.title === "string" && action.title.trim().length >= 2
        ? action.title.trim().slice(0, 160)
        : current.title;
    const { error } = await supabase
      .from("tasks")
      .update({
        title,
        description:
          typeof action.description === "string"
            ? action.description.trim().slice(0, 4000)
            : current.description,
        priority: normalizePriority(action.priority),
        scheduled_at: scheduledAt,
        due_at: dueAt && (!scheduledAt || dueAt >= scheduledAt) ? dueAt : null,
        all_day: action.all_day === true,
      })
      .eq("id", taskId)
      .eq("user_id", userId);
    if (error) continue;
    const reminderAt = validDate(action.reminder_at);
    if (reminderAt && new Date(reminderAt).getTime() >= Date.now() - 60_000) {
      await insertReminder({ supabase, userId, taskId, reminderAt });
    }
    applied.push({ action: "updated", taskId, title });
  }

  const refreshed = await loadOpenTasks({ supabase, userId, limit: 100 });
  const appliedIds = new Set(applied.map((item) => item.taskId));
  const scopedTasks = tasksForScope(refreshed, decision.queryScope);
  const relatedTasks =
    !scopedTasks.length && ["today", "tomorrow"].includes(decision.queryScope)
      ? tasksForScope(refreshed, "upcoming").slice(0, 5)
      : [];
  return {
    intent: decision.intent,
    queryScope: decision.queryScope,
    needsClarification: decision.needsClarification,
    clarificationQuestion: decision.clarificationQuestion,
    applied,
    appliedTasks: refreshed.filter((task) => appliedIds.has(task.id)),
    tasks: scopedTasks,
    relatedTasks,
  };
}

export function formatTaskBrainToolResult(result: TaskBrainResult) {
  const appliedById = new Map(result.appliedTasks.map((task) => [task.id, task]));
  const agenda = result.intent === "mutate" ? result.appliedTasks : result.tasks;
  return {
    success: true,
    intent: result.intent,
    needsClarification: result.needsClarification,
    clarificationQuestion: result.clarificationQuestion,
    operations: result.applied.map((item) => ({
      action: item.action,
      taskId: item.taskId,
      title: item.title,
      task: appliedById.has(item.taskId)
        ? taskForAssistant(appliedById.get(item.taskId)!)
        : null,
    })),
    agenda: agenda.map(taskForAssistant),
    relatedAgenda:
      result.intent === "query" ? result.relatedTasks.map(taskForAssistant) : [],
    responseRules: [
      "Todos os horários já estão convertidos para o fuso indicado em timeZone.",
      "Repita scheduledLocal, dueLocal e remindAtLocal exatamente como recebidos; não recalcule nem converta o horário.",
      "Confirme um lembrete somente quando ele aparecer em task.reminders.",
      "Não mencione o status pending, a menos que o usuário pergunte pelo status.",
    ],
  };
}

export function formatTaskBrainResult(result: TaskBrainResult) {
  return [
    "<resultado_agenda>",
    `Intenção: ${result.intent}.`,
    result.applied.length
      ? `Operações confirmadas: ${result.applied
          .map((item) => `${item.action}: ${item.title} (ID ${item.taskId})`)
          .join("; ")}.`
      : "Nenhuma alteração foi confirmada.",
    result.needsClarification
      ? `Pergunta necessária: ${result.clarificationQuestion || "Pergunte o horário exato do lembrete."}`
      : "",
    `Agenda relevante:\n${formatTasksForModel(result.tasks)}`,
    result.relatedTasks.length
      ? `Não há tarefa no período solicitado, mas existem tarefas próximas. Deixe claro que são de outra data e ofereça antecipá-las ou reorganizá-las:\n${formatTasksForModel(result.relatedTasks)}`
      : "",
    "Só diga que registrou, alterou, concluiu ou agendou um lembrete se a operação constar como confirmada acima. Memória e lembrete são diferentes: nunca diga que é incapaz de lembrar; quando faltar horário, explique que a tarefa foi registrada e pergunte quando deve avisar.",
    "</resultado_agenda>",
  ]
    .filter(Boolean)
    .join("\n");
}
