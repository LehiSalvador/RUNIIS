-- P2-B registration context read model (Master §34-42, §61-76, §124, §165): one server-authoritative
-- read for GET /api/v1/events/:slug/registration-context. For the signed-in buyer and one PUBLISHED
-- Edition it returns what /inscripcion/[slug] needs without any rule living in the browser: registration
-- window, mode and the projected absolute hold, modalities with DERIVED availability and the resolvable
-- price, categories, the published event forms, the required event documents with their current versions,
-- the candidate participants (self, accepted Friends, wards, owned active Guests) with a per-modality
-- eligibility verdict computed by the SAME function create_registration_request uses
-- (private.registration_participant_eligibility), the buyer's account-level legal status, and the buyer's
-- existing pending request / registrations for the Edition.
--
-- Privacy (SEC-012, §121): no date of birth, age, phone, emergency contact or guardian identity of anyone
-- is returned; another person's account state collapses to PARTICIPANT_UNAVAILABLE (inclusion check);
-- no capacity counts are returned (states only, SEC-051); Friends' and Guests' data is limited to what the
-- buyer already sees (display name / owned Guest name). It never mutates registration data; the only
-- write is the rate-limit counter.

insert into infra.rate_limit_policy (scope, max_hits, window_seconds, subject_kind, description) values
  ('registration.context:cmd', 120, 600, 'ACTOR', 'Registration context reads per user (command)')
on conflict (scope) do nothing;

