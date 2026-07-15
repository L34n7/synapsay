"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./reminder-notifications.module.css";

type DueReminder = {
  id: string;
  remind_at: string;
  task: {
    id: string;
    title: string;
    description: string;
    scheduled_at: string | null;
    due_at: string | null;
  };
};

export default function ReminderNotifications() {
  const [visible, setVisible] = useState<DueReminder[]>([]);
  const processingRef = useRef(false);
  const seenRef = useRef(new Set<string>());

  const markDelivered = useCallback(async (id: string) => {
    await fetch(`/api/reminders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "delivered" }),
    }).catch(() => undefined);
  }, []);

  const showBrowserNotification = useCallback(async (reminder: DueReminder) => {
    if (!("Notification" in window) || Notification.permission !== "granted") {
      return false;
    }
    const options: NotificationOptions = {
      body: reminder.task.description || "Você tem uma tarefa programada.",
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      tag: `synapsay-reminder-${reminder.id}`,
      data: { url: "/agenda", reminderId: reminder.id },
      requireInteraction: true,
    };
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker
        .register("/sw.js")
        .catch(() => null);
      if (registration) {
        await registration.showNotification(`Synapsay · ${reminder.task.title}`, options);
        return true;
      }
    }
    new Notification(`Synapsay · ${reminder.task.title}`, options);
    return true;
  }, []);

  const checkDue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      const response = await fetch("/api/reminders/due", { cache: "no-store" });
      if (response.status === 401) return;
      const data = await response.json();
      if (!response.ok) return;
      const reminders = (data.reminders ?? []) as DueReminder[];
      for (const reminder of reminders) {
        if (seenRef.current.has(reminder.id)) continue;
        seenRef.current.add(reminder.id);
        setVisible((current) => [...current, reminder].slice(-4));
        await showBrowserNotification(reminder).catch(() => false);
        await markDelivered(reminder.id);
      }
    } finally {
      processingRef.current = false;
    }
  }, [markDelivered, showBrowserNotification]);

  useEffect(() => {
    void checkDue();
    const timer = window.setInterval(() => void checkDue(), 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void checkDue();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [checkDue]);

  if (!visible.length) return null;
  return (
    <aside className={styles.stack} aria-live="assertive" aria-label="Lembretes">
      {visible.map((reminder) => (
        <article className={styles.toast} key={reminder.id}>
          <div className={styles.pulse} />
          <div>
            <span>LEMBRETE SYNAPSAY</span>
            <strong>{reminder.task.title}</strong>
            {reminder.task.description && <p>{reminder.task.description}</p>}
            <a href="/agenda">ABRIR AGENDA</a>
          </div>
          <button
            aria-label="Fechar lembrete"
            onClick={() =>
              setVisible((current) => current.filter((item) => item.id !== reminder.id))
            }
          >
            ×
          </button>
        </article>
      ))}
    </aside>
  );
}

