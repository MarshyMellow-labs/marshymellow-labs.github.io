-- PostgreSQL LEAST and GREATEST are special conditional expressions, not
-- ordinary pg_catalog functions. Repair the affected deployed definitions
-- without changing their signatures, ownership, grants, or settings.

do $migration$
declare
  target_signatures constant text[] := array[
    'public.control_refund_request(uuid,text,text,text,uuid,timestamp with time zone)',
    'public.get_marshy_control_state(uuid)',
    'public.heartbeat_marshy_control_session(uuid,boolean)',
    'public.enqueue_marshy_control_request(uuid,text)',
    'public.admin_get_marshy_control_audit(integer)',
    'public.companion_marshy_control_heartbeat(text,boolean,boolean,boolean,boolean,boolean,boolean,integer,timestamp with time zone,bigint,text)'
  ];
  target_signature text;
  target_oid oid;
  function_definition text;
begin
  foreach target_signature in array target_signatures loop
    target_oid := pg_catalog.to_regprocedure(target_signature);

    if target_oid is null then
      raise exception 'Required Control Marshy function is missing: %', target_signature;
    end if;

    function_definition := pg_catalog.pg_get_functiondef(target_oid);
    function_definition := pg_catalog.replace(
      function_definition,
      'pg_catalog.least(',
      'least('
    );
    function_definition := pg_catalog.replace(
      function_definition,
      'pg_catalog.greatest(',
      'greatest('
    );

    execute function_definition;
  end loop;
end;
$migration$;