import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function PersonalityLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims?.sub) redirect("/?erro=sessao_expirada");
  return children;
}
