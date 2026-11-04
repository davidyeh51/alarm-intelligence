create function public.alarm_resolve_case(p_case_id bigint) returns boolean
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare changed integer;
begin
  update public.alarm_site_cases
  set resolved_at=now(),resolved_by=(select auth.uid())
  where id=p_case_id and resolved_at is null;
  get diagnostics changed=row_count;
  return changed=1;
end;
$$;
revoke all on function public.alarm_resolve_case(bigint) from public,anon;
grant execute on function public.alarm_resolve_case(bigint) to authenticated;
