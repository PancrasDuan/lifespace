-- Test oracle only: produces expected JSON rows without executing or claiming a
-- migration. A real upgrade must be checked separately with capture/reconcile.
create function pg_temp.goal_fixture_clean(j jsonb) returns jsonb language plpgsql immutable as $$
declare result jsonb; k text; v jsonb;
begin
  if jsonb_typeof(j)='array' then
    select coalesce(jsonb_agg(pg_temp.goal_fixture_clean(value) order by ord),'[]') into result
      from jsonb_array_elements(j) with ordinality as a(value,ord);
    return result;
  elsif jsonb_typeof(j)='object' then
    result:='{}';
    for k,v in select key,value from jsonb_each(j) loop
      if k in ('mainline_id','mainlineId','mainlineName','mainlineKind','mainline_name','mainline_kind','mainlineType','mainline_type') then continue; end if;
      if v='"mainline_ended"'::jsonb and k in ('termination_cause','terminationCause') then v:='"ended"';
      elsif v='"mainline_ended"'::jsonb and k in ('end_cause','endCause') then v:='"historical_ended"';
      else v:=pg_temp.goal_fixture_clean(v); end if;
      result:=result||jsonb_build_object(k,v);
    end loop;
    return result;
  end if;
  return j;
end $$;
create temporary table expected_accounts as select to_jsonb(a) row from public.adventure_accounts a;
create temporary table expected_goals as
select pg_temp.goal_fixture_clean(to_jsonb(g)) || jsonb_build_object(
  'category_label', case when g.kind='real' and m.kind='normal' then btrim(m.name) else null end,
  'sort_order', case when g.kind='real' and g.status='active' then
    row_number() over (partition by g.owner_id, (g.kind='real' and g.status='active')
      order by m.created_at,m.id,g.focused desc,g.sort_order,g.id)-1 else g.sort_order end) row
from public.adventure_goals g join public.adventure_mainlines m on (m.owner_id,m.id)=(g.owner_id,g.mainline_id);
create temporary table expected_tasks as select pg_temp.goal_fixture_clean(to_jsonb(t)) row from public.adventure_tasks t;
create temporary table expected_events as select pg_temp.goal_fixture_clean(to_jsonb(e)) row from public.adventure_events e
  where kind not in ('mainline_created','mainline_updated','mainline_ended');
