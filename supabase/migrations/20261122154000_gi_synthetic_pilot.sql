-- Girių inspekcija: ONLY synthetic pilot data. No connection to existing GI registries.
-- Supabase migration; REVIEW and test in an isolated, empty Supabase project first.
-- Deliberately prefixed gi_ to avoid collisions with existing application tables.
create schema if not exists private;
grant usage on schema private to authenticated;

create table if not exists public.gi_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 100),
  role text not null default 'pending' check (role in ('pending','volunteer','coordinator','admin')),
  created_at timestamptz not null default now()
);
create table if not exists public.gi_tasks (
  id uuid primary key default gen_random_uuid(),
  source_ref text unique check (source_ref is null or char_length(source_ref) <= 160),
  title text not null check (char_length(btrim(title)) between 3 and 140),
  details text not null check (char_length(btrim(details)) between 5 and 6000),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  status text not null default 'proposed' check (status in
    ('proposed','pool','assigned','accepted','in_progress','submitted','returned','approved')),
  assigned_to uuid references public.gi_profiles(id) on delete set null,
  created_by uuid references public.gi_profiles(id) on delete set null,
  due_at timestamptz,
  result_text text check (result_text is null or char_length(result_text) <= 6000),
  feedback_text text check (feedback_text is null or char_length(feedback_text) <= 2000),
  is_demo boolean not null default true check (is_demo = true),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.gi_task_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.gi_tasks(id) on delete cascade,
  actor_id uuid references public.gi_profiles(id) on delete set null,
  action text not null,
  note text,
  created_at timestamptz not null default now()
);
create table if not exists public.gi_role_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.gi_profiles(id) on delete set null,
  target_id uuid references public.gi_profiles(id) on delete set null,
  former_role text not null,
  new_role text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.gi_work_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.gi_tasks(id) on delete cascade,
  volunteer_id uuid not null references public.gi_profiles(id) on delete cascade,
  minutes int not null check (minutes between 1 and 720),
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists gi_tasks_assignee_idx on public.gi_tasks(assigned_to,status);
create index if not exists gi_tasks_status_idx on public.gi_tasks(status,updated_at);
create index if not exists gi_events_task_idx on public.gi_task_events(task_id,created_at);
create index if not exists gi_logs_owner_idx on public.gi_work_logs(volunteer_id,created_at);

alter table public.gi_profiles enable row level security;
alter table public.gi_tasks enable row level security;
alter table public.gi_task_events enable row level security;
alter table public.gi_work_logs enable row level security;
alter table public.gi_role_events enable row level security;

-- Default deny writes to public tables: only audited, permission-checked RPC functions can change data.
revoke all on public.gi_profiles, public.gi_tasks, public.gi_task_events, public.gi_work_logs, public.gi_role_events from public, anon, authenticated;
grant select on public.gi_profiles, public.gi_tasks, public.gi_task_events, public.gi_work_logs, public.gi_role_events to authenticated;

create or replace function private.gi_role()
returns text language sql stable security definer set search_path = ''
as $$ select p.role from public.gi_profiles p where p.id = (select auth.uid()) $$;
revoke all on function private.gi_role() from public, anon;
grant execute on function private.gi_role() to authenticated;

create policy "gi_profiles_self_or_staff" on public.gi_profiles for select to authenticated
using (id = (select auth.uid()) or (select private.gi_role()) in ('coordinator','admin'));
create policy "gi_tasks_staff_or_assignee" on public.gi_tasks for select to authenticated
using ((select private.gi_role()) in ('coordinator','admin')
  or (assigned_to = (select auth.uid()) and (select private.gi_role()) = 'volunteer'));
create policy "gi_events_visible_task" on public.gi_task_events for select to authenticated
using (exists (
  select 1 from public.gi_tasks t where t.id = task_id
    and ((select private.gi_role()) in ('coordinator','admin')
      or (t.assigned_to = (select auth.uid()) and (select private.gi_role()) = 'volunteer'))
));
create policy "gi_role_events_admin_only" on public.gi_role_events for select to authenticated
using ((select private.gi_role()) = 'admin');
create policy "gi_logs_owner_or_staff" on public.gi_work_logs for select to authenticated
using (volunteer_id = (select auth.uid())
  or (select private.gi_role()) in ('coordinator','admin'));

-- New sign-ups must never obtain internal access automatically.
create or replace function public.gi_handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.gi_profiles(id,display_name,role)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name',''),100), 'pending')
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.gi_handle_new_user() from public, anon, authenticated;
drop trigger if exists gi_on_auth_user_created on auth.users;
create trigger gi_on_auth_user_created after insert on auth.users
  for each row execute function public.gi_handle_new_user();

