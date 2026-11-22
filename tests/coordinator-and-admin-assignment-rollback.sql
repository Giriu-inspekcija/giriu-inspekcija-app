BEGIN;
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_user_meta_data)
VALUES
('11111111-aaaa-4111-8111-111111111111','authenticated','authenticated','gi-scaletest-master@example.invalid',now(),now(),now(),'{"full_name":"Master Test"}'),
('22222222-bbbb-4222-8222-222222222222','authenticated','authenticated','gi-scaletest-coordinator@example.invalid',now(),now(),now(),'{"full_name":"Coordinator Test"}'),
('33333333-cccc-4333-8333-333333333333','authenticated','authenticated','gi-scaletest-volunteer@example.invalid',now(),now(),now(),'{"full_name":"Volunteer Test"}'),
('44444444-dddd-4444-8444-444444444444','authenticated','authenticated','gi-scaletest-pending@example.invalid',now(),now(),now(),'{"full_name":"Pending Test"}');
UPDATE public.gi_profiles SET role = CASE
  WHEN id='11111111-aaaa-4111-8111-111111111111' THEN 'admin'
  WHEN id='22222222-bbbb-4222-8222-222222222222' THEN 'coordinator'
  WHEN id='33333333-cccc-4333-8333-333333333333' THEN 'volunteer'
  ELSE 'pending' END
WHERE id IN ('11111111-aaaa-4111-8111-111111111111','22222222-bbbb-4222-8222-222222222222','33333333-cccc-4333-8333-333333333333','44444444-dddd-4444-8444-444444444444');
INSERT INTO public.gi_tasks(id,source_ref,title,details,status) VALUES
('55555555-aaaa-4555-8555-555555555555','GI-ROLLBACK-MASTER-ASSIGN','Master paskirstymas','Tik sintetinė užduotis','pool'),
('66666666-bbbb-4666-8666-666666666666','GI-ROLLBACK-COORD-ASSIGN','Vilijos vaidmens paskirstymas','Tik sintetinė užduotis','pool');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='11111111-aaaa-4111-8111-111111111111';
SELECT public.gi_assign_task('55555555-aaaa-4555-8555-555555555555','33333333-cccc-4333-8333-333333333333');
SET LOCAL request.jwt.claim.sub='22222222-bbbb-4222-8222-222222222222';
SELECT public.gi_assign_task('66666666-bbbb-4666-8666-666666666666','33333333-cccc-4333-8333-333333333333');
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM public.gi_tasks
    WHERE id IN ('55555555-aaaa-4555-8555-555555555555','66666666-bbbb-4666-8666-666666666666')
      AND assigned_to='33333333-cccc-4333-8333-333333333333' AND status='assigned')<>2
  THEN RAISE EXCEPTION 'Both admin and coordinator assignment must work'; END IF;
  BEGIN
    PERFORM public.gi_assign_task('55555555-aaaa-4555-8555-555555555555','44444444-dddd-4444-8444-444444444444');
    RAISE EXCEPTION 'UNEXPECTED_ASSIGN_TO_PENDING';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='UNEXPECTED_ASSIGN_TO_PENDING' THEN RAISE; END IF;
  END;
END $$;
SET LOCAL request.jwt.claim.sub='33333333-cccc-4333-8333-333333333333';
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM public.gi_tasks WHERE id IN
    ('55555555-aaaa-4555-8555-555555555555','66666666-bbbb-4666-8666-666666666666'))<>2
  THEN RAISE EXCEPTION 'Volunteer cannot see both assigned tasks'; END IF;
  BEGIN
    PERFORM public.gi_assign_task('55555555-aaaa-4555-8555-555555555555','33333333-cccc-4333-8333-333333333333');
    RAISE EXCEPTION 'UNEXPECTED_VOLUNTEER_ASSIGN';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='UNEXPECTED_VOLUNTEER_ASSIGN' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT (SELECT COUNT(*)::int FROM auth.users) as remaining_users,
       (SELECT COUNT(*)::int FROM public.gi_tasks) as original_synthetic_tasks;