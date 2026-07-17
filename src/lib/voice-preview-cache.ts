import { createHash } from "node:crypto";

export function voicePreviewCacheKey(userId: string, displayName: unknown) {
  const name = typeof displayName === "string" ? displayName.trim() : "";
  return createHash("sha256")
    .update(`voice-preview-v1:${userId}:${name}`)
    .digest("hex")
    .slice(0, 24);
}
