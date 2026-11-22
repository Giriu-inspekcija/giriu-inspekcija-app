BEGIN;
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_user_meta_data) VALUES
('11111111-1111-4111-8111-111111111111','authenticated','authenticated','gi-page-admin@example.invalid',now(),now(),now(),'{}'),
('22222222-2222-4222-8222-222222222222','authenticated','authenticated','gi-page-vol-a@example.invalid',now(),now(),now(),'{}'),
('33333333-3333-4333-8333-333333333333','authenticated','authenticated','gi-page-vol-b@example.invalid',now(),now(),now(),'{}'),
('44444444-4444-4444-8444-444444444444','authenticated','authenticated','gi-page-pending@example.invalid',now(),now(),now(),'{}');
UPDATE public.gi_profiles SET role=CASE
 WHEN id='11111111-1111-4111-8111-111111111111' THEN 'admin'
 WHEN id IN ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333') THEN 'volunteer'
 ELSE 'pending' END
WHERE id IN('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444');
INSERT INTO public.gi_tasks(source_ref,title,details,status,assigned_to,created_at)
SELECT 'GI-PAGING-ROLLBACK-'||g,'Bandomoji užduotis '||g,'Sintetinė užduotis puslapiavimo patikrai','assigned',
 CASE WHEN g%2=0 THEN '22222222-2222-4222-8222-222222222222'::uuid ELSE '33333333-3333-4333-8333-333333333333'::uuid END,
 now() - make_interval(secs=>g)
FROM generate_series(1,120) g;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
DO $$
DECLARE last_id uuid; last_time timestamptz; first_ids uuid[]; next_ids uuid[];
BEGIN
  SELECT array_agg(id) INTO first_ids FROM public.gi_list_tasks_page(null,null,51,'all');
  IF array_length(first_ids,1)<>51 THEN RAISE EXCEPTION 'ADMIN FIRST PAGE NOT 51'; END IF;
  SELECT created_at,id INTO last_time,last_id FROM public.gi_list_tasks_page(null,null,50,'all') OFFSET 49 LIMIT 1;
  SELECT array_agg(id) INTO next_ids FROM public.gi_list_tasks_page(last_time,last_id,51,'all');
  IF array_length(next_ids,1)<>51 THEN RAISE EXCEPTION 'ADMIN SECOND PAGE NOT 51';END IF;
  IF first_ids[1]=next_ids[1] OR first_ids[50]=next_ids[1] THEN RAISE EXCEPTION 'OVERLAP BETWEEN PAGES'; END IF;
END $$;
SET LOCAL request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
DO $$
DECLARE v_id uuid; v_time timestamptz;
BEGIN
 IF (SELECT count(*) FROM public.gi_list_tasks_page(null,null,51,'all'))<>51 THEN RAISE EXCEPTION 'VOLUNTEER FIRST PAGE WRONG';END IF;
 IF EXISTS(SELECT 1 FROM public.gi_list_tasks_page(null,null,51,'all') WHERE assigned_to<>'22222222-2222-4222-8222-222222222222') THEN RAISE EXCEPTION 'VOLUNTEER SEES OTHER ASSIGNEES'; END IF;
 SELECT created_at,id INTO v_time,v_id FROM public.gi_list_tasks_page(null,null,50,'all') OFFSET 49 LIMIT 1;
 IF (SELECT count(*) FROM public.gi_list_tasks_page(v_time,v_id,51,'all'))<>10 THEN RAISE EXCEPTION 'VOLUNTEER SECOND PAGE WRONG'; END IF;
END $$;
SET LOCAL request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.gi_list_tasks_page(null,null,51,'all')) THEN RAISE EXCEPTION 'PENDING SEES TASKS'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT (SELECT count(*)::int FROM auth.users) AS real_users,
       (SELECT count(*)::int FROM public.gi_tasks) AS original_tasks;