-- Integração privada entre a agenda da Synapsay e o Google Calendar.
-- As duas tabelas são acessadas apenas pelo backend com service_role.

create table if not exists public.google_calendar_integrations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_account_id text not null,
  google_email text not null,
  google_name text,
  google_picture_url text,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  access_token_expires_at timestamptz not null,
  granted_scopes text[] not null default '{}'::text[],
  selected_calendar_id text not null default 'primary',
  selected_calendar_name text not null default 'Agenda principal',
  selected_calendar_timezone text not null default 'America/Sao_Paulo',
  sync_enabled boolean not null default true,
  sync_direction text not null default 'bidirectional',
  last_sync_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_account_id_length_check
    check (length(google_account_id) between 1 and 255),
  constraint google_calendar_email_length_check
    check (length(google_email) between 3 and 320),
  constraint google_calendar_id_length_check
    check (length(selected_calendar_id) between 1 and 1024),
  constraint google_calendar_sync_direction_check
    check (sync_direction in ('bidirectional', 'google_to_synapsay', 'synapsay_to_google')),
  constraint google_calendar_sync_error_length_check
    check (last_sync_error is null or length(last_sync_error) <= 1000)
);

create table if not exists public.google_calendar_event_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.google_calendar_integrations(user_id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  calendar_id text not null,
  google_event_id text not null,
  google_event_etag text,
  google_event_updated_at timestamptz,
  google_html_link text,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_event_calendar_id_length_check
    check (length(calendar_id) between 1 and 1024),
  constraint google_calendar_event_id_length_check
    check (length(google_event_id) between 1 and 1024),
  constraint google_calendar_event_link_owner_unique unique (user_id, calendar_id, google_event_id),
  constraint google_calendar_event_task_unique unique (task_id)
);

create index if not exists google_calendar_integrations_sync_idx
  on public.google_calendar_integrations(sync_enabled, last_sync_at)
  where sync_enabled is true;

create index if not exists google_calendar_event_links_user_idx
  on public.google_calendar_event_links(user_id, calendar_id, google_event_updated_at);

drop trigger if exists google_calendar_integrations_set_updated_at
  on public.google_calendar_integrations;
create trigger google_calendar_integrations_set_updated_at
before update on public.google_calendar_integrations
for each row execute function public.set_updated_at();

drop trigger if exists google_calendar_event_links_set_updated_at
  on public.google_calendar_event_links;
create trigger google_calendar_event_links_set_updated_at
before update on public.google_calendar_event_links
for each row execute function public.set_updated_at();

alter table public.google_calendar_integrations enable row level security;
alter table public.google_calendar_event_links enable row level security;

-- Tokens OAuth nunca ficam disponíveis ao cliente autenticado pela Data API.
revoke all on public.google_calendar_integrations from anon, authenticated;
revoke all on public.google_calendar_event_links from anon, authenticated;
grant all on public.google_calendar_integrations to service_role;
grant all on public.google_calendar_event_links to service_role;

comment on table public.google_calendar_integrations is
  'Credenciais OAuth criptografadas e preferências de sincronização do Google Calendar.';
comment on table public.google_calendar_event_links is
  'Relação privada entre tarefas da Synapsay e eventos do Google Calendar.';
