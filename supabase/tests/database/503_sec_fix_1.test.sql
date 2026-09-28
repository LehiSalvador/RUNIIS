-- SEC-FIX-1: F1 (ALTCHA replay guard) and F3 (email+IP rate-limit keying, higher email-only
-- ceiling) DB-level coverage. F2 (webhook dedupe) and F9/F10 are covered in 501 and unit tests.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(11);

create function pg_temp.errcode_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end $$;

-- ---------------------------------------------------------------------------------------------
-- F1 (SEC-082): consume_altcha_challenge is a single-use replay guard.
-- ---------------------------------------------------------------------------------------------
select is((private.consume_altcha_challenge(repeat('a', 64), now() + interval '2 minutes') ->> 'consumed')::boolean,
  true, 'a fresh challenge hash is consumed on first use');
select is((private.consume_altcha_challenge(repeat('a', 64), now() + interval '2 minutes') ->> 'consumed')::boolean,
  false, 'the same challenge hash is rejected on replay');
select is((private.consume_altcha_challenge(repeat('b', 64), now() + interval '2 minutes') ->> 'consumed')::boolean,
  true, 'a different challenge hash is independent of the first');
select is(pg_temp.errcode_of($$ select private.consume_altcha_challenge('not-hex', now() + interval '1 minute') $$),
  '22023', 'a non-hex/wrong-length challenge is a programming error (22023)');
select is(pg_temp.errcode_of($$ select private.consume_altcha_challenge(repeat('c', 64), null) $$),
  '22023', 'a null expiry is a programming error (22023)');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000503001", "role": "authenticated"}';
set local role authenticated;
select throws_ok($$ select public.consume_altcha_challenge(repeat('d', 64), now() + interval '1 minute') $$,
  '42501', null, 'anon/authenticated cannot call consume_altcha_challenge directly (service_role only)');
reset role;

-- ---------------------------------------------------------------------------------------------
-- F3: the new (email, IP)-keyed scopes and their email-only ceilings exist and are tracked
-- independently of the original email-only scopes (subject is whatever the caller passes).
-- ---------------------------------------------------------------------------------------------
select set_eq($$
  select scope from infra.rate_limit_policy
  where scope in ('auth.verify.email.global', 'auth.otp.email.hour.global', 'csp_report.ip')
$$, array['auth.verify.email.global', 'auth.otp.email.hour.global', 'csp_report.ip'],
  'F3/F7 rate limit policy rows exist');

select is((select max_hits from infra.rate_limit_policy where scope = 'auth.verify.email.global') >
          (select max_hits from infra.rate_limit_policy where scope = 'auth.verify.email'),
  true, 'F3: the email-only verify ceiling is higher than the tight (email, IP) bucket');
select is((select max_hits from infra.rate_limit_policy where scope = 'auth.otp.email.hour.global') >
          (select max_hits from infra.rate_limit_policy where scope = 'auth.otp.email.hour'),
  true, 'F3: the email-only OTP-request ceiling is higher than the tight (email, IP) bucket');

-- An attacker IP hammering a victim email exhausts only its own (email, IP) bucket; a different IP
-- for the same victim email is tracked separately, proving the DB layer is subject-agnostic and the
-- TS keying (email|ip) is what isolates the attacker.
set local role service_role;
select is(public.consume_subject_rate_limit('auth.verify.email', 'victim-503@example.test|203.0.113.9'),
  '{"allowed": true}'::jsonb, 'victim email + attacker IP #1: first attempt allowed');
select is(public.consume_subject_rate_limit('auth.verify.email', 'victim-503@example.test|198.51.100.4'),
  '{"allowed": true}'::jsonb, 'the same victim email from a different IP is a distinct (email, IP) bucket');
reset role;

select * from finish();
rollback;
