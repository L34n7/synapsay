type ResponseContentItem = {
  type?: unknown;
  text?: unknown;
};

type ResponseOutputItem = {
  content?: unknown;
};

/**
 * Extrai texto tanto do helper `output_text` dos SDKs quanto do formato REST
 * canônico da Responses API (`output[].content[]`).
 */
export function responseOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";

  const response = payload as {
    output_text?: unknown;
    output?: unknown;
  };
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  if (!Array.isArray(response.output)) return "";

  return response.output
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = (item as ResponseOutputItem).content;
      return Array.isArray(content) ? content : [];
    })
    .filter(
      (item): item is ResponseContentItem =>
        Boolean(
          item &&
            typeof item === "object" &&
            (item as ResponseContentItem).type === "output_text" &&
            typeof (item as ResponseContentItem).text === "string",
        ),
    )
    .map((item) => String(item.text))
    .join("")
    .trim();
}

export function responseDiagnostic(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return { responseId: null, status: null, incompleteReason: null, outputTypes: [] };
  }

  const response = payload as {
    id?: unknown;
    status?: unknown;
    incomplete_details?: { reason?: unknown } | null;
    output?: unknown;
  };
  return {
    responseId: typeof response.id === "string" ? response.id : null,
    status: typeof response.status === "string" ? response.status : null,
    incompleteReason:
      typeof response.incomplete_details?.reason === "string"
        ? response.incomplete_details.reason
        : null,
    outputTypes: Array.isArray(response.output)
      ? response.output
          .map((item) =>
            item && typeof item === "object" && typeof (item as { type?: unknown }).type === "string"
              ? String((item as { type: string }).type)
              : "unknown",
          )
          .slice(0, 20)
      : [],
  };
}
