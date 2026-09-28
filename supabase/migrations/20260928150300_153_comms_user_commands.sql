-- Favorites, reminders (logged-in and anonymous), preferences and one-click unsubscribe (Master §127-130,
-- §176; SEC-006/010/082/084/120). Ownership always derives from auth.uid(); foreign ids are NOT_FOUND.

create function private.comms_require_self()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_state text;
begin
  perform private.require_actor();
  select rp.runner_profile_id, rp.account_state into v_profile_id, v_state
  from app.runner_profile rp where rp.auth_user_id = auth.uid();
  if v_profile_id is null then
    perform private.raise_domain_error('PROFILE_INCOMPLETE');
  elsif v_state = 'BANNED' then
    perform private.raise_domain_error('ACCOUNT_BANNED');
  elsif v_state = 'DEACTIVATED' then
    perform private.raise_domain_error('FORBIDDEN');
  end if;
  return v_profile_id;
end;
$$;

create function private.comms_published_edition(p_edition_id uuid)
returns app.edition
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_edition app.edition%rowtype;
begin
  select * into v_edition from app.edition e where e.edition_id = p_edition_id and e.publication_state = 'PUBLISHED';
  if not found then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  return v_edition;
end;
$$;

-- Favorite never implies marketing consent (Master §129).
create function private.add_edition_favorite(p_edition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := private.comms_require_self();
begin
  perform private.comms_published_edition(p_edition_id);
  perform private.consume_policy_rate_limit('communication.self:cmd', auth.uid()::text);
  insert into app.edition_interest (runner_profile_id, edition_id, interest_type) values (v_profile_id, p_edition_id, 'FAVORITE')
  on conflict do nothing;
  return jsonb_build_object('edition_id', p_edition_id, 'favorite', true);
end;
$$;

create function private.remove_edition_favorite(p_edition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := private.comms_require_self();
begin
  perform private.consume_policy_rate_limit('communication.self:cmd', auth.uid()::text);
  delete from app.edition_interest
  where runner_profile_id = v_profile_id and edition_id = p_edition_id and interest_type = 'FAVORITE';
  return jsonb_build_object('edition_id', p_edition_id, 'favorite', false);
end;
$$;

create function private.list_my_favorites()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := private.comms_require_self();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'edition_id', e.edition_id, 'slug', e.slug, 'name', e.name, 'registration_state', e.registration_state,
        'execution_state', e.execution_state, 'favorited_at', i.created_at,
        'reminder', (select jsonb_build_object('reminder_id', s.event_reminder_subscription_id, 'status', s.status)
                     from app.event_reminder_subscription s
                     join app.communication_recipient r on r.communication_recipient_id = s.communication_recipient_id
                     where s.edition_id = e.edition_id and r.runner_profile_id = v_profile_id
                       and s.status in ('PENDING_CONFIRMATION', 'ACTIVE')
                     limit 1))
      order by i.created_at desc)
    from app.edition_interest i join app.edition e on e.edition_id = i.edition_id
    where i.runner_profile_id = v_profile_id and i.interest_type = 'FAVORITE' and e.publication_state = 'PUBLISHED'
    ), '[]'::jsonb);
end;
$$;

-- Validates that an Edition accepts "Recordarme" (registration not yet open) and returns it.
create function private.comms_remindable_edition(p_edition_id uuid)
returns app.edition
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_edition app.edition%rowtype := private.comms_published_edition(p_edition_id);
begin
  if v_edition.execution_state = 'CANCELED' then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', '{"reason": "edition_canceled"}');
  elsif v_edition.registration_state = 'CLOSED' then
    perform private.raise_domain_error('REGISTRATION_CLOSED');
  elsif v_edition.registration_state = 'OPEN' then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', '{"reason": "registration_already_open"}');
  end if;
  return v_edition;
end;
$$;

