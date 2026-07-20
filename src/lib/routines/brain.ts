import { AI_MODELS } from "@/lib/ai/models";
import { responseOutputText } from "@/lib/ai/responses";
import { validRoutineTimeZone } from "@/lib/routines/engine";
import type { AssistantRoutine } from "@/lib/routines/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type RoutineBrainResult = {
  handled: boolean;
  summary: string;
  operation: string;
  routineId?: string;
  suggestion?: string;
};

type Args = {
  supabase: SupabaseClient;
  userId: string;
  message: string;
  source: "text" | "voice";
  timezone?: string;
};

type RoutineOperation = {
  operation:
    | "none"
    | "create"
    | "update"
    | "pause"
    | "resume"
    | "delete"
    | "feedback"
    | "signal";
  targetId: string | null;
  name: string | null;
  recurrenceType: "daily" | "weekly" | "once" | null;
  startTime: string | null;
  endTime: string | null;
  startsOn: string | null;
  endsOn: string | null;
  daysOfWeek: number[];
  confirmationMode: "automatic" | "ask_first" | null;
  actionType:
    | "news_briefing"
    | "custom_briefing"
    | "agenda_briefing"
    | "task_briefing"
    | null;
  topics: string[];
  categories: string[];
  sources: string[];
  sourcesOnly: boolean | null;
  maxDurationSeconds: number | null;
  adaptFromMemories: boolean | null;
  suggestAdjustments: boolean | null;
  feedbackInterval: number | null;
  maxExecutionsPerPeriod: number | null;
  feedbackSentiment: "positive" | "negative" | "neutral" | "preference" | null;
  feedbackMessage: string | null;
  topicSignal: string | null;
  localPeriod: "morning" | "afternoon" | "evening" | null;
};

const routineWords = /(?:rotina|agend(?:a|ar|e|ado|amento)|program(?:a|ar|e|ado|ação)|automatiz(?:a|ar|e|ado|ação)|todo dia|todos os dias|diariamente|semanalmente|toda semana|primeira conversa|ao iniciar|quando eu (?:iniciar|abrir|falar|conversar)|sempre que|depois das|a partir das|antes das|pela manhã|de manhã|ao meio-dia|depois do trabalho|me pergunte antes|não pergunte|\b(?:duas|três|tres|quatro|cinco|\d+) vezes\b|resumo|briefing|notícias do dia|notícias pela manhã|pare de falar|pause|desative|reative|exclua|muito longo|mais curto|mais tecnologia|menos política|fonte|site específico|estou gostando|não estou gostando)/i;
const explicitRoutineWords = /(?:\brotina\b|primeira conversa|ao iniciar|quando eu (?:iniciar|abrir|falar|conversar)|briefing|not[ií]cias|resumo|me pergunte antes|n[aã]o pergunte|execute automaticamente|executar automaticamente|rotina autom[aá]tica)/i;
const explicitAgendaWords = /(?:agenda|calend[aá]rio|google calendar|google agenda|compromisso|evento|lembrete|tarefa|reuni[aã]o|consulta|culto|ensaio)/i;
const scheduleShapeWords = /(?:toda semana|semanalmente|segunda a sexta|todo dia|todos os dias|diariamente|\b(?:segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)\b|\b\d{1,2}(?::\d{2})?\s*h?\b|\b(?:uma|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte)\s+horas?\b)/i;

export function isAmbiguousRoutineAgendaRequest(message: string) {
  const text = message.trim();
  if (!text) return false;
  if (explicitRoutineWords.test(text) || explicitAgendaWords.test(text)) return false;
  return scheduleShapeWords.test(text);
}

function outputText(data: unknown) {
  return responseOutputText(data);
}

function parseOperation(data: unknown): RoutineOperation | null {
  const text = outputText(data);
  if (!text) return null;

  try {
    return JSON.parse(text) as RoutineOperation;
  } catch {
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return null;
    try {
      return JSON.parse(json) as RoutineOperation;
    } catch {
      return null;
    }
  }
}

function routineSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "operation",
      "targetId",
      "name",
      "recurrenceType",
      "startTime",
      "endTime",
      "startsOn",
      "endsOn",
      "daysOfWeek",
      "confirmationMode",
      "actionType",
      "topics",
      "categories",
      "sources",
      "sourcesOnly",
      "maxDurationSeconds",
      "adaptFromMemories",
      "suggestAdjustments",
      "feedbackInterval",
      "maxExecutionsPerPeriod",
      "feedbackSentiment",
      "feedbackMessage",
      "topicSignal",
      "localPeriod",
    ],
    properties: {
      operation: {
        type: "string",
        enum: ["none", "create", "update", "pause", "resume", "delete", "feedback", "signal"],
      },
      targetId: { type: ["string", "null"] },
      name: { type: ["string", "null"] },
      recurrenceType: {
        type: ["string", "null"],
        enum: ["daily", "weekly", "once", null],
      },
      startTime: { type: ["string", "null"] },
      endTime: { type: ["string", "null"] },
      startsOn: { type: ["string", "null"] },
      endsOn: { type: ["string", "null"] },
      daysOfWeek: {
        type: "array",
        items: { type: "integer", minimum: 0, maximum: 6 },
      },
      confirmationMode: {
        type: ["string", "null"],
        enum: ["automatic", "ask_first", null],
      },
      actionType: {
        type: ["string", "null"],
        enum: ["news_briefing", "custom_briefing", "agenda_briefing", "task_briefing", null],
      },
      topics: { type: "array", items: { type: "string" } },
      categories: { type: "array", items: { type: "string" } },
      sources: { type: "array", items: { type: "string" } },
      sourcesOnly: { type: ["boolean", "null"] },
      maxDurationSeconds: { type: ["number", "null"], minimum: 15, maximum: 900 },
      adaptFromMemories: { type: ["boolean", "null"] },
      suggestAdjustments: { type: ["boolean", "null"] },
      feedbackInterval: { type: ["number", "null"], minimum: 1, maximum: 30 },
      maxExecutionsPerPeriod: {
        type: ["number", "null"],
        minimum: 1,
        maximum: 10,
      },
      feedbackSentiment: {
        type: ["string", "null"],
        enum: ["positive", "negative", "neutral", "preference", null],
      },
      feedbackMessage: { type: ["string", "null"] },
      topicSignal: { type: ["string", "null"] },
      localPeriod: {
        type: ["string", "null"],
        enum: ["morning", "afternoon", "evening", null],
      },
    },
  };
}

async function classify(args: Args, routines: AssistantRoutine[]) {
  if (!process.env.OPENAI_API_KEY) return null;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AI_MODELS.text,
      store: false,
      max_output_tokens: 1000,
      text: {
        format: {
          type: "json_schema",
          name: "assistant_routine_operation",
          strict: true,
          schema: routineSchema(),
        },
      },
      input: [
        {
          role: "system",
          content: [
            "Extraia a intenção de gerenciamento de rotinas do assistente.",
            "Pedidos como programar ou automatizar notícias, briefings, assuntos, tarefas ou informações em uma janela recorrente significam operation=create.",
            "Uma rotina é diferente de um compromisso da agenda: ela executa uma ação do assistente quando a conversa começa dentro da janela configurada.",
            "Se o usuário pedir agenda, calendário, Google Agenda, compromisso, evento, reunião, consulta, culto, ensaio ou academia em horário marcado, retorne operation=none; isso pertence à agenda, não a rotinas.",
            "Se o pedido puder ser tanto agenda quanto rotina e não houver palavra explícita de rotina, retorne operation=none para que o assistente peça confirmação.",
            "Nunca crie rotina apenas porque o usuário comentou repetidamente sobre um tema; nesse caso use operation=signal.",
            "Datas devem usar AAAA-MM-DD e horários HH:mm.",
            "Quando o usuário disser a partir de um horário e não informar o fim, use 23:59.",
            "Quando não houver pedido explícito para executar automaticamente, use confirmationMode=ask_first.",
            "Preencha maxExecutionsPerPeriod somente quando o usuário pedir mais de uma oportunidade no mesmo dia ou semana; caso contrário use 1.",
            "Para notícias, use actionType=news_briefing. Para um conteúdo livre, use custom_briefing.",
            "Preserve campos não mencionados em atualizações usando null ou arrays vazios.",
            `Fuso: ${args.timezone ?? "America/Sao_Paulo"}.`,
            `Rotinas existentes: ${JSON.stringify(
              routines.map((routine) => ({
                id: routine.id,
                name: routine.name,
                active: routine.active,
                configuration: routine.configuration,
                recurrence_type: routine.recurrence_type,
                start_time: routine.start_time,
                end_time: routine.end_time,
                starts_on: routine.starts_on,
                ends_on: routine.ends_on,
                confirmation_mode: routine.confirmation_mode,
              })),
            )}.`,
          ].join(" "),
        },
        { role: "user", content: args.message },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    console.warn("Classificação de rotina recusada pela OpenAI:", detail?.error?.message ?? response.status);
    return null;
  }

  return parseOperation(await response.json());
}

