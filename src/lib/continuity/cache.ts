import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_MODELS } from "@/lib/ai/models";
import { formatTasksForModel, loadOpenTasks } from "@/lib/tasks/context";
import { taskMoment, type TaskRecord } from "@/lib/tasks/types";

const DEFAULT_TIME_ZONE = "America/Sao_Paulo";
const WEEK_MS = 7 * 24 * 60 * 60_000;
const MAX_TRANSCRIPT_MESSAGES = 80;

type MessageRow = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

export type AssistantContinuity = {
  id: string;
  user_id: string;
  last_conversation_id: string | null;
  last_message_id: string | null;
  last_interaction_at: string | null;
  weekly_summary: string;
  relationship_context: string;
  routine_digest: string;
  confirmed_routines: unknown;
  recent_topics: unknown;
  open_loops: unknown;
  recurring_candidates: unknown;
  greeting_hints: unknown;
  status: "ready" | "processing" | "failed";
  processed_until: string | null;
  last_error: string | null;
  updated_at: string;
};

type ResponsesPayload = {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
};

const continuitySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "weekly_summary",
    "relationship_context",
    "routine_digest",
    "confirmed_routines",
    "recent_topics",
    "open_loops",
    "recurring_candidates",
    "greeting_hints",
  ],
  properties: {
    weekly_summary: { type: "string" },
    relationship_context: { type: "string" },
    routine_digest: { type: "string" },
    confirmed_routines: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "evidence",
          "day_hint",
          "time_hint",
          "location",
          "kind",
          "confidence",
        ],
        properties: {
          name: { type: "string" },
          evidence: { type: "string" },
          day_hint: { type: "string" },
          time_hint: { type: "string" },
          location: { type: "string" },
          kind: { type: "string" },
          confidence: { type: "integer", minimum: 1, maximum: 5 },
        },
      },
    },
    recent_topics: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
    },
    open_loops: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "evidence", "suggested_question", "priority"],
        properties: {
          topic: { type: "string" },
          evidence: { type: "string" },
          suggested_question: { type: "string" },
          priority: { type: "integer", minimum: 1, maximum: 5 },
        },
      },
    },
    recurring_candidates: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "pattern",
          "evidence",
          "day_hint",
          "time_hint",
          "suggested_confirmation",
          "confidence",
          "confirmed",
        ],
        properties: {
          pattern: { type: "string" },
          evidence: { type: "string" },
          day_hint: { type: "string" },
          time_hint: { type: "string" },
          suggested_confirmation: { type: "string" },
          confidence: { type: "integer", minimum: 1, maximum: 5 },
          confirmed: { type: "boolean" },
        },
      },
    },
    greeting_hints: {
      type: "object",
      additionalProperties: false,
      required: [
        "morning",
        "afternoon",
        "evening",
        "night",
        "after_long_gap",
        "resume_open_loop",
      ],
      properties: {
        morning: { type: "string" },
        afternoon: { type: "string" },
        evening: { type: "string" },
        night: { type: "string" },
        after_long_gap: { type: "string" },
        resume_open_loop: { type: "string" },
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

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function jsonArray(value: unknown, maxItems: number) {
  return Array.isArray(value) ? value.slice(0, maxItems) : [];
}

function stringArray(value: unknown, maxItems: number) {
  return jsonArray(value, maxItems)
    .filter((item): item is string => typeof item === "string")
    .map((item) => cleanText(item, 160))
    .filter(Boolean);
}

function safeOpenLoops(value: unknown) {
  return jsonArray(value, 5)
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      topic: cleanText(item.topic, 160),
      evidence: cleanText(item.evidence, 260),
      suggested_question: cleanText(item.suggested_question, 220),
      priority: Math.min(5, Math.max(1, Math.round(Number(item.priority) || 3))),
    }))
    .filter((item) => item.topic && item.evidence);
}

