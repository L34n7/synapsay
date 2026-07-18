const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BuildRoutineContextArgs = {
  supabase: any;
  userId: string;
  conversationId?: string | null;
  currentMessage: string;
  sourceMessageId?: string | null;
};

/**
 * Reúne somente as falas recentes do usuário para completar pedidos de rotina
 * divididos em várias mensagens. A fala atual sempre prevalece sobre o contexto.
 */
export async function buildRoutineConversationContext({
  supabase,
  userId,
  conversationId,
  currentMessage,
  sourceMessageId,
}: BuildRoutineContextArgs) {
  const normalizedCurrent = currentMessage.trim();
  if (!conversationId || !UUID_PATTERN.test(conversationId)) return normalizedCurrent;

  const since = new Date(Date.now() - 20 * 60_000).toISOString();
  let query = supabase
    .from("messages")
    .select("id,content,created_at")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .eq("role", "user")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(8);

  if (sourceMessageId && UUID_PATTERN.test(sourceMessageId)) {
    query = query.neq("id", sourceMessageId);
  }

  const { data, error } = await query;
  if (error || !data?.length) return normalizedCurrent;

  const previousMessages = [...data]
    .reverse()
    .map((item) => String(item.content ?? "").trim())
    .filter(Boolean)
    .filter((content) => content !== normalizedCurrent)
    .slice(-7);

  if (!previousMessages.length) return normalizedCurrent;

  return [
    "Use as falas recentes abaixo apenas para completar dados omitidos do pedido atual.",
    "A mensagem marcada como PEDIDO ATUAL tem prioridade e pode corrigir qualquer informação anterior.",
    "Não use respostas do assistente como requisitos e nunca peça ID técnico para criar uma nova rotina.",
    "FALAS RECENTES DO USUÁRIO:",
    ...previousMessages.map((content, index) => `${index + 1}. ${content}`),
    `PEDIDO ATUAL: ${normalizedCurrent}`,
  ].join("\n");
}
