import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { analyzeAndApplyRoutineMessage } from "@/lib/routines/brain";

export async function POST(request:Request){
  const supabase=await createClient();
  const{data:authData}=await supabase.auth.getClaims();
  const userId=authData?.claims?.sub?String(authData.claims.sub):null;
  if(!userId)return NextResponse.json({error:"Não autorizado."},{status:401});
  const body=await request.json().catch(()=>({}));
  const message=typeof body?.message==="string"?body.message.trim():"";
  const source=body?.source==="voice"?"voice":"text";
  if(!message)return NextResponse.json({error:"Mensagem obrigatória."},{status:400});
  const{data:profile}=await supabase.from("profiles").select("timezone").eq("id",userId).maybeSingle();
  try{
    const result=await analyzeAndApplyRoutineMessage({supabase,userId,message,source,timezone:profile?.timezone||"America/Sao_Paulo"});
    return NextResponse.json(result);
  }catch(reason){
    console.error("Falha no cérebro de rotinas:",reason);
    return NextResponse.json({error:"Não foi possível aplicar a rotina agora."},{status:500});
  }
}
