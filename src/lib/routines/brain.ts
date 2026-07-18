import { AI_MODELS } from "@/lib/ai/models";

export type RoutineBrainResult = {
  handled: boolean;
  summary: string;
  operation: string;
  routineId?: string;
  suggestion?: string;
};

type Args = {
  supabase: any;
  userId: string;
  message: string;
  source: "text" | "voice";
  timezone?: string;
};

const routineWords = /(rotina|todo dia|todos os dias|diariamente|semanalmente|primeira conversa|depois das|a partir das|me pergunte antes|não pergunte|resumo de notícias|notícias do dia|pare de falar|pause a rotina|desative a rotina)/i;

function outputText(data: any) {
  return String(data?.output_text ?? "").trim();
}

async function classify(args: Args, routines: any[]) {
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
      max_output_tokens: 900,
      input: [
        {
          role: "system",
          content: `Extraia comandos de rotina de assistente. Retorne somente JSON válido. Nunca crie rotina apenas porque o usuário comentou repetidamente sobre um tema; nesse caso use operation=signal. Datas em AAAA-MM-DD, horários HH:mm. Fuso: ${args.timezone ?? "America/Sao_Paulo"}. Rotinas existentes: ${JSON.stringify(routines.map((r) => ({ id:r.id,name:r.name,active:r.active,configuration:r.configuration,start_time:r.start_time,end_time:r.end_time,confirmation_mode:r.confirmation_mode })))}. Esquema: {"operation":"none|create|update|pause|resume|delete|feedback|signal|confirm_run|decline_run","targetId":null,"name":null,"startTime":null,"endTime":null,"startsOn":null,"endsOn":null,"daysOfWeek":[0,1,2,3,4,5,6],"confirmationMode":"automatic|ask_first","actionType":"news_briefing|custom_briefing|agenda_briefing|task_briefing","topics":[],"categories":[],"sources":[],"sourcesOnly":false,"maxDurationSeconds":90,"adaptFromMemories":true,"suggestAdjustments":true,"feedbackInterval":3,"feedbackSentiment":"positive|negative|neutral|preference","feedbackMessage":null,"topicSignal":null,"localPeriod":null}`,
        },
        { role: "user", content: args.message },
      ],
    }),
  });
  if (!response.ok) return null;
  try { return JSON.parse(outputText(await response.json())); } catch { return null; }
}

function speechFor(op: any) {
  switch (op.operation) {
    case "create": return `Rotina criada: ${op.name}. ${op.confirmationMode === "ask_first" ? "Vou pedir confirmação antes de executar." : "Ela será executada automaticamente dentro da janela configurada."}`;
    case "update": return "Rotina atualizada com as novas preferências.";
    case "pause": return "Rotina pausada.";
    case "resume": return "Rotina reativada.";
    case "delete": return "Rotina excluída.";
    case "feedback": return "Entendi seu feedback e ajustei a preferência quando você pediu uma mudança permanente.";
    case "confirm_run": return "Confirmação registrada. A rotina pode ser executada agora.";
    case "decline_run": return "Tudo bem. Não vou executar essa rotina nesta oportunidade.";
    default: return "";
  }
}

