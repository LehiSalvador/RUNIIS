-- T33 Friendship (Master §22, §121, §158, §179, §205; SEC-005/010/015/141).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(47);

-- Returns {code, detail} of the error raised by p_sql, or NULL when it succeeds.
create function pg_temp.err(p_sql text) returns jsonb language plpgsql as $$
declare v_code text; v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_code = message_text, v_detail = pg_exception_detail;
  return jsonb_build_object('code', v_code, 'detail', case when v_detail ~ '^\{' then v_detail::jsonb end);
end $$;
grant execute on function pg_temp.err(text) to authenticated;

-- Synthetic people: users 0..331xx, profiles 1..331xx, public ids c..331xx.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000003310' || s)::uuid, 'people-f-' || s || '@example.test'
from unnest(array['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16']) s;
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at)
select ('10000000-0000-4000-8000-0000003310' || s)::uuid, ('00000000-0000-4000-8000-0000003310' || s)::uuid,
  'READY', st, 'Persona ' || s, '1990-01-01', 'F', '+528110000001', 'Contacto', '+528110000002', 'Madre', now()
from (values ('01', 'ACTIVE'), ('02', 'ACTIVE'), ('03', 'ACTIVE'), ('04', 'BANNED'), ('05', 'IDENTITY_LOCKED'),
             ('07', 'ACTIVE'), ('08', 'ACTIVE'), ('09', 'ACTIVE'), ('10', 'ACTIVE'), ('11', 'ACTIVE'),
             ('12', 'ACTIVE'), ('13', 'ACTIVE'), ('14', 'ACTIVE'), ('15', 'ACTIVE'), ('16', 'ACTIVE')) v(s, st);
insert into app.runner_profile (runner_profile_id, auth_user_id, full_name)
values ('10000000-0000-4000-8000-000000331006', '00000000-0000-4000-8000-000000331006', 'Persona 06');
insert into app.community_profile (runner_profile_id, public_profile_id, competition_status, is_visible)
select ('10000000-0000-4000-8000-0000003310' || s)::uuid, ('c0000000-0000-4000-8000-0000003310' || s)::uuid,
  'ELIGIBLE', s <> '07'
from unnest(array['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16']) s;

create temp table ids (name text primary key, value uuid) on commit drop;
grant select, insert on ids to authenticated;

set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Create (§22: always PENDING; §121 exclusions; SEC-015 unordered pair)
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000331001", "role": "authenticated"}';
insert into ids select 'ab', (public.request_friendship('c0000000-0000-4000-8000-000000331002') ->> 'friendship_id')::uuid;
select is((select status from app.friendship where friendship_id = (select value from ids where name = 'ab')), 'PENDING',
  '§22 CreateFriendship always creates PENDING');
select is((select public.request_friendship('c0000000-0000-4000-8000-000000331002') ->> 'friendship_id')::uuid,
  (select value from ids where name = 'ab'), '§22 a repeated request returns the same live PENDING row (one effect)');
select is((select array_agg(k order by k) from jsonb_object_keys(public.request_friendship('c0000000-0000-4000-8000-000000331002') -> 'counterpart') k),
  array['avatar_object_key', 'display_name', 'public_profile_id'], '§22 counterpart projection is the public card only');
select is(pg_temp.err($$ select public.request_friendship('c0000000-0000-4000-8000-000000331001') $$) ->> 'code',
  'BUSINESS_RULE_VIOLATION', '§22 CHECK requester != addressee (self request rejected)');
select is(pg_temp.err($$ select public.request_friendship('c0000000-0000-4000-8000-000000331004') $$) ->> 'code',
  'NOT_FOUND', '§121 a BANNED profile cannot be requested (no oracle)');
select is(pg_temp.err($$ select public.request_friendship('c0000000-0000-4000-8000-000000331005') $$) ->> 'code',
  'NOT_FOUND', '§121 an IDENTITY_LOCKED profile cannot be requested');
select is(pg_temp.err($$ select public.request_friendship('c0000000-0000-4000-8000-000000331006') $$) ->> 'code',
  'NOT_FOUND', 'an incomplete profile cannot be requested');
select is(pg_temp.err($$ select public.request_friendship('c0000000-0000-4000-8000-000000331007') $$) ->> 'code',
  'NOT_FOUND', 'a non-visible profile cannot be requested');
select is(pg_temp.err($$ select public.request_friendship('c0000000-0000-4000-8000-0000003310ff') $$) ->> 'code',
  'NOT_FOUND', 'an unknown public profile is NOT_FOUND');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000331002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.request_friendship('c0000000-0000-4000-8000-000000331001') $$),
  jsonb_build_object('code', 'CONFLICT', 'detail', jsonb_build_object('reason', 'INCOMING_REQUEST_PENDING',
    'friendship_id', (select value from ids where name = 'ab'))),
  'SEC-015 inverse request of a live pair is a CONFLICT that names only the shared friendship');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000331004", "role": "authenticated"}';
select is(pg_temp.err($$ select public.request_friendship('c0000000-0000-4000-8000-000000331001') $$) ->> 'code',
  'ACCOUNT_BANNED', '§121 a BANNED caller cannot request friends');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000331005", "role": "authenticated"}';
