
-- Transactional role / task / feedback test. Entire fixture rolls back.
BEGIN;
INSERT INTO auth.users(id,aud,role,email,created_at,updated_at,raw_user_meta_data)
VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','authenticated','authenticated','gi-rollback-admin@example.invalid',now(),now(),'{"full_name":"Admin Test"}'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','authenticated','authenticated','gi-rollback-volunteer@example.invalid',now(),now(),'{"full_name":"Volunteer Test"}'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','authenticated','authenticated','gi-rollback-pending@example.invalid',now(),now(),'{"full_name":"Pending Test"}');
UPDATE public.gi_profiles SET role = CASE WHEN id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' THEN 'admin' WHEN id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' THEN 'volunteer' ELSE 'pending' END WHERE id IN ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
INSERT INTO public.gi_tasks(id,source_ref,title,details,status,assigned_to,is_demo) VALUES ('33333333-3333-4333-8333-333333333333','GI-ROLLBACK-FEEDBACK-CHECK','Bandomoji užduotis','Sintetiniai duomenys tik testui','assigned','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
DO $$
BEGIN
 IF (SELECT count(*) FROM public.gi_tasks) <> 0 THEN RAISE EXCEPTION 'PENDING sees tasks'; END IF;
 BEGIN
   INSERT INTO public.gi_feedback(reporter_id,category,message) VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','klaida','Negalima skelbti be patvirtinimo');
   RAISE EXCEPTION 'PENDING could submit feedback';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM = 'PENDING could submit feedback' THEN RAISE; END IF;
 END;
END $$;
SET LOCAL request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
DO $$
BEGIN
 IF (SELECT count(*) FROM public.gi_tasks WHERE id='33333333-3333-4333-8333-333333333333') <> 1 THEN RAISE EXCEPTION 'Volunteer missing assigned task'; END IF;
 PERFORM public.gi_task_action('33333333-3333-4333-8333-333333333333','accept',null);
 PERFORM public.gi_task_action('33333333-3333-4333-8333-333333333333','start',null);
 PERFORM public.gi_log_minutes('33333333-3333-4333-8333-333333333333',22,'Tik demonstracija');
 PERFORM public.gi_task_action('33333333-3333-4333-8333-333333333333','submit','Sintetinis darbas baigtas ir pateiktas.');
 INSERT INTO public.gi_feedback(reporter_id,category,message) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','pasiulymas','Patobulinti bandomąjį mygtuką');
 IF (SELECT count(*) FROM public.gi_feedback WHERE reporter_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc') <> 1 THEN RAISE EXCEPTION 'Volunteer feedback failed'; END IF;
END $$;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DO $$
BEGIN
 IF (SELECT count(*) FROM public.gi_feedback WHERE reporter_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc')<>1 THEN RAISE EXCEPTION 'Admin feedback inbox missing'; END IF;
 PERFORM public.gi_task_action('33333333-3333-4333-8333-333333333333','approve',null);
 IF (SELECT status FROM public.gi_tasks WHERE id='33333333-3333-4333-8333-333333333333') <> 'approved' THEN RAISE EXCEPTION 'Admin approval failed'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'gi-rollback-%@example.invalid')::int AS remaining_test_accounts,
 (SELECT count(*) FROM public.gi_tasks)::int AS original_tasks,
 (SELECT count(*) FROM public.gi_feedback)::int AS original_feedback;