function normalizeSources(sources: unknown) {
  if (!Array.isArray(sources)) return [];
  return sources
    .map((source) => {
      if (typeof source === "string") return source.trim();
      if (source && typeof source === "object" && "value" in source) {
        return String((source as { value?: unknown }).value ?? "").trim();
      }
      return "";
    })
    .filter(Boolean)
    .slice(0, 20);
}

function speechFor(op: RoutineOperation, routine?: Partial<AssistantRoutine>) {
  switch (op.operation) {
    case "create": {
      const start = routine?.start_time?.slice(0, 5) ?? op.startTime ?? "08:00";
      const end = routine?.end_time?.slice(0, 5) ?? op.endTime ?? "23:59";
      const confirmation =
        routine?.confirmation_mode === "automatic"
          ? "Vou executar automaticamente na primeira conversa dentro dessa janela."
          : "Vou pedir sua confirmação antes de executar.";
      return `Rotina criada: ${routine?.name ?? op.name ?? "Rotina do assistente"}, disponível entre ${start} e ${end}. ${confirmation} Você pode revisar ou alterar tudo na página Rotinas.`;
    }
    case "update":
      return "Rotina atualizada com as novas preferências. Você pode conferir os detalhes na página Rotinas.";
    case "pause":
      return "Rotina pausada.";
    case "resume":
      return "Rotina reativada.";
    case "delete":
      return "Rotina excluída.";
    case "feedback":
      return "Entendi seu feedback e atualizei a rotina quando você pediu uma mudança permanente.";
    default:
      return "";
  }
}

