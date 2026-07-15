"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./historico.module.css";

type Conversation = {
  id: string;
  title: string | null;
  title_source: "first_message" | "generated" | "manual";
  channel: "voice" | "text";
  status: "active" | "archived";
  started_at: string;
  last_message_at: string | null;
  ended_at: string | null;
  end_reason: "user_finalized" | "inactivity" | "user_archived" | null;
  updated_at: string;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  input_type: "voice" | "text";
  created_at: string;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const emptyPagination: Pagination = {
  page: 1,
  pageSize: 12,
  total: 0,
  totalPages: 0,
};

const endReasonLabel: Record<string, string> = {
  user_finalized: "Finalizada",
  inactivity: "Encerrada por inatividade",
  user_archived: "Arquivada",
};

function formatDate(value: string | null, includeTime = true) {
  if (!value) return "Sem atividade";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

export default function HistoryPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [pagination, setPagination] = useState<Pagination>(emptyPagination);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  const loadConversations = useCallback(async () => {
    setLoadingList(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), pageSize: "12" });
    if (search) params.set("search", search);
    if (status !== "all") params.set("status", status);
    if (from) params.set("from", from);
    if (to) params.set("to", to);

    try {
      const response = await fetch(`/api/conversations?${params}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Não foi possível carregar o histórico.");
      }
      const nextConversations = data.conversations ?? [];
      setConversations(nextConversations);
      setPagination(data.pagination ?? emptyPagination);
      setSelectedId((current) =>
        current && nextConversations.some((item: Conversation) => item.id === current)
          ? current
          : nextConversations[0]?.id ?? null,
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Falha ao carregar histórico.",
      );
    } finally {
      setLoadingList(false);
    }
  }, [from, page, search, status, to]);

  const loadMessages = useCallback(
    async (conversationId: string, cursor?: string | null) => {
      setLoadingMessages(true);
      setError("");
      const params = new URLSearchParams({ limit: "50" });
      if (cursor) params.set("cursor", cursor);

      try {
        const response = await fetch(
          `/api/conversations/${conversationId}/messages?${params}`,
          { cache: "no-store" },
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? "Não foi possível carregar as mensagens.");
        }
        setMessages((current) =>
          cursor ? [...(data.messages ?? []), ...current] : data.messages ?? [],
        );
        setHasMoreMessages(Boolean(data.hasMore));
        setMessageCursor(data.nextCursor ?? null);
      } catch (reason) {
        setError(
          reason instanceof Error ? reason.message : "Falha ao carregar mensagens.",
        );
      } finally {
        setLoadingMessages(false);
      }
    },
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadConversations(), 0);
    return () => window.clearTimeout(timer);
  }, [loadConversations]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setEditingTitle(false);
      setMessages([]);
      setMessageCursor(null);
      setHasMoreMessages(false);
      if (selectedId) void loadMessages(selectedId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadMessages, selectedId]);

  async function patchConversation(
    id: string,
    payload: { title?: string; status?: string },
  ) {
    setBusyId(id);
    setError("");
    try {
      const response = await fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Não foi possível atualizar a conversa.");
      }
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === id ? data.conversation : conversation,
        ),
      );
      setEditingTitle(false);
      return data.conversation as Conversation;
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Falha ao atualizar conversa.",
      );
      return null;
    } finally {
      setBusyId(null);
    }
  }

  async function deleteConversation(conversation: Conversation) {
    const confirmed = window.confirm(
      `Excluir permanentemente “${conversation.title ?? "Conversa sem título"}” e todas as mensagens?`,
    );
    if (!confirmed) return;

    setBusyId(conversation.id);
    setError("");
    try {
      const response = await fetch(`/api/conversations/${conversation.id}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Não foi possível excluir a conversa.");
      }
      const remaining = conversations.filter((item) => item.id !== conversation.id);
      setConversations(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setPagination((current) => ({
        ...current,
        total: Math.max(0, current.total - 1),
        totalPages: Math.ceil(Math.max(0, current.total - 1) / current.pageSize),
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao excluir conversa.");
    } finally {
      setBusyId(null);
    }
  }

  function continueConversation(conversation: Conversation) {
    window.location.href = `/dashboard?conversation=${encodeURIComponent(conversation.id)}`;
  }

  function changeFilter(nextStatus: string) {
    setPage(1);
    setStatus(nextStatus);
  }

  return (
    <main className={styles.page}>
      <div className={styles.grid} />
      <div className={styles.glow} />

      <header className={styles.header}>
        <a href="/dashboard" className={styles.brand}>
          <span className={styles.brandMark}>S</span>
          <span>synap<b>say</b></span>
        </a>
        <nav>
          <a href="/dashboard">ASSISTENTE</a>
          <a href="/memorias">MEMÓRIAS</a>
          <a href="/agenda">AGENDA</a>
          <span><i /> HISTÓRICO ONLINE</span>
        </nav>
      </header>

      <section className={styles.shell}>
        <div className={styles.intro}>
          <div>
            <span>ARQUIVO NEURAL // 02</span>
            <h1>Histórico de <em>conversas</em></h1>
            <p>Encontre um assunto, reveja mensagens ou retome exatamente de onde parou.</p>
          </div>
          <a className={styles.newButton} href="/dashboard">+ NOVA CONVERSA</a>
        </div>

        <div className={styles.filters}>
          <label className={styles.search}>
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg>
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar palavra ou assunto..."
            />
          </label>
          <div className={styles.statusFilters}>
            {["all", "active", "archived"].map((item) => (
              <button
                key={item}
                className={status === item ? styles.activeFilter : ""}
                onClick={() => changeFilter(item)}
              >
                {item === "all" ? "TODAS" : item === "active" ? "ATIVAS" : "ENCERRADAS"}
              </button>
            ))}
          </div>
          <label>DE <input type="date" value={from} onChange={(event) => { setPage(1); setFrom(event.target.value); }} /></label>
          <label>ATÉ <input type="date" value={to} onChange={(event) => { setPage(1); setTo(event.target.value); }} /></label>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.workspace}>
          <aside className={styles.conversationPanel}>
            <div className={styles.panelHeader}>
              <span>CONVERSAS</span>
              <b>{pagination.total}</b>
            </div>
            <div className={styles.conversationList}>
              {loadingList && <div className={styles.loading}>SINCRONIZANDO...</div>}
              {!loadingList && !conversations.length && (
                <div className={styles.emptyList}>Nenhuma conversa encontrada.</div>
              )}
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className={`${styles.conversationItem} ${selectedId === conversation.id ? styles.selected : ""}`}
                  onClick={() => setSelectedId(conversation.id)}
                >
                  <span className={styles.itemStatus} data-active={conversation.status === "active"} />
                  <span className={styles.itemBody}>
                    <strong>{conversation.title || "Conversa sem título"}</strong>
                    <small>{formatDate(conversation.last_message_at ?? conversation.started_at)}</small>
                  </span>
                  <span className={styles.itemKind}>{conversation.channel === "voice" ? "VOICE" : "TEXT"}</span>
                </button>
              ))}
            </div>
            <div className={styles.pagination}>
              <button disabled={page <= 1 || loadingList} onClick={() => setPage((current) => current - 1)}>←</button>
              <span>{pagination.totalPages ? `${page} / ${pagination.totalPages}` : "0 / 0"}</span>
              <button disabled={page >= pagination.totalPages || loadingList} onClick={() => setPage((current) => current + 1)}>→</button>
            </div>
          </aside>

          <section className={styles.messagePanel}>
            {!selected && (
              <div className={styles.noSelection}>
                <span>◌</span>
                <strong>SELECIONE UMA CONVERSA</strong>
              </div>
            )}
            {selected && (
              <>
                <div className={styles.messageHeader}>
                  <div>
                    {editingTitle ? (
                      <form
                        className={styles.titleForm}
                        onSubmit={(event) => {
                          event.preventDefault();
                          void patchConversation(selected.id, { title: titleDraft });
                        }}
                      >
                        <input autoFocus maxLength={80} value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} />
                        <button disabled={busyId === selected.id}>SALVAR</button>
                        <button type="button" onClick={() => setEditingTitle(false)}>×</button>
                      </form>
                    ) : (
                      <div className={styles.titleLine}>
                        <h2>{selected.title || "Conversa sem título"}</h2>
                        <button
                          aria-label="Renomear conversa"
                          onClick={() => {
                            setTitleDraft(selected.title ?? "");
                            setEditingTitle(true);
                          }}
                        >✎</button>
                      </div>
                    )}
                    <p>
                      {selected.status === "active"
                        ? "CONVERSA ATIVA"
                        : endReasonLabel[selected.end_reason ?? ""] ?? "CONVERSA ENCERRADA"}
                      <span>•</span>{formatDate(selected.started_at)}
                    </p>
                  </div>
                  <div className={styles.actions}>
                    <button className={styles.continueButton} onClick={() => continueConversation(selected)}>CONTINUAR</button>
                    <button
                      disabled={busyId === selected.id}
                      onClick={() =>
                        void patchConversation(selected.id, {
                          status: selected.status === "active" ? "archived" : "active",
                        })
                      }
                    >
                      {selected.status === "active" ? "ARQUIVAR" : "REATIVAR"}
                    </button>
                    <button className={styles.deleteButton} disabled={busyId === selected.id} onClick={() => void deleteConversation(selected)}>EXCLUIR</button>
                  </div>
                </div>

                <div className={styles.messages}>
                  {hasMoreMessages && (
                    <button
                      className={styles.loadMore}
                      disabled={loadingMessages || !messageCursor}
                      onClick={() => messageCursor && void loadMessages(selected.id, messageCursor)}
                    >
                      {loadingMessages ? "CARREGANDO..." : "CARREGAR MENSAGENS ANTERIORES"}
                    </button>
                  )}
                  {loadingMessages && !messages.length && <div className={styles.loading}>CARREGANDO MENSAGENS...</div>}
                  {!loadingMessages && !messages.length && <div className={styles.emptyList}>Esta conversa ainda não possui mensagens.</div>}
                  {messages.map((message) => (
                    <article key={message.id} className={`${styles.message} ${message.role === "user" ? styles.userMessage : styles.assistantMessage}`}>
                      <div className={styles.messageMeta}>
                        <span>{message.role === "user" ? "VOCÊ" : "SYNAPSAY"}</span>
                        <time>{formatDate(message.created_at)}</time>
                      </div>
                      <p>{message.content}</p>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
