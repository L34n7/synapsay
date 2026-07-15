"use client";

import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import styles from "./dashboard.module.css";

type GenerationStatus = "streaming" | "completed" | "interrupted" | "error";

type ChatMessage = {
  id: string;
  serverId?: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  generationStatus: GenerationStatus;
  errorMessage?: string | null;
  clientMessageId?: string;
};

type StreamEvent = {
  type?: "start" | "delta" | "done" | "error";
  delta?: string;
  status?: GenerationStatus;
  message?: string;
  assistantId?: string;
  userMessageId?: string | null;
};

function getClientMessageId(message: {
  external_event_id?: string | null;
  metadata?: unknown;
}) {
  if (message.metadata && typeof message.metadata === "object") {
    const value = (message.metadata as { client_message_id?: unknown })
      .client_message_id;
    if (typeof value === "string") return value;
  }
  if (message.external_event_id?.startsWith("text:")) {
    return message.external_event_id.slice(5);
  }
  return undefined;
}

export default function TextChat({
  conversationId,
  ensureConversation,
  finalizing,
  onFinalize,
}: {
  conversationId: string | null;
  ensureConversation: (channel?: "voice" | "text") => Promise<string>;
  finalizing: boolean;
  onFinalize: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const loadedConversationRef = useRef<string | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const loadMessages = useCallback(async (id: string) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/conversations/${id}/messages?limit=100`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Não foi possível carregar as mensagens.");
      }
      const loaded = (data.messages ?? [])
        .filter((message: { role?: string }) =>
          ["user", "assistant"].includes(message.role ?? ""),
        )
        .map(
          (message: {
            id: string;
            role: "user" | "assistant";
            content: string;
            created_at: string;
            generation_status?: GenerationStatus;
            error_message?: string | null;
            external_event_id?: string | null;
            metadata?: unknown;
          }): ChatMessage => ({
            id: message.id,
            serverId: message.id,
            role: message.role,
            content: message.content,
            createdAt: message.created_at,
            generationStatus: message.generation_status ?? "completed",
            errorMessage: message.error_message,
            clientMessageId: getClientMessageId(message),
          }),
        );
      setMessages(loaded);
      loadedConversationRef.current = id;
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Falha ao carregar mensagens.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!conversationId || loadedConversationRef.current === conversationId) return;
    const timer = window.setTimeout(() => void loadMessages(conversationId), 0);
    return () => window.clearTimeout(timer);
  }, [conversationId, loadMessages]);

  useEffect(() => {
    viewportRef.current?.scrollTo({
      top: viewportRef.current.scrollHeight,
      behavior: activeAssistantId ? "auto" : "smooth",
    });
  }, [activeAssistantId, messages]);

  const runGeneration = useCallback(
    async ({
      activeConversationId,
      content,
      clientMessageId,
      assistantLocalId,
    }: {
      activeConversationId: string;
      content: string;
      clientMessageId: string;
      assistantLocalId: string;
    }) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setActiveAssistantId(assistantLocalId);
      setError("");

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            conversationId: activeConversationId,
            content,
            clientMessageId,
          }),
        });

        if (!response.ok || !response.body) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error ?? "Não foi possível gerar a resposta.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const applyEvent = (event: StreamEvent) => {
          if (event.type === "start") {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantLocalId
                  ? { ...message, serverId: event.assistantId }
                  : message,
              ),
            );
          }
          if (event.type === "delta" && event.delta) {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantLocalId
                  ? { ...message, content: message.content + event.delta }
                  : message,
              ),
            );
          }
          if (event.type === "done") {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantLocalId
                  ? {
                      ...message,
                      generationStatus: event.status ?? "completed",
                      errorMessage:
                        event.status === "interrupted"
                          ? "A resposta foi interrompida antes de terminar."
                          : null,
                    }
                  : message,
              ),
            );
          }
          if (event.type === "error") {
            throw new Error(event.message ?? "A resposta falhou.");
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            applyEvent(JSON.parse(line) as StreamEvent);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) applyEvent(JSON.parse(buffer) as StreamEvent);
      } catch (reason) {
        const interrupted =
          reason instanceof DOMException && reason.name === "AbortError";
        const detail =
          interrupted
            ? "Resposta interrompida por você."
            : reason instanceof Error
              ? reason.message
              : "Não foi possível gerar a resposta.";
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantLocalId
              ? {
                  ...message,
                  content: message.content || (interrupted ? "Resposta interrompida." : ""),
                  generationStatus: interrupted ? "interrupted" : "error",
                  errorMessage: detail,
                }
              : message,
          ),
        );
      } finally {
        abortRef.current = null;
        setActiveAssistantId(null);
      }
    },
    [],
  );

  async function sendMessage() {
    const content = input.trim();
    if (!content || activeAssistantId) return;

    let activeConversationId: string;
    try {
      activeConversationId = await ensureConversation("text");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Falha ao iniciar conversa.",
      );
      return;
    }
    loadedConversationRef.current = activeConversationId;
    const clientMessageId = crypto.randomUUID();
    const assistantLocalId = `local-assistant:${clientMessageId}`;
    const createdAt = new Date().toISOString();

    setMessages((current) => [
      ...current,
      {
        id: `local-user:${clientMessageId}`,
        role: "user",
        content,
        createdAt,
        generationStatus: "completed",
        clientMessageId,
      },
      {
        id: assistantLocalId,
        role: "assistant",
        content: "",
        createdAt,
        generationStatus: "streaming",
        clientMessageId,
      },
    ]);
    setInput("");
    await runGeneration({
      activeConversationId,
      content,
      clientMessageId,
      assistantLocalId,
    });
  }

  async function retryMessage(message: ChatMessage) {
    if (!message.clientMessageId || activeAssistantId) return;
    const userMessage = messages.find(
      (item) =>
        item.role === "user" &&
        item.clientMessageId === message.clientMessageId,
    );
    if (!userMessage) return;

    let activeConversationId: string;
    try {
      activeConversationId = await ensureConversation("text");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Falha ao retomar conversa.",
      );
      return;
    }
    setMessages((current) =>
      current.map((item) =>
        item.id === message.id
          ? {
              ...item,
              content: "",
              generationStatus: "streaming",
              errorMessage: null,
            }
          : item,
      ),
    );
    await runGeneration({
      activeConversationId,
      content: userMessage.content,
      clientMessageId: message.clientMessageId,
      assistantLocalId: message.id,
    });
  }

  async function copyMessage(message: ChatMessage) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId(null), 1200);
    } catch {
      setError("O navegador não permitiu copiar a resposta.");
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <section className={styles.textWorkspace}>
      <div className={styles.textHeader}>
        <div>
          <span>CANAL DE TEXTO // STREAM</span>
          <strong>{conversationId ? "CONTEXTO SINCRONIZADO" : "NOVA CONVERSA"}</strong>
        </div>
        <div className={styles.textHeaderActions}>
          <small>{messages.length} MENSAGENS</small>
          <button
            disabled={!conversationId || Boolean(activeAssistantId) || finalizing}
            onClick={onFinalize}
          >
            {finalizing ? "ANALISANDO..." : "FINALIZAR E MEMORIZAR"}
          </button>
        </div>
      </div>

      <div className={styles.textMessages} ref={viewportRef}>
        {loading && <div className={styles.textEmpty}>CARREGANDO CONTEXTO...</div>}
        {!loading && !messages.length && (
          <div className={styles.textEmpty}>
            <span>✦</span>
            <strong>CONVERSE COM A SYNAPSAY</strong>
            <p>Escreva uma mensagem ou volte para o modo de voz quando quiser.</p>
          </div>
        )}
        {messages.map((message) => (
          <article
            key={message.id}
            className={`${styles.textMessage} ${
              message.role === "user" ? styles.textUser : styles.textAssistant
            }`}
          >
            <div className={styles.textMessageMeta}>
              <span>{message.role === "user" ? "VOCÊ" : "SYNAPSAY"}</span>
              <time>
                {new Intl.DateTimeFormat("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(message.createdAt))}
              </time>
              {message.generationStatus === "streaming" && <i>GERANDO</i>}
            </div>
            <div className={styles.textBubble}>
              <p>
                {message.content}
                {message.generationStatus === "streaming" && (
                  <span className={styles.streamCursor} />
                )}
              </p>
              {message.role === "assistant" && message.content && (
                <button
                  className={styles.copyButton}
                  onClick={() => void copyMessage(message)}
                >
                  {copiedId === message.id ? "COPIADO" : "COPIAR"}
                </button>
              )}
            </div>
            {message.role === "assistant" &&
              ["error", "interrupted"].includes(message.generationStatus) && (
                <div className={styles.messageFailure}>
                  <span>{message.errorMessage}</span>
                  <button onClick={() => void retryMessage(message)}>TENTAR NOVAMENTE</button>
                </div>
              )}
          </article>
        ))}
      </div>

      {error && <div className={styles.textError}>{error}</div>}
      <div className={styles.composer}>
        <textarea
          rows={1}
          maxLength={20_000}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Digite sua mensagem..."
          disabled={Boolean(activeAssistantId)}
        />
        <span>{input.length}/20000</span>
        {activeAssistantId ? (
          <button
            className={styles.stopButton}
            onClick={() => abortRef.current?.abort()}
          >
            ■ INTERROMPER
          </button>
        ) : (
          <button
            className={styles.sendButton}
            disabled={!input.trim()}
            onClick={() => void sendMessage()}
          >
            ENVIAR ↗
          </button>
        )}
      </div>
    </section>
  );
}
