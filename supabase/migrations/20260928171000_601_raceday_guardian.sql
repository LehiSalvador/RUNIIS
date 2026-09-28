-- Guardian event verification desk (Master §21/§85, T40). A minor cannot complete EVENT_CHECKIN until
-- their guardian_event_verification is VERIFIED; the row is created lazily by the scan/manual-verify
-- commands (600) the first time it is needed. This file lets GUARDIAN_VERIFY staff resolve it.

insert into infra.rate_limit_policy (scope, max_hits, window_seconds, subject_kind, description) values
  ('raceday.guardian_decide:cmd', 120, 60, 'ACTOR', 'Master §179 guardian verify/reject per staff (command)')
on conflict (scope) do nothing;

create function private.raceday_guardian_verify(
  p_registration_id uuid, p_verification_method text, p_notes text default null, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_edition_id uuid;
  v_idem jsonb;
  v_method text := pg_catalog.btrim(p_verification_method);
  v_row record;
  v_result jsonb;
begin
  select r.edition_id into v_edition_id from app.registration r where r.registration_id = p_registration_id;
  if v_edition_id is null then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  v_staff := private.require_permission('GUARDIAN_VERIFY', v_edition_id);
  if v_method is null or pg_catalog.char_length(v_method) not between 1 and 100 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'verification_method'));
  end if;
  perform private.consume_policy_rate_limit('raceday.guardian_decide:cmd', auth.uid()::text);

  if p_idempotency_key is not null then
    v_idem := private.idempotency_begin('raceday.guardian_verify', p_registration_id::text, p_idempotency_key,
      jsonb_build_object('registration_id', p_registration_id, 'verification_method', v_method));
    if (v_idem ->> 'replay')::boolean then
      return v_idem -> 'response_body';
    end if;
  end if;

  select gv.guardian_event_verification_id, gv.status into v_row
  from app.guardian_event_verification gv where gv.registration_id = p_registration_id
  for update;
  if v_row.guardian_event_verification_id is null then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  if v_row.status = 'REJECTED' then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'ALREADY_REJECTED'));
  end if;
  if v_row.status <> 'VERIFIED' then
    update app.guardian_event_verification
    set status = 'VERIFIED', verification_method = v_method, verified_by_staff_id = v_staff, verified_at = pg_catalog.now(), notes = p_notes
    where guardian_event_verification_id = v_row.guardian_event_verification_id;
    perform private.audit('GUARDIAN_EVENT_VERIFIED', 'registration', p_registration_id, v_edition_id,
      jsonb_build_object('status', v_row.status), jsonb_build_object('status', 'VERIFIED'), p_notes);
    perform private.enqueue_outbox('GuardianEventVerified', 'Registration', p_registration_id,
      'GuardianEventVerified:' || p_registration_id,
      jsonb_build_object('registration_id', p_registration_id, 'edition_id', v_edition_id));
  end if;

  v_result := jsonb_build_object('registration_id', p_registration_id, 'status', 'VERIFIED');
  if v_idem is not null then
    perform private.idempotency_complete((v_idem ->> 'record_id')::uuid, 200, v_result);
  end if;
  return v_result;
end;
$$;

create function private.raceday_guardian_reject(p_registration_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_edition_id uuid;
  v_idem jsonb;
  v_reason text := pg_catalog.btrim(p_reason);
  v_row record;
  v_result jsonb;
begin
  select r.edition_id into v_edition_id from app.registration r where r.registration_id = p_registration_id;
  if v_edition_id is null then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  v_staff := private.require_permission('GUARDIAN_VERIFY', v_edition_id);
  if v_reason is null or pg_catalog.char_length(v_reason) not between 1 and 500 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'reason'));
  end if;
  perform private.consume_policy_rate_limit('raceday.guardian_decide:cmd', auth.uid()::text);

  if p_idempotency_key is not null then
    v_idem := private.idempotency_begin('raceday.guardian_reject', p_registration_id::text, p_idempotency_key,
      jsonb_build_object('registration_id', p_registration_id, 'reason', v_reason));
    if (v_idem ->> 'replay')::boolean then
      return v_idem -> 'response_body';
    end if;
  end if;

  select gv.guardian_event_verification_id, gv.status into v_row
  from app.guardian_event_verification gv where gv.registration_id = p_registration_id
  for update;
  if v_row.guardian_event_verification_id is null then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  if v_row.status = 'VERIFIED' then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'ALREADY_VERIFIED'));
  end if;
  if v_row.status <> 'REJECTED' then
    update app.guardian_event_verification
    set status = 'REJECTED', verified_by_staff_id = v_staff, verified_at = pg_catalog.now(), notes = v_reason
    where guardian_event_verification_id = v_row.guardian_event_verification_id;
    perform private.audit('GUARDIAN_EVENT_REJECTED', 'registration', p_registration_id, v_edition_id,
      jsonb_build_object('status', v_row.status), jsonb_build_object('status', 'REJECTED'), v_reason);
    perform private.enqueue_outbox('GuardianEventVerificationRejected', 'Registration', p_registration_id,
      'GuardianEventVerificationRejected:' || p_registration_id,
      jsonb_build_object('registration_id', p_registration_id, 'edition_id', v_edition_id));
  end if;

  v_result := jsonb_build_object('registration_id', p_registration_id, 'status', 'REJECTED');
  if v_idem is not null then
    perform private.idempotency_complete((v_idem ->> 'record_id')::uuid, 200, v_result);
  end if;
  return v_result;
end;
$$;

-- PENDING (and REJECTED, still actionable) verifications for the Guardian desk of an Edition.
create function private.raceday_list_guardian_verifications(p_edition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('GUARDIAN_VERIFY', p_edition_id);
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
        'guardian_event_verification_id', gv.guardian_event_verification_id,
        'status', gv.status,
        'created_at', gv.created_at,
        'participant', private.raceday_participant_view(gv.registration_id, p_edition_id))
      order by gv.created_at)
    from app.guardian_event_verification gv
    join app.registration r on r.registration_id = gv.registration_id
    where r.edition_id = p_edition_id and gv.status in ('PENDING', 'REJECTED')
    limit 200), '[]'::jsonb));
end;
$$;

create function public.raceday_guardian_verify(
  p_registration_id uuid, p_verification_method text, p_notes text default null, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.raceday_guardian_verify(p_registration_id, p_verification_method, p_notes, p_idempotency_key) $$;
create function public.raceday_guardian_reject(p_registration_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.raceday_guardian_reject(p_registration_id, p_reason, p_idempotency_key) $$;
create function public.raceday_list_guardian_verifications(p_edition_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.raceday_list_guardian_verifications(p_edition_id) $$;

revoke all on function
  private.raceday_guardian_verify(uuid, text, text, text), public.raceday_guardian_verify(uuid, text, text, text),
  private.raceday_guardian_reject(uuid, text, text), public.raceday_guardian_reject(uuid, text, text),
  private.raceday_list_guardian_verifications(uuid), public.raceday_list_guardian_verifications(uuid)
from public, anon, authenticated, service_role;

grant execute on function
  private.raceday_guardian_verify(uuid, text, text, text), public.raceday_guardian_verify(uuid, text, text, text),
  private.raceday_guardian_reject(uuid, text, text), public.raceday_guardian_reject(uuid, text, text),
  private.raceday_list_guardian_verifications(uuid), public.raceday_list_guardian_verifications(uuid)
to authenticated;
