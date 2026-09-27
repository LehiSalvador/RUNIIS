create schema if not exists app;
create schema if not exists private;
create schema if not exists audit;
create schema if not exists infra;

revoke all on schema app, private, audit, infra from public, anon, authenticated;

-- Closed by default: grants to API roles are added explicitly by the RLS/grants migration.
alter default privileges for role postgres in schema app, private, audit, infra
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema app, private, audit, infra
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema app, private, audit, infra
  revoke all on functions from public, anon, authenticated;
-- public is only the API facade (ADR-001): its objects are also closed until explicitly allowlisted.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;
-- PUBLIC EXECUTE on functions is a global default that per-schema rules cannot remove.
alter default privileges for role postgres revoke execute on functions from public;

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function private.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'restrict_violation',
    message = format('%s on %I.%I is not allowed', tg_op, tg_table_schema, tg_table_name),
    detail = coalesce(tg_argv[0], 'history is preserved; use status, revision or reversal columns');
end;
$$;

-- UPDATE may only change the columns passed as trigger arguments (supersede/revoke/reverse facts).
create function private.enforce_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - tg_argv) is distinct from (to_jsonb(old) - tg_argv) then
    raise exception using
      errcode = 'restrict_violation',
      message = format('UPDATE on %I.%I may only change: %s', tg_table_schema, tg_table_name,
                       coalesce(array_to_string(tg_argv, ', '), '(nothing)'));
  end if;
  return new;
end;
$$;

create function private.normalize_search_text(input text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary, input)),
    '\s+', ' ', 'g'))
$$;

create function private.is_iana_timezone(tz text)
returns boolean
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = tz)
$$;
