-- Adiciona aniversário ao perfil e usa metadata do Auth na criação da conta.

alter table public.profiles
  add column if not exists birthday date;

comment on column public.profiles.display_name is 'Nome preferido do usuário para saudações e conversas.';
comment on column public.profiles.birthday is 'Data de aniversário do usuário, quando informada.';

create or replace function public.safe_profile_birthday(p_value text)
returns date
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;

  if p_value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;

  return p_value::date;
exception
  when others then
    return null;
end;
$$;

revoke all on function public.safe_profile_birthday(text) from public;

create or replace function public.birthday_from_auth_profile(p_metadata jsonb)
returns date
language sql
stable
security invoker
set search_path = ''
as $$
  select public.safe_profile_birthday(p_metadata ->> 'birthday');
$$;

revoke all on function public.birthday_from_auth_profile(jsonb) from public;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, birthday)
  values (
    new.id,
    public.display_name_from_auth_profile(new.email, new.raw_user_meta_data),
    public.birthday_from_auth_profile(new.raw_user_meta_data)
  )
  on conflict (id) do update
  set
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    birthday = coalesce(public.profiles.birthday, excluded.birthday);
  return new;
end;
$$;

update public.profiles as profile
set
  birthday = public.birthday_from_auth_profile(auth_user.raw_user_meta_data),
  updated_at = now()
from auth.users as auth_user
where profile.id = auth_user.id
  and profile.birthday is null
  and public.birthday_from_auth_profile(auth_user.raw_user_meta_data) is not null;
