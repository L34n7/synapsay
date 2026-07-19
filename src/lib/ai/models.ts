/**
 * Catálogo único dos modelos usados pela Synapsay.
 *
 * Comunicadoras: respondem diretamente ao usuário.
 * Cérebro de memória: analisa fatos e organiza memórias em segundo plano.
 */
function configuredModel(variable: string | undefined, fallback: string) {
  const value = variable?.trim();
  if (!value) return fallback;

  // Corrige o erro de digitação que chegou à produção sem bloquear modelos
  // oficiais. Ex.: "pt-5.6-luna" deve ser "gpt-5.6-luna".
  if (value.startsWith("pt-")) return `g${value}`;

  return value;
}

function configuredMemoryModel(variable: string | undefined, fallback: string) {
  const value = variable?.trim();
  // Migra automaticamente a configuração anterior, que usava Luna
  // para classificadores e rotinas de segundo plano.
  if (!value || value === "gpt-5.6-luna") return fallback;
  return configuredModel(value, fallback);
}

export const AI_MODELS = {
  voice: configuredModel(process.env.OPENAI_REALTIME_MODEL, "gpt-realtime-mini"),
  text: configuredModel(process.env.OPENAI_TEXT_MODEL, "gpt-5.6-luna"),
  memoryBrain: configuredMemoryModel(
    process.env.OPENAI_MEMORY_MODEL,
    "gpt-5.4-nano",
  ),
  memoryConflict: configuredMemoryModel(
    process.env.OPENAI_MEMORY_CONFLICT_MODEL,
    "gpt-5.4-nano",
  ),
  embedding: configuredModel(
    process.env.OPENAI_EMBEDDING_MODEL,
    "text-embedding-3-small",
  ),
} as const;
