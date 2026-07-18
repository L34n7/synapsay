alter table public.assistant_routines
  add column if not exists starts_on date,
  add column if not exists ends_on date,
  add column if not exists adapt_from_memories boolean not null default true,
  add column if not exists suggest_adjustments boolean not null default true,
  add column if not exists feedback_interval integer not null default 3,
  add column if not exists execution_count integer not null default 0,
  add column if not exists last_feedback_at timestamptz;

create table if not exists public.assistant_routine_feedback (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.assistant_routines(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid references public.assistant_routine_runs(id) on delete set null,
  sentiment text not null check (sentiment in ('positive','negative','neutral','preference')),
  message text not null,
  adjustments jsonb not null default '{}'::jsonb,
  applied boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.assistant_routine_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  signal_key text not null,
  topic text not null,
  local_period text,
  occurrences integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  suggested_at timestamptz,
  dismissed_at timestamptz,
  converted_routine_id uuid references public.assistant_routines(id) on delete set null,
  unique (user_id, signal_key)
);

create index if not exists assistant_routine_feedback_user_idx on public.assistant_routine_feedback(user_id, created_at desc);
create index if not exists assistant_routine_signals_user_idx on public.assistant_routine_signals(user_id, occurrences desc, last_seen_at desc);

alter table public.assistant_routine_feedback enable row level security;
alter table public.assistant_routine_signals enable row level security;

drop policy if exists "routine feedback owner" on public.assistant_routine_feedback;
create policy "routine feedback owner" on public.assistant_routine_feedback for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "routine signals owner" on public.assistant_routine_signals;
create policy "routine signals owner" on public.assistant_routine_signals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.increment_routine_execution(p_routine_id uuid, p_user_id uuid)
returns void language sql security invoker as $$
  update public.assistant_routines
     set execution_count = execution_count + 1,
         updated_at = now()
   where id = p_routine_id and user_id = p_user_id;
$$;
