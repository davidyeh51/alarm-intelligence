-- Hourly alarm ingestion, site-level cases and explicit resolution.
create table public.alarm_sync_runs (
  id uuid primary key default gen_random_uuid(),
  synced_at timestamptz not null default now(),
  group_count integer not null,
  detail_count integer not null,
  source text not null default 'historyalarms'
);
alter table public.alarm_sync_runs enable row level security;
revoke all on public.alarm_sync_runs from public, anon, authenticated;
grant select on public.alarm_sync_runs to authenticated;
create policy "approved viewers read alarm sync runs" on public.alarm_sync_runs
for select to authenticated using (exists (select 1 from public.alarm_dashboard_viewers v where v.user_id = (select auth.uid())));

-- Keep the existing table untouched; initialize an independent, deduplicated event store.
create table public.alarm_synced_events (
  id bigint generated always as identity primary key,
  factory_name text, county text, maintainer text, event_time text,
  alarm_type text, device text, description text, error_message text,
  level text, color_label text,
  imported_at timestamptz not null default now(),
  content_hash text not null unique,
  last_run_id uuid references public.alarm_sync_runs(id)
);
alter table public.alarm_synced_events enable row level security;
revoke all on public.alarm_synced_events from public,anon,authenticated;
grant select on public.alarm_synced_events to authenticated;
grant select,insert,update on public.alarm_synced_events to service_role;
grant usage,select on sequence public.alarm_synced_events_id_seq to service_role;
create policy "approved viewers read synced events" on public.alarm_synced_events
for select to authenticated using (exists (select 1 from public.alarm_dashboard_viewers v where v.user_id = (select auth.uid())));
create index alarm_synced_events_last_run_idx on public.alarm_synced_events(last_run_id,id);
with prior as (
  insert into public.alarm_sync_runs (synced_at,group_count,detail_count,source)
  select coalesce(max(imported_at),now()),count(distinct factory_name),count(*),'initial_snapshot'
  from public.alarm_dashboard_events returning id
)
insert into public.alarm_synced_events(factory_name,county,maintainer,event_time,alarm_type,device,description,error_message,level,color_label,imported_at,content_hash,last_run_id)
select e.factory_name,e.county,e.maintainer,e.event_time,e.alarm_type,e.device,e.description,e.error_message,e.level,e.color_label,e.imported_at,
  encode(extensions.digest(jsonb_build_array(e.factory_name,e.county,e.maintainer,e.event_time,e.alarm_type,e.device,e.description,e.error_message,e.level,e.color_label)::text,'sha256'),'hex'),prior.id
from public.alarm_dashboard_events e cross join prior;

create table public.alarm_site_cases (
  id bigint generated always as identity primary key,
  factory_name text not null,
  county text,
  maintainer text,
  opened_at timestamptz not null default now(),
  first_event_at timestamptz not null,
  last_event_at timestamptz not null,
  last_observed_at timestamptz not null,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);
create unique index alarm_site_cases_one_open_per_site on public.alarm_site_cases(factory_name) where resolved_at is null;
create index alarm_site_cases_status_idx on public.alarm_site_cases(resolved_at,last_observed_at);
alter table public.alarm_site_cases enable row level security;
revoke all on public.alarm_site_cases from public, anon, authenticated;
grant select on public.alarm_site_cases to authenticated;
grant update(resolved_at,resolved_by) on public.alarm_site_cases to authenticated;
create policy "approved viewers read alarm cases" on public.alarm_site_cases
for select to authenticated using (exists (select 1 from public.alarm_dashboard_viewers v where v.user_id = (select auth.uid())));
create policy "approved viewers resolve alarm cases" on public.alarm_site_cases
for update to authenticated using (
  resolved_at is null and exists (select 1 from public.alarm_dashboard_viewers v where v.user_id = (select auth.uid()))
) with check (
  resolved_by=(select auth.uid()) and resolved_at between now()-interval '10 minutes' and now()+interval '1 minute'
  and exists (select 1 from public.alarm_dashboard_viewers v where v.user_id = (select auth.uid()))
);

create table public.alarm_case_devices (
  case_id bigint not null references public.alarm_site_cases(id) on delete cascade,
  device text not null,
  first_event_at timestamptz not null,
  last_event_at timestamptz not null,
  primary key(case_id,device)
);
alter table public.alarm_case_devices enable row level security;
revoke all on public.alarm_case_devices from public, anon, authenticated;
grant select on public.alarm_case_devices to authenticated;
create policy "approved viewers read case devices" on public.alarm_case_devices
for select to authenticated using (exists (select 1 from public.alarm_dashboard_viewers v where v.user_id = (select auth.uid())));

-- Initialize open cases from the previously imported snapshot; absence of an alarm does not resolve a case.
insert into public.alarm_site_cases(factory_name,county,maintainer,first_event_at,last_event_at,last_observed_at)
select factory_name,max(county),max(maintainer),min(event_time::timestamptz),max(event_time::timestamptz),max(imported_at)
from public.alarm_synced_events
where alarm_type='無發電數據' and nullif(factory_name,'') is not null
  and device ~* '^(inv[[:space:]]*)?[0-9]{1,4}$' and event_time is not null
group by factory_name;
insert into public.alarm_case_devices(case_id,device,first_event_at,last_event_at)
select c.id, 'INV'||lpad((regexp_replace(e.device,'[^0-9]','','g')::integer)::text,2,'0'),min(e.event_time::timestamptz),max(e.event_time::timestamptz)
from public.alarm_synced_events e join public.alarm_site_cases c on c.factory_name=e.factory_name and c.resolved_at is null
where e.alarm_type='無發電數據' and e.device ~* '^(inv[[:space:]]*)?[0-9]{1,4}$' and e.event_time is not null
group by c.id,'INV'||lpad((regexp_replace(e.device,'[^0-9]','','g')::integer)::text,2,'0');

