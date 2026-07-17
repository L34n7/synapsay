-- Evita nomes de perfil artificiais como "leandro.isidorio" quando o
-- cadastro veio apenas do e-mail.

create or replace function public.display_name_from_auth_profile(
  p_email text,
  p_metadata jsonb
)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  with candidates as (
    select
      nullif(btrim(
        case
          when p_metadata ->> 'display_name' ~ '^[^[:space:]@]+@[^[:space:]@]+$'
            then initcap(regexp_replace(split_part(p_metadata ->> 'display_name', '@', 1), '[._+-].*$', ''))
          when p_metadata ->> 'display_name' ~ '^[^[:space:]@._+-]+[._+-][^[:space:]@]+$'
            then initcap(regexp_replace(p_metadata ->> 'display_name', '[._+-].*$', ''))
          else p_metadata ->> 'display_name'
        end
      ), '') as metadata_display_name,
      nullif(btrim(
        case
          when p_metadata ->> 'full_name' ~ '^[^[:space:]@]+@[^[:space:]@]+$'
            then initcap(regexp_replace(split_part(p_metadata ->> 'full_name', '@', 1), '[._+-].*$', ''))
          when p_metadata ->> 'full_name' ~ '^[^[:space:]@._+-]+[._+-][^[:space:]@]+$'
            then initcap(regexp_replace(p_metadata ->> 'full_name', '[._+-].*$', ''))
          else p_metadata ->> 'full_name'
        end
      ), '') as metadata_full_name,
      nullif(btrim(split_part(coalesce(p_email, ''), '@', 1)), '') as email_local_part
  ),
  picked as (
    select coalesce(
      metadata_display_name,
      metadata_full_name,
      nullif(initcap(regexp_replace(email_local_part, '[._+-].*$', '')), '')
    ) as display_name
    from candidates
  )
  select nullif(btrim(regexp_replace(display_name, '\s+', ' ', 'g')), '')
  from picked;
$$;

revoke all on function public.display_name_from_auth_profile(text, jsonb) from public;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    public.display_name_from_auth_profile(new.email, new.raw_user_meta_data)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

update public.profiles as profile
set
  display_name = public.display_name_from_auth_profile(auth_user.email, auth_user.raw_user_meta_data),
  updated_at = now()
from auth.users as auth_user
where profile.id = auth_user.id
  and nullif(btrim(profile.display_name), '') is not null
  and btrim(profile.display_name) = split_part(coalesce(auth_user.email, ''), '@', 1)
  and profile.display_name ~ '[._+-]'
  and public.display_name_from_auth_profile(auth_user.email, auth_user.raw_user_meta_data) is not null
  and public.display_name_from_auth_profile(auth_user.email, auth_user.raw_user_meta_data) <> profile.display_name;
