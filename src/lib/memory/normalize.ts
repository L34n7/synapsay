import { createHash } from "node:crypto";

export const MEMORY_CATEGORIES = [
  "preference",
  "personal",
  "goal",
  "project",
  "relationship",
  "routine",
  "commitment",
  "health",
  "work",
  "general",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
export type MemoryType = "permanent" | "temporary";

export function normalizeMemoryText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function createMemoryDedupeKey(category: string, content: string) {
  return createHash("sha256")
    .update(`${normalizeMemoryText(category)}:${normalizeMemoryText(content)}`)
    .digest("hex");
}

