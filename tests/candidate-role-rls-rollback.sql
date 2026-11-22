-- End-to-end, ROLLBACK-only database role test for new candidate vs existing GI volunteer.
BEGIN;
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_user_meta_data)
VALUES
('11110000-1111-4111-8111-111111111111','authenticated','authenticated','gi-roles-admin@example.invalid',now(),now(),now(),'{"full_name":"Master Test"}'::jsonb),
('22220000-2222-4222-8222-222222222222','authenticated','authenticated','gi-roles-coord@example.invalid',now(),now(),now(),'{"full_name":"Vilija Test"}'::jsonb),
('33330000-3333-4333-8333-333333333333','authenticated','authenticated','gi-roles-new@example.invalid',now(),now(),now(),'{"full_name":"Naujas Kandidatas","membership_intent":"new_candidate","preferred_activity":"field","region_label":"Demo rajonas","role":"admin","can_prepare_documents":true}'::jsonb),
('44440000-4444-4444-8444-444444444444','authenticated','authenticated','gi-roles-existing@example.invalid',now(),now(),now(),'{"full_name":"Esamas Savanoris","membership_intent":"existing_volunteer","preferred_activity":"advocacy"}'::jsonb),
('55550000-5555-4555-8555-555555555555','authenticated','authenticated','gi-roles-unapproved@example.invalid',now(),now(),now(),'{"full_name":"Neregistruotas"}'::jsonb);
DO $$ BEGIN
 IF (SELECT role FROM public.gi_profiles WHERE id='33330000-3333-4333-8333-333333333333') <> 'pending' THEN
   RAISE EXCEPTION 'User-controlled auth metadata elevated the candidate'; END IF;
 IF (SELECT membership_intent FROM public.gi_profiles WHERE id='33330000-3333-4333-8333-333333333333') <> 'new_candidate' THEN
   RAISE EXCEPTION 'Signup preference missing'; END IF;
 IF (SELECT can_prepare_documents FROM public.gi_profiles WHERE id='33330000-3333-4333-8333-333333333333') THEN
   RAISE EXCEPTION 'User-controlled drafting permission'; END IF;
END $$;
UPDATE public.gi_profiles SET role=CASE
 WHEN id='11110000-1111-4111-8111-111111111111' THEN 'admin'
 WHEN id='22220000-2222-4222-8222-222222222222' THEN 'coordinator'
 ELSE 'pending' END
WHERE id IN ('11110000-1111-4111-8111-111111111111','22220000-2222-4222-8222-222222222222');
INSERT INTO public.gi_tasks(id,source_ref,title,details,status,task_kind,candidate_safe)
VALUES
('66660000-6666-4666-8666-666666666666','GI-CAND-ROLLBACK-FIELD','Bandomoji išvyka','Apsilankyti tik išgalvotoje vietoje','pool','field_visit',false),
('77770000-7777-4777-8777-777777777777','GI-CAND-ROLLBACK-DOC','Rengti bandomąjį raštą','Tik advokacijos bandymo duomenys','pool','documentation',false);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='22220000-2222-4222-8222-222222222222';
DO $$ BEGIN
 PERFORM public.gi_approve_candidate('33330000-3333-4333-8333-333333333333');
 PERFORM public.gi_approve_volunteer('44440000-4444-4444-8444-444444444444');
 PERFORM public.gi_set_candidate_task('66660000-6666-4666-8666-666666666666',true,'field_visit');
 PERFORM public.gi_assign_task('66660000-6666-4666-8666-666666666666','33330000-3333-4333-8333-333333333333');
 PERFORM public.gi_assign_task('77770000-7777-4777-8777-777777777777','44440000-4444-4444-8444-444444444444');
 BEGIN
   PERFORM public.gi_assign_task('77770000-7777-4777-8777-777777777777','33330000-3333-4333-8333-333333333333');
   RAISE EXCEPTION 'UNEXPECTED_CANDIDATE_DOC_ASSIGNMENT';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM='UNEXPECTED_CANDIDATE_DOC_ASSIGNMENT' THEN RAISE; END IF;
 END;
END $$;
SET LOCAL request.jwt.claim.sub='33330000-3333-4333-8333-333333333333';
DO $$ BEGIN
 IF (SELECT COUNT(*) FROM public.gi_tasks WHERE source_ref LIKE 'GI-CAND-ROLLBACK-%')<>1 THEN
   RAISE EXCEPTION 'Candidate must see one safe task only'; END IF;
 IF public.gi_can_prepare_documents() THEN RAISE EXCEPTION 'Candidate obtained draft permission'; END IF;
 PERFORM public.gi_task_action('66660000-6666-4666-8666-666666666666','accept',null);
 PERFORM public.gi_task_action('66660000-6666-4666-8666-666666666666','start',null);
 PERFORM public.gi_log_minutes('66660000-6666-4666-8666-666666666666',18,'Bandomoji isvyka');
 PERFORM public.gi_task_action('66660000-6666-4666-8666-666666666666','submit','Patikrinta tik išgalvota vietovė.');
 BEGIN
   PERFORM public.gi_task_action('77770000-7777-4777-8777-777777777777','accept',null);
   RAISE EXCEPTION 'UNEXPECTED_CANDIDATE_DOC_ACTION';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='UNEXPECTED_CANDIDATE_DOC_ACTION' THEN RAISE; END IF;END;
END $$;
SET LOCAL request.jwt.claim.sub='55550000-5555-4555-8555-555555555555';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.gi_tasks WHERE source_ref LIKE 'GI-CAND-ROLLBACK-%') THEN
   RAISE EXCEPTION 'Pending sees any task'; END IF;
 BEGIN
   PERFORM public.gi_approve_candidate('55550000-5555-4555-8555-555555555555');
   RAISE EXCEPTION 'UNEXPECTED_SELF_APPROVAL';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='UNEXPECTED_SELF_APPROVAL' THEN RAISE; END IF; END;
END $$;
SET LOCAL request.jwt.claim.sub='11110000-1111-4111-8111-111111111111';
DO $$ BEGIN
 PERFORM public.gi_set_volunteer_rank('44440000-4444-4444-8444-444444444444','patyres');
 PERFORM public.gi_set_document_permission('44440000-4444-4444-8444-444444444444',true);
 IF (SELECT volunteer_rank FROM public.gi_profiles WHERE id='44440000-4444-4444-8444-444444444444') <> 'patyres' THEN
   RAISE EXCEPTION 'Rank update missing'; END IF;
 IF (SELECT COUNT(*) FROM public.gi_member_events WHERE target_id='44440000-4444-4444-8444-444444444444')<>2 THEN
   RAISE EXCEPTION 'Permission/rank audits missing'; END IF;
END $$;
SET LOCAL request.jwt.claim.sub='44440000-4444-4444-8444-444444444444';
DO $$ BEGIN
 IF NOT public.gi_can_prepare_documents() THEN RAISE EXCEPTION 'Approved advocacy volunteer denied drafting permission';END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT (SELECT COUNT(*)::int FROM auth.users) AS real_users,
       (SELECT COUNT(*)::int FROM public.gi_tasks) AS original_tasks,
       (SELECT COUNT(*)::int FROM public.gi_member_events) AS membership_events;