select is(pg_temp.err($$ select public.request_friendship('c0000000-0000-4000-8000-000000331001') $$) ->> 'code',
  'IDENTITY_LOCKED', 'an IDENTITY_LOCKED caller cannot request friends');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000331006", "role": "authenticated"}';
select is(pg_temp.err($$ select public.request_friendship('c0000000-0000-4000-8000-000000331001') $$) ->> 'code',
  'PROFILE_INCOMPLETE', 'a PROFILE_INCOMPLETE caller cannot request friends');
set local "request.jwt.claims" = '';
select is(pg_temp.err($$ select public.request_friendship('c0000000-0000-4000-8000-000000331001') $$) ->> 'code',
  'AUTH_REQUIRED', 'no session: AUTH_REQUIRED (SEC-006 fail closed)');

-- ---------------------------------------------------------------------------------------------
-- Accept / reject: addressee only (§22, SEC-015)
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000331001", "role": "authenticated"}';
select is(pg_temp.err(format('select public.accept_friendship(%L)', (select value from ids where name = 'ab'))),
  '{"code": "FORBIDDEN", "detail": {"reason": "ADDRESSEE_ONLY"}}'::jsonb, '§22 the requester cannot accept');
select is(pg_temp.err(format('select public.reject_friendship(%L)', (select value from ids where name = 'ab'))) ->> 'code',
  'FORBIDDEN', '§22 the requester cannot reject');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000331003", "role": "authenticated"}';
select is(pg_temp.err(format('select public.accept_friendship(%L)', (select value from ids where name = 'ab'))) ->> 'code',
  'NOT_FOUND', 'SEC-010 a third party gets NOT_FOUND on accept');
select is(pg_temp.err(format('select public.remove_friendship(%L)', (select value from ids where name = 'ab'))) ->> 'code',
  'NOT_FOUND', 'SEC-010 a third party gets NOT_FOUND on remove');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000331002", "role": "authenticated"}';
select is(public.accept_friendship((select value from ids where name = 'ab')) ->> 'status', 'ACCEPTED',
  '§22 the addressee accepts');
select is(public.accept_friendship((select value from ids where name = 'ab')) ->> 'status', 'ACCEPTED',
  'accepting twice is a no-op');
select is(pg_temp.err(format('select public.reject_friendship(%L)', (select value from ids where name = 'ab'))),
  '{"code": "CONFLICT", "detail": {"reason": "NOT_PENDING", "status": "ACCEPTED"}}'::jsonb,
  'an ACCEPTED friendship cannot be rejected');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000331001", "role": "authenticated"}';
select is(pg_temp.err($$ select public.request_friendship('c0000000-0000-4000-8000-000000331002') $$) -> 'detail' ->> 'reason',
  'ALREADY_FRIENDS', 'SEC-015 no duplicate while ACCEPTED');

-- B -> C rejected, then re-requested (uniqueness only while relevant).
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000331002", "role": "authenticated"}';
insert into ids select 'bc', (public.request_friendship('c0000000-0000-4000-8000-000000331003') ->> 'friendship_id')::uuid;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000331003", "role": "authenticated"}';
select is(public.reject_friendship((select value from ids where name = 'bc')) ->> 'status', 'REJECTED', '§22 the addressee rejects');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000331002", "role": "authenticated"}';
select is(pg_temp.err(format('select public.remove_friendship(%L)', (select value from ids where name = 'bc'))) ->> 'code',
  'NOT_FOUND', 'a REJECTED row is not removable (no rejection oracle for the requester)');
select isnt((public.request_friendship('c0000000-0000-4000-8000-000000331003') ->> 'friendship_id')::uuid,
  (select value from ids where name = 'bc'), 'a new request is allowed after a rejection');

-- ---------------------------------------------------------------------------------------------
-- Reads and BOLA (§158, §205: A cannot see B–C)
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000331001", "role": "authenticated"}';
select is(jsonb_array_length(public.list_my_friendships('FRIENDS') -> 'items'), 1, 'A lists exactly one friend');
select is(public.list_my_friendships('FRIENDS') -> 'items' -> 0 -> 'counterpart' ->> 'public_profile_id',
  'c0000000-0000-4000-8000-000000331002', 'A''s friend is B');
select is_empty($$ select 1 from app.friendship f
  where '10000000-0000-4000-8000-000000331001' not in (f.requester_profile_id, f.addressee_profile_id) $$,
  '§205 A cannot read the B–C friendship rows (RLS)');
select is(pg_temp.err(format('select public.accept_friendship(%L)', (select value from ids where name = 'bc'))) ->> 'code',
  'NOT_FOUND', 'SEC-010 A cannot act on the B–C friendship');
select is(pg_temp.err($$ select public.list_my_friendships('ALL') $$) ->> 'code', 'VALIDATION_ERROR', 'unknown view is rejected');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000331003", "role": "authenticated"}';
select is(jsonb_array_length(public.list_my_friendships('INCOMING') -> 'items'), 1, 'C sees the new incoming request');
select is(public.list_my_friendships('INCOMING') -> 'items' -> 0 ->> 'direction', 'INCOMING', 'incoming direction');