export async function analyzeAndApplyRoutineMessage(args: Args): Promise<RoutineBrainResult> {
  if (isAmbiguousRoutineAgendaRequest(args.message)) {
    return {
      handled: true,
      summary:
        "Só para confirmar: você quer que eu crie uma rotina do assistente ou uma agenda no calendário?",
      operation: "clarification",
    };
  }

  if (!routineWords.test(args.message)) {
    await recordInterestSignal(args).catch(() => null);
    return { handled: false, summary: "", operation: "none" };
  }

  const { data: routines, error: routinesError } = await args.supabase
    .from("assistant_routines")
    .select("*")
    .eq("user_id", args.userId)
    .order("updated_at", { ascending: false })
    .limit(30);

  if (routinesError) throw routinesError;
  const typedRoutines = (routines ?? []) as AssistantRoutine[];

  const op = await classify(args, typedRoutines);
  if (!op || op.operation === "none" || op.operation === "signal") {
    if (op?.operation === "signal") await recordInterestSignal(args).catch(() => null);
    return { handled: false, summary: "", operation: op?.operation ?? "none" };
  }

  if (op.operation === "create") {
    const sources = normalizeSources(op.sources);
    const recurrenceType = op.recurrenceType ?? "daily";
    const confirmationMode = op.confirmationMode === "automatic" ? "automatic" : "ask_first";
    const payload = {
      user_id: args.userId,
      name: String(op.name || "Rotina do assistente").slice(0, 120),
      description: null,
      active: true,
      trigger_type: "conversation_window",
      recurrence_type: recurrenceType,
      timezone: validRoutineTimeZone(args.timezone),
      start_time: op.startTime || "08:00",
      end_time: op.endTime || "23:59",
      starts_on: op.startsOn || null,
      ends_on: op.endsOn || null,
      days_of_week:
        Array.isArray(op.daysOfWeek) && op.daysOfWeek.length
          ? op.daysOfWeek
          : [0, 1, 2, 3, 4, 5, 6],
      max_executions_per_period: Math.max(
        1,
        Math.min(10, Number(op.maxExecutionsPerPeriod) || 1),
      ),
      confirmation_mode: confirmationMode,
      action_type: op.actionType || "news_briefing",
      adapt_from_memories: op.adaptFromMemories !== false,
      suggest_adjustments: op.suggestAdjustments !== false,
      feedback_interval: Math.max(1, Math.min(30, Number(op.feedbackInterval) || 3)),
      configuration: {
        topics: op.topics ?? [],
        categories: op.categories ?? [],
        sources: sources.map((value) => ({ type: "domain", value })),
        sourcesOnly: Boolean(op.sourcesOnly),
        maxDurationSeconds: Number(op.maxDurationSeconds) || 90,
        delivery: args.source === "voice" ? "voice" : "both",
      },
      created_via: args.source === "voice" ? "voice" : "conversation",
    };

    const { data, error } = await args.supabase
      .from("assistant_routines")
      .insert(payload)
      .select("id,name,start_time,end_time,confirmation_mode")
      .single();

    if (error) throw error;

    return {
      handled: true,
      operation: "create",
      routineId: data.id,
      summary: speechFor(op, data),
    };
  }

  if (["update", "pause", "resume", "delete"].includes(op.operation) && op.targetId) {
    if (op.operation === "delete") {
      const { error } = await args.supabase
        .from("assistant_routines")
        .delete()
        .eq("id", op.targetId)
        .eq("user_id", args.userId);
      if (error) throw error;
    } else if (op.operation === "pause" || op.operation === "resume") {
      const { error } = await args.supabase
        .from("assistant_routines")
        .update({ active: op.operation === "resume" })
        .eq("id", op.targetId)
        .eq("user_id", args.userId);
      if (error) throw error;
    } else {
      const target = typedRoutines.find((routine) => routine.id === op.targetId);
      if (!target) {
        return {
          handled: true,
          summary: "Não encontrei a rotina indicada. Abra a página Rotinas para conferir as rotinas cadastradas.",
          operation: "none",
        };
      }

      const sources = normalizeSources(op.sources);
      const configuration = {
        ...(target.configuration ?? {}),
        ...(op.topics?.length ? { topics: op.topics } : {}),
        ...(op.categories?.length ? { categories: op.categories } : {}),
        ...(sources.length
          ? { sources: sources.map((value) => ({ type: "domain", value })) }
          : {}),
        ...(typeof op.sourcesOnly === "boolean" ? { sourcesOnly: op.sourcesOnly } : {}),
        ...(op.maxDurationSeconds
          ? { maxDurationSeconds: op.maxDurationSeconds }
          : {}),
      };
      const patch: Record<string, unknown> = { configuration };
      if (op.name) patch.name = String(op.name).slice(0, 120);
      if (op.recurrenceType) patch.recurrence_type = op.recurrenceType;
      if (op.startTime) patch.start_time = op.startTime;
      if (op.endTime) patch.end_time = op.endTime;
      if (op.startsOn) patch.starts_on = op.startsOn;
      if (op.endsOn) patch.ends_on = op.endsOn;
      if (op.daysOfWeek?.length) patch.days_of_week = op.daysOfWeek;
      if (op.confirmationMode) patch.confirmation_mode = op.confirmationMode;
      if (op.actionType) patch.action_type = op.actionType;
      if (typeof op.adaptFromMemories === "boolean") {
        patch.adapt_from_memories = op.adaptFromMemories;
      }
      if (typeof op.suggestAdjustments === "boolean") {
        patch.suggest_adjustments = op.suggestAdjustments;
      }
      if (op.feedbackInterval) {
        patch.feedback_interval = Math.max(1, Math.min(30, Number(op.feedbackInterval)));
      }
      if (op.maxExecutionsPerPeriod) {
        patch.max_executions_per_period = Math.max(
          1,
          Math.min(10, Number(op.maxExecutionsPerPeriod)),
        );
      }

      const { error } = await args.supabase
        .from("assistant_routines")
        .update(patch)
        .eq("id", op.targetId)
        .eq("user_id", args.userId);
      if (error) throw error;
    }

    return {
      handled: true,
      operation: op.operation,
      routineId: op.targetId,
      summary: speechFor(op),
    };
  }

  if (op.operation === "feedback" && op.targetId) {
    const { error: feedbackError } = await args.supabase
      .from("assistant_routine_feedback")
      .insert({
        routine_id: op.targetId,
        user_id: args.userId,
        sentiment: op.feedbackSentiment || "preference",
        message: op.feedbackMessage || args.message,
        adjustments: {
          topics: op.topics,
          categories: op.categories,
          maxDurationSeconds: op.maxDurationSeconds,
        },
        applied: Boolean(
          op.topics?.length || op.categories?.length || op.maxDurationSeconds,
        ),
      });
    if (feedbackError) throw feedbackError;

    const target = typedRoutines.find((routine) => routine.id === op.targetId);
    if (target && (op.topics?.length || op.categories?.length || op.maxDurationSeconds)) {
      const { error } = await args.supabase
        .from("assistant_routines")
        .update({
          configuration: {
            ...(target.configuration ?? {}),
            ...(op.topics?.length ? { topics: op.topics } : {}),
            ...(op.categories?.length ? { categories: op.categories } : {}),
            ...(op.maxDurationSeconds
              ? { maxDurationSeconds: op.maxDurationSeconds }
              : {}),
          },
        })
        .eq("id", op.targetId)
        .eq("user_id", args.userId);
      if (error) throw error;
    }

    await args.supabase
      .from("assistant_routines")
      .update({ last_feedback_at: new Date().toISOString() })
      .eq("id", op.targetId)
      .eq("user_id", args.userId);

    return {
      handled: true,
      operation: "feedback",
      routineId: op.targetId,
      summary: speechFor(op),
    };
  }

  return { handled: false, summary: "", operation: op.operation };
}

