import type { AssistantRoutine, RoutineOpportunity } from "./types";

type SupabaseLike = { from: (table: string) => any };

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23", weekday: "short",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayMap: Record<string, number> = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  return { date:`${map.year}-${map.month}-${map.day}`, time:`${map.hour}:${map.minute}:${map.second}`, weekday:weekdayMap[map.weekday] ?? 0 };
}

function referenceKey(routine: AssistantRoutine, now: Date) {
  const local = zonedParts(now, routine.timezone);
  if (routine.recurrence_type === "once") return `once:${routine.id}`;
  if (routine.recurrence_type === "weekly") {
    const d = new Date(`${local.date}T12:00:00Z`);
    const thursday = new Date(d);
    thursday.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${thursday.getUTCFullYear()}-W${String(week).padStart(2,"0")}`;
  }
  return local.date;
}

function withinWindow(routine: AssistantRoutine, now: Date) {
  const local = zonedParts(now, routine.timezone);
  if (routine.starts_on && local.date < routine.starts_on) return false;
  if (routine.ends_on && local.date > routine.ends_on) return false;
  if (!routine.days_of_week.includes(local.weekday)) return false;
  if (["location_detected","calendar_event_finished"].includes(routine.trigger_type)) return false;
  const current = local.time.slice(0,5);
  const start = routine.start_time?.slice(0,5) ?? "00:00";
  const end = routine.end_time?.slice(0,5) ?? "23:59";
  return current >= start && current <= end;
}

function expirationFor(routine: AssistantRoutine, now: Date) {
  if (!routine.end_time) return null;
  const local = zonedParts(now, routine.timezone);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone:routine.timezone, timeZoneName:"longOffset" })
    .formatToParts(now).find((part) => part.type === "timeZoneName")?.value ?? "GMT-03:00";
  return new Date(`${local.date}T${routine.end_time.slice(0,8)}${offset.replace("GMT","")}`).toISOString();
}

export async function claimRoutineOpportunities({ supabase,userId,conversationId,now=new Date() }:{ supabase:SupabaseLike; userId:string; conversationId?:string|null; now?:Date }):Promise<RoutineOpportunity[]> {
  const { data,error } = await supabase.from("assistant_routines").select("*").eq("user_id",userId).eq("active",true).order("created_at",{ascending:true});
  if (error) throw error;
  const opportunities:RoutineOpportunity[]=[];
  for (const routine of (data ?? []) as AssistantRoutine[]) {
    if (!withinWindow(routine,now)) continue;
    const key=referenceKey(routine,now);
    const status=routine.confirmation_mode === "ask_first" ? "awaiting_confirmation" : "processing";
    const { data:run,error:claimError } = await supabase.from("assistant_routine_runs").insert({
      routine_id:routine.id,user_id:userId,reference_key:key,conversation_id:conversationId ?? null,status,
      offered_at:now.toISOString(),started_at:status === "processing" ? now.toISOString() : null,expires_at:expirationFor(routine,now),
    }).select("id").maybeSingle();
    if (claimError && claimError.code !== "23505") throw claimError;
    if (!run) continue;
    const interval=Math.max(1,routine.feedback_interval || 3);
    opportunities.push({
      routine, referenceKey:key, expiresAt:expirationFor(routine,now),
      requiresConfirmation:routine.confirmation_mode === "ask_first",
      shouldAskFeedback:Boolean(routine.suggest_adjustments && routine.execution_count > 0 && routine.execution_count % interval === 0),
    });
  }
  return opportunities;
}

export function formatRoutineOpening(opportunities:RoutineOpportunity[]) {
  if (!opportunities.length) return "";
  return opportunities.map(({routine,referenceKey,requiresConfirmation,shouldAskFeedback}) => {
    const config=routine.configuration ?? {};
    const topics=[...(config.categories ?? []),...(config.topics ?? [])].join(", ");
    const sources=(config.sources ?? []).map((source) => source.label || source.value).join(", ");
    const feedback=shouldAskFeedback ? " Ao terminar, pergunte brevemente se o formato está bom ou se deseja mudar duração, assuntos ou fontes." : "";
    const execution=`routineId=${routine.id}; referenceKey=${referenceKey}`;
    if (requiresConfirmation) return `Existe uma rotina disponível chamada "${routine.name}" (${execution}). Pergunte de forma breve se o usuário quer executá-la agora. Se ele responder, chame manage_tasks enviando a resposta completa; o cérebro unificado localizará a rotina pendente, confirmará, recusará ou desativará conforme a fala. Não execute antes da confirmação.${feedback}`;
    return `Execute agora a rotina "${routine.name}" chamando manage_tasks com a mensagem exata "EXECUTAR_ROTINA ${execution}". Depois leia integralmente o conteúdo devolvido pela ferramenta. Tipo: ${routine.action_type}. ${topics ? `Assuntos: ${topics}.` : ""} ${sources ? `Fontes: ${sources}.` : ""} ${config.sourcesOnly ? "Use somente as fontes configuradas." : "Fontes configuradas são preferenciais."} ${config.prompt ?? ""}${feedback}`;
  }).join("\n");
}

export async function findRoutineSuggestion(supabase:SupabaseLike,userId:string) {
  const { data } = await supabase.from("assistant_routine_signals").select("*").eq("user_id",userId).is("dismissed_at",null).is("converted_routine_id",null).is("suggested_at",null).gte("occurrences",4).order("occurrences",{ascending:false}).limit(1).maybeSingle();
  if (!data) return null;
  await supabase.from("assistant_routine_signals").update({ suggested_at:new Date().toISOString() }).eq("id",data.id).eq("user_id",userId);
  const period=data.local_period === "morning" ? "pela manhã" : data.local_period === "afternoon" ? "à tarde" : "à noite";
  return `Você costuma conversar sobre ${data.topic} ${period}. Pergunte, sem criar automaticamente, se o usuário gostaria de transformar esse padrão em uma rotina. Se ele aceitar, chame manage_tasks enviando a fala completa.`;
}
