-- Agenda inteligente: tarefas e lembretes da Synapsay.
-- Execute depois da migration 20260715062759_hybrid_history_search.sql.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  source_message_id uuid references public.messages(id) on delete set null,
  source_action_index smallint,
  title text not null,
  description text not null default '',
  status text not null default 'pending',
  priority smallint not null default 3,
  scheduled_at timestamptz,
  due_at timestamptz,
  all_day boolean not null default false,
  timezone text not null default 'America/Sao_Paulo',
  recurrence_rule text,
  created_by text not null default 'manual',
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_title_length_check check (length(btrim(title)) between 2 and 160),
  constraint tasks_description_length_check check (length(description) <= 4000),
  constraint tasks_status_check check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  constraint tasks_priority_check check (priority between 1 and 5),
  constraint tasks_created_by_check check (created_by in ('manual', 'assistant', 'integration')),
  constraint tasks_schedule_order_check check (due_at is null or scheduled_at is null or due_at >= scheduled_at),
  constraint tasks_source_action_check check (
    source_message_id is null
    or (source_message_id is not null and source_action_index between 0 and 20)
  )
);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  remind_at timestamptz not null,
  channel text not null default 'browser',
  status text not null default 'scheduled',
  delivered_at timestamptz,
  dismissed_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminders_channel_check check (channel in ('browser', 'in_app')),
  constraint reminders_status_check check (status in ('scheduled', 'delivered', 'dismissed', 'cancelled', 'failed')),
  constraint reminders_error_length_check check (last_error is null or length(last_error) <= 500)
);

create unique index if not exists tasks_source_action_uidx
  on public.tasks(user_id, source_message_id, source_action_index)
  where source_message_id is not null;

create index if not exists tasks_user_schedule_idx
  on public.tasks(user_id, status, scheduled_at, due_at);

create index if not exists tasks_user_updated_idx
  on public.tasks(user_id, updated_at desc);

create unique index if not exists reminders_task_time_channel_uidx
  on public.reminders(task_id, remind_at, channel);

create index if not exists reminders_user_due_idx
  on public.reminders(user_id, status, remind_at)
  where status = 'scheduled';

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

drop trigger if exists reminders_set_updated_at on public.reminders;
create trigger reminders_set_updated_at
before update on public.reminders
for each row execute function public.set_updated_at();

alter table public.tasks enable row level security;
alter table public.reminders enable row level security;

drop policy if exists "tasks_select_own" on public.tasks;
create policy "tasks_select_own" on public.tasks
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "tasks_insert_own" on public.tasks;
create policy "tasks_insert_own" on public.tasks
for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and (
    conversation_id is null
    or exists (
      select 1 from public.conversations
      where conversations.id = tasks.conversation_id
      and conversations.user_id = (select auth.uid())
    )
  )
  and (
    source_message_id is null
    or exists (
      select 1 from public.messages
      where messages.id = tasks.source_message_id
        and messages.user_id = (select auth.uid())
    )
  )
);

drop policy if exists "tasks_update_own" on public.tasks;
create policy "tasks_update_own" on public.tasks
for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and (
    conversation_id is null
    or exists (
      select 1 from public.conversations
      where conversations.id = tasks.conversation_id
      and conversations.user_id = (select auth.uid())
    )
  )
  and (
    source_message_id is null
    or exists (
      select 1 from public.messages
      where messages.id = tasks.source_message_id
        and messages.user_id = (select auth.uid())
    )
  )
);

drop policy if exists "tasks_delete_own" on public.tasks;
create policy "tasks_delete_own" on public.tasks
for delete to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "reminders_select_own" on public.reminders;
create policy "reminders_select_own" on public.reminders
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "reminders_insert_own" on public.reminders;
create policy "reminders_insert_own" on public.reminders
for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.tasks
    where tasks.id = reminders.task_id
      and tasks.user_id = (select auth.uid())
  )
);

drop policy if exists "reminders_update_own" on public.reminders;
create policy "reminders_update_own" on public.reminders
for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.tasks
    where tasks.id = reminders.task_id
      and tasks.user_id = (select auth.uid())
  )
);

drop policy if exists "reminders_delete_own" on public.reminders;
create policy "reminders_delete_own" on public.reminders
for delete to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.reminders to authenticated;

comment on table public.tasks is 'Tarefas e compromissos estruturados do usuário.';
comment on table public.reminders is 'Avisos vinculados a tarefas, entregues pelos canais disponíveis.';
