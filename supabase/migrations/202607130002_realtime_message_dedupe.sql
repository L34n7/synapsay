-- Identificador do evento da API Realtime para impedir mensagens duplicadas.

alter table public.messages
  add column if not exists external_event_id text;

create unique index if not exists messages_conversation_external_event_uidx
  on public.messages(conversation_id, external_event_id);
