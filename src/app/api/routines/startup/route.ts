import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { claimRoutineOpportunities, findRoutineSuggestion, formatRoutineOpening } from "@/lib/routines/engine";

export async function POST(request:Request){
  const supabase=await createClient();
  const{data:authData}=await supabase.auth.getClaims();
  const userId=authData?.claims?.sub?String(authData.claims.sub):null;
  if(!userId)return NextResponse.json({error:"Não autorizado."},{status:401});
  const body=await request.json().catch(()=>({}));
  const conversationId=typeof body?.conversationId==="string"?body.conversationId:null;
  try{
    const[opportunities,suggestion]=await Promise.all([
      claimRoutineOpportunities({supabase,userId,conversationId}),
      findRoutineSuggestion(supabase,userId),
    ]);
    const openingInstruction=[formatRoutineOpening(opportunities),suggestion].filter(Boolean).join("\n");
    return NextResponse.json({opportunities,suggestion,openingInstruction});
  }catch(reason){
    console.error("Falha ao avaliar rotinas:",reason);
    return NextResponse.json({error:"Não foi possível avaliar as rotinas agora."},{status:500});
  }
}
