-- Completa o motor de rotinas com reivindicacao atomica, repeticoes por
-- periodo, recuperacao de falhas e privilegios explicitos para a Data API.

alter table public.assistant_routine_runs
  add column if not exists period_key text,
  add column if not exists execution_number integer not null default 1,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists available_after timestamptz,
  add column if not exists is_test boolean not null default false;

update public.assistant_routine_runs
   set period_key = regexp_replace(reference_key, ':[0-9]+$', ''),
       execution_number = coalesce(
         nullif(substring(reference_key from ':([0-9]+)$'), '')::integer,
         1
       )
 where period_key is null;

alter table public.assistant_routine_runs
  alter column period_key set not null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'assistant_routine_runs_execution_number_check'
       and conrelid = 'public.assistant_routine_runs'::regclass
  ) then
    alter table public.assistant_routine_runs
      add constraint assistant_routine_runs_execution_number_check
      check (execution_number > 0);
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'assistant_routine_runs_attempt_count_check'
       and conrelid = 'public.assistant_routine_runs'::regclass
  ) then
    alter table public.assistant_routine_runs
      add constraint assistant_routine_runs_attempt_count_check
      check (attempt_count between 0 and 10);
  end if;
end
$$;

create unique index if not exists assistant_routine_runs_period_execution_uidx
  on public.assistant_routine_runs(routine_id, period_key, execution_number);

create unique index if not exists assistant_routine_runs_conversation_period_uidx
  on public.assistant_routine_runs(routine_id, period_key, conversation_id)
  where conversation_id is not null and is_test is false;

create index if not exists assistant_routine_runs_claim_idx
  on public.assistant_routine_runs(routine_id, user_id, period_key, status, execution_number);

drop policy if exists "users manage own assistant routines" on public.assistant_routines;
create policy "users manage own assistant routines"
  on public.assistant_routines for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "users manage own assistant routine runs" on public.assistant_routine_runs;
create policy "users read own assistant routine runs"
  on public.assistant_routine_runs for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "users insert own assistant routine runs"
  on public.assistant_routine_runs for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and (
      conversation_id is null
      or exists (
        select 1
          from public.conversations
         where conversations.id = assistant_routine_runs.conversation_id
           and conversations.user_id = (select auth.uid())
      )
    )
  );

create policy "users update own assistant routine runs"
  on public.assistant_routine_runs for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (
      conversation_id is null
      or exists (
        select 1
          from public.conversations
         where conversations.id = assistant_routine_runs.conversation_id
           and conversations.user_id = (select auth.uid())
      )
    )
  );

create policy "users delete own assistant routine runs"
  on public.assistant_routine_runs for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "users read own assistant routine cache" on public.assistant_routine_content_cache;
drop policy if exists "users manage own assistant routine cache" on public.assistant_routine_content_cache;
create policy "users manage own assistant routine cache"
  on public.assistant_routine_content_cache for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "routine feedback owner" on public.assistant_routine_feedback;
create policy "routine feedback owner"
  on public.assistant_routine_feedback for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "routine signals owner" on public.assistant_routine_signals;
create policy "routine signals owner"
  on public.assistant_routine_signals for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.assistant_routines to authenticated, service_role;
grant select, insert, update, delete on public.assistant_routine_runs to authenticated, service_role;
grant select, insert, update, delete on public.assistant_routine_content_cache to authenticated, service_role;
grant select, insert, update, delete on public.assistant_routine_feedback to authenticated, service_role;
grant select, insert, update, delete on public.assistant_routine_signals to authenticated, service_role;

create or replace function public.claim_assistant_routine_run(
  p_routine_id uuid,
  p_period_key text,
  p_conversation_id uuid default null,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_routine public.assistant_routines%rowtype;
  v_existing public.assistant_routine_runs%rowtype;
  v_run public.assistant_routine_runs%rowtype;
  v_count integer;
  v_execution_number integer;
  v_reference_key text;
begin
  if v_user_id is null or nullif(btrim(p_period_key), '') is null then
    return null;
  end if;

  select *
    into v_routine
    from public.assistant_routines
   where id = p_routine_id
     and user_id = v_user_id
     and active is true;

  if not found then
    return null;
  end if;

  select *
    into v_existing
    from public.assistant_routine_runs
   where routine_id = p_routine_id
     and user_id = v_user_id
     and period_key = p_period_key
     and is_test is false
     and (
       (status = 'failed' and attempt_count < 3)
       or (
         status = 'processing'
         and coalesce(last_attempt_at, updated_at) < now() - interval '2 minutes'
       )
       or (status = 'postponed' and available_after is not null and available_after <= now())
     )
   order by execution_number
   for update skip locked
   limit 1;

  if found then
    update public.assistant_routine_runs
       set status = case
         when v_existing.confirmed_at is not null then 'available'
         when v_routine.confirmation_mode = 'ask_first' then 'awaiting_confirmation'
         else 'available'
       end,
       conversation_id = coalesce(p_conversation_id, conversation_id),
       offered_at = now(),
       started_at = null,
       available_after = null,
       expires_at = coalesce(p_expires_at, expires_at),
       error_message = null
     where id = v_existing.id
     returning * into v_run;

    return to_jsonb(v_run);
  end if;

  if p_conversation_id is not null and exists (
    select 1
      from public.assistant_routine_runs
     where routine_id = p_routine_id
       and user_id = v_user_id
       and period_key = p_period_key
       and conversation_id = p_conversation_id
       and is_test is false
  ) then
    return null;
  end if;

  select count(*), coalesce(max(execution_number), 0) + 1
    into v_count, v_execution_number
    from public.assistant_routine_runs
   where routine_id = p_routine_id
     and user_id = v_user_id
     and period_key = p_period_key
     and is_test is false;

  if v_count >= v_routine.max_executions_per_period then
    return null;
  end if;

  v_reference_key := case
    when v_routine.max_executions_per_period = 1 then p_period_key
    else p_period_key || ':' || v_execution_number::text
  end;

  insert into public.assistant_routine_runs (
    routine_id,
    user_id,
    period_key,
    execution_number,
    reference_key,
    conversation_id,
    status,
    offered_at,
    expires_at
  ) values (
    p_routine_id,
    v_user_id,
    p_period_key,
    v_execution_number,
    v_reference_key,
    p_conversation_id,
    case
      when v_routine.confirmation_mode = 'ask_first' then 'awaiting_confirmation'
      else 'available'
    end,
    now(),
    p_expires_at
  )
  on conflict do nothing
  returning * into v_run;

  if v_run.id is null then
    return null;
  end if;

  return to_jsonb(v_run);
end;
$$;

revoke all on function public.claim_assistant_routine_run(uuid, text, uuid, timestamptz) from public, anon;
grant execute on function public.claim_assistant_routine_run(uuid, text, uuid, timestamptz) to authenticated, service_role;

revoke all on function public.increment_routine_execution(uuid, uuid) from public, anon;
grant execute on function public.increment_routine_execution(uuid, uuid) to authenticated, service_role;
