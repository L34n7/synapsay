"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./memorias.module.css";

type Memory = {
  id: string;
  title: string;
  content: string;
  category: string;
  importance: number;
  status: "active" | "archived";
  review_status: "pending" | "approved" | "rejected";
  memory_type: "permanent" | "temporary";
  expires_at: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

type Draft = {
  title: string;
  content: string;
  category: string;
  importance: number;
  memoryType: "permanent" | "temporary";
  expiresAt: string;
};

type Filter = "approved" | "archived" | "all";

const categories = [
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
];

const categoryLabels: Record<string, string> = {
  preference: "Preferência",
  personal: "Pessoal",
  goal: "Meta",
  project: "Projeto",
  relationship: "Relação",
  routine: "Rotina",
  commitment: "Compromisso",
  health: "Saúde",
  work: "Trabalho",
  general: "Geral",
};

const emptyDraft: Draft = {
  title: "",
  content: "",
  category: "general",
  importance: 3,
  memoryType: "permanent",
  expiresAt: "",
};

function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function memoryToDraft(memory: Memory): Draft {
  return {
    title: memory.title,
    content: memory.content,
    category: memory.category,
    importance: memory.importance,
    memoryType: memory.memory_type,
    expiresAt: toLocalDateTime(memory.expires_at),
  };
}

export default function MemoriesPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [filter, setFilter] = useState<Filter>("approved");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState("");

  const loadMemories = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/memories", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao carregar memórias.");
      setMemories(data.memories ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao carregar memórias.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadMemories(), 0);
    return () => window.clearTimeout(timer);
  }, [loadMemories]);

  const counts = useMemo(
    () => ({
      approved: memories.filter(
        (memory) => memory.review_status === "approved" && memory.status === "active",
      ).length,
      archived: memories.filter((memory) => memory.status === "archived").length,
      all: memories.length,
    }),
    [memories],
  );

  const visibleMemories = useMemo(() => {
    if (filter === "approved") {
      return memories.filter(
        (memory) => memory.review_status === "approved" && memory.status === "active",
      );
    }
    if (filter === "archived") {
      return memories.filter((memory) => memory.status === "archived");
    }
    return memories;
  }, [filter, memories]);

  async function patchMemory(id: string, payload: Record<string, unknown>) {
    setBusyId(id);
    setError("");
    try {
      const response = await fetch(`/api/memories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao atualizar memória.");
      setMemories((current) =>
        current.map((memory) => (memory.id === id ? data.memory : memory)),
      );
      setEditingId(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao atualizar memória.");
    } finally {
      setBusyId(null);
    }
  }

  async function forgetMemory(memory: Memory) {
    const confirmed = window.confirm(
      `Esquecer permanentemente “${memory.title}”? Esta ação não pode ser desfeita.`,
    );
    if (!confirmed) return;

    setBusyId(memory.id);
    setError("");
    try {
      const response = await fetch(`/api/memories/${memory.id}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao esquecer memória.");
      setMemories((current) => current.filter((item) => item.id !== memory.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao esquecer memória.");
    } finally {
      setBusyId(null);
    }
  }

  async function createMemory() {
    setBusyId("new");
    setError("");
    try {
      const response = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao criar memória.");
      setMemories((current) => [data.memory, ...current]);
      setDraft(emptyDraft);
      setAdding(false);
      setFilter("approved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao criar memória.");
    } finally {
      setBusyId(null);
    }
  }

  function beginEdit(memory: Memory) {
    setAdding(false);
    setEditingId(memory.id);
    setDraft(memoryToDraft(memory));
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
        <div className={styles.headerActions}>
          <span><i /> MEMÓRIA ONLINE</span>
          <a href="/agenda">AGENDA</a>
          <a href="/historico">HISTÓRICO</a>
          <a href="/dashboard">VOLTAR AO NÚCLEO</a>
        </div>
      </header>

      <section className={styles.shell}>
        <div className={styles.intro}>
          <div>
            <span className={styles.eyebrow}>CAMADA COGNITIVA // 01</span>
            <h1>Memória <em>consciente</em></h1>
            <p>
              A Synapsay organiza automaticamente as informações importantes.
              Aqui você pode editar, arquivar ou esquecer o que ela usa.
            </p>
          </div>
          <div className={styles.stats}>
            <div><strong>{counts.approved}</strong><span>ATIVAS</span></div>
            <div><strong>{counts.archived}</strong><span>ARQUIVADAS</span></div>
            <div><strong>{counts.all}</strong><span>NO TOTAL</span></div>
          </div>
        </div>

        <div className={styles.toolbar}>
          <nav aria-label="Filtros de memória">
            {(["approved", "archived", "all"] as Filter[]).map(
              (item) => (
                <button
                  key={item}
                  className={filter === item ? styles.activeFilter : ""}
                  onClick={() => setFilter(item)}
                >
                  {item === "approved" && "Ativas"}
                  {item === "archived" && "Arquivadas"}
                  {item === "all" && "Todas"}
                  <span>{counts[item]}</span>
                </button>
              ),
            )}
          </nav>
          <button
            className={styles.addButton}
            onClick={() => {
              setEditingId(null);
              setDraft(emptyDraft);
              setAdding(true);
            }}
          >
            + ADICIONAR MEMÓRIA
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {adding && (
          <MemoryEditor
            title="NOVA MEMÓRIA MANUAL"
            draft={draft}
            setDraft={setDraft}
            busy={busyId === "new"}
            onCancel={() => setAdding(false)}
            onSave={() => void createMemory()}
          />
        )}

        <div className={styles.memoryGrid}>
          {loading && <div className={styles.empty}>SINCRONIZANDO MEMÓRIAS...</div>}
          {!loading && !visibleMemories.length && (
            <div className={styles.empty}>
              <span>○</span>
              <strong>NENHUMA MEMÓRIA NESTA CAMADA</strong>
              <p>Finalize uma conversa ou adicione uma memória manualmente.</p>
            </div>
          )}

          {visibleMemories.map((memory) =>
            editingId === memory.id ? (
              <MemoryEditor
                key={memory.id}
                title="EDITAR MEMÓRIA"
                draft={draft}
                setDraft={setDraft}
                busy={busyId === memory.id}
                onCancel={() => setEditingId(null)}
                onSave={() =>
                  void patchMemory(memory.id, {
                    ...draft,
                    reviewStatus: memory.review_status,
                  })
                }
              />
            ) : (
              <article className={styles.memoryCard} key={memory.id}>
                <div className={styles.cardTop}>
                  <span className={styles.category}>
                    {categoryLabels[memory.category] ?? memory.category}
                  </span>
                  <span
                    className={`${styles.review} ${styles[memory.review_status]}`}
                  >
                    {memory.status === "active" ? "ATIVA" : "ARQUIVADA"}
                  </span>
                </div>
                <h2>{memory.title}</h2>
                <p>{memory.content}</p>
                <div className={styles.meta}>
                  <span>{memory.memory_type === "permanent" ? "PERMANENTE" : "TEMPORÁRIA"}</span>
                  {memory.expires_at && (
                    <span>EXPIRA {new Intl.DateTimeFormat("pt-BR").format(new Date(memory.expires_at))}</span>
                  )}
                  <span>IMPORTÂNCIA {memory.importance}/5</span>
                  <span>{memory.source === "manual" ? "MANUAL" : "CONVERSA"}</span>
                </div>
                <div className={styles.importance} aria-label={`Importância ${memory.importance} de 5`}>
                  {[1, 2, 3, 4, 5].map((level) => (
                    <i key={level} className={level <= memory.importance ? styles.lit : ""} />
                  ))}
                </div>
                <div className={styles.cardActions}>
                  {memory.status === "archived" ? (
                    <button
                      disabled={busyId === memory.id}
                      onClick={() => void patchMemory(memory.id, { status: "active" })}
                    >
                      REATIVAR
                    </button>
                  ) : (
                    <button
                      disabled={busyId === memory.id}
                      onClick={() => void patchMemory(memory.id, { status: "archived" })}
                    >
                      ARQUIVAR
                    </button>
                  )}
                  <button disabled={busyId === memory.id} onClick={() => beginEdit(memory)}>
                    EDITAR
                  </button>
                  <button
                    className={styles.forget}
                    disabled={busyId === memory.id}
                    onClick={() => void forgetMemory(memory)}
                  >
                    ESQUECER
                  </button>
                </div>
              </article>
            ),
          )}
        </div>
      </section>
    </main>
  );
}

function MemoryEditor({
  title,
  draft,
  setDraft,
  busy,
  onCancel,
  onSave,
}: {
  title: string;
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const valid = draft.title.trim() && draft.content.trim();

  return (
    <section className={styles.editor}>
      <div className={styles.editorHeader}>
        <span>{title}</span>
        <button onClick={onCancel} aria-label="Fechar editor">×</button>
      </div>
      <div className={styles.formGrid}>
        <label className={styles.wide}>
          TÍTULO
          <input
            maxLength={80}
            value={draft.title}
            onChange={(event) =>
              setDraft((current) => ({ ...current, title: event.target.value }))
            }
          />
        </label>
        <label className={styles.wide}>
          O QUE A SYNAPSAY DEVE LEMBRAR
          <textarea
            maxLength={500}
            rows={3}
            value={draft.content}
            onChange={(event) =>
              setDraft((current) => ({ ...current, content: event.target.value }))
            }
          />
        </label>
        <label>
          CATEGORIA
          <select
            value={draft.category}
            onChange={(event) =>
              setDraft((current) => ({ ...current, category: event.target.value }))
            }
          >
            {categories.map((category) => (
              <option key={category} value={category}>
                {categoryLabels[category]}
              </option>
            ))}
          </select>
        </label>
        <label>
          IMPORTÂNCIA
          <select
            value={draft.importance}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                importance: Number(event.target.value),
              }))
            }
          >
            {[1, 2, 3, 4, 5].map((level) => (
              <option key={level} value={level}>{level} / 5</option>
            ))}
          </select>
        </label>
        <label>
          DURAÇÃO
          <select
            value={draft.memoryType}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                memoryType: event.target.value as Draft["memoryType"],
              }))
            }
          >
            <option value="permanent">Permanente</option>
            <option value="temporary">Temporária</option>
          </select>
        </label>
        {draft.memoryType === "temporary" && (
          <label>
            EXPIRA EM
            <input
              type="datetime-local"
              value={draft.expiresAt}
              onChange={(event) =>
                setDraft((current) => ({ ...current, expiresAt: event.target.value }))
              }
            />
          </label>
        )}
      </div>
      <div className={styles.editorActions}>
        <button onClick={onCancel}>CANCELAR</button>
        <button className={styles.approve} disabled={!valid || busy} onClick={onSave}>
          {busy ? "SALVANDO..." : "SALVAR MEMÓRIA"}
        </button>
      </div>
    </section>
  );
}
