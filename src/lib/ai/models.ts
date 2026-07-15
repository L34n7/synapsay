/**
 * Catálogo único dos modelos usados pela Synapsay.
 *
 * Comunicadoras: respondem diretamente ao usuário.
 * Cérebro de memória: analisa fatos e organiza memórias em segundo plano.
 */
export const AI_MODELS = {
  voice: process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1-mini",
  text: process.env.OPENAI_TEXT_MODEL ?? "gpt-5.6-luna",
  memoryBrain: process.env.OPENAI_MEMORY_MODEL ?? "gpt-5.6-luna",
  memoryConflict:
    process.env.OPENAI_MEMORY_CONFLICT_MODEL ?? "gpt-5.6-luna",
  embedding:
    process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
} as const;
