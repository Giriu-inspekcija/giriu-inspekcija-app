-- GI synthetic pilot: email-first signup and one-time master bootstrap.
-- NO real cases. Bootstrap identity is configured privately in DB, NEVER in public source.
create table if not exists private.gi_admin_bootstrap (
  email text primary key check (email = lower(btrim(email)) and char_length(email) between 5 and 254),
  created_at timestamptz not null default now()
);
revoke all on private.gi_admin_bootstrap from public, anon, authenticated;

create or replace function private.gi_password_needed()
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare v_hash text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select u.encrypted_password into v_hash
  from auth.users u where u.id = auth.uid();
  if not found then raise exception 'Unknown identity'; end if;
  return nullif(btrim(v_hash), '') is null;
end;
$$;
revoke all on function private.gi_password_needed() from public, anon;
grant execute on function private.gi_password_needed() to authenticated;

create or replace function public.gi_password_needed()
returns boolean language sql stable security invoker set search_path = ''
as $$ select private.gi_password_needed(); $$;
revoke all on function public.gi_password_needed() from public, anon;
grant execute on function public.gi_password_needed() to authenticated;

create or replace function private.gi_claim_first_admin()
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_email text; v_confirmed timestamptz; v_role text; v_id uuid;
begin
  v_id := auth.uid();
  if v_id is null then raise exception 'Not signed in'; end if;
  -- Prevent concurrent claims and preserve exactly one approved first administrator.
  perform pg_catalog.pg_advisory_xact_lock(20261122, 2026);
  select lower(u.email), u.email_confirmed_at, p.role
    into v_email, v_confirmed, v_role
  from auth.users u
  join public.gi_profiles p on p.id = u.id
  where u.id = v_id
  for update of p;
  if v_email is null or v_confirmed is null or v_role <> 'pending' then
    raise exception 'Verified pending GI account required';
  end if;
  if not exists (select 1 from private.gi_admin_bootstrap b where b.email = v_email) then
    raise exception 'This email is not approved for administrator bootstrap';
  end if;
  if exists (select 1 from public.gi_profiles p where p.role='admin') then
    raise exception 'Initial GI admin has already been established';
  end if;
  update public.gi_profiles set role='admin' where id=v_id and role='pending';
  if not found then raise exception 'GI profile changed'; end if;
  insert into public.gi_role_events(actor_id,target_id,former_role,new_role)
  values(v_id,v_id,'pending','admin');
  delete from private.gi_admin_bootstrap where email=v_email;
  return true;
end;
$$;
revoke all on function private.gi_claim_first_admin() from public, anon;
grant execute on function private.gi_claim_first_admin() to authenticated;

create or replace function public.gi_claim_first_admin()
returns boolean language sql security invoker set search_path = ''
as $$ select private.gi_claim_first_admin(); $$;
revoke all on function public.gi_claim_first_admin() from public, anon;
grant execute on function public.gi_claim_first_admin() to authenticated;
