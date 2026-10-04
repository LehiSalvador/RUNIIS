-- P3-S follow-up to migration 790 (already applied on staging, so not edited): the catalog lint "no overloaded names in public" (110) allows ONE public
-- signature per name. 790 left two for each of staff_cancel_registration_request and staff_bulk_cancel_registration_requests (the 144/722 wrappers plus the
-- reason_category overloads). Here each name keeps exactly one public function whose reason_category is the LAST parameter with DEFAULT 'OTHER':
--   * positional callers of the 144/722 shapes (id, reason[, key]) and (edition, ids, reason[, key]) keep working unchanged;
--   * named callers (PostgREST) may omit p_reason_category or pass it; no ambiguity remains because there is a single candidate.
-- The private functions of 790 are untouched (the lint is about the public API surface). Grants follow the 144/722 pattern: authenticated only.

drop function public.staff_cancel_registration_request(uuid, text, text);
drop function public.staff_cancel_registration_request(uuid, text, text, text);
drop function public.staff_bulk_cancel_registration_requests(uuid, uuid[], text, text);
drop function public.staff_bulk_cancel_registration_requests(uuid, uuid[], text, text, text);

create function public.staff_cancel_registration_request(
  p_registration_request_id uuid, p_reason text, p_idempotency_key text default null, p_reason_category text default 'OTHER')
returns jsonb language sql security invoker set search_path = ''
as $$ select private.staff_cancel_registration_request(p_registration_request_id, p_reason, p_reason_category, p_idempotency_key) $$;

create function public.staff_bulk_cancel_registration_requests(
  p_edition_id uuid, p_request_ids uuid[], p_reason text, p_idempotency_key text default null, p_reason_category text default 'OTHER')
returns jsonb language sql security invoker set search_path = ''
as $$ select private.staff_bulk_cancel_registration_requests(p_edition_id, p_request_ids, p_reason, p_reason_category, p_idempotency_key) $$;

revoke all on function
  public.staff_cancel_registration_request(uuid, text, text, text),
  public.staff_bulk_cancel_registration_requests(uuid, uuid[], text, text, text)
from public, anon, authenticated, service_role;
grant execute on function
  public.staff_cancel_registration_request(uuid, text, text, text),
  public.staff_bulk_cancel_registration_requests(uuid, uuid[], text, text, text)
to authenticated;

-- The 144/722 private 3- and 4-argument functions (kept by 790 as the targets of the old public wrappers) have no public wrapper of the same shape any
-- more (lint 110: a private function granted to an API role must be the target of a public wrapper). Nothing calls them: withdraw the grant.
revoke all on function
  private.staff_cancel_registration_request(uuid, text, text),
  private.staff_bulk_cancel_registration_requests(uuid, uuid[], text, text)
from public, anon, authenticated, service_role;