-- Banned counterparts drop out of lists; a banned requester cannot be accepted (§121).
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000331008", "role": "authenticated"}';
insert into ids select 'hc', (public.request_friendship('c0000000-0000-4000-8000-000000331003') ->> 'friendship_id')::uuid;
reset role;
update app.runner_profile set account_state = 'BANNED' where runner_profile_id = '10000000-0000-4000-8000-000000331008';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000331003", "role": "authenticated"}';
select is(jsonb_array_length(public.list_my_friendships('INCOMING') -> 'items'), 1, '§121 a banned requester is omitted from lists');
select is(pg_temp.err(format('select public.accept_friendship(%L)', (select value from ids where name = 'hc'))),
  '{"code": "BUSINESS_RULE_VIOLATION", "detail": {"reason": "COUNTERPART_UNAVAILABLE"}}'::jsonb,
  '§121 a request from a now-banned profile cannot be accepted');

-- ---------------------------------------------------------------------------------------------
-- Remove: either party (§22)
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000331002", "role": "authenticated"}';
select is(public.remove_friendship((select value from ids where name = 'ab')) ->> 'status', 'REMOVED', '§22 the addressee removes');
select is(public.remove_friendship((select value from ids where name = 'ab')) ->> 'status', 'REMOVED', 'removing twice is a no-op');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000331001", "role": "authenticated"}';
insert into ids select 'ab2', (public.request_friendship('c0000000-0000-4000-8000-000000331002') ->> 'friendship_id')::uuid;
select is(public.remove_friendship((select value from ids where name = 'ab2')) ->> 'status', 'REMOVED',
  '§22 the requester removes (cancels) a pending request');

-- ---------------------------------------------------------------------------------------------
-- Idempotency, audit, outbox (§151: ids-only payloads, deterministic effect keys)
-- ---------------------------------------------------------------------------------------------
insert into ids select 'ai', (public.request_friendship('c0000000-0000-4000-8000-000000331009', 'friend-key-0001') ->> 'friendship_id')::uuid;
select is((public.request_friendship('c0000000-0000-4000-8000-000000331009', 'friend-key-0001') ->> 'friendship_id')::uuid,
  (select value from ids where name = 'ai'), 'Idempotency-Key replay returns the stored response');
reset role;
select is((select count(*)::int from infra.outbox_event where effect_key = 'FriendshipRequested:' || (select value from ids where name = 'ab')),
  1, '§151 FriendshipRequested is enqueued once per friendship');
select is((select count(*)::int from infra.outbox_event where effect_key = 'FriendshipAccepted:' || (select value from ids where name = 'ab')),
  1, '§151 FriendshipAccepted is enqueued once even when accept is repeated');
select is((select array_agg(k order by k) from infra.outbox_event o, jsonb_object_keys(o.payload) k
           where o.effect_key = 'FriendshipRequested:' || (select value from ids where name = 'ab')),
  array['addressee_profile_id', 'friendship_id', 'requester_profile_id'], '§151 outbox payload carries ids only');
select is((select array_agg(action order by occurred_at, action) from audit.audit_log
           where entity_type = 'friendship' and entity_id = (select value from ids where name = 'ab')),
  array['FRIENDSHIP_ACCEPTED', 'FRIENDSHIP_REMOVED', 'FRIENDSHIP_REQUESTED'], 'each transition is audited once');
select is((select count(*)::int from app.friendship where requester_profile_id = '10000000-0000-4000-8000-000000331001'
           and addressee_profile_id = '10000000-0000-4000-8000-000000331009'), 1, 'the replay created no second row');

-- ---------------------------------------------------------------------------------------------
-- Rate limit for direct callers (SEC-141: command success-path counter 5/min)
-- ---------------------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000331010", "role": "authenticated"}';
select lives_ok($$ select public.request_friendship(p.public_profile_id)
  from app.community_profile p where p.public_profile_id in ('c0000000-0000-4000-8000-000000331011',
    'c0000000-0000-4000-8000-000000331012', 'c0000000-0000-4000-8000-000000331013',
    'c0000000-0000-4000-8000-000000331014', 'c0000000-0000-4000-8000-000000331015') $$,
  '§179 five friend requests in a minute are allowed');
select is(pg_temp.err($$ select public.request_friendship('c0000000-0000-4000-8000-000000331016') $$) ->> 'code',
  'RATE_LIMITED', '§179 the sixth friend request in a minute is RATE_LIMITED');
select ok((pg_temp.err($$ select public.request_friendship('c0000000-0000-4000-8000-000000331016') $$) -> 'detail' ->> 'retry_after_seconds')::int > 0,
  'RATE_LIMITED carries retry_after_seconds');

-- ---------------------------------------------------------------------------------------------
-- Grants (SEC-002/006)
-- ---------------------------------------------------------------------------------------------
reset role;
select ok(not has_function_privilege('anon', 'public.request_friendship(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.list_my_friendships(text, text, uuid)', 'execute'),
  'anon cannot execute friendship functions');

select * from finish();
rollback;
