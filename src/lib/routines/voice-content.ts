export type RoutineSourceLink = {
  title?: string;
  url?: string;
};

/** Remove links do conteúdo enviado ao modelo de voz sem alterar o texto salvo. */
export function routineContentForVoice(content: string) {
  return content
    // Citações parentéticas produzidas pela busca web não fazem parte da fala.
    .replace(/\s*\(\s*\[[^\]]+\]\(https?:\/\/[^)]+\)\s*\)/gi, "")
    // Se o link fizer parte da frase, preserva somente o rótulo legível.
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gi, "$1")
    // Em link cru, troca o endereço completo somente pelo nome do site.
    .replace(/https?:\/\/[^\s<>)\]]+/gi, (url) => {
      try {
        return new URL(url).hostname.replace(/^www\./, "");
      } catch {
        return "";
      }
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function routineSourcesForHistory(sources: unknown) {
  if (!Array.isArray(sources)) return [];
  const unique = new Map<string, { title: string; url: string }>();
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const value = source as RoutineSourceLink;
    if (typeof value.url !== "string" || !value.url.startsWith("http")) continue;
    if (!unique.has(value.url)) {
      unique.set(value.url, {
        title:
          typeof value.title === "string" && value.title.trim()
            ? value.title.trim()
            : value.url,
        url: value.url,
      });
    }
  }
  return [...unique.values()].slice(0, 12);
}

export function routineSourcesFromContent(content: string) {
  const sources: RoutineSourceLink[] = [];
  const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi;
  for (const match of content.matchAll(markdownLinkPattern)) {
    sources.push({ title: match[1], url: match[2] });
  }

  const rawUrlPattern = /https?:\/\/[^\s<>)\]]+/gi;
  for (const match of content.matchAll(rawUrlPattern)) {
    const url = match[0];
    let title = url;
    try {
      title = new URL(url).hostname.replace(/^www\./, "");
    } catch {}
    sources.push({ title, url });
  }

  return routineSourcesForHistory(sources);
}

export function appendRoutineSourcesToHistory(
  content: string,
  sources: RoutineSourceLink[],
) {
  const normalized = routineSourcesForHistory(sources);
  if (!normalized.length) return content;
  return `${content.trim()}\n\nFontes:\n${normalized
    .map((source) => `- [${source.title}](${source.url})`)
    .join("\n")}`;
}
