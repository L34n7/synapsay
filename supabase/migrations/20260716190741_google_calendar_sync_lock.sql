-- Controle server-side para impedir sincronizações concorrentes/repetidas.
-- A UI e o assistente usam estes campos para saber quando uma sync já está em andamento.

alter table public.google_calendar_integrations
  add column if not exists sync_started_at timestamptz,
  add column if not exists sync_lock_token uuid;

create index if not exists google_calendar_integrations_sync_lock_idx
  on public.google_calendar_integrations(sync_started_at)
  where sync_started_at is not null;
