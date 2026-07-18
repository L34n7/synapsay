/**
 * Catálogo único dos modelos usados pela Synapsay.
 *
 * Comunicadoras: respondem diretamente ao usuário.
 * Cérebro de memória: analisa fatos e organiza memórias em segundo plano.
 */
function configuredModel(variable: string | undefined, fallback: string) {
  const value = variable?.trim();

  // Impede que nomes internos, experimentais ou digitados incorretamente
  // derrubem os fluxos críticos do assistente em produção.
  if (!value || value.startsWith("pt-") || value.toLowerCase().includes("luna")) {
    return fallback;
  }

  return value;
}

export const AI_MODELS = {
  voice: configuredModel(process.env.OPENAI_REALTIME_MODEL, "gpt-realtime-mini"),
  text: configuredModel(process.env.OPENAI_TEXT_MODEL, "gpt-5-mini"),
  memoryBrain: configuredModel(process.env.OPENAI_MEMORY_MODEL, "gpt-5-mini"),
  memoryConflict: configuredModel(
    process.env.OPENAI_MEMORY_CONFLICT_MODEL,
    "gpt-5-mini",
  ),
  embedding: configuredModel(
    process.env.OPENAI_EMBEDDING_MODEL,
    "text-embedding-3-small",
  ),
} as const;
