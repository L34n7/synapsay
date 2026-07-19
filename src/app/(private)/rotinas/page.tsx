"use client";

import { useEffect, useState, type FormEvent } from "react";
import styles from "./routines.module.css";

type Source = { value?: string; label?: string; title?: string; url?: string };
type LatestRun = {
  status: string;
  completed_at: string | null;
  created_at: string;
  result: { content?: string; sources?: Source[] } | null;
  error_message: string | null;
} | null;

type Routine = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  trigger_type: string;
  recurrence_type: string;
  timezone: string;
  start_time: string | null;
  end_time: string | null;
  starts_on: string | null;
  ends_on: string | null;
  days_of_week: number[];
  max_executions_per_period: number;
  confirmation_mode: string;
  action_type: string;
  adapt_from_memories: boolean;
  suggest_adjustments: boolean;
  feedback_interval: number;
  execution_count: number;
  configuration: {
    topics?: string[];
    categories?: string[];
    sources?: Source[];
    sourcesOnly?: boolean;
    maxDurationSeconds?: number;
    prompt?: string;
  };
  latest_run: LatestRun;
};

const emptyForm = {
  name: "",
  description: "",
  active: true,
  trigger_type: "conversation_window",
  recurrence_type: "daily",
  timezone: "America/Sao_Paulo",
  start_time: "08:00",
  end_time: "11:59",
  starts_on: "",
  ends_on: "",
  days_of_week: [0, 1, 2, 3, 4, 5, 6],
  max_executions_per_period: 1,
  confirmation_mode: "ask_first",
  action_type: "news_briefing",
  topics: "mundo",
  sources: "",
  sourcesOnly: false,
  adapt_from_memories: true,
  suggest_adjustments: true,
  feedback_interval: 3,
  maxDurationSeconds: 90,
};

const weekDays = [
  { value: 0, label: "D" },
  { value: 1, label: "S" },
  { value: 2, label: "T" },
  { value: 3, label: "Q" },
  { value: 4, label: "Q" },
  { value: 5, label: "S" },
  { value: 6, label: "S" },
];

const statusLabels: Record<string, string> = {
  available: "Disponível",
  awaiting_confirmation: "Aguardando confirmação",
  declined: "Recusada",
  postponed: "Adiada",
  processing: "Executando",
  completed: "Concluída",
  expired: "Expirada",
  failed: "Falhou",
};

function formFromRoutine(routine: Routine) {
  return {
    ...emptyForm,
    name: routine.name,
    description: routine.description ?? "",
    active: routine.active,
    recurrence_type: routine.recurrence_type,
    timezone: routine.timezone,
    start_time: routine.start_time?.slice(0, 5) ?? "08:00",
    end_time: routine.end_time?.slice(0, 5) ?? "11:59",
    starts_on: routine.starts_on ?? "",
    ends_on: routine.ends_on ?? "",
    days_of_week: routine.days_of_week,
    max_executions_per_period: routine.max_executions_per_period,
    confirmation_mode: routine.confirmation_mode,
    action_type: routine.action_type,
    topics: [
      ...(routine.configuration?.categories ?? []),
      ...(routine.configuration?.topics ?? []),
    ].join(", "),
    sources: (routine.configuration?.sources ?? [])
      .map((source) => source.value ?? "")
      .filter(Boolean)
      .join(", "),
    sourcesOnly: Boolean(routine.configuration?.sourcesOnly),
    adapt_from_memories: routine.adapt_from_memories,
    suggest_adjustments: routine.suggest_adjustments,
    feedback_interval: routine.feedback_interval,
    maxDurationSeconds: routine.configuration?.maxDurationSeconds ?? 90,
  };
}

