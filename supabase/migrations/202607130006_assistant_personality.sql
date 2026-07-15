-- Personalidade do assistente por perfil de usuário.
-- Execute depois da migração 005.

alter table public.profiles
  add column if not exists communication_style text not null default 'balanced',
  add column if not exists response_detail text not null default 'balanced',
  add column if not exists assistant_tone text not null default 'friendly',
  add column if not exists assistant_boundaries text not null default '',
  add column if not exists prohibited_topics text[] not null default '{}'::text[],
  add column if not exists custom_instructions text not null default '';

update public.profiles
set assistant_name = 'Synapsay'
where length(btrim(assistant_name)) not between 2 and 40;

update public.profiles
set preferred_voice = 'marin'
where preferred_voice not in (
  'alloy', 'ash', 'ballad', 'coral', 'echo',
  'sage', 'shimmer', 'verse', 'marin', 'cedar'
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_assistant_name_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_assistant_name_check check (length(btrim(assistant_name)) between 2 and 40);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'profiles_preferred_voice_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_preferred_voice_check check (preferred_voice in ('alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'profiles_communication_style_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_communication_style_check check (communication_style in ('balanced', 'direct', 'explanatory', 'creative'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'profiles_response_detail_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_response_detail_check check (response_detail in ('short', 'balanced', 'detailed'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'profiles_assistant_tone_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_assistant_tone_check check (assistant_tone in ('friendly', 'professional', 'casual'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'profiles_personality_text_limits_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_personality_text_limits_check check (
      length(assistant_boundaries) <= 1500
      and length(custom_instructions) <= 2000
      and cardinality(prohibited_topics) <= 12
    );
  end if;
end;
$$;

comment on column public.profiles.communication_style is 'Estilo de comunicação: balanced, direct, explanatory ou creative.';
comment on column public.profiles.response_detail is 'Nível de detalhe: short, balanced ou detailed.';
comment on column public.profiles.assistant_tone is 'Tom do assistente: friendly, professional ou casual.';
comment on column public.profiles.assistant_boundaries is 'Limites de atuação definidos pelo usuário.';
comment on column public.profiles.prohibited_topics is 'Até 12 assuntos que o usuário não quer abordar.';
comment on column public.profiles.custom_instructions is 'Instruções pessoais aplicadas a todas as novas respostas.';
