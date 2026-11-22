-- Determine whether the current verified email owner may claim the single bootstrap role.
-- Keeps the reserved address out of public client code and GitHub.
create or replace function private.gi_is_bootstrap_candidate()
returns boolean language sql stable security definer set search_path = ''
as $$
select exists(
  select 1 from auth.users u
  inner join public.gi_profiles p on p.id=u.id
  inner join private.gi_admin_bootstrap b on b.email=lower(u.email)
  where u.id=auth.uid()
    and u.email_confirmed_at is not null
    and p.role='pending'
    and not exists(select 1 from public.gi_profiles a where a.role='admin')
)
$$;
revoke all on function private.gi_is_bootstrap_candidate() from public, anon;
grant execute on function private.gi_is_bootstrap_candidate() to authenticated;
create or replace function public.gi_is_bootstrap_candidate()
returns boolean language sql stable security invoker set search_path = ''
as $$select private.gi_is_bootstrap_candidate()$$;
revoke all on function public.gi_is_bootstrap_candidate() from public, anon;
grant execute on function public.gi_is_bootstrap_candidate() to authenticated;