function dateTimeLabel(value: string | null | undefined) {
  if (!value) return "Nunca executada";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function nextOpportunityLabel(routine: Routine) {
  if (!routine.active) return "Pausada";
  if (routine.recurrence_type === "once" && routine.latest_run?.status === "completed") {
    return "Rotina única concluída";
  }
  return `Na próxima conversa elegível, entre ${routine.start_time?.slice(0, 5) ?? "00:00"} e ${routine.end_time?.slice(0, 5) ?? "23:59"}`;
}

export default function RoutinesPage() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tests, setTests] = useState<
    Record<string, { loading?: boolean; error?: string; content?: string; sources?: Source[] }>
  >({});

  async function load() {
    setLoading(true);
    setError("");
    const response = await fetch("/api/routines", { cache: "no-store" });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) return setError(data.error ?? "Falha ao carregar rotinas.");
    setRoutines(data.routines ?? []);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  }

  function edit(routine: Routine) {
    setEditingId(routine.id);
    setForm(formFromRoutine(routine));
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleDay(day: number) {
    const exists = form.days_of_week.includes(day);
    const days = exists
      ? form.days_of_week.filter((item) => item !== day)
      : [...form.days_of_week, day].sort();
    if (days.length) setForm({ ...form, days_of_week: days });
  }

  async function saveRoutine(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const sources = form.sources
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => ({ type: "domain", value }));
    const payload = {
      ...form,
      ...(editingId ? { id: editingId } : {}),
      starts_on: form.starts_on || null,
      ends_on: form.ends_on || null,
      configuration: {
        topics: form.topics
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        categories: [],
        sources,
        sourcesOnly: form.sourcesOnly,
        delivery: "both",
        maxItems: 5,
        maxDurationSeconds: form.maxDurationSeconds,
      },
      created_via: "page",
    };
    const response = await fetch("/api/routines", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) return setError(data.error ?? "Falha ao salvar rotina.");
    cancelEdit();
    await load();
  }

  async function toggle(routine: Routine) {
    const response = await fetch("/api/routines", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...routine, active: !routine.active }),
    });
    if (response.ok) await load();
  }

  async function remove(id: string) {
    if (!window.confirm("Excluir esta rotina e todo o histórico de execuções?")) return;
    const response = await fetch(`/api/routines?id=${id}`, { method: "DELETE" });
    if (response.ok) {
      if (editingId === id) cancelEdit();
      await load();
    }
  }

  async function testRoutine(id: string) {
    setTests((current) => ({ ...current, [id]: { loading: true } }));
    const response = await fetch("/api/routines/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routineId: id }),
    });
    const data = await response.json();
    setTests((current) => ({
      ...current,
      [id]: response.ok
        ? { content: data.content, sources: data.sources ?? [] }
        : { error: data.error ?? "Falha ao testar a rotina." },
    }));
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Assistente pessoal // Rotinas</p>
            <h1 className={styles.title}>Rotinas</h1>
            <p className={styles.subtitle}>
              Crie ações recorrentes por horário e contexto. A mesma rotina pode ser
              gerenciada por voz, texto ou nesta página.
            </p>
          </div>
          <a href="/dashboard" className={styles.backLink}>
            ← VOLTAR AO ASSISTENTE
          </a>
        </header>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2 className={styles.panelTitle}>
                {editingId ? "Editar rotina" : "Nova rotina"}
              </h2>
              <span className={styles.panelHint}>
                {editingId
                  ? "Altere os campos e salve para aplicar na próxima oportunidade."
                  : "Defina quando e como o assistente deve agir."}
              </span>
            </div>
          </div>

          <form onSubmit={saveRoutine} className={styles.form}>
            <label className={`${styles.field} ${styles.span6}`}>
              <span>Nome da rotina</span>
              <input
                className={styles.input}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Ex.: Notícias da manhã"
                required
              />
            </label>
            <label className={`${styles.field} ${styles.span6}`}>
              <span>Assuntos</span>
              <input
                className={styles.input}
                value={form.topics}
                onChange={(event) => setForm({ ...form, topics: event.target.value })}
                placeholder="mundo, tecnologia, inteligência artificial"
              />
            </label>

            <label className={`${styles.field} ${styles.span3}`}>
              <span>A partir de</span>
              <div className={styles.dateWrap}>
                <input
                  type="time"
                  className={styles.dateInput}
                  value={form.start_time}
                  onChange={(event) => setForm({ ...form, start_time: event.target.value })}
                />
              </div>
            </label>
            <label className={`${styles.field} ${styles.span3}`}>
              <span>Até</span>
              <div className={styles.dateWrap}>
                <input
                  type="time"
                  className={styles.dateInput}
                  value={form.end_time}
                  onChange={(event) => setForm({ ...form, end_time: event.target.value })}
                />
              </div>
            </label>
            <label className={`${styles.field} ${styles.span3}`}>
              <span>Iniciar na data</span>
              <div className={styles.dateWrap}>
                <input
                  type="date"
                  className={styles.dateInput}
                  value={form.starts_on}
                  onChange={(event) => setForm({ ...form, starts_on: event.target.value })}
                />
              </div>
            </label>
            <label className={`${styles.field} ${styles.span3}`}>
              <span>Encerrar na data</span>
              <div className={styles.dateWrap}>
                <input
                  type="date"
                  className={styles.dateInput}
                  value={form.ends_on}
                  onChange={(event) => setForm({ ...form, ends_on: event.target.value })}
                />
              </div>
              <small>Vazio significa sem data final.</small>
            </label>

            <label className={`${styles.field} ${styles.span3}`}>
              <span>Tipo de conteúdo</span>
              <select
                className={styles.select}
                value={form.action_type}
                onChange={(event) => setForm({ ...form, action_type: event.target.value })}
              >
                <option value="news_briefing">Notícias</option>
                <option value="custom_briefing">Resumo personalizado</option>
                <option value="agenda_briefing">Agenda</option>
                <option value="task_briefing">Tarefas</option>
              </select>
            </label>
            <label className={`${styles.field} ${styles.span3}`}>
              <span>Recorrência</span>
              <select
                className={styles.select}
                value={form.recurrence_type}
                onChange={(event) =>
                  setForm({ ...form, recurrence_type: event.target.value })
                }
              >
                <option value="daily">Diária</option>
                <option value="weekly">Semanal</option>
                <option value="once">Uma vez</option>
              </select>
            </label>
            <label className={`${styles.field} ${styles.span3}`}>
              <span>Comportamento</span>
              <select
                className={styles.select}
                value={form.confirmation_mode}
                onChange={(event) =>
                  setForm({ ...form, confirmation_mode: event.target.value })
                }
              >
                <option value="ask_first">Perguntar antes</option>
                <option value="automatic">Executar automaticamente</option>
              </select>
            </label>
            <label className={`${styles.field} ${styles.span3}`}>
              <span>Oportunidades por período</span>
              <select
                className={styles.select}
                value={form.max_executions_per_period}
                onChange={(event) =>
                  setForm({
                    ...form,
                    max_executions_per_period: Number(event.target.value),
                  })
                }
              >
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <fieldset className={styles.daysField}>
              <legend>Dias da semana</legend>
              <div className={styles.daysGrid}>
                {weekDays.map((day, index) => (
                  <button
                    key={`${day.value}-${index}`}
                    type="button"
                    aria-pressed={form.days_of_week.includes(day.value)}
                    className={`${styles.dayChip} ${
                      form.days_of_week.includes(day.value) ? styles.dayChipActive : ""
                    }`}
                    onClick={() => toggleDay(day.value)}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className={`${styles.field} ${styles.span4}`}>
              <span>Duração máxima</span>
              <select
                className={styles.select}
                value={form.maxDurationSeconds}
                onChange={(event) =>
                  setForm({ ...form, maxDurationSeconds: Number(event.target.value) })
                }
              >
                <option value={30}>30 segundos</option>
                <option value={60}>1 minuto</option>
                <option value={90}>1 minuto e meio</option>
                <option value={120}>2 minutos</option>
                <option value={300}>5 minutos</option>
              </select>
            </label>
            <label className={`${styles.field} ${styles.span4}`}>
              <span>Pedir opinião a cada</span>
              <select
                className={styles.select}
                value={form.feedback_interval}
                onChange={(event) =>
                  setForm({ ...form, feedback_interval: Number(event.target.value) })
                }
              >
                <option value={1}>1 execução</option>
                <option value={3}>3 execuções</option>
                <option value={5}>5 execuções</option>
                <option value={10}>10 execuções</option>
              </select>
            </label>
            <label className={`${styles.field} ${styles.span4}`}>
              <span>Fuso horário</span>
              <input
                className={styles.input}
                value={form.timezone}
                onChange={(event) => setForm({ ...form, timezone: event.target.value })}
              />
            </label>

            <label className={`${styles.field} ${styles.span12}`}>
              <span>Sites específicos</span>
              <input
                className={styles.input}
                value={form.sources}
                onChange={(event) => setForm({ ...form, sources: event.target.value })}
                placeholder="g1.globo.com, theverge.com"
              />
              <small>Separe os domínios por vírgula.</small>
            </label>

            <div className={styles.optionsBox}>
              <label className={styles.option}>
                <input
                  type="checkbox"
                  checked={form.sourcesOnly}
                  onChange={(event) =>
                    setForm({ ...form, sourcesOnly: event.target.checked })
                  }
                />
                <span>
                  <strong>Usar somente os sites informados</strong>
                  <small>A pesquisa será tecnicamente limitada a esses domínios.</small>
                </span>
              </label>
              <label className={styles.option}>
                <input
                  type="checkbox"
                  checked={form.adapt_from_memories}
                  onChange={(event) =>
                    setForm({ ...form, adapt_from_memories: event.target.checked })
                  }
                />
                <span>
                  <strong>Adaptar prioridades usando memórias aprovadas</strong>
                  <small>Gostos e preferências ajudam a priorizar assuntos e fontes.</small>
                </span>
              </label>
              <label className={styles.option}>
                <input
                  type="checkbox"
                  checked={form.suggest_adjustments}
                  onChange={(event) =>
                    setForm({ ...form, suggest_adjustments: event.target.checked })
                  }
                />
                <span>
                  <strong>Perguntar ocasionalmente se desejo fazer ajustes</strong>
                  <small>A Synapsay pode sugerir mudanças sem aplicá-las sozinha.</small>
                </span>
              </label>
            </div>

            {error ? <p className={styles.error}>{error}</p> : null}
            <div className={styles.actions}>
              {editingId ? (
                <button type="button" onClick={cancelEdit} className={styles.secondaryButton}>
                  CANCELAR
                </button>
              ) : null}
              <button disabled={saving} className={styles.primaryButton}>
                {saving
                  ? "SALVANDO..."
                  : editingId
                    ? "SALVAR ALTERAÇÕES"
                    : "CRIAR ROTINA"}
              </button>
            </div>
          </form>
        </section>

        <section className={styles.listSection}>
          <div className={styles.listHeader}>
            <h2 className={styles.listTitle}>Suas rotinas</h2>
            <span className={styles.counter}>{routines.length} cadastrada(s)</span>
          </div>
          {loading ? (
            <div className={styles.loading}>CARREGANDO ROTINAS...</div>
          ) : routines.length === 0 ? (
            <div className={styles.empty}>
              Nenhuma rotina criada ainda. Use o formulário ou peça pelo assistente.
            </div>
          ) : (
            <div className={styles.cards}>
              {routines.map((routine) => {
                const test = tests[routine.id];
                return (
                  <article key={routine.id} className={styles.card}>
                    <div>
                      <div className={styles.cardTitleRow}>
                        <h3 className={styles.cardTitle}>{routine.name}</h3>
                        <span
                          className={`${styles.status} ${
                            routine.active ? styles.activeStatus : styles.pausedStatus
                          }`}
                        >
                          {routine.active ? "Ativa" : "Pausada"}
                        </span>
                      </div>
                      <div className={styles.meta}>
                        <span>
                          {routine.start_time?.slice(0, 5) ?? "00:00"}–
                          {routine.end_time?.slice(0, 5) ?? "23:59"}
                        </span>
                        <span>
                          {routine.confirmation_mode === "ask_first"
                            ? "Pergunta antes"
                            : "Automática"}
                        </span>
                        <span>
                          {routine.max_executions_per_period} oportunidade(s) por período
                        </span>
                        <span>{routine.ends_on ? `Até ${routine.ends_on}` : "Sem data final"}</span>
                      </div>
                      <p className={styles.description}>
                        {routine.configuration?.topics?.join(", ") ||
                          routine.description ||
                          "Rotina personalizada"}
                      </p>
                      <div className={styles.meta}>
                        <span>{routine.execution_count ?? 0} execução(ões)</span>
                        <span>
                          Última: {dateTimeLabel(routine.latest_run?.completed_at)}
                          {routine.latest_run
                            ? ` · ${statusLabels[routine.latest_run.status] ?? routine.latest_run.status}`
                            : ""}
                        </span>
                        <span>Próxima: {nextOpportunityLabel(routine)}</span>
                      </div>
                      {test ? (
                        <div className={styles.testResult}>
                          {test.loading ? <p>Executando teste...</p> : null}
                          {test.error ? <p className={styles.testError}>{test.error}</p> : null}
                          {test.content ? <p>{test.content}</p> : null}
                          {test.sources?.length ? (
                            <div className={styles.sources}>
                              <strong>Fontes</strong>
                              {test.sources.map((source, index) => (
                                <a
                                  key={`${source.url}-${index}`}
                                  href={source.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {source.title || source.url}
                                </a>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className={styles.cardActions}>
                      <button
                        onClick={() => testRoutine(routine.id)}
                        disabled={test?.loading}
                        className={styles.secondaryButton}
                      >
                        TESTAR
                      </button>
                      <button onClick={() => edit(routine)} className={styles.secondaryButton}>
                        EDITAR
                      </button>
                      <button onClick={() => toggle(routine)} className={styles.secondaryButton}>
                        {routine.active ? "PAUSAR" : "ATIVAR"}
                      </button>
                      <button onClick={() => remove(routine.id)} className={styles.dangerButton}>
                        EXCLUIR
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