-- Logged-in reminder: the auth email is already verified, so the subscription is ACTIVE at once.
create function private.create_edition_reminder(p_edition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := private.comms_require_self();
  v_recipient record;
  v_verified boolean;
  v_subscription app.event_reminder_subscription%rowtype;
  v_constraint text;
begin
  perform private.comms_remindable_edition(p_edition_id);
  perform private.consume_policy_rate_limit('communication.self:cmd', auth.uid()::text);
  select * into v_recipient from private.comms_ensure_runner_recipient(v_profile_id);
  select cp.verification_status = 'VERIFIED' into v_verified
  from app.communication_contact_point cp where cp.communication_contact_point_id = v_recipient.o_contact_point_id;
  if not coalesce(v_verified, false) then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', '{"reason": "email_unverified"}');
  end if;

  select * into v_subscription from app.event_reminder_subscription s
  where s.edition_id = p_edition_id and s.communication_recipient_id = v_recipient.o_recipient_id
    and s.reminder_type = 'REGISTRATION_OPENED' and s.status in ('PENDING_CONFIRMATION', 'ACTIVE')
  for update;
  if not found then
    insert into app.event_reminder_subscription (edition_id, communication_recipient_id, reminder_type, status, confirmed_at)
    values (p_edition_id, v_recipient.o_recipient_id, 'REGISTRATION_OPENED', 'ACTIVE', pg_catalog.now())
    returning * into v_subscription;
  elsif v_subscription.status = 'PENDING_CONFIRMATION' then
    update app.event_reminder_subscription set status = 'ACTIVE', confirmed_at = pg_catalog.now()
    where event_reminder_subscription_id = v_subscription.event_reminder_subscription_id
    returning * into v_subscription;
  end if;
  perform private.comms_record_consent(v_recipient.o_recipient_id, 'EVENT_REMINDER', 'GRANTED', 'REMINDER_REQUEST',
    jsonb_build_object('edition_id', p_edition_id));

  return jsonb_build_object('reminder_id', v_subscription.event_reminder_subscription_id, 'edition_id', p_edition_id,
    'status', v_subscription.status);
exception when unique_violation then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint, '{"event_reminder_subscription_live_uidx": "CONFLICT"}');
end;
$$;

