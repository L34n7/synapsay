import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { RoutineActionType, RoutineConfirmationMode, RoutineRecurrence, RoutineTriggerType } from "@/lib/routines/types";
import { validRoutineTimeZone } from "@/lib/routines/engine";

const TRIGGERS:RoutineTriggerType[]=["conversation_window","fixed_time","calendar_event_finished","location_detected"];
const RECURRENCES:RoutineRecurrence[]=["daily","weekly","once"];
const CONFIRMATIONS:RoutineConfirmationMode[]=["automatic","ask_first"];
const ACTIONS:RoutineActionType[]=["news_briefing","custom_briefing","agenda_briefing","task_briefing"];

function validTime(value:unknown){return value==null||(typeof value==="string"&&/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value));}
function validDate(value:unknown){return value==null||(typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value));}

function sanitize(body:unknown){
  if(!body||typeof body!=="object")throw new Error("Dados inválidos.");
  const value=body as Record<string,unknown>;
  const name=String(value.name??"").trim();
  if(!name||name.length>120)throw new Error("Informe um nome válido.");
  if(!TRIGGERS.includes(value.trigger_type as RoutineTriggerType))throw new Error("Gatilho inválido.");
  if(!RECURRENCES.includes(value.recurrence_type as RoutineRecurrence))throw new Error("Recorrência inválida.");
  if(!CONFIRMATIONS.includes(value.confirmation_mode as RoutineConfirmationMode))throw new Error("Confirmação inválida.");
  if(!ACTIONS.includes(value.action_type as RoutineActionType))throw new Error("Ação inválida.");
  if(!validTime(value.start_time)||!validTime(value.end_time))throw new Error("Horário inválido.");
  if(!validDate(value.starts_on)||!validDate(value.ends_on))throw new Error("Data inválida.");
  if(typeof value.starts_on==="string"&&typeof value.ends_on==="string"&&value.ends_on<value.starts_on)throw new Error("A data final não pode ser anterior à inicial.");
  const days=Array.isArray(value.days_of_week)?value.days_of_week.map(Number):[0,1,2,3,4,5,6];
  if(days.some((day:number)=>!Number.isInteger(day)||day<0||day>6))throw new Error("Dias da semana inválidos.");
  return{
    name,
    description:value.description?String(value.description).slice(0,500):null,
    active:value.active!==false,
    trigger_type:value.trigger_type,
    recurrence_type:value.recurrence_type,
    timezone:validRoutineTimeZone(typeof value.timezone==="string"?value.timezone:null),
    start_time:value.start_time||null,
    end_time:value.end_time||null,
    starts_on:value.starts_on||null,
    ends_on:value.ends_on||null,
    days_of_week:days,
    max_executions_per_period:Math.max(1,Math.min(10,Number(value.max_executions_per_period)||1)),
    confirmation_mode:value.confirmation_mode,
    action_type:value.action_type,
    configuration:typeof value.configuration==="object"&&value.configuration?value.configuration:{},
    adapt_from_memories:value.adapt_from_memories!==false,
    suggest_adjustments:value.suggest_adjustments!==false,
    feedback_interval:Math.max(1,Math.min(30,Number(value.feedback_interval)||3)),
    created_via:value.created_via==="voice"||value.created_via==="conversation"?value.created_via:"page",
  };
}

async function auth(){const supabase=await createClient();const{data}=await supabase.auth.getClaims();const userId=data?.claims?.sub?String(data.claims.sub):null;return{supabase,userId};}

export async function GET(){
  const{supabase,userId}=await auth();
  if(!userId)return NextResponse.json({error:"Não autorizado."},{status:401});
  const{data,error}=await supabase.from("assistant_routines").select("*").eq("user_id",userId).order("created_at",{ascending:false});
  if(error)return NextResponse.json({error:error.message},{status:500});
  const{data:runs,error:runsError}=await supabase
    .from("assistant_routine_runs")
    .select("routine_id,status,completed_at,created_at,result,error_message,is_test")
    .eq("user_id",userId)
    .eq("is_test",false)
    .order("created_at",{ascending:false})
    .limit(300);
  if(runsError&&!["42703","PGRST204"].includes(runsError.code??"")){
    return NextResponse.json({error:runsError.message},{status:500});
  }
  const latestByRoutine=new Map<string,unknown>();
  for(const run of runs??[]){if(!latestByRoutine.has(run.routine_id))latestByRoutine.set(run.routine_id,run);}
  return NextResponse.json({
    routines:(data??[]).map((routine)=>({
      ...routine,
      latest_run:latestByRoutine.get(routine.id)??null,
    })),
  });
}

export async function POST(request:Request){
  const{supabase,userId}=await auth();
  if(!userId)return NextResponse.json({error:"Não autorizado."},{status:401});
  try{const payload=sanitize(await request.json());const{data,error}=await supabase.from("assistant_routines").insert({...payload,user_id:userId}).select("*").single();if(error)throw error;return NextResponse.json({routine:data},{status:201});}
  catch(reason){return NextResponse.json({error:reason instanceof Error?reason.message:"Não foi possível criar a rotina."},{status:400});}
}

export async function PATCH(request:Request){
  const{supabase,userId}=await auth();
  if(!userId)return NextResponse.json({error:"Não autorizado."},{status:401});
  try{const body=await request.json();const id=String(body.id??"");const payload=sanitize(body);const{data,error}=await supabase.from("assistant_routines").update(payload).eq("id",id).eq("user_id",userId).select("*").single();if(error)throw error;return NextResponse.json({routine:data});}
  catch(reason){return NextResponse.json({error:reason instanceof Error?reason.message:"Não foi possível atualizar a rotina."},{status:400});}
}

export async function DELETE(request:Request){
  const{supabase,userId}=await auth();
  if(!userId)return NextResponse.json({error:"Não autorizado."},{status:401});
  const id=new URL(request.url).searchParams.get("id");
  if(!id)return NextResponse.json({error:"Rotina inválida."},{status:400});
  const{error}=await supabase.from("assistant_routines").delete().eq("id",id).eq("user_id",userId);
  if(error)return NextResponse.json({error:error.message},{status:500});
  return NextResponse.json({success:true});
}
