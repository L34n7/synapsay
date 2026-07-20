-- Preferência de captação do microfone na conversa por voz.
-- O padrão recomendado é "apertar para falar" para evitar captação de áudio ambiente.

alter table public.profiles
  add column if not exists microphone_mode text not null default 'push_to_talk';

update public.profiles
set microphone_mode = 'push_to_talk'
where microphone_mode not in ('push_to_talk', 'open');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_microphone_mode_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_microphone_mode_check
      check (microphone_mode in ('push_to_talk', 'open'));
  end if;
end;
$$;

comment on column public.profiles.microphone_mode is
  'Modo de captação da conversa por voz: push_to_talk ou open.';
