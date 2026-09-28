-- T30 worker close-registration-windows (Master §152): every 5 min via pg_cron. Commands never
-- depend on it (registration_close_at governs reads directly); it only materialises CLOSED so the
-- state does not silently drift from a passed deadline. Same lock order as the commands (ADR-001 §3).

create function private.worker_close_registration_windows()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_edition_id uuid;
  v_closed integer := 0;
  v_skipped integer := 0;
  v_errors integer := 0;
  v_last_error text;
begin
  insert into infra.worker_run (worker_key) values ('close-registration-windows') returning worker_run_id into v_run_id;

  for v_edition_id in
    select e.edition_id from app.edition e
    where e.registration_state in ('OPEN', 'PAUSED') and e.registration_close_at <= pg_catalog.now()
    limit 500
  loop
    begin
      perform 1 from app.edition e where e.edition_id = v_edition_id for update skip locked;
      if not found then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      update app.edition set registration_state = 'CLOSED'
      where edition_id = v_edition_id and registration_state in ('OPEN', 'PAUSED') and registration_close_at <= pg_catalog.now();
      if found then
        perform private.audit('EDITION_REGISTRATION_CLOSED', 'edition', v_edition_id, v_edition_id,
          jsonb_build_object('registration_state', 'OPEN_OR_PAUSED'), jsonb_build_object('registration_state', 'CLOSED'),
          'registration_close_at_reached');
        v_closed := v_closed + 1;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      v_last_error := sqlstate;
    end;
  end loop;

  update infra.worker_run set
    status = case when v_errors = 0 then 'SUCCEEDED' else 'PARTIAL' end,
    completed_at = pg_catalog.now(),
    processed_count = v_closed,
    error_count = v_errors,
    metadata = jsonb_strip_nulls(jsonb_build_object('skipped_editions', v_skipped, 'last_error_sqlstate', v_last_error))
  where worker_run_id = v_run_id;
  return jsonb_build_object('worker_run_id', v_run_id, 'closed', v_closed, 'skipped_editions', v_skipped, 'errors', v_errors);
end;
$$;

select cron.schedule('close-registration-windows', '*/5 * * * *', 'select private.worker_close_registration_windows()');

revoke all on function private.worker_close_registration_windows() from public, anon, authenticated, service_role;
