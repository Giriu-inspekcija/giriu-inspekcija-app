-- Synthetic-only volunteer feedback. Kept in Supabase, not auto-posted to public GitHub issues.
create table if not exists public.gi_feedback (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.gi_profiles(id) on delete cascade,
  category text not null check (category in ('klaida','pasiulymas','klausimas')),
  message text not null check (char_length(btrim(message)) between 5 and 1500),
  is_demo boolean not null default true check (is_demo = true),
  created_at timestamptz not null default now()
);
create index if not exists gi_feedback_reporter_created_idx on public.gi_feedback(reporter_id,created_at);
alter table public.gi_feedback enable row level security;
revoke all on public.gi_feedback from public, anon, authenticated;
grant select, insert on public.gi_feedback to authenticated;

create policy "gi_feedback_own_or_staff" on public.gi_feedback for select to authenticated
using (reporter_id = (select auth.uid()) or (select private.gi_role()) in ('coordinator','admin'));
create policy "gi_feedback_insert_own" on public.gi_feedback for insert to authenticated
with check (reporter_id = (select auth.uid()));
