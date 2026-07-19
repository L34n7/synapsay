import { AI_MODELS } from "@/lib/ai/models";
import { responseDiagnostic, responseOutputText } from "@/lib/ai/responses";
import type { AssistantRoutine, NewsSource } from "@/lib/routines/types";
import type { SupabaseClient } from "@supabase/supabase-js";

type ExecuteRoutineArgs = {
  supabase: SupabaseClient;
  userId: string;
  routineId: string;
  referenceKey: string;
  executionInstruction?: string | null;
};

type MemoryPreference = { content: string; category?: string; importance?: number };
type RoutineFeedback = { message: string; sentiment?: string; adjustments?: unknown };
type TaskSummary = {
  title: string;
  description?: string;
  status: string;
  priority?: number;
  scheduled_at?: string | null;
  due_at?: string | null;
  all_day?: boolean;
  timezone?: string;
};
type SourceAnnotation = { type?: string; title?: string; url?: string };
type OpenAIOutputItem = {
  type?: string;
  content?: Array<{ annotations?: SourceAnnotation[] }>;
  action?: { sources?: SourceAnnotation[] };
};

function normalizeDomain(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return trimmed.replace(/^https?:\/\//, "").split("/")[0];
  }
}

function buildPrompt(
  routine: AssistantRoutine,
  memories: MemoryPreference[],
  feedback: RoutineFeedback[],
  tasks: TaskSummary[],
  executionInstruction?: string | null,
) {
  const config = routine.configuration ?? {};
  const topics = [...(config.categories ?? []), ...(config.topics ?? [])];
  const sources = (config.sources ?? [])
    .map((source: NewsSource) => normalizeDomain(String(source.value ?? "")))
    .filter(Boolean);
  const sourceRule = sources.length
    ? config.sourcesOnly
      ? `Use exclusivamente informações publicadas nestes domínios: ${sources.join(", ")}.`
      : `Priorize estes domínios e complemente somente quando necessário: ${sources.join(", ")}.`
    : "Use fontes confiáveis e variadas.";
  const memoryContext =
    routine.adapt_from_memories && memories.length
      ? `Preferências e interesses aprovados do usuário, usados apenas para priorização leve: ${memories
          .map((memory) => memory.content)
          .join(" | ")}`
      : "Não personalize por memória nesta execução.";
  const feedbackContext = feedback.length
    ? `Feedback recente sobre esta rotina: ${feedback
        .map((item) => item.message)
        .join(" | ")}`
    : "Ainda não há feedback específico desta rotina.";
  const actionContext =
    routine.action_type === "agenda_briefing" || routine.action_type === "task_briefing"
      ? tasks.length
        ? `Dados estruturados atuais da agenda e das tarefas: ${JSON.stringify(tasks)}.`
        : "Não há tarefas ou compromissos ativos para apresentar. Diga isso de forma breve."
      : routine.action_type === "custom_briefing"
        ? "Siga a instrução personalizada sem inventar fatos atuais que não estejam no contexto."
        : "Pesquise informações atuais antes de redigir o briefing.";

  return [
    `Produza um briefing em português do Brasil para a rotina "${routine.name}".`,
    `Data e hora de execução: ${new Date().toISOString()}; fuso do usuário: ${routine.timezone}.`,
    topics.length
      ? `Assuntos definidos permanentemente: ${topics.join(", ")}.`
      : "Selecione os assuntos mais relevantes para o tipo da rotina.",
    routine.action_type === "news_briefing" ? sourceRule : "",
    actionContext,
    memoryContext,
    feedbackContext,
    "Memórias apenas ajustam prioridade. Não altere silenciosamente a configuração permanente da rotina.",
    executionInstruction
      ? `Preferência válida somente nesta execução, sem mudar a rotina: ${executionInstruction}`
      : "",
    `Use no máximo ${Number(config.maxItems) || 5} itens e linguagem adequada para leitura em voz alta.`,
    `Duração aproximada máxima: ${Number(config.maxDurationSeconds) || 90} segundos.`,
    "Comece diretamente pelo conteúdo. Não invente fatos e diferencie notícia confirmada de informação em desenvolvimento.",
    "Não escreva URLs no corpo falado; as fontes serão apresentadas separadamente pela interface.",
    config.prompt ? `Instrução adicional permanente do usuário: ${config.prompt}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function extractSources(data: unknown) {
  const output =
    data && typeof data === "object" && Array.isArray((data as { output?: unknown }).output)
      ? ((data as { output: OpenAIOutputItem[] }).output ?? [])
      : [];
  const annotations = output
    .flatMap((item) => item.content ?? [])
    .flatMap((item) => item.annotations ?? [])
    .filter((item) => item.type === "url_citation")
    .map((item) => ({ title: item.title, url: item.url }));
  const searchedSources = output
    .filter((item) => item.type === "web_search_call")
    .flatMap((item) => item.action?.sources ?? [])
    .map((item) => ({
      title: item.title ?? item.url ?? "Fonte consultada",
      url: item.url,
    }));
  const unique = new Map<string, { title: string; url: string }>();
  for (const source of [...annotations, ...searchedSources]) {
    if (source.url && !unique.has(source.url)) {
      unique.set(source.url, {
        title: source.title || source.url,
        url: source.url,
      });
    }
  }
  // As citações efetivamente usadas entram primeiro. Limitar a lista evita
  // gravar e reenviar ao Realtime dezenas de resultados auxiliares da busca.
  return [...unique.values()].slice(0, 12);
}

function webSearchTools(routine: AssistantRoutine) {
  if (routine.action_type !== "news_briefing") return [];
  const config = routine.configuration ?? {};
  const domains = (config.sources ?? [])
    .map((source: NewsSource) => normalizeDomain(String(source.value ?? "")))
    .filter(Boolean)
    .slice(0, 100);
  return [
    {
      type: "web_search",
      ...(config.sourcesOnly && domains.length
        ? { filters: { allowed_domains: domains } }
        : {}),
    },
  ];
}

export async function executeRoutine({
  supabase,
  userId,
  routineId,
  referenceKey,
  executionInstruction,
}: ExecuteRoutineArgs) {
  const [
    { data: routine },
    { data: cached },
    { data: memories },
    { data: feedback },
    { data: run },
    { data: tasks },
  ] = await Promise.all([
    supabase
      .from("assistant_routines")
      .select("*")
      .eq("id", routineId)
      .eq("user_id", userId)
      .eq("active", true)
      .maybeSingle(),
    supabase
      .from("assistant_routine_content_cache")
      .select("content_text,sources,generated_at,expires_at")
      .eq("routine_id", routineId)
      .eq("reference_key", referenceKey)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("memories")
      .select("content,category,importance")
      .eq("user_id", userId)
      .eq("status", "active")
      .eq("review_status", "approved")
      .order("importance", { ascending: false })
      .limit(20),
    supabase
      .from("assistant_routine_feedback")
      .select("message,sentiment,adjustments")
      .eq("routine_id", routineId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("assistant_routine_runs")
      .select("*")
      .eq("routine_id", routineId)
      .eq("reference_key", referenceKey)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("tasks")
      .select("title,description,status,priority,scheduled_at,due_at,all_day,timezone")
      .eq("user_id", userId)
      .in("status", ["pending", "in_progress"])
      .order("scheduled_at", { ascending: true, nullsFirst: false })
      .limit(40),
  ]);

  if (!routine) throw new Error("Rotina não encontrada ou pausada.");
  if (!run) throw new Error("Oportunidade de rotina não encontrada.");
  if (run.status === "awaiting_confirmation") {
    throw new Error("Esta rotina ainda aguarda confirmação.");
  }
  if (run.expires_at && new Date(run.expires_at).getTime() < Date.now()) {
    await supabase
      .from("assistant_routine_runs")
      .update({ status: "expired" })
      .eq("id", run.id)
      .eq("user_id", userId);
    throw new Error("A oportunidade desta rotina expirou.");
  }

  const isTest = run.is_test === true || referenceKey.startsWith("test:");
  const cacheIsValid =
    cached && (!cached.expires_at || new Date(cached.expires_at).getTime() > Date.now());
  if (cacheIsValid && !executionInstruction) {
    return {
      content: cached.content_text,
      sources: cached.sources ?? [],
      cached: true,
      askFeedback: false,
      routineId,
      referenceKey,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada.");

  const attemptPatch: Record<string, unknown> = {
    status: "processing",
    started_at: new Date().toISOString(),
  };
  if (Object.prototype.hasOwnProperty.call(run, "attempt_count")) {
    attemptPatch.attempt_count = Math.min(10, Number(run.attempt_count ?? 0) + 1);
    attemptPatch.last_attempt_at = new Date().toISOString();
  }
  const { error: startError } = await supabase
    .from("assistant_routine_runs")
    .update(attemptPatch)
    .eq("id", run.id)
    .eq("user_id", userId);
  if (startError) throw startError;

  try {
    const tools = webSearchTools(routine);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: AI_MODELS.text,
        store: false,
        tools,
        ...(tools.length
          ? {
              tool_choice: "auto",
              include: ["web_search_call.action.sources"],
            }
          : {}),
        input: buildPrompt(
          routine as AssistantRoutine,
          (memories ?? []) as MemoryPreference[],
          (feedback ?? []) as RoutineFeedback[],
          (tasks ?? []) as TaskSummary[],
          executionInstruction,
        ),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message ?? "Falha ao gerar briefing.");
    }
    const content = responseOutputText(data);
    if (!content) {
      const diagnostic = responseDiagnostic(data);
      console.error("Resposta da rotina concluída sem texto utilizável.", diagnostic);
      throw new Error(
        diagnostic.incompleteReason
          ? `O briefing ficou incompleto (${diagnostic.incompleteReason}). Tente novamente.`
          : "A geração terminou sem texto utilizável. Tente novamente.",
      );
    }
    const sources = extractSources(data);

    if (!isTest && !executionInstruction) {
      const { error: cacheError } = await supabase
        .from("assistant_routine_content_cache")
        .upsert(
          {
            routine_id: routineId,
            user_id: userId,
            reference_key: referenceKey,
            content_text: content,
            sources,
            expires_at: run.expires_at,
          },
          { onConflict: "routine_id,reference_key" },
        );
      if (cacheError) throw cacheError;
    }

    const { error: completeError } = await supabase
      .from("assistant_routine_runs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        result: { content, sources },
        error_message: null,
      })
      .eq("id", run.id)
      .eq("user_id", userId);
    if (completeError) throw completeError;

    if (!isTest) {
      const { error: incrementError } = await supabase.rpc(
        "increment_routine_execution",
        { p_routine_id: routineId, p_user_id: userId },
      );
      if (incrementError) {
        console.warn("Contador da rotina não atualizado:", incrementError);
      }
    }

    const nextCount = Number(routine.execution_count ?? 0) + (isTest ? 0 : 1);
    const interval = Math.max(1, Number(routine.feedback_interval) || 3);
    const askFeedback = Boolean(
      !isTest && routine.suggest_adjustments && nextCount > 0 && nextCount % interval === 0,
    );
    return {
      content,
      sources,
      cached: false,
      routineId,
      referenceKey,
      askFeedback,
      feedbackPrompt: askFeedback
        ? "Ao terminar, pergunte brevemente se o usuário está gostando ou deseja mudar duração, assuntos ou fontes."
        : null,
    };
  } catch (reason) {
    const message =
      reason instanceof Error ? reason.message : "Não foi possível executar a rotina.";
    await supabase
      .from("assistant_routine_runs")
      .update({ status: "failed", error_message: message.slice(0, 500) })
      .eq("id", run.id)
      .eq("user_id", userId);
    throw new Error(message);
  }
}

function normalize(message: string) {
  return message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function postponementMinutes(message: string, configuredMinutes: number | null | undefined) {
  const normalized = normalize(message);
  const explicit = normalized.match(/daqui a\s+(\d{1,3})\s*(minuto|minutos|hora|horas)/);
  if (explicit) {
    const amount = Number(explicit[1]);
    return explicit[2].startsWith("hora") ? amount * 60 : amount;
  }
  return Math.max(5, Math.min(720, Number(configuredMinutes) || 60));
}

function oneTimeInstruction(message: string) {
  return message
    .replace(
      /^(sim|pode|claro|quero|execute|executa|fale|manda|vamos|ok|okay|confirmo)\b[\s,.:;-]*/i,
      "",
    )
    .replace(/^(mas|porem|porém|so|só)\b[\s,.:;-]*/i, "")
    .trim();
}

export async function resolvePendingRoutine({
  supabase,
  userId,
  message,
}: {
  supabase: SupabaseClient;
  userId: string;
  message: string;
}) {
  const normalized = normalize(message);
  const affirmative =
    /^(sim|pode|claro|quero|eu quero|execute|executa|fale|manda|vamos|ok|okay|confirmo|traga|rode)\b/.test(
      normalized,
    );
  const decline = /^(nao|agora nao|hoje nao|deixa pra la|dispenso|pular|pule)\b/.test(
    normalized,
  );
  const disable = /(nao quero mais|desative|desliga|pare essa rotina|cancele essa rotina)/.test(
    normalized,
  );
  const postpone = /(mais tarde|daqui a\s+\d+|pergunte depois|lembre depois)/.test(normalized);
  if (!affirmative && !decline && !disable && !postpone) return null;

  const { data: run } = await supabase
    .from("assistant_routine_runs")
    .select(
      "id,routine_id,reference_key,expires_at,assistant_routines(name,configuration)",
    )
    .eq("user_id", userId)
    .eq("status", "awaiting_confirmation")
    .order("offered_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!run) return null;

  if (run.expires_at && new Date(run.expires_at).getTime() < Date.now()) {
    await supabase
      .from("assistant_routine_runs")
      .update({ status: "expired" })
      .eq("id", run.id)
      .eq("user_id", userId);
    return {
      handled: true,
      status: "expired",
      summary:
        "A janela dessa rotina já terminou. Ela ficará disponível novamente na próxima oportunidade.",
    };
  }

  if (disable) {
    await Promise.all([
      supabase
        .from("assistant_routines")
        .update({ active: false })
        .eq("id", run.routine_id)
        .eq("user_id", userId),
      supabase
        .from("assistant_routine_runs")
        .update({ status: "declined" })
        .eq("id", run.id)
        .eq("user_id", userId),
    ]);
    return {
      handled: true,
      status: "disabled",
      summary: "Rotina desativada. Ela não será oferecida novamente até ser reativada.",
    };
  }

  if (postpone) {
    const relation = Array.isArray(run.assistant_routines)
      ? run.assistant_routines[0]
      : run.assistant_routines;
    const minutes = postponementMinutes(
      message,
      relation?.configuration?.askAgainAfterMinutes,
    );
    const availableAfter = new Date(Date.now() + minutes * 60_000);
    if (run.expires_at && availableAfter.getTime() >= new Date(run.expires_at).getTime()) {
      await supabase
        .from("assistant_routine_runs")
        .update({ status: "declined" })
        .eq("id", run.id)
        .eq("user_id", userId);
      return {
        handled: true,
        status: "declined",
        summary:
          "Tudo bem. Esse novo horário ficaria fora da janela de hoje, então ofereço novamente na próxima oportunidade.",
      };
    }
    await supabase
      .from("assistant_routine_runs")
      .update({ status: "postponed", available_after: availableAfter.toISOString() })
      .eq("id", run.id)
      .eq("user_id", userId);
    return {
      handled: true,
      status: "postponed",
      summary: `Tudo bem. Vou oferecer esta rotina novamente em cerca de ${minutes} minutos, se a janela ainda estiver aberta.`,
    };
  }

  if (decline) {
    await supabase
      .from("assistant_routine_runs")
      .update({ status: "declined" })
      .eq("id", run.id)
      .eq("user_id", userId);
    return {
      handled: true,
      status: "declined",
      summary: "Tudo bem. Não vou executar essa rotina nesta oportunidade.",
    };
  }

  await supabase
    .from("assistant_routine_runs")
    .update({
      status: "available",
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", run.id)
    .eq("user_id", userId);
  const execution = await executeRoutine({
    supabase,
    userId,
    routineId: run.routine_id,
    referenceKey: run.reference_key,
    executionInstruction: oneTimeInstruction(message) || null,
  });
  return {
    handled: true,
    status: "completed",
    summary: execution.content,
    ...execution,
  };
}