create function private.cancel_reminder(p_reminder_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := private.comms_require_self();
  v_subscription app.event_reminder_subscription%rowtype;
begin
  select s.* into v_subscription
  from app.event_reminder_subscription s
  join app.communication_recipient r on r.communication_recipient_id = s.communication_recipient_id
  where s.event_reminder_subscription_id = p_reminder_id and r.runner_profile_id = v_profile_id
  for update of s;
  if not found then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.consume_policy_rate_limit('communication.self:cmd', auth.uid()::text);
  if v_subscription.status in ('PENDING_CONFIRMATION', 'ACTIVE') then
    update app.event_reminder_subscription set status = 'CANCELED', canceled_at = pg_catalog.now()
    where event_reminder_subscription_id = p_reminder_id
    returning * into v_subscription;
  end if;
  return jsonb_build_object('reminder_id', p_reminder_id, 'edition_id', v_subscription.edition_id, 'status', v_subscription.status);
end;
$$;

create function private.comms_preferences_projection(p_recipient_id uuid, p_contact_point_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'contact', jsonb_build_object(
      'has_email', p_contact_point_id is not null,
      'verified', coalesce((select cp.verification_status = 'VERIFIED' from app.communication_contact_point cp
                            where cp.communication_contact_point_id = p_contact_point_id), false)),
    'purposes', (
      select jsonb_object_agg(p.purpose, jsonb_build_object(
        'granted', private.comms_consent_granted(p_recipient_id, p.purpose),
        'suppressed', p_contact_point_id is not null
                      and private.comms_is_suppressed(p_contact_point_id, private.comms_purpose_category(p.purpose)),
        'effective', private.comms_consent_granted(p_recipient_id, p.purpose)
                     and p_contact_point_id is not null
                     and not private.comms_is_suppressed(p_contact_point_id, private.comms_purpose_category(p.purpose))))
      from unnest(array['GENERAL_MARKETING', 'EVENT_REMINDER', 'OTHER_OPTIONAL']) p(purpose)),
    'reminders', coalesce((
      select jsonb_agg(jsonb_build_object('reminder_id', s.event_reminder_subscription_id, 'edition_id', e.edition_id,
          'slug', e.slug, 'name', e.name, 'status', s.status, 'registration_state', e.registration_state)
        order by s.created_at desc)
      from app.event_reminder_subscription s join app.edition e on e.edition_id = s.edition_id
      where s.communication_recipient_id = p_recipient_id and s.status in ('PENDING_CONFIRMATION', 'ACTIVE')
        and e.publication_state = 'PUBLISHED'), '[]'::jsonb))
$$;

create function private.get_my_communication_preferences()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient record;
begin
  select * into v_recipient from private.comms_ensure_runner_recipient(private.comms_require_self());
  return private.comms_preferences_projection(v_recipient.o_recipient_id, v_recipient.o_contact_point_id);
end;
$$;

-- Every change appends a consent fact (Master §127); NULL leaves a purpose unchanged.
create function private.update_my_communication_preferences(
  p_general_marketing boolean, p_event_reminder boolean, p_other_optional boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := private.comms_require_self();
  v_recipient record;
  v_dob date;
begin
  if p_general_marketing is null and p_event_reminder is null and p_other_optional is null then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"reason": "no_changes"}');
  end if;
  perform private.consume_policy_rate_limit('communication.self:cmd', auth.uid()::text);
  select * into v_recipient from private.comms_ensure_runner_recipient(v_profile_id);

  if p_general_marketing then
    select rp.date_of_birth into v_dob from app.runner_profile rp where rp.runner_profile_id = v_profile_id;
    -- SEC-120: marketing is adults only; send-time revalidation enforces it again.
    if v_dob is null or v_dob > ((pg_catalog.now() at time zone 'America/Monterrey')::date - interval '18 years')::date then
      perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', '{"reason": "marketing_adults_only"}');
    end if;
  end if;

  if p_general_marketing is not null then
    perform private.comms_record_consent(v_recipient.o_recipient_id, 'GENERAL_MARKETING',
      case when p_general_marketing then 'GRANTED' else 'WITHDRAWN' end, 'PREFERENCES');
  end if;
  if p_event_reminder is not null then
    perform private.comms_record_consent(v_recipient.o_recipient_id, 'EVENT_REMINDER',
      case when p_event_reminder then 'GRANTED' else 'WITHDRAWN' end, 'PREFERENCES');
    if not p_event_reminder then
      update app.event_reminder_subscription set status = 'CANCELED', canceled_at = pg_catalog.now()
      where communication_recipient_id = v_recipient.o_recipient_id and status in ('PENDING_CONFIRMATION', 'ACTIVE');
    end if;
  end if;
  if p_other_optional is not null then
    perform private.comms_record_consent(v_recipient.o_recipient_id, 'OTHER_OPTIONAL',
      case when p_other_optional then 'GRANTED' else 'WITHDRAWN' end, 'PREFERENCES');
  end if;
  return private.comms_preferences_projection(v_recipient.o_recipient_id, v_recipient.o_contact_point_id);
end;
$$;

-- SYSTEM only (SEC-082): Next applies CAPTCHA/IP/email limits first. The response is identical whatever
-- the state of the email, so the endpoint is not an address oracle. Anonymous recipients are never
-- merged into runner accounts by address match (Master §130).
create function private.request_anonymous_reminder(p_edition_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := private.normalize_email(p_email);
  v_accepted constant jsonb := '{"accepted": true}';
  v_recipient_id uuid;
  v_contact_id uuid;
  v_subscription app.event_reminder_subscription%rowtype;
begin
  if coalesce(pg_catalog.length(v_email), 0) not between 6 and 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "email"}');
  end if;
  perform private.comms_remindable_edition(p_edition_id);
  if not private.consume_policy_rate_limit('reminder.anonymous.email:cmd', v_email, false) then
    return v_accepted;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('comms:anonymous:' || v_email, 0));
  select r.communication_recipient_id, cp.communication_contact_point_id into v_recipient_id, v_contact_id
  from app.communication_recipient r
  join app.communication_contact_point cp on cp.communication_recipient_id = r.communication_recipient_id
  where r.recipient_type = 'ANONYMOUS' and cp.channel = 'EMAIL' and cp.status = 'ACTIVE' and cp.value_normalized = v_email
  order by r.created_at
  limit 1;
  if v_recipient_id is null then
    insert into app.communication_recipient (recipient_type, anonymous_key) values ('ANONYMOUS', gen_random_uuid())
    returning communication_recipient_id into v_recipient_id;
    insert into app.communication_contact_point (communication_recipient_id, channel, value_normalized, is_primary)
    values (v_recipient_id, 'EMAIL', v_email, true)
    returning communication_contact_point_id into v_contact_id;
  end if;
  if private.comms_is_suppressed(v_contact_id, 'REMINDER') then
    return v_accepted;
  end if;

  select * into v_subscription from app.event_reminder_subscription s
  where s.edition_id = p_edition_id and s.communication_recipient_id = v_recipient_id
    and s.reminder_type = 'REGISTRATION_OPENED' and s.status in ('PENDING_CONFIRMATION', 'ACTIVE')
  for update;
  if v_subscription.status = 'ACTIVE' then
    return v_accepted;
  elsif not found then
    insert into app.event_reminder_subscription (edition_id, communication_recipient_id, reminder_type)
    values (p_edition_id, v_recipient_id, 'REGISTRATION_OPENED')
    returning * into v_subscription;
  end if;

  -- At most one confirmation email per subscription per hour; the link token is minted at dispatch.
  perform private.comms_enqueue_message('ANONYMOUS_REMINDER_CONFIRMATION', v_recipient_id, v_contact_id,
    'ANONYMOUS_REMINDER_CONFIRMATION:' || v_subscription.event_reminder_subscription_id || ':'
      || pg_catalog.to_char(pg_catalog.date_bin('1 hour', pg_catalog.now(), timestamptz '2000-01-01 00:00:00+00') at time zone 'UTC', 'YYYYMMDDHH24'),
    'EVENT_REMINDER_SUBSCRIPTION', v_subscription.event_reminder_subscription_id,
    private.comms_pick_vars('ANONYMOUS_REMINDER_CONFIRMATION', private.comms_edition_vars(p_edition_id)), p_edition_id);
  return v_accepted;