export async function analyzeAndApplyRoutineMessage(args: Args): Promise<RoutineBrainResult> {
  if (!routineWords.test(args.message)) {
    await recordInterestSignal(args).catch(() => null);
    return { handled: false, summary: "", operation: "none" };
  }
  const { data: routines } = await args.supabase.from("assistant_routines").select("*").eq("user_id", args.userId).order("updated_at", { ascending: false }).limit(30);
  const op = await classify(args, routines ?? []);
  if (!op || op.operation === "none") return { handled: false, summary: "", operation: "none" };

  const base = {
    name: String(op.name || "Rotina do assistente").slice(0,120),
    description: null,
    active: true,
    trigger_type: "conversation_window",
    recurrence_type: "daily",
    timezone: args.timezone ?? "America/Sao_Paulo",
    start_time: op.startTime || "08:00",
    end_time: op.endTime || "23:59",
    starts_on: op.startsOn || null,
    ends_on: op.endsOn || null,
    days_of_week: Array.isArray(op.daysOfWeek) ? op.daysOfWeek : [0,1,2,3,4,5,6],
    max_executions_per_period: 1,
    confirmation_mode: op.confirmationMode === "ask_first" ? "ask_first" : "automatic",
    action_type: op.actionType || "news_briefing",
    adapt_from_memories: op.adaptFromMemories !== false,
    suggest_adjustments: op.suggestAdjustments !== false,
    feedback_interval: Math.max(1, Math.min(30, Number(op.feedbackInterval) || 3)),
    configuration: {
      topics: op.topics ?? [], categories: op.categories ?? [],
      sources: (op.sources ?? []).map((value:string) => ({ type:"domain", value })),
      sourcesOnly: Boolean(op.sourcesOnly), maxDurationSeconds: Number(op.maxDurationSeconds) || 90,
      delivery: args.source === "voice" ? "voice" : "both",
    },
    created_via: args.source === "voice" ? "voice" : "conversation",
  };

  if (op.operation === "create") {
    const { data, error } = await args.supabase.from("assistant_routines").insert({ ...base, user_id: args.userId }).select("id").single();
    if (error) throw error;
    return { handled:true, operation:"create", routineId:data.id, summary:speechFor(op) };
  }
  if (["update","pause","resume","delete"].includes(op.operation) && op.targetId) {
    if (op.operation === "delete") await args.supabase.from("assistant_routines").delete().eq("id", op.targetId).eq("user_id", args.userId);
    else if (op.operation === "pause" || op.operation === "resume") await args.supabase.from("assistant_routines").update({ active: op.operation === "resume" }).eq("id", op.targetId).eq("user_id", args.userId);
    else await args.supabase.from("assistant_routines").update(base).eq("id", op.targetId).eq("user_id", args.userId);
    return { handled:true, operation:op.operation, routineId:op.targetId, summary:speechFor(op) };
  }
  if (op.operation === "feedback") {
    await args.supabase.from("assistant_routine_feedback").insert({ routine_id: op.targetId, user_id: args.userId, sentiment: op.feedbackSentiment || "preference", message: op.feedbackMessage || args.message, adjustments: { topics:op.topics, categories:op.categories, maxDurationSeconds:op.maxDurationSeconds }, applied:Boolean(op.targetId) });
    if (op.targetId && (op.topics?.length || op.categories?.length || op.maxDurationSeconds)) {
      const target = (routines ?? []).find((r:any) => r.id === op.targetId);
      await args.supabase.from("assistant_routines").update({ configuration: { ...(target?.configuration ?? {}), ...(op.topics?.length ? {topics:op.topics}:{}), ...(op.categories?.length ? {categories:op.categories}:{}), ...(op.maxDurationSeconds ? {maxDurationSeconds:op.maxDurationSeconds}:{}) } }).eq("id",op.targetId).eq("user_id",args.userId);
    }
    return { handled:true, operation:"feedback", routineId:op.targetId, summary:speechFor(op) };
  }
  return { handled:false, summary:"", operation:op.operation };
}

export async function recordInterestSignal(args: Args) {
  const clean = args.message.trim();
  if (clean.length < 15 || clean.length > 400) return;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return;
  const response = await fetch("https://api.openai.com/v1/responses", { method:"POST", headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"}, body:JSON.stringify({ model:AI_MODELS.text, store:false, max_output_tokens:120, input:`Extraia somente o assunto principal desta fala, em até 5 palavras, ou retorne vazio se não houver interesse temático recorrente útil: ${clean}` }) });
  if (!response.ok) return;
  const topic = outputText(await response.json()).replace(/[\"\n]/g,"").trim();
  if (!topic) return;
  const period = new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening";
  const signalKey = `${topic.toLowerCase()}:${period}`.slice(0,180);
  const { data: existing } = await args.supabase.from("assistant_routine_signals").select("id,occurrences").eq("user_id",args.userId).eq("signal_key",signalKey).maybeSingle();
  if (existing) await args.supabase.from("assistant_routine_signals").update({ occurrences:existing.occurrences+1,last_seen_at:new Date().toISOString() }).eq("id",existing.id);
  else await args.supabase.from("assistant_routine_signals").insert({ user_id:args.userId, signal_key:signalKey, topic, local_period:period });
}

export function formatRoutineBrainResult(result: RoutineBrainResult) {
  return result.handled ? `Operação estruturada de rotina concluída: ${result.summary}` : "Nenhuma alteração estruturada de rotina foi realizada nesta mensagem.";
}