create function public.alarm_ingest_snapshot(p_sites jsonb) returns jsonb
language plpgsql security invoker set search_path = pg_catalog,public,extensions as $$
declare v_run uuid; v_records integer; v_groups integer; v_rows integer;
begin
  perform pg_advisory_xact_lock(543209862);
  if jsonb_typeof(p_sites) is distinct from 'array' or jsonb_array_length(p_sites)=0 or jsonb_array_length(p_sites)>10000 then
    raise exception 'invalid source site list';
  end if;
  if exists (select 1 from jsonb_array_elements(p_sites) g where jsonb_typeof(g) <> 'object' or jsonb_typeof(g->'allAlarms') is distinct from 'array' or nullif(g->>'factoryName','') is null) then
    raise exception 'invalid source site shape';
  end if;
  if exists (select 1 from jsonb_array_elements(p_sites) g cross join lateral jsonb_array_elements(g->'allAlarms') a
    where jsonb_typeof(a)<>'object' or nullif(a->>'timestamp','') is null or nullif(a->>'alarmType','') is null) then
    raise exception 'invalid source alarm shape';
  end if;
  select jsonb_array_length(p_sites),coalesce(sum(jsonb_array_length(g->'allAlarms')),0)::integer into v_groups,v_records
  from jsonb_array_elements(p_sites) g;
  if v_records>200000 then raise exception 'too many source alarms'; end if;
  insert into public.alarm_sync_runs(group_count,detail_count) values(v_groups,v_records) returning id into v_run;
  with flat as (
    select g->>'factoryName' factory_name,g->>'county' county,g->>'maintainer' maintainer,
      a->>'timestamp' event_time,a->>'alarmType' alarm_type,a->>'inv' device,
      a->>'desc' description,a->>'errMsg' error_message,a->>'level' level,a->>'colorLabel' color_label
    from jsonb_array_elements(p_sites) g cross join lateral jsonb_array_elements(g->'allAlarms') a
  ), keyed as (
    select f.*,encode(extensions.digest(jsonb_build_array(factory_name,county,maintainer,event_time,alarm_type,device,description,error_message,level,color_label)::text,'sha256'),'hex') as h from flat f
  )
  insert into public.alarm_synced_events(factory_name,county,maintainer,event_time,alarm_type,device,description,error_message,level,color_label,content_hash,last_run_id)
  select distinct on (h) factory_name,county,maintainer,event_time,alarm_type,device,description,error_message,level,color_label,h,v_run from keyed
  on conflict (content_hash) do update set last_run_id=excluded.last_run_id;
  get diagnostics v_rows=row_count;

  with found as (
    select e.factory_name,max(e.county) county,max(e.maintainer) maintainer,
      min(e.event_time::timestamptz) first_event,max(e.event_time::timestamptz) last_event
    from public.alarm_synced_events e
    where e.last_run_id=v_run and e.alarm_type='無發電數據'
      and e.device ~* '^(inv[[:space:]]*)?[0-9]{1,4}$'
      and not exists (select 1 from public.alarm_site_cases prior
        where prior.factory_name=e.factory_name and prior.resolved_at is not null
          and prior.resolved_at >= e.event_time::timestamptz)
    group by e.factory_name
  )
  insert into public.alarm_site_cases(factory_name,county,maintainer,first_event_at,last_event_at,last_observed_at)
  select f.factory_name,f.county,f.maintainer,f.first_event,f.last_event,now() from found f
  on conflict (factory_name) where resolved_at is null do update
    set county=excluded.county,maintainer=excluded.maintainer,
        first_event_at=least(public.alarm_site_cases.first_event_at,excluded.first_event_at),
        last_event_at=greatest(public.alarm_site_cases.last_event_at,excluded.last_event_at),
        last_observed_at=now();

  insert into public.alarm_case_devices(case_id,device,first_event_at,last_event_at)
  select c.id,'INV'||lpad((regexp_replace(e.device,'[^0-9]','','g')::integer)::text,2,'0'),
    min(e.event_time::timestamptz),max(e.event_time::timestamptz)
  from public.alarm_synced_events e join public.alarm_site_cases c on c.factory_name=e.factory_name and c.resolved_at is null
  where e.last_run_id=v_run and e.alarm_type='無發電數據' and e.device ~* '^(inv[[:space:]]*)?[0-9]{1,4}$'
    and not exists (select 1 from public.alarm_site_cases prior where prior.factory_name=e.factory_name
      and prior.resolved_at is not null and prior.resolved_at >= e.event_time::timestamptz)
  group by c.id,'INV'||lpad((regexp_replace(e.device,'[^0-9]','','g')::integer)::text,2,'0')
  on conflict (case_id,device) do update set
    first_event_at=least(public.alarm_case_devices.first_event_at,excluded.first_event_at),
    last_event_at=greatest(public.alarm_case_devices.last_event_at,excluded.last_event_at);
  return jsonb_build_object('run_id',v_run,'source_groups',v_groups,'source_records',v_records,'unique_records',v_rows);
end;
$$;
revoke all on function public.alarm_ingest_snapshot(jsonb) from public,anon,authenticated;
grant execute on function public.alarm_ingest_snapshot(jsonb) to service_role;
grant select,insert,update on public.alarm_sync_runs,public.alarm_site_cases,public.alarm_case_devices to service_role;
grant usage,select on sequence public.alarm_site_cases_id_seq to service_role;
