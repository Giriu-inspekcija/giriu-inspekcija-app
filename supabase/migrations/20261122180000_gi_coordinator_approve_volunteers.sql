-- Coordinators may approve pending volunteers only, never assign coordinator/admin privileges.
create or replace function private.gi_approve_volunteer(p_user uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_old text;
begin
  if coalesce((select private.gi_role()),'pending') not in ('coordinator','admin')
     or auth.uid() is null or p_user is null or p_user=auth.uid() then
    raise exception 'Coordinator permission required';
  end if;
  select role into v_old from public.gi_profiles where id=p_user for update;
  if v_old is distinct from 'pending' then
    raise exception 'Only pending accounts can be approved as volunteers';
  end if;
  update public.gi_profiles set role='volunteer' where id=p_user and role='pending';
  if not found then raise exception 'GI member status changed'; end if;
  insert into public.gi_role_events(actor_id,target_id,former_role,new_role)
    values(auth.uid(),p_user,'pending','volunteer');
end;
$$;
revoke all on function private.gi_approve_volunteer(uuid) from public, anon;
grant execute on function private.gi_approve_volunteer(uuid) to authenticated;
create or replace function public.gi_approve_volunteer(p_user uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.gi_approve_volunteer(p_user) $$;
revoke all on function public.gi_approve_volunteer(uuid) from public, anon;
grant execute on function public.gi_approve_volunteer(uuid) to authenticated;
