-- Cache de continuidade: contexto recente para a voz retomar conversas com naturalidade.
-- Execute depois da migration 20260715193000_tasks_reminders_agenda.sql.

create table if not exists public.assistant_continuity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  last_conversation_id uuid references public.conversations(id) on delete set null,
  last_message_id uuid references public.messages(id) on delete set null,
  last_interaction_at timestamptz,
  weekly_summary text not null default '',
  relationship_context text not null default '',
  routine_digest text not null default '',
  confirmed_routines jsonb not null default '[]'::jsonb,
  recent_topics jsonb not null default '[]'::jsonb,
  open_loops jsonb not null default '[]'::jsonb,
  recurring_candidates jsonb not null default '[]'::jsonb,
  greeting_hints jsonb not null default '{}'::jsonb,
  status text not null default 'ready',
  processed_until timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_continuity_user_unique unique (user_id),
  constraint assistant_continuity_status_check check (status in ('ready', 'processing', 'failed')),
  constraint assistant_continuity_weekly_summary_length_check check (length(weekly_summary) <= 4000),
  constraint assistant_continuity_relationship_context_length_check check (length(relationship_context) <= 2500),
  constraint assistant_continuity_routine_digest_length_check check (length(routine_digest) <= 3000),
  constraint assistant_continuity_last_error_length_check check (last_error is null or length(last_error) <= 500),
  constraint assistant_continuity_confirmed_routines_array_check check (jsonb_typeof(confirmed_routines) = 'array'),
  constraint assistant_continuity_recent_topics_array_check check (jsonb_typeof(recent_topics) = 'array'),
  constraint assistant_continuity_open_loops_array_check check (jsonb_typeof(open_loops) = 'array'),
  constraint assistant_continuity_recurring_candidates_array_check check (jsonb_typeof(recurring_candidates) = 'array'),
  constraint assistant_continuity_greeting_hints_object_check check (jsonb_typeof(greeting_hints) = 'object')
);

alter table public.assistant_continuity
  add column if not exists confirmed_routines jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'assistant_continuity_confirmed_routines_array_check'
      and conrelid = 'public.assistant_continuity'::regclass
  ) then
    alter table public.assistant_continuity
      add constraint assistant_continuity_confirmed_routines_array_check
      check (jsonb_typeof(confirmed_routines) = 'array');
  end if;
end;
$$;

create index if not exists assistant_continuity_user_updated_idx
  on public.assistant_continuity(user_id, updated_at desc);

create index if not exists assistant_continuity_last_interaction_idx
  on public.assistant_continuity(last_interaction_at desc);

drop trigger if exists assistant_continuity_set_updated_at
  on public.assistant_continuity;
create trigger assistant_continuity_set_updated_at
before update on public.assistant_continuity
for each row execute function public.set_updated_at();

alter table public.assistant_continuity enable row level security;

drop policy if exists "assistant_continuity_select_own" on public.assistant_continuity;
create policy "assistant_continuity_select_own" on public.assistant_continuity
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "assistant_continuity_insert_own" on public.assistant_continuity;
create policy "assistant_continuity_insert_own" on public.assistant_continuity
for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "assistant_continuity_update_own" on public.assistant_continuity;
create policy "assistant_continuity_update_own" on public.assistant_continuity
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "assistant_continuity_delete_own" on public.assistant_continuity;
create policy "assistant_continuity_delete_own" on public.assistant_continuity
for delete to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.assistant_continuity to authenticated;

comment on table public.assistant_continuity is
  'Resumo operacional recente para retomar conversas de voz com contexto, rotina e assuntos em aberto.';