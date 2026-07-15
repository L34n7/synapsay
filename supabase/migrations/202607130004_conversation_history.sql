-- Histórico avançado de conversas.
-- Execute depois da migração 003.

alter table public.conversations
  add column if not exists title_source text not null default 'first_message',
  add column if not exists title_generated_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists end_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'conversations_title_source_check'
      and conrelid = 'public.conversations'::regclass
  ) then
    alter table public.conversations
      add constraint conversations_title_source_check
      check (title_source in ('first_message', 'generated', 'manual'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'conversations_end_reason_check'
      and conrelid = 'public.conversations'::regclass
  ) then
    alter table public.conversations
      add constraint conversations_end_reason_check
      check (end_reason is null or end_reason in ('user_finalized', 'inactivity', 'user_archived'));
  end if;
end;
$$;

update public.conversations
set
  ended_at = coalesce(ended_at, last_message_at, updated_at),
  end_reason = coalesce(end_reason, 'user_archived')
where status = 'archived';

create index if not exists conversations_user_status_activity_idx
  on public.conversations(user_id, status, last_message_at desc, started_at desc);

create index if not exists conversations_user_started_idx
  on public.conversations(user_id, started_at desc);

