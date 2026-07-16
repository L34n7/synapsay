"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./agenda.module.css";

type Direction = "bidirectional" | "google_to_synapsay" | "synapsay_to_google";
type IntegrationStatus =
  | { connected: false }
  | {
      connected: true;
      email: string;
      name: string | null;
      calendarId: string;
      calendarName: string;
      calendarTimezone: string;
      syncEnabled: boolean;
      syncDirection: Direction;
      lastSyncAt: string | null;
      lastSyncError: string | null;
      reconnectRequired: boolean;
    };
type CalendarOption = {
  id: string;
  name: string;
  primary: boolean;
  timezone: string;
  color: string | null;
};

async function jsonRequest<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Falha ao acessar o Google Agenda.");
  return data;
}

export default function GoogleCalendarIntegration({ onSynced }: { onSynced: () => void }) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const callbackHandled = useRef(false);

  const loadStatus = useCallback(async () => {
    const data = await jsonRequest<IntegrationStatus>(
      `/api/integracoes/google-calendar/status?at=${Date.now()}`,
    );
    setStatus(data);
    return data;
  }, []);

  const loadCalendars = useCallback(async () => {
    const data = await jsonRequest<{ calendars: CalendarOption[] }>(
      "/api/integracoes/google-calendar/calendarios",
    );
    setCalendars(data.calendars ?? []);
  }, []);

  const synchronize = useCallback(async () => {
    setBusy("sync");
    setError("");
    setMessage("");
    try {
      const data = await jsonRequest<{
        result: { imported?: number; updated?: number; exported?: number };
      }>("/api/integracoes/google-calendar/sincronizar", { method: "POST" });
      const result = data.result;
      setMessage(
        `Sincronização concluída: ${result.imported ?? 0} importados, ${result.updated ?? 0} atualizados e ${result.exported ?? 0} enviados.`,
      );
      await loadStatus();
      onSynced();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao sincronizar agendas.");
      await loadStatus().catch(() => undefined);
    } finally {
      setBusy("");
    }
  }, [loadStatus, onSynced]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void loadStatus().then(async (current) => {
        if (!active) return;
        const query = new URLSearchParams(window.location.search);
        const callbackStatus = query.get("google_calendar");
        const callbackMessage = query.get("message");
        if (!callbackHandled.current && callbackStatus) {
          callbackHandled.current = true;
          query.delete("google_calendar");
          query.delete("message");
          window.history.replaceState(
            {},
            "",
            `${window.location.pathname}${query.size ? `?${query}` : ""}`,
          );
          if (callbackStatus === "connected") {
            if (current.connected) {
              setMessage("Conta Google conectada. Preparando a primeira sincronização...");
              await loadCalendars();
              await synchronize();
            } else {
              setError(
                "O Google autorizou a conexão, mas a Synapsay não conseguiu confirmar o vínculo. Atualize a página; se o botão continuar aparecendo, conecte novamente.",
              );
            }
          } else if (callbackMessage) {
            setError(callbackMessage);
          }
          return;
        }
        if (!current.connected) return;
        await loadCalendars();
        const lastSyncTime = current.lastSyncAt
          ? new Date(current.lastSyncAt).getTime()
          : 0;
        if (
          !callbackHandled.current &&
          current.syncEnabled &&
          Date.now() - lastSyncTime > 5 * 60_000
        ) {
          callbackHandled.current = true;
          await synchronize();
        }
        }).catch((reason) => {
          if (active) setError(reason instanceof Error ? reason.message : "Falha ao carregar integração.");
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [loadCalendars, loadStatus, synchronize]);

  async function updateConfiguration(payload: {
    calendarId?: string;
    syncEnabled?: boolean;
    syncDirection?: Direction;
  }) {
    setBusy("settings");
    setError("");
    setMessage("");
    try {
      await jsonRequest("/api/integracoes/google-calendar/configuracao", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await loadStatus();
      setMessage("Configuração do Google Agenda salva.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao salvar configuração.");
    } finally {
      setBusy("");
    }
  }

  async function disconnect() {
    if (!window.confirm("Desconectar o Google Agenda? Os eventos já criados serão preservados.")) return;
    setBusy("disconnect");
    setError("");
    try {
      await jsonRequest("/api/integracoes/google-calendar/desconectar", { method: "DELETE" });
      setStatus({ connected: false });
      setCalendars([]);
      setMessage("Google Agenda desconectado.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao desconectar.");
    } finally {
      setBusy("");
    }
  }

  if (!status) {
    return (
      <section className={styles.googleCard}>
        {error ? <p className={styles.googleError}>{error}</p> : "CARREGANDO INTEGRAÇÕES..."}
      </section>
    );
  }

  if (!status.connected) {
    return (
      <section className={styles.googleCard}>
        <div className={styles.googleIdentity}>
          <span className={styles.googleMark}>G</span>
          <div>
            <strong>Google Agenda</strong>
            <p>Sincronize compromissos da Synapsay com sua agenda do Google.</p>
          </div>
        </div>
        <a className={styles.googleConnect} href="/api/integracoes/google-calendar/auth">
          CONECTAR GOOGLE AGENDA
        </a>
        {message && <p className={styles.googleSuccess}>{message}</p>}
        {error && <p className={styles.googleError}>{error}</p>}
      </section>
    );
  }

  return (
    <section className={styles.googleCard}>
      <div className={styles.googleIdentity}>
        <span className={styles.googleMark}>G</span>
        <div>
          <strong>{status.name || "Google Agenda"}</strong>
          <p>{status.email} · {status.calendarName}</p>
        </div>
        <span className={styles.googleConnected}>● CONECTADO</span>
      </div>

      <div className={styles.googleControls}>
        <label>
          AGENDA PARA NOVOS COMPROMISSOS
          <select
            value={status.calendarId}
            disabled={busy !== ""}
            onChange={(event) => void updateConfiguration({ calendarId: event.target.value })}
          >
            {!calendars.some((item) => item.id === status.calendarId) && (
              <option value={status.calendarId}>{status.calendarName}</option>
            )}
            {calendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.name}{calendar.primary ? " (principal)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          FLUXO DE SINCRONIZAÇÃO
          <select
            value={status.syncDirection}
            disabled={busy !== ""}
            onChange={(event) =>
              void updateConfiguration({ syncDirection: event.target.value as Direction })
            }
          >
            <option value="bidirectional">Google ↔ Synapsay</option>
            <option value="google_to_synapsay">Google → Synapsay</option>
            <option value="synapsay_to_google">Synapsay → Google</option>
          </select>
        </label>
        <label className={styles.googleToggle}>
          <input
            type="checkbox"
            checked={status.syncEnabled}
            disabled={busy !== ""}
            onChange={(event) =>
              void updateConfiguration({ syncEnabled: event.target.checked })
            }
          />
          SINCRONIZAÇÃO AUTOMÁTICA
        </label>
      </div>

      <div className={styles.googleFooter}>
        <span>
          {status.lastSyncAt
            ? `Última sincronização: ${new Intl.DateTimeFormat("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
              }).format(new Date(status.lastSyncAt))}`
            : "Ainda não sincronizado"}
        </span>
        <div>
          <button onClick={() => void disconnect()} disabled={busy !== ""}>DESCONECTAR</button>
          {status.reconnectRequired ? (
            <a href="/api/integracoes/google-calendar/auth">RECONECTAR</a>
          ) : (
            <button
              className={styles.googleSync}
              onClick={() => void synchronize()}
              disabled={busy !== ""}
            >
              {busy === "sync" ? "SINCRONIZANDO..." : "SINCRONIZAR AGORA"}
            </button>
          )}
        </div>
      </div>
      {message && <p className={styles.googleSuccess}>{message}</p>}
      {(error || status.lastSyncError) && (
        <p className={styles.googleError}>{error || status.lastSyncError}</p>
      )}
    </section>
  );
}
