-- Each task can repeat 4000-character descriptions in its completion snapshot.
-- Ten records stay below 1MB even at six JSON bytes per escaped character.
-- #145: read-only batches pinned to the workspace revision and Beijing date.
create index if not exists adventure_tasks_planned_list on public.adventure_tasks(owner_id,status,planned_on,created_at,id) where deleted_at is null;
create index if not exists adventure_tasks_completed_list on public.adventure_tasks(owner_id,completed_on,planned_on,created_at,id) where deleted_at is null and status='completed';

create or replace function public.adventure_task_list(p_owner uuid,p_date date,p_scope text,p_expected_version bigint,p_today date,p_page integer default 1)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare
  v_version bigint;
  v_today date;
  v_result jsonb;
  v_tasks jsonb;
  v_total bigint;
  v_completed bigint;
begin
  if p_owner is null or p_date is null or p_today is null or p_scope is null or p_scope not in ('all','focus')
    or p_expected_version is null or p_expected_version not between 0 and 9007199254740991
    or p_page is null or p_page not between 1 and 1000000 then raise exception 'INVALID_COMMAND'; end if;
  select revision into v_version from public.adventure_accounts where owner_id=p_owner for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_today:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
  if v_version<>p_expected_version or v_today<>p_today then raise exception 'VERSION_CONFLICT'; end if;
  with filtered as materialized (
    select t.*,case when t.status='completed' then 2 when t.planned_on<v_today then 0 else 1 end rank
    from public.adventure_tasks t join public.adventure_goals g on (g.owner_id,g.id)=(t.owner_id,t.goal_id)
    where t.owner_id=p_owner and t.deleted_at is null and (p_scope='all' or g.focused or g.kind='inbox')
      and case when p_date<v_today then t.status='completed' and t.completed_on=p_date
        when p_date>v_today then t.status='pending' and t.planned_on=p_date
        else t.status='pending' and t.planned_on<=v_today or t.status='completed' and t.completed_on=v_today end
  )
  select (select count(*) from filtered),(select count(*) from filtered where status='completed'),
    (select coalesce(jsonb_agg(item order by rank,planned_on,created_at,id),'[]'::jsonb) from (
      select rank,planned_on,created_at,id,public.adventure_task_view(p_owner,id,v_today) item from filtered
      order by rank,planned_on,created_at,id limit 10 offset (p_page::bigint-1)*10
    ) batch) into v_total,v_completed,v_tasks;
  v_result:=jsonb_build_object('version',v_version,'today',v_today,'date',p_date,'scope',p_scope,'page',p_page,'pageSize',10,
    'total',v_total,'tasks',v_tasks,'progress',jsonb_build_object('completed',v_completed,'total',v_total,
      'ratio',case when v_total=0 then null else v_completed::numeric/v_total end));
  if octet_length(v_result::text)>1000000 then raise exception 'CAPACITY_REACHED'; end if;
  return v_result;
end $$;
revoke execute on function public.adventure_task_list(uuid,date,text,bigint,date,integer) from public,anon,authenticated;
grant execute on function public.adventure_task_list(uuid,date,text,bigint,date,integer) to service_role;