-- Create only a proposal. Importers cannot assign/approve a task without separate authorization.
create or replace function public.gi_create_proposal(
  p_title text, p_details text, p_priority text default 'normal', p_source_ref text default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if coalesce((select private.gi_role()), 'pending') not in ('coordinator','admin') then
    raise exception 'GI permission denied';
  end if;
  if char_length(btrim(coalesce(p_title,''))) not between 3 and 140
    or char_length(btrim(coalesce(p_details,''))) not between 5 and 6000
    or p_priority not in ('low','normal','high')
    or (p_source_ref is not null and char_length(p_source_ref) > 160) then
    raise exception 'Invalid GI task';
  end if;
  insert into public.gi_tasks(title,details,priority,source_ref,created_by)
    values (btrim(p_title),btrim(p_details),p_priority,p_source_ref,auth.uid())
    on conflict (source_ref) do nothing returning id into v_id;
  if v_id is null and p_source_ref is not null then
    select id into v_id from public.gi_tasks where source_ref = p_source_ref;
  end if;
  return v_id;
end;
$$;

-- Approve proposal, assign volunteer, or perform a role-dependent transition.
create or replace function public.gi_assign_task(p_id uuid, p_volunteer uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_status text; v_role text;
begin
  if coalesce((select private.gi_role()), 'pending') not in ('coordinator','admin') then raise exception 'GI permission denied'; end if;
  select role into v_role from public.gi_profiles where id=p_volunteer;
  if v_role not in ('volunteer','coordinator','admin') then raise exception 'Volunteer not approved'; end if;
  select status into v_status from public.gi_tasks where id=p_id for update;
  if v_status is null or v_status not in ('pool','assigned') then raise exception 'Invalid assignment stage'; end if;
  update public.gi_tasks set assigned_to=p_volunteer,status='assigned',updated_at=now() where id=p_id;
  insert into public.gi_task_events(task_id,actor_id,action,note)
  values (p_id,auth.uid(),'assign','Synthetic pilot assignment');
end;
$$;

create or replace function public.gi_task_action(p_id uuid, p_action text, p_note text default null)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_task public.gi_tasks%rowtype; v_role text; v_new text;
begin
  v_role := (select private.gi_role());
  if v_role is null or v_role='pending' then raise exception 'GI permission denied'; end if;
  select * into v_task from public.gi_tasks where id=p_id for update;
  if not found then raise exception 'Task not found'; end if;

  if p_action='publish' and v_role in ('coordinator','admin') and v_task.status='proposed' then
    v_new:='pool';
  elsif p_action='accept' and v_task.assigned_to=auth.uid() and v_task.status='assigned' then
    v_new:='accepted';
  elsif p_action='start' and v_task.assigned_to=auth.uid() and v_task.status in ('accepted','returned') then
    v_new:='in_progress';
  elsif p_action='submit' and v_task.assigned_to=auth.uid() and v_task.status='in_progress'
    and char_length(btrim(coalesce(p_note,''))) between 10 and 6000 then
    v_new:='submitted';
  elsif p_action='approve' and v_role in ('coordinator','admin') and v_task.status='submitted' then
    v_new:='approved';
  elsif p_action='return' and v_role in ('coordinator','admin') and v_task.status='submitted'
    and char_length(btrim(coalesce(p_note,''))) between 3 and 2000 then
    v_new:='returned';
  else
    raise exception 'Invalid GI role or task transition';
  end if;
  update public.gi_tasks set status=v_new,updated_at=now(),
    result_text=case when p_action='submit' then btrim(p_note) else result_text end,
    feedback_text=case when p_action='return' then btrim(p_note) else feedback_text end
    where id=p_id;
  insert into public.gi_task_events(task_id,actor_id,action,note)
    values (p_id,auth.uid(),p_action,left(p_note,2000));
  return v_new;
end;
$$;

create or replace function public.gi_log_minutes(p_id uuid, p_minutes int, p_note text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_new uuid;
begin
  if coalesce((select private.gi_role()), 'pending') not in ('volunteer','coordinator','admin')
    or not exists(select 1 from public.gi_tasks where id=p_id and assigned_to=auth.uid()
      and status in ('accepted','in_progress','submitted','returned','approved'))
    or p_minutes not between 1 and 720 or char_length(coalesce(p_note,'')) > 1000 then
    raise exception 'Invalid GI time entry';
  end if;
  insert into public.gi_work_logs(task_id,volunteer_id,minutes,note)
    values(p_id,auth.uid(),p_minutes,p_note) returning id into v_new;
  return v_new;
end;
$$;

-- Only an existing administrator may approve members; bootstrap first admin manually.
create or replace function public.gi_set_user_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_prior text;
begin
  if coalesce((select private.gi_role()), 'pending') <> 'admin' or p_user=auth.uid()
    or p_role not in ('pending','volunteer','coordinator','admin') then
    raise exception 'GI admin approval required';
  end if;
  select role into v_prior from public.gi_profiles where id=p_user for update;
  if v_prior is null then raise exception 'Unknown GI user'; end if;
  update public.gi_profiles set role=p_role where id=p_user;
  insert into public.gi_role_events(actor_id,target_id,former_role,new_role)
    values (auth.uid(),p_user,v_prior,p_role);
end;
$$;

revoke all on function public.gi_create_proposal(text,text,text,text) from public, anon;
revoke all on function public.gi_assign_task(uuid,uuid) from public, anon;
revoke all on function public.gi_task_action(uuid,text,text) from public, anon;
revoke all on function public.gi_log_minutes(uuid,int,text) from public, anon;
revoke all on function public.gi_set_user_role(uuid,text) from public, anon;
grant execute on function public.gi_create_proposal(text,text,text,text),
  public.gi_assign_task(uuid,uuid), public.gi_task_action(uuid,text,text),
  public.gi_log_minutes(uuid,int,text), public.gi_set_user_role(uuid,text)
  to authenticated;

-- Do not seed actual users/roles or connect Drive, Gmail, GIS, or production cases.
