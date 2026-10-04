-- P3-R security hardening, part 2: closure authority, attendance read lock, OWN-04 notification outcome.
--   P3SECA-05  EDITION_CLOSURE_MANAGE (close / reopen) is GLOBAL ADMIN only (Master §145 "ADMIN GLOBAL: closure/reopen"); freezing the
--              platform ranking_epoch (Master §102) writes its own RANKING_EPOCH_FROZEN audit row.
--   P3SECA-04  the attendance workspace read no longer holds the Edition FOR UPDATE lock through the projection: it locks only when
--              universe rows need reconciling (private.attendance_universe_needs_sync).
--   P3SECA-06  OWN-04 (always notify): the cancel notification outcome (queued | suppressed | no_contact) is computed for the cancel
--              response, and a no_contact/suppressed outcome opens ONE ACTION_REQUIRED task `registration-cancel-notice:{registration}`
--              for staff follow-up (also opened by the RegistrationCanceled outbox consumer). The OWN-04 rule itself is unchanged: the
--              participant is always notified when a contact point exists.
-- Backwards compatible: signatures, grants and result keys of the existing functions are unchanged.

-- ---------------------------------------------------------------------------------------------
-- 1. Closure authority: GLOBAL ADMIN only.
-- ---------------------------------------------------------------------------------------------
-- has_permission() already refuses an EDITION-scoped assignment for a global_only action, so close_edition/reopen_edition answer
-- FORBIDDEN to an edition-scoped ADMIN with no change to the commands. OPERATOR never had the action.
update private.staff_action set global_only = true where action = 'EDITION_CLOSURE_MANAGE';