end;
$$;

-- SYSTEM only. Unknown, used and expired tokens are indistinguishable (410).
create function private.confirm_anonymous_reminder(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token private.communication_action_token%rowtype;
  v_subscription app.event_reminder_subscription%rowtype;
  v_edition app.edition%rowtype;
begin
  select * into v_token from private.communication_action_token t
  where t.token_hash = p_token_hash and t.purpose = 'REMINDER_CONFIRMATION'
  for update;
  if not found or v_token.used_at is not null or v_token.expires_at <= pg_catalog.now() then
    perform private.raise_domain_error('RESOURCE_EXPIRED');
  end if;
  select * into v_subscription from app.event_reminder_subscription s
  where s.event_reminder_subscription_id = v_token.event_reminder_subscription_id
  for update;
  if v_subscription.status <> 'PENDING_CONFIRMATION' then
    perform private.raise_domain_error('RESOURCE_EXPIRED');
  end if;

  update app.event_reminder_subscription set status = 'ACTIVE', confirmed_at = pg_catalog.now()
  where event_reminder_subscription_id = v_subscription.event_reminder_subscription_id;
  update app.communication_contact_point set verification_status = 'VERIFIED', verified_at = pg_catalog.now()
  where communication_contact_point_id = v_token.contact_point_id and verification_status = 'UNVERIFIED';
  perform private.comms_record_consent(v_token.communication_recipient_id, 'EVENT_REMINDER', 'GRANTED',
    'ANONYMOUS_REMINDER_CONFIRMATION', jsonb_build_object('edition_id', v_subscription.edition_id,
      'event_reminder_subscription_id', v_subscription.event_reminder_subscription_id));
  update private.communication_action_token set used_at = pg_catalog.now()
  where event_reminder_subscription_id = v_subscription.event_reminder_subscription_id and used_at is null;

  select * into v_edition from app.edition e where e.edition_id = v_subscription.edition_id;
  return jsonb_build_object('status', 'CONFIRMED', 'edition', jsonb_build_object('slug', v_edition.slug, 'name', v_edition.name));
end;
$$;

-- SYSTEM only (SEC-084, RFC 8058 one-click). A token only affects its own recipient; repeat calls are no-ops.
create function private.unsubscribe_with_token(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token private.communication_action_token%rowtype;
begin
  select * into v_token from private.communication_action_token t
  where t.token_hash = p_token_hash and t.purpose in ('UNSUBSCRIBE_MARKETING', 'UNSUBSCRIBE_REMINDERS')
    and t.expires_at > pg_catalog.now()
  for update;
  if not found then
    perform private.raise_domain_error('NOT_FOUND');
  end if;

  if v_token.purpose = 'UNSUBSCRIBE_MARKETING' then
    perform private.comms_record_consent(v_token.communication_recipient_id, 'GENERAL_MARKETING', 'WITHDRAWN',
      'ONE_CLICK_UNSUBSCRIBE', jsonb_build_object('communication_message_id', v_token.communication_message_id));
  else
    perform private.comms_record_consent(v_token.communication_recipient_id, 'EVENT_REMINDER', 'WITHDRAWN',
      'ONE_CLICK_UNSUBSCRIBE', jsonb_build_object('communication_message_id', v_token.communication_message_id));
    update app.event_reminder_subscription set status = 'CANCELED', canceled_at = pg_catalog.now()
    where communication_recipient_id = v_token.communication_recipient_id and status in ('PENDING_CONFIRMATION', 'ACTIVE');
  end if;
  update private.communication_action_token set used_at = coalesce(used_at, pg_catalog.now())
  where communication_action_token_id = v_token.communication_action_token_id;
  return jsonb_build_object('status', 'UNSUBSCRIBED',
    'scope', case v_token.purpose when 'UNSUBSCRIBE_MARKETING' then 'MARKETING' else 'REMINDERS' end);
end;
$$;