function safeRecurringCandidates(value: unknown) {
  return jsonArray(value, 6)
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      pattern: cleanText(item.pattern, 180),
      evidence: cleanText(item.evidence, 260),
      day_hint: cleanText(item.day_hint, 80),
      time_hint: cleanText(item.time_hint, 80),
      suggested_confirmation: cleanText(item.suggested_confirmation, 220),
      confidence: Math.min(5, Math.max(1, Math.round(Number(item.confidence) || 2))),
      confirmed: item.confirmed === true,
    }))
    .filter((item) => item.pattern && item.evidence);
}

function safeConfirmedRoutines(value: unknown) {
  return jsonArray(value, 8)
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      name: cleanText(item.name, 180),
      evidence: cleanText(item.evidence, 260),
      day_hint: cleanText(item.day_hint, 120),
      time_hint: cleanText(item.time_hint, 120),
      location: cleanText(item.location, 160),
      kind: cleanText(item.kind, 80),
      confidence: Math.min(5, Math.max(1, Math.round(Number(item.confidence) || 3))),
    }))
    .filter((item) => item.name && item.evidence);
}

function safeGreetingHints(value: unknown) {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    morning: cleanText(source.morning, 220),
    afternoon: cleanText(source.afternoon, 220),
    evening: cleanText(source.evening, 220),
    night: cleanText(source.night, 220),
    after_long_gap: cleanText(source.after_long_gap, 220),
    resume_open_loop: cleanText(source.resume_open_loop, 220),
  };
}

function parseContinuity(value: string) {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  return {
    weekly_summary: cleanText(parsed.weekly_summary, 4000),
    relationship_context: cleanText(parsed.relationship_context, 2500),
    routine_digest: cleanText(parsed.routine_digest, 3000),
    confirmed_routines: safeConfirmedRoutines(parsed.confirmed_routines),
    recent_topics: stringArray(parsed.recent_topics, 8),
    open_loops: safeOpenLoops(parsed.open_loops),
    recurring_candidates: safeRecurringCandidates(parsed.recurring_candidates),
    greeting_hints: safeGreetingHints(parsed.greeting_hints),
  };
}

function localDateTime(value: string | Date, timeZone = DEFAULT_TIME_ZONE) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: validTimeZone(timeZone),
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function localHour(value: Date, timeZone = DEFAULT_TIME_ZONE) {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: validTimeZone(timeZone),
    hour: "2-digit",
    hourCycle: "h23",
  }).format(value);
  return Number(hour);
}

function localTimeParts(value: Date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: validTimeZone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  return {
    hour: Number(parts.find((part) => part.type === "hour")?.value ?? "0"),
    minute: Number(parts.find((part) => part.type === "minute")?.value ?? "0"),
  };
}

function localWeekday(value: Date, timeZone = DEFAULT_TIME_ZONE) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: validTimeZone(timeZone),
    weekday: "long",
  })
    .format(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function localDateKey(value: string | Date, timeZone = DEFAULT_TIME_ZONE) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: validTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function validTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone }).format();
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function dayPeriod(hour: number) {
  if (hour < 5) return "madrugada";
  if (hour < 12) return "manhã";
  if (hour < 18) return "tarde";
  if (hour < 22) return "noite";
  return "fim da noite";
}

