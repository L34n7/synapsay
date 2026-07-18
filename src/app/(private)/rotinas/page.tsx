"use client";

import { useEffect, useState } from "react";

type Routine = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  trigger_type: string;
  recurrence_type: string;
  start_time: string | null;
  end_time: string | null;
  confirmation_mode: string;
  action_type: string;
  configuration: { topics?: string[]; sources?: { value: string; label?: string }[]; sourcesOnly?: boolean };
};

const emptyForm = {
  name: "",
  description: "",
  active: true,
  trigger_type: "conversation_window",
  recurrence_type: "daily",
  start_time: "08:00",
  end_time: "11:59",
  days_of_week: [0,1,2,3,4,5,6],
  max_executions_per_period: 1,
  confirmation_mode: "ask_first",
  action_type: "news_briefing",
  topics: "mundo",
  sources: "",
  sourcesOnly: false,
};

export default function RoutinesPage() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    const response = await fetch("/api/routines", { cache: "no-store" });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) return setError(data.error ?? "Falha ao carregar rotinas.");
    setRoutines(data.routines ?? []);
  }

  useEffect(() => { void load(); }, []);

  async function createRoutine(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const sources = form.sources.split(",").map((value) => value.trim()).filter(Boolean).map((value) => ({ type: "domain", value }));
    const response = await fetch("/api/routines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        configuration: {
          topics: form.topics.split(",").map((value) => value.trim()).filter(Boolean),
          sources,
          sourcesOnly: form.sourcesOnly,
          delivery: "both",
          maxItems: 5,
          maxDurationSeconds: 90,
        },
        created_via: "page",
      }),
    });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) return setError(data.error ?? "Falha ao criar rotina.");
    setForm(emptyForm);
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
    const response = await fetch(`/api/routines?id=${id}`, { method: "DELETE" });
    if (response.ok) await load();
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-4 md:p-8">
      <header>
        <p className="text-sm text-muted-foreground">Assistente pessoal</p>
        <h1 className="text-3xl font-semibold tracking-tight">Rotinas</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">Crie ações que o assistente oferece ou executa ao iniciar uma conversa dentro de uma janela de horário.</p>
      </header>

      <section className="rounded-2xl border bg-card p-5 shadow-sm md:p-6">
        <h2 className="text-lg font-semibold">Nova rotina</h2>
        <form onSubmit={createRoutine} className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="space-y-2"><span className="text-sm font-medium">Nome</span><input className="w-full rounded-xl border bg-background px-3 py-2" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Notícias da manhã" required /></label>
          <label className="space-y-2"><span className="text-sm font-medium">Assuntos</span><input className="w-full rounded-xl border bg-background px-3 py-2" value={form.topics} onChange={(e) => setForm({ ...form, topics: e.target.value })} placeholder="mundo, tecnologia, IA" /></label>
          <label className="space-y-2"><span className="text-sm font-medium">A partir de</span><input type="time" className="w-full rounded-xl border bg-background px-3 py-2" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></label>
          <label className="space-y-2"><span className="text-sm font-medium">Até</span><input type="time" className="w-full rounded-xl border bg-background px-3 py-2" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></label>
          <label className="space-y-2"><span className="text-sm font-medium">Comportamento</span><select className="w-full rounded-xl border bg-background px-3 py-2" value={form.confirmation_mode} onChange={(e) => setForm({ ...form, confirmation_mode: e.target.value })}><option value="ask_first">Perguntar antes</option><option value="automatic">Executar automaticamente</option></select></label>
          <label className="space-y-2"><span className="text-sm font-medium">Sites específicos</span><input className="w-full rounded-xl border bg-background px-3 py-2" value={form.sources} onChange={(e) => setForm({ ...form, sources: e.target.value })} placeholder="g1.globo.com, theverge.com" /></label>
          <label className="flex items-center gap-3 md:col-span-2"><input type="checkbox" checked={form.sourcesOnly} onChange={(e) => setForm({ ...form, sourcesOnly: e.target.checked })} /><span className="text-sm">Usar somente os sites informados</span></label>
          {error ? <p className="text-sm text-destructive md:col-span-2">{error}</p> : null}
          <div className="md:col-span-2"><button disabled={saving} className="rounded-xl bg-primary px-5 py-2.5 font-medium text-primary-foreground disabled:opacity-50">{saving ? "Salvando..." : "Criar rotina"}</button></div>
        </form>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Suas rotinas</h2><span className="text-sm text-muted-foreground">{routines.length} cadastrada(s)</span></div>
        {loading ? <div className="rounded-2xl border p-6 text-muted-foreground">Carregando...</div> : routines.length === 0 ? <div className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground">Nenhuma rotina criada ainda.</div> : routines.map((routine) => (
          <article key={routine.id} className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2"><h3 className="font-semibold">{routine.name}</h3><span className={`rounded-full px-2 py-0.5 text-xs ${routine.active ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground"}`}>{routine.active ? "Ativa" : "Pausada"}</span></div>
              <p className="mt-1 text-sm text-muted-foreground">{routine.start_time?.slice(0,5) ?? "00:00"}–{routine.end_time?.slice(0,5) ?? "23:59"} · {routine.confirmation_mode === "ask_first" ? "pergunta antes" : "automática"}</p>
              <p className="mt-2 text-sm">{routine.configuration?.topics?.join(", ") || routine.description || "Rotina personalizada"}</p>
            </div>
            <div className="flex gap-2"><button onClick={() => toggle(routine)} className="rounded-xl border px-3 py-2 text-sm">{routine.active ? "Pausar" : "Ativar"}</button><button onClick={() => remove(routine.id)} className="rounded-xl border px-3 py-2 text-sm text-destructive">Excluir</button></div>
          </article>
        ))}
      </section>
    </main>
  );
}
