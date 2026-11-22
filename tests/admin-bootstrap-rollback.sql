BEGIN;
INSERT INTO auth.users (id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_user_meta_data)
VALUES
('11111111-ffff-4111-8111-111111111111','authenticated','authenticated','zelaurynas@gmail.com',now(),now(),now(),'{"full_name":"Test master"}'::jsonb),
('22222222-ffff-4222-8222-222222222222','authenticated','authenticated','laurynas@giriuinspekcija.lt',now(),now(),now(),'{"full_name":"Test volunteer"}'::jsonb),
('33333333-ffff-4333-8333-333333333333','authenticated','authenticated','unverified@example.invalid',null,now(),now(),'{"full_name":"Test unverified"}'::jsonb);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '22222222-ffff-4222-8222-222222222222';
DO $$
BEGIN
  BEGIN
    PERFORM public.gi_claim_first_admin();
    RAISE EXCEPTION 'UNEXPECTED_NON_MASTER_ADMIN';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='UNEXPECTED_NON_MASTER_ADMIN' THEN RAISE; END IF;
  END;
END $$;
SET LOCAL request.jwt.claim.sub = '33333333-ffff-4333-8333-333333333333';
DO $$
BEGIN
  BEGIN
    PERFORM public.gi_claim_first_admin();
    RAISE EXCEPTION 'UNEXPECTED_UNVERIFIED_ADMIN';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='UNEXPECTED_UNVERIFIED_ADMIN' THEN RAISE; END IF;
  END;
END $$;
SET LOCAL request.jwt.claim.sub = '11111111-ffff-4111-8111-111111111111';
DO $$
BEGIN
  IF NOT public.gi_password_needed() THEN RAISE EXCEPTION 'OTP account should need password'; END IF;
  IF NOT public.gi_claim_first_admin() THEN RAISE EXCEPTION 'Master claim failed'; END IF;
  IF (SELECT role FROM public.gi_profiles WHERE id=auth.uid()) <> 'admin' THEN RAISE EXCEPTION 'Master role not set'; END IF;
  IF (SELECT count(*) FROM public.gi_role_events WHERE target_id=auth.uid() AND new_role='admin') <> 1 THEN RAISE EXCEPTION 'Master audit missing'; END IF;
  BEGIN
    PERFORM public.gi_claim_first_admin();
    RAISE EXCEPTION 'UNEXPECTED_SECOND_CLAIM';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='UNEXPECTED_SECOND_CLAIM' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM private.gi_admin_bootstrap) <> 0 THEN RAISE EXCEPTION 'Reservation not consumed'; END IF;
END $$;
ROLLBACK;
SELECT (SELECT count(*) FROM auth.users)::int as real_users,
 (SELECT count(*) FROM private.gi_admin_bootstrap)::int as still_reserved,
 (SELECT count(*) FROM public.gi_role_events)::int as role_events;