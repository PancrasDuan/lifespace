-- INCOMPLETE PROTOTYPE: deliberately rolls back; do not deploy.
begin;
create or replace function pg_temp.goal_clean(j jsonb) returns jsonb language plpgsql immutable as $$
declare result jsonb; k text; v jsonb;
begin
  if jsonb_typeof(j)='array' then
    select coalesce(jsonb_agg(pg_temp.goal_clean(value) order by ord),'[]') into result from jsonb_array_elements(j) with ordinality as a(value,ord);
    return result;
  elsif jsonb_typeof(j)='object' then
    result:='{}';
    for k,v in select key,value from jsonb_each(j) loop
      if k in ('mainline_id','mainlineId','mainlineName','mainlineKind','mainline_name','mainline_kind','mainlineType','mainline_type') then continue; end if;
      if v='"mainline_ended"'::jsonb and k in ('termination_cause','terminationCause') then v:='"ended"';
      elsif v='"mainline_ended"'::jsonb and k in ('end_cause','endCause') then v:='"historical_ended"';
      else v:=pg_temp.goal_clean(v); end if;
      result:=result||jsonb_build_object(k,v);
    end loop;
    return result;
  end if;
  return j;
end $$;
do $$
declare bad record;
begin
  if to_regclass('public.adventure_mainlines') is null then return; end if;
  lock table public.adventure_accounts, public.adventure_mainlines, public.adventure_goals, public.adventure_tasks, public.adventure_events in access exclusive mode;
  select g.owner_id,g.id into bad from public.adventure_goals g left join public.adventure_mainlines m on (m.owner_id,m.id)=(g.owner_id,g.mainline_id) where m.id is null order by g.owner_id,g.id limit 1;
  if found then raise exception 'GOAL_MIGRATION_INVALID_MAPPING owner=% goal=%',bad.owner_id,bad.id; end if;
  select g.owner_id,g.id into bad from public.adventure_goals g join public.adventure_mainlines m on (m.owner_id,m.id)=(g.owner_id,g.mainline_id) where g.kind='real' and m.kind='normal' and (length(btrim(m.name)) not between 1 and 200 or m.name is null) order by g.owner_id,g.id limit 1;
  if found then raise exception 'GOAL_MIGRATION_INVALID_LABEL owner=% goal=%',bad.owner_id,bad.id; end if;
alter table public.adventure_goals add column category_label text;
alter table public.adventure_goals drop constraint adventure_goals_termination_cause_check;
alter table public.adventure_tasks drop constraint adventure_tasks_end_cause_check;
with ordering as (
 select g.owner_id,g.id,row_number() over (partition by g.owner_id order by m.created_at,m.id,g.focused desc,g.sort_order,g.id)-1 as ordering
 from public.adventure_goals g join public.adventure_mainlines m on (m.owner_id,m.id)=(g.owner_id,g.mainline_id) where g.kind='real' and g.status='active'
)
update public.adventure_goals g set category_label=case when g.kind='real' and m.kind='normal' then btrim(m.name) else null end,
 sort_order=coalesce((select ordering from ordering o where (o.owner_id,o.id)=(g.owner_id,g.id)),g.sort_order),termination_cause=case when g.termination_cause='mainline_ended' then 'ended' else g.termination_cause end,
 attainment_snapshot=pg_temp.goal_clean(g.attainment_snapshot)
from public.adventure_mainlines m where (m.owner_id,m.id)=(g.owner_id,g.mainline_id);
update public.adventure_tasks set end_cause='historical_ended' where end_cause='mainline_ended';
update public.adventure_events set snapshot=pg_temp.goal_clean(snapshot), calculation=pg_temp.goal_clean(calculation);
delete from public.adventure_events where kind in ('mainline_created','mainline_updated','mainline_ended');
alter table public.adventure_goals add constraint adventure_goals_termination_cause_check check (termination_cause in ('achieved','ended'));
alter table public.adventure_tasks add constraint adventure_tasks_end_cause_check check (end_cause in ('manual','goal_achieved','goal_ended','historical_ended'));
alter table public.adventure_goals drop column mainline_id;
alter table public.adventure_events drop column mainline_id;
drop table public.adventure_mainlines;
raise exception 'GOAL_MIGRATION_INCOMPLETE';
end $$;
commit;
