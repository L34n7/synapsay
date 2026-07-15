-- Motor de memória controlada da Synapsay.
-- Execute depois das migrações 001 e 002.

alter table public.conversations
  add column if not exists memory_processed_at timestamptz,
  add column if not exists memory_processing_status text not null default 'pending',
  add column if not exists memory_processing_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'conversations_memory_processing_status_check'
      and conrelid = 'public.conversations'::regclass
  ) then
    alter table public.conversations
      add constraint conversations_memory_processing_status_check
      check (memory_processing_status in ('pending', 'processing', 'completed', 'failed'));
  end if;
end;
$$;

alter table public.memories
  add column if not exists conversation_id uuid references public.conversations(id) on delete set null,
  add column if not exists dedupe_key text,
  add column if not exists memory_type text not null default 'permanent',
  add column if not exists review_status text not null default 'pending',
  add column if not exists expires_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'memories_memory_type_check'
      and conrelid = 'public.memories'::regclass
  ) then
    alter table public.memories
      add constraint memories_memory_type_check
      check (memory_type in ('permanent', 'temporary'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'memories_review_status_check'
      and conrelid = 'public.memories'::regclass
  ) then
    alter table public.memories
      add constraint memories_review_status_check
      check (review_status in ('pending', 'approved', 'rejected'));
  end if;
end;
$$;

create unique index if not exists memories_user_dedupe_uidx
  on public.memories(user_id, dedupe_key);

create index if not exists memories_user_review_status_idx
  on public.memories(user_id, review_status, status, importance desc, updated_at desc);

create index if not exists memories_conversation_idx
  on public.memories(conversation_id)
  where conversation_id is not null;