-- One candidate with its inclusion verdict, per-modality eligibility and document acceptance state.
-- p_modalities: [{modality_id, status, user_category_ids[]}]. Caller is the context command (definer chain).
create function private.registration_context_candidate(
  p_edition_id uuid, p_buyer uuid, p_relation text, p_runner_profile_id uuid, p_guest_participant_id uuid,
  p_display_name text, p_public_profile_id uuid, p_modalities jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_kind text := case when p_guest_participant_id is not null then 'GUEST' else 'PROFILE' end;
  v_check jsonb;
  v_is_minor boolean;
  v_required uuid[];
  v_missing uuid[];
  v_acceptor record;
  v_acceptor_kind text;
  v_verdicts jsonb := '[]'::jsonb;
  v_m jsonb;
  v_modality_id uuid;
  v_res jsonb;
  v_issue jsonb;
  v_allowed jsonb;
  v_cat uuid;
  v_eligible boolean;
begin
  v_check := private.participant_inclusion_check(p_edition_id, v_kind, p_runner_profile_id, p_guest_participant_id, p_buyer);
  v_is_minor := coalesce((v_check ->> 'is_minor')::boolean, false);
  select coalesce(array_agg(d.legal_document_version_id order by d.document_type), '{}') into v_required
  from private.registration_required_documents(p_edition_id, v_is_minor) d;
  v_missing := private.registration_missing_documents(p_edition_id, p_runner_profile_id, p_guest_participant_id, v_is_minor);
  select * into v_acceptor
  from private.registration_acceptor_assignment(p_buyer, p_runner_profile_id, p_guest_participant_id, v_is_minor);
  v_acceptor_kind := case
    when v_acceptor.allowed then
      case when p_runner_profile_id is not distinct from p_buyer then 'SELF'
           when p_guest_participant_id is not null and not v_is_minor then 'OWNER'
           else 'GUARDIAN' end
    when v_is_minor then 'OTHER_GUARDIAN'
    else 'PARTICIPANT' end;

  for v_m in select e from jsonb_array_elements(p_modalities) e loop
    v_modality_id := (v_m ->> 'modality_id')::uuid;
    if v_m ->> 'status' <> 'ACTIVE' then
      v_verdicts := v_verdicts || jsonb_build_object('modality_id', v_modality_id, 'eligible', false,
        'code', 'MODALITY_NOT_AVAILABLE', 'reasons', jsonb_build_array('MODALITY_CLOSED'),
        'category_selection_required', false, 'allowed_category_ids', '[]'::jsonb, 'derived_category_id', null);
      continue;
    end if;
    v_res := private.registration_participant_eligibility(0, p_edition_id, p_buyer, v_kind, p_runner_profile_id,
      p_guest_participant_id, v_modality_id, null);
    if v_res ? 'row' then
      v_verdicts := v_verdicts || jsonb_build_object('modality_id', v_modality_id, 'eligible', true, 'code', null,
        'reasons', '[]'::jsonb, 'category_selection_required', false, 'allowed_category_ids', '[]'::jsonb,
        'derived_category_id', v_res -> 'row' -> 'category_id');
      continue;
    end if;
    v_issue := v_res -> 'issue';
    if v_issue ->> 'code' = 'FORM_INVALID' and v_issue ->> 'field_key' = 'category_id' and v_issue ->> 'reason' = 'required' then
      -- Eligible for the Modality but the buyer must choose a USER_SELECTS category: list the ones that fit.
      v_allowed := '[]'::jsonb;
      for v_cat in select x::uuid from jsonb_array_elements_text(v_m -> 'user_category_ids') x loop
        if private.registration_participant_eligibility(0, p_edition_id, p_buyer, v_kind, p_runner_profile_id,
             p_guest_participant_id, v_modality_id, v_cat) ? 'row' then
          v_allowed := v_allowed || to_jsonb(v_cat);
        end if;
      end loop;
      v_eligible := jsonb_array_length(v_allowed) > 0;
      v_verdicts := v_verdicts || jsonb_build_object('modality_id', v_modality_id, 'eligible', v_eligible,
        'code', case when v_eligible then null else 'PARTICIPANT_NOT_ELIGIBLE' end,
        'reasons', case when v_eligible then '[]'::jsonb else jsonb_build_array('CATEGORY_RULE') end,
        'category_selection_required', true, 'allowed_category_ids', v_allowed, 'derived_category_id', null);
    else
      v_verdicts := v_verdicts || jsonb_build_object('modality_id', v_modality_id, 'eligible', false,
        'code', v_issue ->> 'code',
        'reasons', coalesce(v_issue -> 'reasons',
          case when v_issue ? 'reason' then jsonb_build_array(v_issue ->> 'reason') else '[]'::jsonb end),
        'category_selection_required', false, 'allowed_category_ids', '[]'::jsonb, 'derived_category_id', null);
    end if;
  end loop;

  return jsonb_build_object(
    'candidate_key', case when p_guest_participant_id is not null then 'guest:' || p_guest_participant_id
                          when p_relation = 'SELF' then 'self'
                          else 'profile:' || p_public_profile_id end,
    'relation', p_relation,
    'participant_kind', v_kind,
    'public_profile_id', p_public_profile_id,
    'guest_participant_id', p_guest_participant_id,
    'display_name', p_display_name,
    'is_minor', v_is_minor,
    'inclusion', jsonb_build_object('eligible', (v_check ->> 'eligible')::boolean, 'reasons', v_check -> 'client_reasons'),
    'acceptance', jsonb_build_object('required_document_version_ids', to_jsonb(v_required),
      'missing_document_version_ids', to_jsonb(v_missing), 'buyer_can_accept', v_acceptor.allowed,
      'acceptor', v_acceptor_kind),
    'modalities', v_verdicts);
end;
$$;

create function private.get_registration_context(p_slug text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_max_candidates constant integer := 100;
  v_buyer uuid := private.require_ready_profile();
  v_resolved jsonb;
  v_edition app.edition%rowtype;
  v_now timestamptz := pg_catalog.now();
  v_availability jsonb;
  v_whatsapp text;
  v_blocking text;
  v_m record;
  v_state text;
  v_price jsonb;
  v_reason text;
  v_modality_json jsonb := '[]'::jsonb;
  v_modality_inputs jsonb := '[]'::jsonb;
  v_forms jsonb;
  v_documents jsonb;
  v_categories jsonb;
  v_candidates jsonb := '[]'::jsonb;
  v_friends_truncated boolean := false;
  v_guests_truncated boolean := false;
  v_row record;
  v_count integer;
  v_pending uuid;
  v_pending_view jsonb;
  v_registrations jsonb;
  v_self_public uuid;
  v_self_name text;
begin
  perform private.consume_policy_rate_limit('registration.context:cmd', auth.uid()::text);
  if p_slug is null or char_length(p_slug) > 160 or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    return null;
  end if;
  v_resolved := private.resolve_edition_slug(p_slug);
  if v_resolved is null then return null; end if;
  select * into v_edition from app.edition e
  where e.edition_id = (v_resolved ->> 'edition_id')::uuid and e.publication_state = 'PUBLISHED';
  if not found then return null; end if;
  if (v_resolved ->> 'redirect')::boolean then
    return jsonb_build_object('redirect', true, 'slug', v_resolved ->> 'slug');
  end if;

  v_whatsapp := private.effective_whatsapp(v_edition.edition_id) ->> 'phone_e164';
  -- Same precedence as create_registration_request's preconditions (Master §65).
  v_blocking := case
    when v_edition.execution_state <> 'SCHEDULED' then 'EDITION_NOT_REGISTRABLE'
    when v_edition.registration_state = 'CLOSED' or v_now >= v_edition.registration_close_at then 'REGISTRATION_CLOSED'
    when v_edition.registration_state <> 'OPEN' or v_now < coalesce(v_edition.registration_open_at, '-infinity') then 'REGISTRATION_NOT_OPEN'
    when v_edition.registration_mode = 'EXTERNAL_WHATSAPP' and v_whatsapp is null then 'EDITION_NOT_REGISTRABLE'
  end;

  v_availability := private.edition_availability(v_edition.edition_id);

  for v_m in
    select m.* from app.modality m
    where m.edition_id = v_edition.edition_id and m.status in ('ACTIVE', 'CLOSED')
    order by m.sort_order, m.key
  loop
    select x ->> 'state' into v_state
    from jsonb_array_elements(v_availability -> 'modalities') x where x ->> 'modality_id' = v_m.modality_id::text;
    v_price := private.resolve_modality_price(v_m.modality_id, v_now);
    v_reason := case
      when v_m.status <> 'ACTIVE' then 'MODALITY_CLOSED'
      when v_price is null then 'NO_PRICE'
      when v_state = 'SOLD_OUT' then 'SOLD_OUT'
      when v_state = 'TEMPORARILY_UNAVAILABLE' then 'TEMPORARILY_UNAVAILABLE'
    end;
    v_modality_json := v_modality_json || jsonb_build_object(
      'modality_id', v_m.modality_id, 'key', v_m.key, 'name', v_m.name,
      'official_distance_m', v_m.official_distance_m, 'local_start_time', v_m.local_start_time,
      'sort_order', v_m.sort_order, 'status', v_m.status,
      'availability_state', coalesce(v_state, 'AVAILABLE'),
      'registrable', v_reason is null,
      'unavailable_reason', v_reason,
      'price', case when v_price is null then null else jsonb_build_object(
        'source', v_price ->> 'source', 'price_offer_id', v_price -> 'price_offer_id',
        'name', v_price -> 'name', 'amount_minor', (v_price ->> 'amount_minor')::bigint,
        'currency', v_price ->> 'currency', 'ends_at', v_price -> 'ends_at') end,
      'category_mode', case
        when exists (select 1 from app.category c join app.modality_category mc on mc.category_id = c.category_id
                     where mc.modality_id = v_m.modality_id and c.active and c.assignment_mode = 'USER_SELECTS') then 'USER_SELECTS'
        when exists (select 1 from app.category c join app.modality_category mc on mc.category_id = c.category_id
                     where mc.modality_id = v_m.modality_id and c.active and c.assignment_mode = 'SYSTEM_DERIVES') then 'SYSTEM_DERIVES'
        else 'NONE' end);
    v_modality_inputs := v_modality_inputs || jsonb_build_object('modality_id', v_m.modality_id, 'status', v_m.status,
      'user_category_ids', coalesce((
        select jsonb_agg(c.category_id order by c.sort_order, c.key)
        from app.category c join app.modality_category mc on mc.category_id = c.category_id
        where mc.modality_id = v_m.modality_id and c.active and c.assignment_mode = 'USER_SELECTS'), '[]'::jsonb));
  end loop;

  select coalesce(jsonb_agg(private.category_projection(c.category_id) order by c.sort_order, c.key), '[]'::jsonb)
  into v_categories from app.category c where c.edition_id = v_edition.edition_id and c.active;

  -- Published forms only (edition-wide has modality_id null; a Modality form adds fields for that Modality).
  select coalesce(jsonb_agg(jsonb_build_object(
      'registration_form_id', f.registration_form_id, 'modality_id', f.modality_id, 'version', f.version,
      'fields', coalesce((
        select jsonb_agg(jsonb_build_object('field_key', ff.field_key, 'label', ff.label, 'field_type', ff.field_type,
            'required', ff.required, 'validation_config', ff.validation_config, 'options_config', ff.options_config,
            'sort_order', ff.sort_order) order by ff.sort_order, ff.field_key)
        from app.registration_form_field ff where ff.registration_form_id = f.registration_form_id), '[]'::jsonb))
      order by f.modality_id nulls first, f.registration_form_id), '[]'::jsonb)
  into v_forms
  from app.registration_form f where f.edition_id = v_edition.edition_id and f.status = 'PUBLISHED';

  -- Event documents with a PUBLISHED version only (same source the create/accept commands validate against).
  select coalesce(jsonb_agg(jsonb_build_object(
      'document_type', d ->> 'document_type', 'document_key', d ->> 'document_key', 'applies_to', d ->> 'applies_to',
      'legal_document_version_id', d -> 'current_version' ->> 'legal_document_version_id',
      'version', (d -> 'current_version' ->> 'version')::integer,
      'published_at', d -> 'current_version' -> 'published_at')
      order by d ->> 'document_type', d ->> 'document_key'), '[]'::jsonb)
  into v_documents
  from jsonb_array_elements(coalesce(private.edition_required_legal_documents(v_edition.edition_id), '[]'::jsonb)) d
  where jsonb_typeof(d -> 'current_version') = 'object';

  -- Candidates: self first, then wards, Friends and Guests (sorted by name, capped).
  select cp.public_profile_id, coalesce(rp.full_name, cp.display_name) into v_self_public, v_self_name
  from app.runner_profile rp left join app.community_profile cp on cp.runner_profile_id = rp.runner_profile_id
  where rp.runner_profile_id = v_buyer;
  v_candidates := v_candidates || jsonb_build_array(private.registration_context_candidate(
    v_edition.edition_id, v_buyer, 'SELF', v_buyer, null, v_self_name, v_self_public, v_modality_inputs));

  v_count := 0;
  for v_row in
    select cp.runner_profile_id, cp.public_profile_id, cp.display_name
    from app.friendship f
    join app.community_profile cp on cp.runner_profile_id =
      case when f.requester_profile_id = v_buyer then f.addressee_profile_id else f.requester_profile_id end
    where f.status = 'ACCEPTED' and v_buyer in (f.requester_profile_id, f.addressee_profile_id)
      and private.people_profile_available(cp.runner_profile_id)
    order by private.normalize_search_text(cp.display_name) collate "C", f.friendship_id
    limit c_max_candidates + 1
  loop
    v_count := v_count + 1;
    if v_count > c_max_candidates then v_friends_truncated := true; exit; end if;
    v_candidates := v_candidates || jsonb_build_array(private.registration_context_candidate(
      v_edition.edition_id, v_buyer, 'FRIEND', v_row.runner_profile_id, null, v_row.display_name, v_row.public_profile_id,
      v_modality_inputs));
  end loop;

  -- Wards: minor RunnerProfiles whose ACTIVE guardian is the buyer and who are not already Friends.
  for v_row in
    select cp.runner_profile_id, cp.public_profile_id, cp.display_name
    from app.guardian_assignment ga
    join app.community_profile cp on cp.runner_profile_id = ga.minor_runner_profile_id
    where ga.guardian_profile_id = v_buyer and ga.status = 'ACTIVE' and ga.minor_runner_profile_id is not null
      and private.people_profile_available(cp.runner_profile_id)
      and not exists (
        select 1 from app.friendship f
        where f.status = 'ACCEPTED'
          and least(f.requester_profile_id, f.addressee_profile_id) = least(v_buyer, cp.runner_profile_id)
          and greatest(f.requester_profile_id, f.addressee_profile_id) = greatest(v_buyer, cp.runner_profile_id))
    order by private.normalize_search_text(cp.display_name) collate "C", ga.guardian_assignment_id
    limit c_max_candidates
  loop
    v_candidates := v_candidates || jsonb_build_array(private.registration_context_candidate(
      v_edition.edition_id, v_buyer, 'WARD', v_row.runner_profile_id, null, v_row.display_name, v_row.public_profile_id,
      v_modality_inputs));
  end loop;

  v_count := 0;
  for v_row in
    select g.guest_participant_id, g.full_name
    from app.guest_participant g
    where g.owner_profile_id = v_buyer and g.status = 'ACTIVE'
    order by private.normalize_search_text(g.full_name) collate "C", g.guest_participant_id
    limit c_max_candidates + 1
  loop
    v_count := v_count + 1;
    if v_count > c_max_candidates then v_guests_truncated := true; exit; end if;
    v_candidates := v_candidates || jsonb_build_array(private.registration_context_candidate(
      v_edition.edition_id, v_buyer, 'GUEST', null, v_row.guest_participant_id, v_row.full_name, null, v_modality_inputs));
  end loop;

  -- Existing pending request (effective hold) and confirmed registrations of the buyer for this Edition.
  select r.registration_request_id into v_pending
  from app.registration_request r
  where r.buyer_profile_id = v_buyer and r.edition_id = v_edition.edition_id
    and r.status = 'PENDING_CONFIRMATION' and r.expires_at > v_now
  order by r.created_at desc, r.registration_request_id desc
  limit 1;
  if v_pending is not null then
    v_pending_view := private.registration_request_view(v_pending, v_buyer, false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'registration_id', reg.registration_id, 'registration_number', reg.registration_number, 'status', reg.status,
      'registration_request_id', reg.registration_request_id, 'confirmed_at', reg.confirmed_at,
      'is_titular', reg.runner_profile_id is not distinct from v_buyer,
      'participant_display_name', case
        when reg.runner_profile_id is not distinct from v_buyer then v_self_name
        when reg.runner_profile_id is not null then cp.display_name
        else g.full_name end,
      'modality', jsonb_build_object('modality_id', m.modality_id, 'name', m.name),
      'participant_pass_id', case when private.pass_viewer_allowed(reg.registration_id, v_buyer) then pp.participant_pass_id end)
      order by reg.confirmed_at, reg.registration_id), '[]'::jsonb)
  into v_registrations
  from app.registration reg
  join app.modality m on m.modality_id = reg.modality_id
  left join app.community_profile cp on cp.runner_profile_id = reg.runner_profile_id
  left join app.guest_participant g on g.guest_participant_id = reg.guest_participant_id
  left join app.participant_pass pp on pp.registration_id = reg.registration_id
  where reg.edition_id = v_edition.edition_id and reg.status = 'CONFIRMED'
    and (reg.buyer_profile_id = v_buyer or reg.runner_profile_id = v_buyer);

  return jsonb_build_object(
    'redirect', false,
    'server_time', v_now,
    'edition', jsonb_build_object(
      'edition_id', v_edition.edition_id, 'slug', v_edition.slug, 'name', v_edition.name,
      'registration_mode', v_edition.registration_mode, 'registration_state', v_edition.registration_state,
      'execution_state', v_edition.execution_state, 'timezone', v_edition.timezone,
      'sport_date', private.current_schedule(v_edition.edition_id) ->> 'local_date',
      'city', v_edition.city, 'state_region', v_edition.state_region),
    'registration', jsonb_build_object(
      'can_register', v_blocking is null, 'blocking_code', v_blocking,
      'opens_at', v_edition.registration_open_at, 'closes_at', v_edition.registration_close_at,
      'global_state', v_availability -> 'global' ->> 'state',
      'max_participants_per_request', 20),
    'hold', case when v_edition.registration_mode = 'EXTERNAL_WHATSAPP' then jsonb_build_object(
        'kind', 'ABSOLUTE', 'duration_minutes', 1440, 'extends_on_activity', false,
        'projected_expires_at', least(v_now + interval '24 hours', v_edition.registration_close_at))
      else null end,
    'whatsapp', case when v_edition.registration_mode = 'EXTERNAL_WHATSAPP'
      then jsonb_build_object('configured', v_whatsapp is not null) else null end,
    'modalities', v_modality_json,
    'categories', v_categories,
    'forms', v_forms,
    'documents', v_documents,
    'account_legal', private.account_legal_status(v_buyer),
    'candidates', v_candidates,
    'candidates_truncated', jsonb_build_object('friends', v_friends_truncated, 'guests', v_guests_truncated),
    'existing', jsonb_build_object('pending_request', v_pending_view, 'registrations', v_registrations));
end;
$$;

create function public.get_registration_context(p_slug text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.get_registration_context(p_slug) $$;

revoke all on function
  private.registration_context_candidate(uuid, uuid, text, uuid, uuid, text, uuid, jsonb),
  private.get_registration_context(text), public.get_registration_context(text)
from public, anon, authenticated, service_role;
grant execute on function
  private.get_registration_context(text), public.get_registration_context(text)
to authenticated;
