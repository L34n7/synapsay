import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { RoutineActionType, RoutineConfirmationMode, RoutineRecurrence, RoutineTriggerType } from "@/lib/routines/types";

const TRIGGERS:RoutineTriggerType[]=["conversation_window","fixed_time","calendar_event_finished","location_detected"];
const RECURRENCES:RoutineRecurrence[]=["daily","weekly","once"];
const CONFIRMATIONS:RoutineConfirmationMode[]=["automatic","ask_first"];
const ACTIONS:RoutineActionType[]=["news_briefing","custom_briefing","agenda_briefing","task_briefing"];

function validTime(value:unknown){return value==null||(typeof value==="string"&&/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value));}
function validDate(value:unknown){return value==null||(typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value));}

function sanitize(body:any){
  if(!body||typeof body!=="object")throw new Error("Dados inválidos.");
  const name=String(body.name??"").trim();
  if(!name||name.length>120)throw new Error("Informe um nome válido.");
  if(!TRIGGERS.includes(body.trigger_type))throw new Error("Gatilho inválido.");
  if(!RECURRENCES.includes(body.recurrence_type))throw new Error("Recorrência inválida.");
  if(!CONFIRMATIONS.includes(body.confirmation_mode))throw new Error("Confirmação inválida.");
  if(!ACTIONS.includes(body.action_type))throw new Error("Ação inválida.");
  if(!validTime(body.start_time)||!validTime(body.end_time))throw new Error("Horário inválido.");
  if(!validDate(body.starts_on)||!validDate(body.ends_on))throw new Error("Data inválida.");
  if(body.starts_on&&body.ends_on&&body.ends_on<body.starts_on)throw new Error("A data final não pode ser anterior à inicial.");
  const days=Array.isArray(body.days_of_week)?body.days_of_week.map(Number):[0,1,2,3,4,5,6];
  if(days.some((day:number)=>!Number.isInteger(day)||day<0||day>6))throw new Error("Dias da semana inválidos.");
  return{
    name,
    description:body.description?String(body.description).slice(0,500):null,
    active:body.active!==false,
    trigger_type:body.trigger_type,
    recurrence_type:body.recurrence_type,
    timezone:typeof body.timezone==="string"&&body.timezone?body.timezone:"America/Sao_Paulo",
    start_time:body.start_time||null,
    end_time:body.end_time||null,
    starts_on:body.starts_on||null,
    ends_on:body.ends_on||null,
    days_of_week:days,
    max_executions_per_period:Math.max(1,Math.min(10,Number(body.max_executions_per_period)||1)),
    confirmation_mode:body.confirmation_mode,
    action_type:body.action_type,
    configuration:typeof body.configuration==="object"&&body.configuration?body.configuration:{},
    adapt_from_memories:body.adapt_from_memories!==false,
    suggest_adjustments:body.suggest_adjustments!==false,
    feedback_interval:Math.max(1,Math.min(30,Number(body.feedback_interval)||3)),
    created_via:body.created_via==="voice"||body.created_via==="conversation"?body.created_via:"page",
  };
}

async function auth(){const supabase=await createClient();const{data}=await supabase.auth.getClaims();const userId=data?.claims?.sub?String(data.claims.sub):null;return{supabase,userId};}

export async function GET(){
  const{supabase,userId}=await auth();
  if(!userId)return NextResponse.json({error:"Não autorizado."},{status:401});
  const{data,error}=await supabase.from("assistant_routines").select("*").eq("user_id",userId).order("created_at",{ascending:false});
  if(error)return NextResponse.json({error:error.message},{status:500});
  return NextResponse.json({routines:data??[]});
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
