"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TaskRecord } from "@/lib/tasks/types";
import styles from "./agenda.module.css";

type Filter = "today" | "upcoming" | "completed" | "all";
type Draft = {
  title: string;
  description: string;
  priority: number;
  scheduledAt: string;
  dueAt: string;
  reminderAt: string;
  allDay: boolean;
};

const emptyDraft: Draft = {
  title: "",
  description: "",
  priority: 3,
  scheduledAt: "",
  dueAt: "",
  reminderAt: "",
  allDay: false,
};

function localDateKey(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIso(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function taskDate(task: TaskRecord) {
  return task.scheduled_at ?? task.due_at;
}

function taskToDraft(task: TaskRecord): Draft {
  const reminder = (task.reminders ?? []).find((item) => item.status === "scheduled");
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    scheduledAt: toLocalInput(task.scheduled_at),
    dueAt: toLocalInput(task.due_at),
    reminderAt: toLocalInput(reminder?.remind_at ?? null),
    allDay: task.all_day,
  };
}

export default function AgendaPage() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [filter, setFilter] = useState<Filter>("today");
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(new Date()));
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState("");
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");
  const [currentTime, setCurrentTime] = useState(0);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/tasks?limit=250", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao carregar a agenda.");
      setTasks(data.tasks ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao carregar a agenda.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setNotificationPermission(
        "Notification" in window ? Notification.permission : "unsupported",
      );
      setCurrentTime(Date.now());
      void loadTasks();
    }, 0);
    const clock = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(clock);
    };
  }, [loadTasks]);

  const counts = useMemo(() => {
    const today = localDateKey(new Date());
    return {
      today: tasks.filter(
        (task) =>
          ["pending", "in_progress"].includes(task.status) &&
          taskDate(task) &&
          localDateKey(taskDate(task)!) === today,
      ).length,
      open: tasks.filter((task) => ["pending", "in_progress"].includes(task.status)).length,
      overdue: tasks.filter((task) => {
        const moment = taskDate(task);
        return (
          ["pending", "in_progress"].includes(task.status) &&
          moment &&
          currentTime > 0 &&
          new Date(moment).getTime() < currentTime &&
          localDateKey(moment) !== today
        );
      }).length,
    };
  }, [currentTime, tasks]);

  const week = useMemo(() => {
    const center = new Date(`${selectedDate}T12:00:00`);
    const start = new Date(center);
    start.setDate(center.getDate() - center.getDay());
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [selectedDate]);

  const visible = useMemo(() => {
    return tasks
      .filter((task) => {
        const moment = taskDate(task);
        if (filter === "completed") return task.status === "completed";
        if (filter === "all") return task.status !== "cancelled";
        if (!["pending", "in_progress"].includes(task.status)) return false;
        if (filter === "today") {
          return Boolean(moment && localDateKey(moment) === selectedDate);
        }
        return !moment || currentTime === 0 || new Date(moment).getTime() >= currentTime;
      })
      .sort((a, b) => {
        const aTime = taskDate(a) ? new Date(taskDate(a)!).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = taskDate(b) ? new Date(taskDate(b)!).getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime || b.priority - a.priority;
      });
  }, [currentTime, filter, selectedDate, tasks]);

  async function requestNotifications() {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === "granted" && "serviceWorker" in navigator) {
      await navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }

  async function createTask() {
    setBusyId("new");
    setError("");
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          scheduledAt: toIso(draft.scheduledAt),
          dueAt: toIso(draft.dueAt),
          reminderAt: toIso(draft.reminderAt),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao criar tarefa.");
      setTasks((current) => [...current, data.task]);
      setAdding(false);
      setDraft(emptyDraft);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao criar tarefa.");
    } finally {
      setBusyId(null);
    }
  }

  async function patchTask(id: string, payload: Record<string, unknown>) {
    setBusyId(id);
    setError("");
    try {
      const response = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao atualizar tarefa.");
      setTasks((current) =>
        current.map((task) => (task.id === id ? data.task : task)),
      );
      setEditingId(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao atualizar tarefa.");
    } finally {
      setBusyId(null);
    }
  }

  async function saveEdit(id: string) {
    await patchTask(id, {
      title: draft.title,
      description: draft.description,
      priority: draft.priority,
      scheduledAt: toIso(draft.scheduledAt),
      dueAt: toIso(draft.dueAt),
      reminderAt: toIso(draft.reminderAt),
      allDay: draft.allDay,
    });
  }

  async function deleteTask(task: TaskRecord) {
    if (!window.confirm(`Excluir “${task.title}” e seus lembretes?`)) return;
    setBusyId(task.id);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao excluir tarefa.");
      setTasks((current) => current.filter((item) => item.id !== task.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao excluir tarefa.");
    } finally {
      setBusyId(null);
    }
  }

  function beginAdd() {
    setEditingId(null);
    setDraft({ ...emptyDraft, scheduledAt: `${selectedDate}T09:00` });
    setAdding(true);
  }

  function beginEdit(task: TaskRecord) {
    setAdding(false);
    setEditingId(task.id);
    setDraft(taskToDraft(task));
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
          <span><i /> AGENDA ONLINE</span>
          <a href="/memorias">MEMÓRIAS</a>
          <a href="/historico">HISTÓRICO</a>
          <a href="/dashboard">VOLTAR AO NÚCLEO</a>
        </nav>
      </header>

      <section className={styles.shell}>
        <div className={styles.intro}>
          <div>
            <span>ORQUESTRAÇÃO TEMPORAL // 03</span>
            <h1>Agenda <em>inteligente</em></h1>
            <p>Tarefas, compromissos e lembretes organizados pela Synapsay.</p>
          </div>
          <div className={styles.stats}>
            <div><strong>{counts.today}</strong><span>HOJE</span></div>
            <div><strong>{counts.open}</strong><span>ABERTAS</span></div>
            <div><strong>{counts.overdue}</strong><span>ATRASADAS</span></div>
          </div>
        </div>

        <div className={styles.actionsBar}>
          <button
            className={notificationPermission === "granted" ? styles.enabled : ""}
            onClick={() => void requestNotifications()}
          >
            {notificationPermission === "granted"
              ? "● NOTIFICAÇÕES ATIVAS"
              : notificationPermission === "denied"
                ? "NOTIFICAÇÕES BLOQUEADAS"
                : "ATIVAR NOTIFICAÇÕES"}
          </button>
          <button className={styles.addButton} onClick={beginAdd}>+ NOVA TAREFA</button>
        </div>

        <div className={styles.weekStrip}>
          {week.map((date) => {
            const key = localDateKey(date);
            const amount = tasks.filter(
              (task) =>
                ["pending", "in_progress"].includes(task.status) &&
                taskDate(task) &&
                localDateKey(taskDate(task)!) === key,
            ).length;
            return (
              <button
                key={key}
                className={selectedDate === key ? styles.selectedDay : ""}
                onClick={() => {
                  setSelectedDate(key);
                  setFilter("today");
                }}
              >
                <span>{new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(date)}</span>
                <strong>{date.getDate()}</strong>
                <i data-visible={amount > 0}>{amount || ""}</i>
              </button>
            );
          })}
        </div>

        <div className={styles.filters}>
          {(["today", "upcoming", "completed", "all"] as Filter[]).map((item) => (
            <button
              key={item}
              className={filter === item ? styles.activeFilter : ""}
              onClick={() => setFilter(item)}
            >
              {item === "today" && "Dia selecionado"}
              {item === "upcoming" && "Próximas"}
              {item === "completed" && "Concluídas"}
              {item === "all" && "Todas"}
            </button>
          ))}
        </div>

        {error && <div className={styles.error}>{error}</div>}
        {adding && (
          <TaskEditor
            draft={draft}
            setDraft={setDraft}
            busy={busyId === "new"}
            onCancel={() => setAdding(false)}
            onSave={() => void createTask()}
          />
        )}

        <div className={styles.taskList}>
          {loading && <div className={styles.empty}>SINCRONIZANDO AGENDA...</div>}
          {!loading && !visible.length && (
            <div className={styles.empty}>
              <span>○</span>
              <strong>NENHUMA TAREFA NESTE PERÍODO</strong>
              <p>Você pode adicionar manualmente ou pedir à Synapsay por voz.</p>
            </div>
          )}
          {visible.map((task) =>
            editingId === task.id ? (
              <TaskEditor
                key={task.id}
                draft={draft}
                setDraft={setDraft}
                busy={busyId === task.id}
                onCancel={() => setEditingId(null)}
                onSave={() => void saveEdit(task.id)}
              />
            ) : (
              <article className={styles.taskCard} key={task.id}>
                <button
                  className={styles.check}
                  disabled={busyId === task.id || task.status === "completed"}
                  onClick={() => void patchTask(task.id, { status: "completed" })}
                  aria-label="Concluir tarefa"
                >
                  {task.status === "completed" ? "✓" : ""}
                </button>
                <div className={styles.taskBody}>
                  <div className={styles.taskTop}>
                    <span>PRIORIDADE {task.priority}/5</span>
                    <span>{task.created_by === "assistant" ? "CRIADA PELA IA" : "MANUAL"}</span>
                  </div>
                  <h2>{task.title}</h2>
                  {task.description && <p>{task.description}</p>}
                  <div className={styles.schedule}>
                    <span>{taskDate(task) ? new Intl.DateTimeFormat("pt-BR", {
                      dateStyle: "medium",
                      timeStyle: task.all_day ? undefined : "short",
                    }).format(new Date(taskDate(task)!)) : "SEM DATA DEFINIDA"}</span>
                    {(task.reminders ?? []).filter((item) => item.status === "scheduled").map(
                      (reminder) => (
                        <span key={reminder.id} className={styles.reminder}>
                          LEMBRETE {new Intl.DateTimeFormat("pt-BR", {
                            dateStyle: "short",
                            timeStyle: "short",
                          }).format(new Date(reminder.remind_at))}
                        </span>
                      ),
                    )}
                  </div>
                </div>
                <div className={styles.cardActions}>
                  <button onClick={() => beginEdit(task)}>EDITAR</button>
                  {task.status !== "completed" && (
                    <button onClick={() => void patchTask(task.id, { status: "cancelled" })}>
                      CANCELAR
                    </button>
                  )}
                  <button className={styles.delete} onClick={() => void deleteTask(task)}>
                    EXCLUIR
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

function TaskEditor({
  draft,
  setDraft,
  busy,
  onCancel,
  onSave,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <section className={styles.editor}>
      <div className={styles.editorTitle}>CONFIGURAR TAREFA</div>
      <div className={styles.formGrid}>
        <label className={styles.wide}>TÍTULO
          <input value={draft.title} maxLength={160} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
        </label>
        <label className={styles.wide}>DETALHES
          <textarea rows={3} maxLength={4000} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
        </label>
        <label>DATA E HORÁRIO
          <input type="datetime-local" value={draft.scheduledAt} onChange={(event) => setDraft((current) => ({ ...current, scheduledAt: event.target.value }))} />
        </label>
        <label>PRAZO
          <input type="datetime-local" value={draft.dueAt} onChange={(event) => setDraft((current) => ({ ...current, dueAt: event.target.value }))} />
        </label>
        <label>LEMBRAR EM
          <input type="datetime-local" value={draft.reminderAt} onChange={(event) => setDraft((current) => ({ ...current, reminderAt: event.target.value }))} />
        </label>
        <label>PRIORIDADE
          <select value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: Number(event.target.value) }))}>
            {[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>{level} / 5</option>)}
          </select>
        </label>
        <label className={styles.checkbox}>
          <input type="checkbox" checked={draft.allDay} onChange={(event) => setDraft((current) => ({ ...current, allDay: event.target.checked }))} />
          COMPROMISSO SEM HORÁRIO EXATO
        </label>
      </div>
      <div className={styles.editorActions}>
        <button onClick={onCancel}>CANCELAR</button>
        <button className={styles.save} disabled={busy || draft.title.trim().length < 2} onClick={onSave}>
          {busy ? "SALVANDO..." : "SALVAR TAREFA"}
        </button>
      </div>
    </section>
  );
}