-- ---------------------------------------------------------------------------------------------
-- 2. CloseEdition: body of migration 712 plus the RANKING_EPOCH_FROZEN audit row. create or replace keeps the grants.
-- ---------------------------------------------------------------------------------------------
create or replace function private.close_edition(p_edition_id uuid, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := private.cfg_authorize('EDITION_CLOSURE_MANAGE', p_edition_id);
  v_idem jsonb;
  v_edition app.edition%rowtype;
  v_readiness jsonb;
  v_revision integer;
  v_closure_id uuid;
  v_finalization_id uuid;
  v_row record;
  v_effective jsonb;
  v_sport_date date;
  v_previous_credit_id uuid;
  v_credit_id uuid;
  v_credit_ids uuid[] := '{}';
  v_credited_count integer := 0;
  v_epoch_candidate date;
  v_epoch_frozen integer;
  v_result jsonb;
  v_constraint text;
begin
  v_idem := private.cfg_idempotency_begin('closure.close_edition', p_edition_id::text, p_idempotency_key,
    jsonb_build_object('edition_id', p_edition_id));
  if v_idem is not null and (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  select * into v_edition from app.edition e where e.edition_id = p_edition_id for update;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  if v_edition.closure_state <> 'PENDING' then
    perform private.cfg_invalid_transition('closure_state', v_edition.closure_state);
  end if;
  perform private.attendance_sync_universe(p_edition_id);

  v_readiness := private.closure_readiness(p_edition_id);
  if not (v_readiness ->> 'ready')::boolean then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION',
      jsonb_build_object('reason', 'not_ready', 'readiness', v_readiness));
  end if;

  select f.attendance_finalization_id into v_finalization_id from app.attendance_finalization f
  where f.edition_id = p_edition_id and f.superseded_at is null and f.status = 'FINALIZED';

  select coalesce(max(c.revision), 0) + 1 into v_revision from app.administrative_closure c where c.edition_id = p_edition_id;
  insert into app.administrative_closure (edition_id, revision, attendance_finalization_id, closed_by_staff_id)
  values (p_edition_id, v_revision, v_finalization_id, v_staff_id)
  returning administrative_closure_id into v_closure_id;

  -- Eligible PROFILE registrations only. The credit's FK to app.registration (registration_id, edition_id,
  -- runner_profile_id) makes a Guest row structurally impossible (Master §99); the filter keeps the loop honest.
  for v_row in
    select r.registration_id, r.runner_profile_id, r.modality_id, m.official_distance_m,
      ar.attendance_resolution_id, s.sporting_eligibility_resolution_id
    from app.registration r
    join app.modality m on m.modality_id = r.modality_id
    join app.attendance_resolution ar on ar.registration_id = r.registration_id and ar.superseded_at is null
    join app.sporting_eligibility_resolution s on s.registration_id = r.registration_id and s.superseded_at is null
    where r.edition_id = p_edition_id and r.status = 'CONFIRMED' and r.runner_profile_id is not null
      and ar.status = 'PRESENT' and s.distance_credit_disposition = 'ALLOW' and m.generates_distance_credit
    order by r.registration_id
  loop
    if v_row.official_distance_m is null or v_row.official_distance_m <= 0 then
      perform private.raise_domain_error('BUSINESS_RULE_VIOLATION',
        jsonb_build_object('reason', 'official_distance_missing', 'modality_id', v_row.modality_id));
    end if;
    v_effective := private.effective_start(p_edition_id, v_row.modality_id);
    if v_effective is null or v_effective ->> 'sport_date' is null then
      perform private.raise_domain_error('BUSINESS_RULE_VIOLATION',
        jsonb_build_object('reason', 'sport_date_unknown', 'modality_id', v_row.modality_id));
    end if;
    v_sport_date := (v_effective ->> 'sport_date')::date;

    -- The successor of a reversed credit points back at it (Master §98); a first credit has no predecessor.
    select dc.distance_credit_id into v_previous_credit_id
    from app.distance_credit dc
    where dc.registration_id = v_row.registration_id and dc.status = 'REVERSED'
      and not exists (select 1 from app.distance_credit n where n.supersedes_distance_credit_id = dc.distance_credit_id)
    order by dc.reversed_at desc, dc.created_at desc
    limit 1;

    v_credit_id := null;
    insert into app.distance_credit (runner_profile_id, registration_id, edition_id, modality_id,
      attendance_resolution_id, attendance_finalization_id, administrative_closure_id, sporting_eligibility_resolution_id,
      official_distance_snapshot_m, credited_distance_m, sport_date, sport_timezone, supersedes_distance_credit_id)
    values (v_row.runner_profile_id, v_row.registration_id, p_edition_id, v_row.modality_id,
      v_row.attendance_resolution_id, v_finalization_id, v_closure_id, v_row.sporting_eligibility_resolution_id,
      v_row.official_distance_m, v_row.official_distance_m, v_sport_date, v_edition.timezone, v_previous_credit_id)
    on conflict (registration_id) where status = 'ACTIVE' do nothing
    returning distance_credit_id into v_credit_id;

    if v_credit_id is not null then
      v_credited_count := v_credited_count + 1;
      v_credit_ids := v_credit_ids || v_credit_id;
      perform private.enqueue_outbox('DistanceCreditGranted', 'DistanceCredit', v_credit_id,
        'DistanceCreditGranted:' || v_credit_id, jsonb_build_object('distance_credit_id', v_credit_id,
          'runner_profile_id', v_row.runner_profile_id, 'edition_id', p_edition_id));
    end if;
  end loop;

  -- Ranking epoch bootstrap (Master §102): first-ever competitively eligible credit only, never moved
  -- silently afterwards (the `ranking_epoch is null` predicate is the whole guard; a concurrent close of
  -- another Edition serializes on this row). Competitive eligibility facts (Master §101, T42 rebuilds the
  -- same test from live data): runner ACTIVE, adult (>= 18) as of sport_date, disposition ALLOW, modality
  -- generates credit, credit ACTIVE.
  select min(dc.sport_date) into v_epoch_candidate
  from app.distance_credit dc
  join app.runner_profile rp on rp.runner_profile_id = dc.runner_profile_id
  where dc.administrative_closure_id = v_closure_id and dc.status = 'ACTIVE'
    and rp.account_state = 'ACTIVE' and age(dc.sport_date, rp.date_of_birth) >= interval '18 years';
  if v_epoch_candidate is not null then
    update app.competition_settings set ranking_epoch = v_epoch_candidate, ranking_epoch_frozen_at = now(),
      updated_by_staff_id = v_staff_id
    where settings_id = 1 and ranking_epoch is null;
    get diagnostics v_epoch_frozen = row_count;
    -- P3SECA-05 / Master §102: the platform-wide ranking epoch is frozen exactly once, so the one transaction that does it leaves its own
    -- audit row (who, which Edition and closure, which date). A close that finds the epoch already frozen writes nothing here.
    if v_epoch_frozen > 0 then
      perform private.audit('RANKING_EPOCH_FROZEN', 'competition_settings', null, p_edition_id,
        jsonb_build_object('ranking_epoch', null, 'ranking_epoch_frozen_at', null),
        jsonb_build_object('ranking_epoch', v_epoch_candidate, 'ranking_epoch_frozen_at', now(),
          'edition_id', p_edition_id, 'administrative_closure_id', v_closure_id));
    end if;
  end if;

  update app.edition set closure_state = 'CLOSED' where edition_id = p_edition_id;

  perform private.audit('EDITION_ADMINISTRATIVELY_CLOSED', 'edition', p_edition_id, p_edition_id, null,
    jsonb_build_object('revision', v_revision, 'credits_created', v_credited_count,
      'affected_ranking_period_ids', to_jsonb(private.distance_credit_ranking_periods(v_credit_ids))));
  perform private.enqueue_outbox('EditionAdministrativelyClosed', 'Edition', p_edition_id,
    'EditionAdministrativelyClosed:' || p_edition_id || ':' || v_revision, jsonb_build_object('edition_id', p_edition_id));

  v_result := private.administrative_closure_projection(p_edition_id) || jsonb_build_object('credits_created', v_credited_count);
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Attendance workspace without the unconditional Edition lock.
-- ---------------------------------------------------------------------------------------------
-- TRUE when attendance_sync_universe would write something for this Edition: a CONFIRMED registration with no attendance or no eligibility
-- row yet, or (while the attendance is not FINALIZED) a PENDING/INITIAL row with a verified check-in to promote or a PRESENT/CHECKIN row whose
-- evidence was withdrawn. Mirrors the sync's own predicates; read-only and lock-free.
create function private.attendance_universe_needs_sync(p_edition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from app.registration r
      where r.edition_id = p_edition_id and r.status = 'CONFIRMED'
        and not exists (select 1 from app.attendance_resolution x where x.registration_id = r.registration_id))
    or exists (
      select 1 from app.registration r
      where r.edition_id = p_edition_id and r.status = 'CONFIRMED'
        and not exists (select 1 from app.sporting_eligibility_resolution x where x.registration_id = r.registration_id))
    or (
      not exists (select 1 from app.attendance_finalization f
                  where f.edition_id = p_edition_id and f.superseded_at is null and f.status = 'FINALIZED')
      and (
        exists (
          select 1 from app.attendance_resolution ar
          join app.registration r on r.registration_id = ar.registration_id
          where r.edition_id = p_edition_id and r.status = 'CONFIRMED' and ar.superseded_at is null
            and ar.status = 'PENDING' and ar.source = 'INITIAL'
            and exists (select 1 from app.attendance_checkin ac
                        where ac.registration_id = ar.registration_id and ac.status = 'VERIFIED_PRESENT'))
        or exists (
          select 1 from app.attendance_resolution ar
          join app.registration r on r.registration_id = ar.registration_id
          where r.edition_id = p_edition_id and r.status = 'CONFIRMED' and ar.superseded_at is null
            and ar.status = 'PRESENT' and ar.source = 'CHECKIN'
            and not exists (select 1 from app.attendance_checkin ac
                            where ac.registration_id = ar.registration_id and ac.status = 'VERIFIED_PRESENT'))))
