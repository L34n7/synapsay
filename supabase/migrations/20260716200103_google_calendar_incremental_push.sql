-- Canais privados usados pelas notificações push e pelos sync tokens incrementais.
-- Apenas o backend service_role acessa esta tabela.

create table if not exists public.google_calendar_sync_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.google_calendar_integrations(user_id) on delete cascade,
  resource_type text not null,
  calendar_id text not null,
  channel_id uuid not null unique,
  channel_token_hash text not null,
  resource_id text not null,
  resource_uri text,
  expiration_at timestamptz not null,
  sync_token text,
  change_pending boolean not null default true,
  last_notification_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_sync_channels_resource_type_check
    check (resource_type in ('events', 'calendar_list')),
  constraint google_calendar_sync_channels_calendar_id_length_check
    check (length(calendar_id) between 1 and 1024),
  constraint google_calendar_sync_channels_token_hash_check
    check (length(channel_token_hash) = 64),
  constraint google_calendar_sync_channels_resource_id_length_check
    check (length(resource_id) between 1 and 1024),
  constraint google_calendar_sync_channels_owner_resource_unique
    unique (user_id, resource_type, calendar_id)
);

create index if not exists google_calendar_sync_channels_user_pending_idx
  on public.google_calendar_sync_channels(user_id, resource_type, calendar_id)
  where change_pending is true;

create index if not exists google_calendar_sync_channels_expiration_idx
  on public.google_calendar_sync_channels(expiration_at);

drop trigger if exists google_calendar_sync_channels_set_updated_at
  on public.google_calendar_sync_channels;
create trigger google_calendar_sync_channels_set_updated_at
before update on public.google_calendar_sync_channels
for each row execute function public.set_updated_at();

alter table public.google_calendar_sync_channels enable row level security;
revoke all on public.google_calendar_sync_channels from anon, authenticated;
grant all on public.google_calendar_sync_channels to service_role;

comment on table public.google_calendar_sync_channels is
  'Canais push privados e cursores incrementais da integração Google Calendar.';
