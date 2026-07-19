import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { executeRoutine } from "@/lib/routines/executor";

export const runtime="nodejs";
export const maxDuration=120;

export async function POST(request:Request){
  const supabase=await createClient();
  const{data:authData}=await supabase.auth.getClaims();
  const userId=authData?.claims?.sub?String(authData.claims.sub):null;
  if(!userId)return NextResponse.json({error:"Não autorizado."},{status:401});
  const body=await request.json().catch(()=>({}));
  const routineId=String(body?.routineId??"");
  const referenceKey=String(body?.referenceKey??"");
  const decision=body?.decision;
  if(!routineId||!referenceKey||!["confirm","decline","disable"].includes(decision))return NextResponse.json({error:"Confirmação inválida."},{status:400});
  const{data:run}=await supabase.from("assistant_routine_runs").select("id,status,expires_at").eq("routine_id",routineId).eq("reference_key",referenceKey).eq("user_id",userId).maybeSingle();
  if(!run)return NextResponse.json({error:"Oportunidade não encontrada."},{status:404});
  if(run.status!=="awaiting_confirmation")return NextResponse.json({error:"Esta oportunidade não aguarda confirmação."},{status:409});
  if(run.expires_at&&new Date(run.expires_at).getTime()<Date.now())return NextResponse.json({error:"Esta oportunidade expirou."},{status:410});
  if(decision==="disable"){
    await supabase.from("assistant_routines").update({active:false}).eq("id",routineId).eq("user_id",userId);
    await supabase.from("assistant_routine_runs").update({status:"declined"}).eq("id",run.id);
    return NextResponse.json({status:"disabled"});
  }
  if(decision==="decline"){
    await supabase.from("assistant_routine_runs").update({status:"declined"}).eq("id",run.id).eq("user_id",userId);
    return NextResponse.json({status:"declined"});
  }
  await supabase.from("assistant_routine_runs").update({status:"available",confirmed_at:new Date().toISOString()}).eq("id",run.id).eq("user_id",userId);
  try{return NextResponse.json({status:"completed",...(await executeRoutine({supabase,userId,routineId,referenceKey}))});}
  catch(reason){return NextResponse.json({error:reason instanceof Error?reason.message:"Não foi possível executar a rotina."},{status:500});}
}