$$;

revoke all on function private.attendance_universe_needs_sync(uuid) from public, anon, authenticated, service_role;

-- Body of migration 710 (same projection, same grants) with the conditional sync.
create or replace function private.attendance_workspace(p_edition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform private.require_permission('ATTENDANCE_MANAGE', p_edition_id);
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  -- P3SECA-04: the Edition FOR UPDATE lock (inside attendance_sync_universe) is taken ONLY when there are universe rows to reconcile. A read of an
  -- already reconciled Edition (the steady state) takes no lock, so it cannot queue behind or in front of check-ins, creates and closure commands.
  -- The needs-sync test is an unlocked read; the sync re-checks everything under the lock, and a change racing this read is healed by the next read.
  if private.attendance_universe_needs_sync(p_edition_id) then
    perform private.attendance_sync_universe(p_edition_id);
  end if;

  select jsonb_build_object(
    'edition_id', p_edition_id,
    'universe_count', (select count(*) from app.registration r where r.edition_id = p_edition_id and r.status = 'CONFIRMED'),
    'attendance_counts', coalesce((
      select jsonb_object_agg(status, cnt) from (
        select ar.status as status, count(*) as cnt
        from app.registration r
        join app.attendance_resolution ar on ar.registration_id = r.registration_id and ar.superseded_at is null
        where r.edition_id = p_edition_id and r.status = 'CONFIRMED'
        group by 1) s), '{}'::jsonb),
    'eligibility_counts', coalesce((
      select jsonb_object_agg(status, cnt) from (
        select s.status, count(*) as cnt
        from app.registration r
        join app.sporting_eligibility_resolution s on s.registration_id = r.registration_id and s.superseded_at is null
        where r.edition_id = p_edition_id and r.status = 'CONFIRMED'
        group by 1) s), '{}'::jsonb),
    'disposition_pending_count', (
      select count(*) from app.registration r
      join app.sporting_eligibility_resolution s on s.registration_id = r.registration_id and s.superseded_at is null
      where r.edition_id = p_edition_id and r.status = 'CONFIRMED' and s.distance_credit_disposition = 'PENDING'),
    'current_finalization', private.attendance_finalization_projection(p_edition_id),
    'current_closure', private.administrative_closure_projection(p_edition_id),
    'finalize_readiness', private.finalization_readiness(p_edition_id),
    'close_readiness', private.closure_readiness(p_edition_id),
    'participants', (
      select coalesce(jsonb_agg(item.row order by item.sort_name, item.registration_number), '[]'::jsonb) from (
        select
          coalesce(rp.full_name, g.full_name, '') as sort_name,
          r.registration_number,
          jsonb_build_object(
            'registration_id', r.registration_id, 'registration_number', r.registration_number,
            'participant_kind', case when r.runner_profile_id is not null then 'PROFILE' else 'GUEST' end,
            'display_name', coalesce(rp.full_name, g.full_name),
            'modality', jsonb_build_object('modality_id', m.modality_id, 'name', m.name),
            'attendance', jsonb_build_object('status', ar.status, 'source', ar.source, 'reason', ar.reason,
              'resolved_at', ar.resolved_at),
            'eligibility', jsonb_build_object('status', s.status, 'distance_credit_disposition', s.distance_credit_disposition,
              'reason_code', s.reason_code, 'resolved_at', s.resolved_at),
            'guardian_status', gev.status,
            'has_active_credit', exists (select 1 from app.distance_credit dc
              where dc.registration_id = r.registration_id and dc.status = 'ACTIVE')) as row
        from app.registration r
        join app.modality m on m.modality_id = r.modality_id
        left join app.runner_profile rp on rp.runner_profile_id = r.runner_profile_id
        left join app.guest_participant g on g.guest_participant_id = r.guest_participant_id
        left join app.attendance_resolution ar on ar.registration_id = r.registration_id and ar.superseded_at is null
        left join app.sporting_eligibility_resolution s on s.registration_id = r.registration_id and s.superseded_at is null
        left join app.guardian_event_verification gev on gev.registration_id = r.registration_id
        where r.edition_id = p_edition_id and r.status = 'CONFIRMED'
        order by 1, 2
        limit 2000) item)
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. OWN-04 cancellation notification outcome (P3SECA-06).
-- ---------------------------------------------------------------------------------------------
-- One follow-up task per canceled registration (stable key, so repeated calls and the outbox consumer converge on the same row).
-- A manually RESOLVED task is not re-raised: admin_task_sync_open keeps it resolved while its metadata says it is still active.
create function private.registration_cancel_notice_task(
  p_registration_id uuid, p_edition_id uuid, p_registration_number text, p_outcome text)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.admin_task_sync_open('registration-cancel-notice:' || p_registration_id::text, 'COMMUNICATIONS', p_edition_id,
    'registration', p_registration_id, 'Avisa al participante de la cancelación',
    pg_catalog.format('La inscripción %s fue cancelada, pero el aviso por correo %s. Contacta al participante por otro medio (por ejemplo, el WhatsApp con el que se inscribió) y resuelve esta tarea.',
      p_registration_number,
      case p_outcome when 'no_contact' then 'no tiene un correo al cual enviarse' else 'quedó suprimido por la lista de supresión del destinatario' end),
    'HIGH', 'ACTION_REQUIRED', 'OPERATOR',
    jsonb_build_object('registration_id', p_registration_id, 'registration_number', p_registration_number, 'notification_outcome', p_outcome))
$$;

-- What the cancel response reports: queued (an email will be sent by the outbox consumer), suppressed (the contact is on the suppression
-- list) or no_contact (no email contact point). For the last two the follow-up task is opened here too. Authorisation is the cancel's own
-- (REGISTRATION_MANAGE on the registration's Edition); only a CANCELED registration has an outcome.
create function private.registration_cancel_notification(p_registration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reg record;
  v_recipient record;
  v_status text;
  v_task_result text;
  v_task_id uuid;
begin
  select r.registration_id, r.edition_id, r.status, r.runner_profile_id, r.buyer_profile_id, r.registration_number
    into v_reg from app.registration r where r.registration_id = p_registration_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.require_permission('REGISTRATION_MANAGE', v_reg.edition_id);
  if v_reg.status <> 'CANCELED' then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'not_canceled'));
  end if;

  -- Same recipient the outbox consumer resolves: the participant's own profile, or the buyer's for a Guest.
  select * into v_recipient from private.comms_ensure_runner_recipient(coalesce(v_reg.runner_profile_id, v_reg.buyer_profile_id));
  if v_recipient.o_contact_point_id is null then
    v_status := 'no_contact';
  elsif private.comms_recipient_block_reason(v_recipient.o_recipient_id, v_recipient.o_contact_point_id, 'TRANSACTIONAL', false) is not null then
    v_status := 'suppressed';
  else
    v_status := 'queued';
  end if;

  if v_status <> 'queued' then
    v_task_result := private.registration_cancel_notice_task(v_reg.registration_id, v_reg.edition_id, v_reg.registration_number, v_status);
    select t.admin_task_id into v_task_id from app.admin_task t
    where t.task_key = 'registration-cancel-notice:' || v_reg.registration_id::text;
  end if;
  return jsonb_build_object('status', v_status, 'follow_up_task_id', v_task_id, 'task_result', v_task_result);
end;
$$;

create function public.registration_cancel_notification(p_registration_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.registration_cancel_notification(p_registration_id) $$;

revoke all on function
  private.registration_cancel_notice_task(uuid, uuid, text, text),
  private.registration_cancel_notification(uuid), public.registration_cancel_notification(uuid)
from public, anon, authenticated, service_role;
grant execute on function private.registration_cancel_notification(uuid), public.registration_cancel_notification(uuid) to authenticated;

-- Outbox consumer of migration 714 with the follow-up task for the cases where no email can go out (result keys unchanged).
create or replace function private.enqueue_registration_canceled_messages(p_outbox_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event infra.outbox_event%rowtype;
  v_registration_id uuid;
  v_reg record;
  v_recipient record;
  v_label text;
  v_vars jsonb;
begin
  select * into v_event from infra.outbox_event o where o.outbox_event_id = p_outbox_event_id;
  if not found or v_event.event_type <> 'RegistrationCanceled' then
    raise exception using errcode = 'invalid_parameter_value', message = 'not a RegistrationCanceled event';
  end if;

  v_registration_id := coalesce((v_event.payload ->> 'registration_id')::uuid,
    case when v_event.aggregate_type = 'Registration' then v_event.aggregate_id end);
  select r.registration_id, r.edition_id, r.runner_profile_id, r.guest_participant_id, r.buyer_profile_id,
         r.registration_number, m.name as modality_name, coalesce(rp.full_name, g.full_name) as participant_name
    into v_reg
  from app.registration r
  join app.modality m on m.modality_id = r.modality_id
  left join app.runner_profile rp on rp.runner_profile_id = r.runner_profile_id
  left join app.guest_participant g on g.guest_participant_id = r.guest_participant_id
  where r.registration_id = v_registration_id;
  if not found then
    return jsonb_build_object('enqueued', 0, 'skipped_no_registration', 1);
  end if;

  -- The participant's own profile, or the buyer's for a Guest (who has no account): the event carries it, the
  -- registration row is the fallback for events written before the recipient reference existed.
  select * into v_recipient from private.comms_ensure_runner_recipient(
    coalesce((v_event.payload ->> 'recipient_profile_id')::uuid, v_reg.runner_profile_id, v_reg.buyer_profile_id));
  if v_recipient.o_contact_point_id is null then
    -- OWN-04 (P3SECA-06): the participant cannot be emailed -> staff follow-up task (idempotent, one per registration).
    perform private.registration_cancel_notice_task(v_reg.registration_id, v_reg.edition_id, v_reg.registration_number, 'no_contact');
    return jsonb_build_object('enqueued', 0, 'skipped_no_contact', 1);
  end if;
  if private.comms_recipient_block_reason(v_recipient.o_recipient_id, v_recipient.o_contact_point_id, 'TRANSACTIONAL', false) is not null then
    perform private.registration_cancel_notice_task(v_reg.registration_id, v_reg.edition_id, v_reg.registration_number, 'suppressed');
  end if;

  -- Closed set (migration 713): only the label travels, never the free-text reason.
  v_label := case v_event.payload ->> 'reason_category'
    when 'PARTICIPANT_REQUEST' then 'Cancelación solicitada por el participante'
    when 'DUPLICATE_REGISTRATION' then 'Inscripción duplicada'
    when 'ELIGIBILITY' then 'Requisitos de participación'
    when 'EVENT_CHANGE' then 'Cambio en el evento'
    when 'ADMINISTRATIVE' then 'Motivo administrativo'
    else 'Otro motivo'
  end;

  v_vars := private.comms_pick_vars('REGISTRATION_CANCELED', private.comms_edition_vars(v_reg.edition_id))
    || jsonb_build_object('participant_name', coalesce(v_reg.participant_name, 'Participante'),
         'modality_name', v_reg.modality_name, 'registration_number', v_reg.registration_number,
         'reason_label', v_label, 'is_guest_pass', v_reg.guest_participant_id is not null);

  return jsonb_build_object('enqueued',
    case when private.comms_enqueue_message('REGISTRATION_CANCELED', v_recipient.o_recipient_id, v_recipient.o_contact_point_id,
           'REGISTRATION_CANCELED:' || v_reg.registration_id, 'REGISTRATION', v_reg.registration_id, v_vars,
           v_reg.edition_id, null, null) is not null then 1 else 0 end);
end;
$$;
