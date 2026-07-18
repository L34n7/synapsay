"use client";

import { useEffect, useState, type FormEvent } from "react";
import styles from "./routines.module.css";

type Routine = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  trigger_type: string;
  recurrence_type: string;
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
  configuration: { topics?: string[]; sources?: { value: string; label?: string }[]; sourcesOnly?: boolean; maxDurationSeconds?: number };
};

const emptyForm = {
  name: "", description: "", active: true,
  trigger_type: "conversation_window", recurrence_type: "daily",
  start_time: "08:00", end_time: "11:59", starts_on: "", ends_on: "",
  days_of_week: [0, 1, 2, 3, 4, 5, 6], max_executions_per_period: 1,
  confirmation_mode: "ask_first", action_type: "news_briefing", topics: "mundo",
  sources: "", sourcesOnly: false, adapt_from_memories: true,
  suggest_adjustments: true, feedback_interval: 3, maxDurationSeconds: 90,
};

export default function RoutinesPage() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    const response = await fetch("/api/routines", { cache: "no-store" });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) return setError(data.error ?? "Falha ao carregar rotinas.");
    setRoutines(data.routines ?? []);
  }

  useEffect(() => { void load(); }, []);

  async function createRoutine(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    const sources = form.sources.split(",").map((value) => value.trim()).filter(Boolean).map((value) => ({ type: "domain", value }));
    const response = await fetch("/api/routines", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form, starts_on: form.starts_on || null, ends_on: form.ends_on || null,
        configuration: {
          topics: form.topics.split(",").map((value) => value.trim()).filter(Boolean),
          sources, sourcesOnly: form.sourcesOnly, delivery: "both", maxItems: 5,
          maxDurationSeconds: form.maxDurationSeconds,
        },
        created_via: "page",
      }),
    });
    const data = await response.json(); setSaving(false);
    if (!response.ok) return setError(data.error ?? "Falha ao criar rotina.");
    setForm(emptyForm); await load();
  }

  async function toggle(routine: Routine) {
    const response = await fetch("/api/routines", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...routine, active: !routine.active }),
    });
    if (response.ok) await load();
  }

  async function remove(id: string) {
    const response = await fetch(`/api/routines?id=${id}`, { method: "DELETE" });
    if (response.ok) await load();
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Assistente pessoal // Rotinas</p>
            <h1 className={styles.title}>Rotinas</h1>
            <p className={styles.subtitle}>Configure ações recorrentes por horário e contexto. Você também pode criar, alterar ou pausar rotinas conversando naturalmente com a Synapsay.</p>
          </div>
          <a href="/dashboard" className={styles.backLink}>← VOLTAR AO ASSISTENTE</a>
        </header>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div><h2 className={styles.panelTitle}>Nova rotina</h2><span className={styles.panelHint}>Defina quando e como o assistente deve agir.</span></div>
          </div>

          <form onSubmit={createRoutine} className={styles.form}>
            <label className={`${styles.field} ${styles.span6}`}><span>Nome da rotina</span><input className={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Notícias da manhã" required /></label>
            <label className={`${styles.field} ${styles.span6}`}><span>Assuntos</span><input className={styles.input} value={form.topics} onChange={(e) => setForm({ ...form, topics: e.target.value })} placeholder="mundo, tecnologia, inteligência artificial" /></label>

            <label className={`${styles.field} ${styles.span3}`}><span>A partir de</span><div className={styles.dateWrap}><input type="time" className={styles.dateInput} value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></div></label>
            <label className={`${styles.field} ${styles.span3}`}><span>Até</span><div className={styles.dateWrap}><input type="time" className={styles.dateInput} value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></div></label>
            <label className={`${styles.field} ${styles.span3}`}><span>Iniciar na data</span><div className={styles.dateWrap}><input type="date" className={styles.dateInput} value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} /></div><small>Opcional.</small></label>
            <label className={`${styles.field} ${styles.span3}`}><span>Encerrar na data</span><div className={styles.dateWrap}><input type="date" className={styles.dateInput} value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} /></div><small>Vazio significa sem data final.</small></label>

            <label className={`${styles.field} ${styles.span4}`}><span>Comportamento</span><select className={styles.select} value={form.confirmation_mode} onChange={(e) => setForm({ ...form, confirmation_mode: e.target.value })}><option value="ask_first">Perguntar antes</option><option value="automatic">Executar automaticamente</option></select></label>
            <label className={`${styles.field} ${styles.span4}`}><span>Duração máxima</span><select className={styles.select} value={form.maxDurationSeconds} onChange={(e) => setForm({ ...form, maxDurationSeconds: Number(e.target.value) })}><option value={30}>30 segundos</option><option value={60}>1 minuto</option><option value={90}>1 minuto e meio</option><option value={120}>2 minutos</option><option value={300}>5 minutos</option></select></label>
            <label className={`${styles.field} ${styles.span4}`}><span>Pedir opinião a cada</span><select className={styles.select} value={form.feedback_interval} onChange={(e) => setForm({ ...form, feedback_interval: Number(e.target.value) })}><option value={1}>1 execução</option><option value={3}>3 execuções</option><option value={5}>5 execuções</option><option value={10}>10 execuções</option></select></label>

            <label className={`${styles.field} ${styles.span12}`}><span>Sites específicos</span><input className={styles.input} value={form.sources} onChange={(e) => setForm({ ...form, sources: e.target.value })} placeholder="g1.globo.com, theverge.com" /><small>Separe os domínios por vírgula.</small></label>

            <div className={styles.optionsBox}>
              <label className={styles.option}><input type="checkbox" checked={form.sourcesOnly} onChange={(e) => setForm({ ...form, sourcesOnly: e.target.checked })} /><span><strong>Usar somente os sites informados</strong><small>Quando ativado, o briefing não utiliza fontes externas à lista.</small></span></label>
              <label className={styles.option}><input type="checkbox" checked={form.adapt_from_memories} onChange={(e) => setForm({ ...form, adapt_from_memories: e.target.checked })} /><span><strong>Adaptar prioridades usando memórias aprovadas</strong><small>Gostos e preferências ajudam a priorizar assuntos e fontes.</small></span></label>
              <label className={styles.option}><input type="checkbox" checked={form.suggest_adjustments} onChange={(e) => setForm({ ...form, suggest_adjustments: e.target.checked })} /><span><strong>Perguntar ocasionalmente se desejo fazer ajustes</strong><small>A Synapsay poderá sugerir mudanças de duração, assunto ou fonte.</small></span></label>
            </div>

            {error ? <p className={styles.error}>{error}</p> : null}
            <div className={styles.actions}><button disabled={saving} className={styles.primaryButton}>{saving ? "CRIANDO ROTINA..." : "CRIAR ROTINA"}</button></div>
          </form>
        </section>

        <section className={styles.listSection}>
          <div className={styles.listHeader}><h2 className={styles.listTitle}>Suas rotinas</h2><span className={styles.counter}>{routines.length} cadastrada(s)</span></div>
          {loading ? <div className={styles.loading}>CARREGANDO ROTINAS...</div> : routines.length === 0 ? <div className={styles.empty}>Nenhuma rotina criada ainda. Você pode usar o formulário acima ou pedir pelo assistente.</div> : (
            <div className={styles.cards}>{routines.map((routine) => (
              <article key={routine.id} className={styles.card}>
                <div>
                  <div className={styles.cardTitleRow}><h3 className={styles.cardTitle}>{routine.name}</h3><span className={`${styles.status} ${routine.active ? styles.activeStatus : styles.pausedStatus}`}>{routine.active ? "Ativa" : "Pausada"}</span></div>
                  <div className={styles.meta}><span>{routine.start_time?.slice(0,5) ?? "00:00"}–{routine.end_time?.slice(0,5) ?? "23:59"}</span><span>{routine.confirmation_mode === "ask_first" ? "Pergunta antes" : "Automática"}</span><span>{routine.ends_on ? `Até ${routine.ends_on}` : "Sem data final"}</span><span>{routine.execution_count ?? 0} execução(ões)</span></div>
                  <p className={styles.description}>{routine.configuration?.topics?.join(", ") || routine.description || "Rotina personalizada"}</p>
                  <div className={styles.meta}><span>{routine.adapt_from_memories ? "Personaliza com memórias" : "Sem adaptação por memórias"}</span><span>{routine.suggest_adjustments ? `Feedback a cada ${routine.feedback_interval} execução(ões)` : "Sem pedido de feedback"}</span></div>
                </div>
                <div className={styles.cardActions}><button onClick={() => toggle(routine)} className={styles.secondaryButton}>{routine.active ? "PAUSAR" : "ATIVAR"}</button><button onClick={() => remove(routine.id)} className={styles.dangerButton}>EXCLUIR</button></div>
              </article>
            ))}</div>
          )}
        </section>
      </div>
    </main>
  );
}
