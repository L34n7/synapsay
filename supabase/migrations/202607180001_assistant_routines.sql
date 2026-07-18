create table if not exists public.assistant_routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  active boolean not null default true,
  trigger_type text not null default 'conversation_window'
    check (trigger_type in ('conversation_window','fixed_time','calendar_event_finished','location_detected')),
  recurrence_type text not null default 'daily'
    check (recurrence_type in ('daily','weekly','once')),
  timezone text not null default 'America/Sao_Paulo',
  start_time time,
  end_time time,
  days_of_week smallint[] not null default array[0,1,2,3,4,5,6]::smallint[],
  max_executions_per_period integer not null default 1 check (max_executions_per_period > 0),
  confirmation_mode text not null default 'automatic'
    check (confirmation_mode in ('automatic','ask_first')),
  action_type text not null
    check (action_type in ('news_briefing','custom_briefing','agenda_briefing','task_briefing')),
  configuration jsonb not null default '{}'::jsonb,
  created_via text not null default 'conversation'
    check (created_via in ('conversation','voice','page','system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assistant_routine_runs (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.assistant_routines(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reference_key text not null,
  conversation_id uuid references public.conversations(id) on delete set null,
  status text not null default 'available'
    check (status in ('available','awaiting_confirmation','declined','postponed','processing','completed','expired','failed')),
  offered_at timestamptz,
  confirmed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (routine_id, reference_key)
);

create table if not exists public.assistant_routine_content_cache (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.assistant_routines(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reference_key text not null,
  content_text text not null,
  sources jsonb not null default '[]'::jsonb,
  audio_url text,
  generated_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (routine_id, reference_key)
);

create index if not exists assistant_routines_user_active_idx
  on public.assistant_routines(user_id, active);
create index if not exists assistant_routine_runs_user_status_idx
  on public.assistant_routine_runs(user_id, status, created_at desc);
create index if not exists assistant_routine_cache_user_idx
  on public.assistant_routine_content_cache(user_id, generated_at desc);

alter table public.assistant_routines enable row level security;
alter table public.assistant_routine_runs enable row level security;
alter table public.assistant_routine_content_cache enable row level security;

create policy "users manage own assistant routines"
  on public.assistant_routines for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "users manage own assistant routine runs"
  on public.assistant_routine_runs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "users read own assistant routine cache"
  on public.assistant_routine_content_cache for select
  using (auth.uid() = user_id);
create policy "users manage own assistant routine cache"
  on public.assistant_routine_content_cache for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.touch_assistant_routine_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger assistant_routines_touch_updated_at
before update on public.assistant_routines
for each row execute function public.touch_assistant_routine_updated_at();

create trigger assistant_routine_runs_touch_updated_at
before update on public.assistant_routine_runs
for each row execute function public.touch_assistant_routine_updated_at();
