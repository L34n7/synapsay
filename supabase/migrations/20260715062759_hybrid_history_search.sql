-- Busca híbrida de histórico: texto literal + similaridade semântica.
-- Execute depois da migração 006.

create extension if not exists vector with schema extensions;

alter table public.messages
  add column if not exists embedding extensions.vector(1536),
  add column if not exists embedding_model text,
  add column if not exists embedding_updated_at timestamptz;

create index if not exists messages_embedding_hnsw_idx
  on public.messages
  using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

create or replace function public.match_message_history(
  query_embedding extensions.vector(1536),
  match_count integer default 30,
  filter_conversation_id uuid default null,
  exclude_conversation_id uuid default null,
  exclude_message_id uuid default null,
  filter_from timestamptz default null,
  filter_to timestamptz default null
)
returns table (
  id uuid,
  conversation_id uuid,
  role text,
  content text,
  created_at timestamptz,
  similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    messages.id,
    messages.conversation_id,
    messages.role,
    messages.content,
    messages.created_at,
    1 - (
      messages.embedding OPERATOR(extensions.<=>) query_embedding
    ) as similarity
  from public.messages
  where messages.user_id = (select auth.uid())
    and messages.embedding is not null
    and messages.generation_status = 'completed'
    and (
      filter_conversation_id is null
      or messages.conversation_id = filter_conversation_id
    )
    and (
      exclude_conversation_id is null
      or messages.conversation_id <> exclude_conversation_id
    )
    and (exclude_message_id is null or messages.id <> exclude_message_id)
    and (filter_from is null or messages.created_at >= filter_from)
    and (filter_to is null or messages.created_at < filter_to)
  order by messages.embedding OPERATOR(extensions.<=>) query_embedding
  limit least(greatest(coalesce(match_count, 30), 1), 100);
$$;

revoke all on function public.match_message_history(
  extensions.vector,
  integer,
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz
) from public;
revoke all on function public.match_message_history(
  extensions.vector,
  integer,
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz
) from anon;
grant execute on function public.match_message_history(
  extensions.vector,
  integer,
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz
) to authenticated;

comment on function public.match_message_history(
  extensions.vector,
  integer,
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz
) is
  'Busca mensagens semanticamente semelhantes, sempre limitada ao usuário autenticado e às políticas RLS.';