export async function recordInterestSignal(args: Args) {
  const clean = args.message.trim();
  if (clean.length < 15 || clean.length > 400) return;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AI_MODELS.text,
      store: false,
      max_output_tokens: 120,
      input: `Extraia somente o assunto principal desta fala, em até 5 palavras, ou retorne vazio se não houver interesse temático recorrente útil: ${clean}`,
    }),
  });
  if (!response.ok) return;

  const topic = outputText(await response.json()).replace(/["\n]/g, "").trim();
  if (!topic) return;

  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: args.timezone ?? "America/Sao_Paulo",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date()),
  );
  const period = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const signalKey = `${topic.toLowerCase()}:${period}`.slice(0, 180);
  const { data: existing } = await args.supabase
    .from("assistant_routine_signals")
    .select("id,occurrences")
    .eq("user_id", args.userId)
    .eq("signal_key", signalKey)
    .maybeSingle();

  if (existing) {
    await args.supabase
      .from("assistant_routine_signals")
      .update({
        occurrences: existing.occurrences + 1,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    await args.supabase.from("assistant_routine_signals").insert({
      user_id: args.userId,
      signal_key: signalKey,
      topic,
      local_period: period,
    });
  }
}

export function formatRoutineBrainResult(result: RoutineBrainResult) {
  return result.handled
    ? `Operação estruturada de rotina concluída: ${result.summary}`
    : "Nenhuma alteração estruturada de rotina foi realizada nesta mensagem.";
}