function gapLabel(lastInteractionAt: string | null) {
  if (!lastInteractionAt) return "sem interação anterior registrada";
  const diffMs = Date.now() - new Date(lastInteractionAt).getTime();
  if (diffMs < 0) return "interação anterior registrada no futuro";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `${minutes} minuto(s) desde a última interação`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hora(s) desde a última interação`;
  return `${Math.round(hours / 24)} dia(s) desde a última interação`;
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function dayHintMatchesToday(dayHint: string, today: string) {
  const hint = normalizeText(dayHint);
  if (!hint || /todo dia|diario|diaria|todos os dias|sempre/.test(hint)) return true;
  if (hint.includes(today)) return true;
  if (today === "segunda-feira") return hint.includes("segunda");
  if (today === "terca-feira") return hint.includes("terca");
  if (today === "quarta-feira") return hint.includes("quarta");
  if (today === "quinta-feira") return hint.includes("quinta");
  if (today === "sexta-feira") return hint.includes("sexta");
  if (today === "sabado") return hint.includes("sabado");
  if (today === "domingo") return hint.includes("domingo");
  return false;
}

function parseTimeHint(value: string) {
  const normalized = normalizeText(value);
  const match = normalized.match(/(?:as\s*)?(\d{1,2})(?:\s*h\s*(\d{1,2})?|:(\d{1,2}))?/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? match[3] ?? "0");
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function minutesFromNowToday(target: { hour: number; minute: number }, now: Date, timeZone: string) {
  const current = localTimeParts(now, timeZone);
  return target.hour * 60 + target.minute - (current.hour * 60 + current.minute);
}

function triggerWindow(minutesFromNow: number) {
  if (minutesFromNow >= 0 && minutesFromNow <= 120) return "próxima";
  if (minutesFromNow < 0 && minutesFromNow >= -180) return "recente";
  return "";
}

function formatJson(value: unknown, limit = 6000) {
  return JSON.stringify(value ?? null, null, 2).slice(0, limit);
}

function formatMessages(messages: MessageRow[]) {
  return messages
    .map((message) => {
      const role =
        message.role === "user"
          ? "USUÁRIO"
          : message.role === "assistant"
            ? "SYNAPSAY"
            : "SISTEMA";
      return `[${localDateTime(message.created_at)}] ${role}: ${message.content.trim().slice(0, 900)}`;
    })
    .join("\n")
    .slice(-12_000);
}

export async function loadContinuityCache(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("assistant_continuity")
    .select(
      "id, user_id, last_conversation_id, last_message_id, last_interaction_at, weekly_summary, relationship_context, routine_digest, confirmed_routines, recent_topics, open_loops, recurring_candidates, greeting_hints, status, processed_until, last_error, updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as AssistantContinuity | null;
}

export function formatContinuityForVoice({
  continuity,
  displayName,
  timeZone = DEFAULT_TIME_ZONE,
}: {
  continuity: AssistantContinuity | null;
  displayName?: string | null;
  timeZone?: string;
}) {
  const safeTimeZone = validTimeZone(timeZone);
  if (!continuity || continuity.status === "failed") {
    return "Nenhum cache de continuidade confiável foi encontrado. Use memórias aprovadas, agenda e a conversa atual.";
  }

  const now = new Date();
  const hour = localHour(now, safeTimeZone);
  const period = dayPeriod(hour);
  const openLoops = safeOpenLoops(continuity.open_loops);
  const confirmedRoutines = safeConfirmedRoutines(continuity.confirmed_routines);
  const recurringCandidates = safeRecurringCandidates(continuity.recurring_candidates);
  const greetingHints = safeGreetingHints(continuity.greeting_hints);

  return [
    "Use este contexto de continuidade para a primeira interação e para preservar naturalidade ao longo da conversa.",
    `Nome do usuário, se for natural usar: ${displayName ? displayName.split(/\s+/)[0] : "não informado"}.`,
    `Agora no fuso ${safeTimeZone}: ${localDateTime(now, safeTimeZone)} (${period}).`,
    `Intervalo desde a última conversa: ${gapLabel(continuity.last_interaction_at)}.`,
    continuity.last_interaction_at
      ? `Última interação local: ${localDateTime(continuity.last_interaction_at, safeTimeZone)}.`
      : "",
    continuity.weekly_summary ? `Resumo dos últimos 7 dias: ${continuity.weekly_summary}` : "",
    continuity.relationship_context
      ? `Contexto pessoal/relacional explicitamente conhecido: ${continuity.relationship_context}`
      : "",
    continuity.routine_digest ? `Rotinas e padrões explicitamente conhecidos: ${continuity.routine_digest}` : "",
    confirmedRoutines.length
      ? `Rotinas confirmadas estruturadas:\n${formatJson(confirmedRoutines, 3500)}`
      : "",
    stringArray(continuity.recent_topics, 8).length
      ? `Tópicos recentes: ${stringArray(continuity.recent_topics, 8).join("; ")}.`
      : "",
    openLoops.length
      ? `Assuntos em aberto que podem ser retomados se fizer sentido:\n${formatJson(openLoops, 3500)}`
      : "",
    recurringCandidates.length
      ? `Padrões recorrentes ainda não necessariamente confirmados. Se um deles for relevante hoje, pergunte confirmação antes de tratar como rotina fixa:\n${formatJson(recurringCandidates, 3500)}`
      : "",
    `Dicas de abertura por contexto:\n${formatJson(greetingHints, 1800)}`,
    [
      "Regras de naturalidade:",
      "não recite o resumo;",
      "use no máximo uma referência pessoal concreta na abertura;",
      "não finja sentimentos intensos nem invente fatos;",
      "se houver assunto inacabado, ofereça continuar;",
      "se o usuário iniciar direto em outro assunto, acompanhe o novo assunto;",
      "se o usuário confirmar uma rotina ou hábito, trate a confirmação como informação útil para memória futura.",
    ].join(" "),
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildOpeningTriggers({
  continuity,
  tasks,
  timeZone = DEFAULT_TIME_ZONE,
}: {
  continuity: AssistantContinuity | null;
  tasks: TaskRecord[];
  timeZone?: string;
}) {
  const safeTimeZone = validTimeZone(timeZone);
  const now = new Date();
  const today = localWeekday(now, safeTimeZone);
  const triggers: string[] = [];

  if (continuity && continuity.status !== "failed") {
    for (const routine of safeConfirmedRoutines(continuity.confirmed_routines)) {
      if (!dayHintMatchesToday(routine.day_hint, today)) continue;
      const parsedTime = parseTimeHint(routine.time_hint);
      if (!parsedTime) continue;
      const minutes = minutesFromNowToday(parsedTime, now, safeTimeZone);
      const window = triggerWindow(minutes);
      if (!window) continue;
      const direction =
        window === "próxima"
          ? `começa em aproximadamente ${minutes} minuto(s)`
          : `aconteceu há aproximadamente ${Math.abs(minutes)} minuto(s)`;
      triggers.push(
        `Rotina ${window}: ${routine.name} (${routine.day_hint || "dia recorrente"} ${routine.time_hint || ""}) ${direction}. Evidência: ${routine.evidence}.`,
      );
    }

    for (const loop of safeOpenLoops(continuity.open_loops).filter((item) => item.priority >= 4)) {
      triggers.push(
        `Assunto em aberto prioritário: ${loop.topic}. Pergunta sugerida: ${loop.suggested_question}.`,
      );
    }
  }

  for (const task of tasks.slice(0, 12)) {
    const moment = taskMoment(task);
    if (!moment || task.all_day) continue;
    const minutes = Math.round((new Date(moment).getTime() - now.getTime()) / 60_000);
    const window = triggerWindow(minutes);
    if (!window) continue;
    const direction =
      window === "próxima"
        ? `começa em aproximadamente ${minutes} minuto(s)`
        : `aconteceu há aproximadamente ${Math.abs(minutes)} minuto(s)`;
    triggers.push(`Agenda ${window}: ${task.title} ${direction}.`);
  }

  const todayKey = localDateKey(now, safeTimeZone);
  for (const task of tasks.slice(0, 12)) {
    const moment = taskMoment(task);
    if (!moment || !task.all_day) continue;
    if (localDateKey(moment, safeTimeZone) !== todayKey) continue;
    triggers.push(`Agenda de hoje sem horário exato: ${task.title}.`);
  }

  if (!triggers.length) return "";
  return [
    "<gatilhos_de_abertura>",
    ...triggers.slice(0, 6).map((trigger) => `- ${trigger}`),
    "</gatilhos_de_abertura>",
    "Use estes gatilhos somente se couberem naturalmente na primeira fala. Priorize um gatilho, não todos.",
  ].join("\n");
}

export function buildContinuityStartupBriefing({
  continuity,
  displayName,
  openingTriggers,
  taskBriefing,
  timeZone = DEFAULT_TIME_ZONE,
}: {
  continuity: AssistantContinuity | null;
  displayName?: string | null;
  openingTriggers?: string;
  taskBriefing?: string;
  timeZone?: string;
}) {
  if (!continuity && !taskBriefing && !openingTriggers) return "";
  const hour = localHour(new Date(), validTimeZone(timeZone));
  const period = dayPeriod(hour);
  const firstName = displayName?.trim().split(/\s+/)[0] ?? "";
  return [
    "Ao iniciar, faça uma abertura curta, falada e natural.",
    firstName ? `Você pode chamar o usuário de ${firstName}.` : "",
    `Considere que agora é ${period}.`,
    openingTriggers || "",
    continuity
      ? [
          "Use o contexto de continuidade para soar como uma relação contínua.",
          "Se existir gatilho de abertura, ele tem prioridade sobre uma saudação genérica.",
          "Se a última conversa ficou com assunto aberto, mencione só o ponto principal e pergunte se ele quer continuar.",
          "Se houver padrão recorrente não confirmado relevante para hoje, pergunte confirmação de forma leve.",
          "Não liste bastidores, não diga que leu cache, e não recite o resumo.",
        ].join(" ")
      : "",
    taskBriefing || "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function refreshContinuityCache({
  supabase,
  userId,
  conversationId,
}: {
  supabase: SupabaseClient;
  userId: string;
  conversationId: string;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada.");

  const processingAt = new Date().toISOString();
  const previous = await loadContinuityCache(supabase, userId).catch(() => null);
  const previousUpdatedAt = previous?.updated_at
    ? new Date(previous.updated_at).getTime()
    : 0;
  const refreshWindowActive =
    previousUpdatedAt > 0 && Date.now() - previousUpdatedAt < 15 * 60_000;

  if (
    refreshWindowActive &&
    (previous?.status === "processing" || previous?.status === "ready")
  ) {
    return { refreshed: false, skipped: "debounced" };
  }

  await supabase.from("assistant_continuity").upsert(
    {
      user_id: userId,
      last_conversation_id: conversationId,
      status: "processing",
      last_error: null,
    },
    { onConflict: "user_id" },
  );

  try {
    const since =
      previous?.processed_until && !Number.isNaN(new Date(previous.processed_until).getTime())
        ? previous.processed_until
        : new Date(Date.now() - WEEK_MS).toISOString();
    const [{ data: messageRows }, { data: memories }, openTasks] =
      await Promise.all([
        supabase
          .from("messages")
          .select("id, conversation_id, role, content, created_at")
          .eq("user_id", userId)
          .eq("generation_status", "completed")
          .gt("created_at", since)
          .order("created_at", { ascending: false })
          .limit(MAX_TRANSCRIPT_MESSAGES),
        supabase
          .from("memories")
          .select("category, content, importance, memory_type, updated_at")
          .eq("user_id", userId)
          .eq("status", "active")
          .eq("review_status", "approved")
          .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
          .order("importance", { ascending: false })
          .order("updated_at", { ascending: false })
          .limit(30),
        loadContinuityCache(supabase, userId).catch(() => null),
        loadOpenTasks({ supabase, userId, limit: 60 }).catch(() => []),
      ]);

    const messages = ((messageRows ?? []) as MessageRow[]).reverse();
    const lastMessage = messages[messages.length - 1] ?? null;
    const memoryContext = (memories ?? [])
      .map(
        (memory, index) =>
          `${index + 1}. [${memory.category}; importância ${memory.importance}/5; ${memory.memory_type}] ${String(memory.content).slice(0, 500)}`,
      )
      .join("\n")
      .slice(0, 7_000);

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
        max_output_tokens: 900,
        instructions: [
          "Você é o cérebro de continuidade relacional da Synapsay.",
          "Crie um cache curto para a assistente de voz retomar a relação como se a conversa fosse contínua, sem inserir histórico bruto no prompt.",
          "Use somente fatos explicitamente declarados pelo USUÁRIO, memórias aprovadas, tarefas estruturadas e mensagens recentes. Nunca invente casamento, filhos, trabalho, estudo, rotina, humor ou intimidade.",
          "relationship_context deve conter dados pessoais e familiares estáveis apenas quando explicitamente conhecidos, como trabalho, estudo, casamento, filhos, preferências de tratamento e contexto de vida.",
          "routine_digest deve registrar rotinas confirmadas ou muito bem sustentadas por memórias aprovadas. Se o padrão apareceu nas mensagens mas ainda não foi confirmado, coloque em recurring_candidates e peça confirmação.",
          "confirmed_routines deve conter rotinas já confirmadas em formato estruturado. Preencha day_hint com o dia ou frequência em português, como 'quarta-feira' ou 'todo dia'. Preencha time_hint somente quando houver horário conhecido, como '17h' ou '19h30'.",
          "open_loops são assuntos inacabados, decisões pendentes, pedidos interrompidos ou temas que o usuário provavelmente esperava continuar.",
          "recurring_candidates servem para padrões como 'toda terça padaria'. Não marque confirmed=true sem confirmação explícita do usuário ou memória aprovada equivalente.",
          "greeting_hints deve trazer sugestões curtas por período do dia e por retorno após intervalo. Não escreva uma fala longa; escreva pistas naturais para a voz adaptar.",
          "Mantenha tudo em português do Brasil, conciso, útil e não robótico.",
          `AGORA: ${new Date().toISOString()}. FUSO: ${DEFAULT_TIME_ZONE}.`,
        ].join(" "),
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: [
                  `CACHE ANTERIOR:\n${previous ? formatJson(previous, 4000) : "Nenhum."}`,
                  `MEMÓRIAS APROVADAS:\n${memoryContext || "Nenhuma."}`,
                  `AGENDA ATIVA:\n${formatTasksForModel(openTasks)}`,
                  `MENSAGENS DOS ÚLTIMOS 7 DIAS:\n${formatMessages(messages) || "Nenhuma."}`,
                ].join("\n\n"),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "synapsay_continuity_cache",
            strict: true,
            schema: continuitySchema,
          },
        },
      }),
    });

    const payload = (await response.json()) as ResponsesPayload;
    if (!response.ok) {
      throw new Error(payload.error?.message ?? "Falha ao atualizar continuidade.");
    }

    const text = outputText(payload);
    if (!text) throw new Error("A continuidade não retornou um resultado válido.");
    const parsed = parseContinuity(text);

    const { error } = await supabase.from("assistant_continuity").upsert(
      {
        user_id: userId,
        last_conversation_id: conversationId,
        last_message_id: lastMessage?.id ?? null,
        last_interaction_at: lastMessage?.created_at ?? processingAt,
        weekly_summary: parsed.weekly_summary,
        relationship_context: parsed.relationship_context,
        routine_digest: parsed.routine_digest,
        confirmed_routines: parsed.confirmed_routines,
        recent_topics: parsed.recent_topics,
        open_loops: parsed.open_loops,
        recurring_candidates: parsed.recurring_candidates,
        greeting_hints: parsed.greeting_hints,
        status: "ready",
        processed_until: lastMessage?.created_at ?? processingAt,
        last_error: null,
        metadata: {
          model: AI_MODELS.memoryBrain,
          refreshed_at: new Date().toISOString(),
          message_count: messages.length,
          since,
        },
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);

    return {
      refreshed: true,
      messageCount: messages.length,
      processedUntil: lastMessage?.created_at ?? processingAt,
    };
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Falha ao atualizar continuidade.";
    await supabase.from("assistant_continuity").upsert(
      {
        user_id: userId,
        last_conversation_id: conversationId,
        status: "failed",
        last_error: message.slice(0, 500),
      },
      { onConflict: "user_id" },
    );
    throw reason;
  }
}
