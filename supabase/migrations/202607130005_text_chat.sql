-- Conversa por texto com streaming e recuperação de falhas.
-- Execute depois da migração 004.

alter table public.messages
  add column if not exists generation_status text not null default 'completed',
  add column if not exists error_message text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'messages_generation_status_check'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_generation_status_check
      check (generation_status in ('streaming', 'completed', 'interrupted', 'error'));
  end if;
end;
$$;

create index if not exists messages_user_generation_status_idx
  on public.messages(user_id, generation_status, created_at desc);

drop policy if exists "messages_update_own" on public.messages;
create policy "messages_update_own" on public.messages
for update to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.conversations
    where conversations.id = messages.conversation_id
      and conversations.user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.conversations
    where conversations.id = messages.conversation_id
      and conversations.user_id = (select auth.uid())
  )
);

grant update on public.messages to authenticated;

