-- #199: one atomic upgrade from the current four-table goal model.
-- All old rows, event hashes, receipts and balances remain untouched.
begin;
do $$ begin
  if to_regclass('public.adventure_recurring_tasks') is not null then raise exception 'RECURRING_ALREADY_INSTALLED'; end if;
  if to_regclass('public.adventure_mainlines') is not null or exists(select 1 from pg_attribute where attrelid in ('public.adventure_tasks'::regclass,'public.adventure_events'::regclass) and attname='historical_lock' and not attisdropped) then raise exception 'RECURRING_WRONG_BASELINE'; end if;
end $$;
lock table public.adventure_accounts,public.adventure_goals,public.adventure_tasks,public.adventure_events in access exclusive mode;
create table public.adventure_recurring_tasks (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.adventure_accounts(owner_id), goal_id uuid not null,
  title varchar(200) not null check(length(btrim(title)) between 1 and 200), description text not null default '' check(length(description)<=4000),
  period_type text not null check(period_type in ('week','month','quarter','year')),
  start_on date not null check(start_on between date '0001-01-01' and date '9999-12-31'),
  required_count bigint not null check(required_count between 1 and 9007199254740991),
  status text not null default 'active' check(status in ('active','ended')), ended_at timestamptz, ended_on date, deleted_at timestamptz,
  completed_periods bigint not null default 0 check(completed_periods between 0 and 9007199254740991),
  tracked_period_no bigint not null default 0 check(tracked_period_no between 0 and 9007199254740991),
  tracked_period_satisfied boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(owner_id,id), foreign key(owner_id,goal_id) references public.adventure_goals(owner_id,id),
  check(completed_periods<=tracked_period_no),
  check(not tracked_period_satisfied or (tracked_period_no>=1 and completed_periods>=1)),
  check(tracked_period_no<>0 or (completed_periods=0 and not tracked_period_satisfied)),
  check((status='ended' and ended_at is not null and ended_on is not null and ended_on>=start_on and ended_on<=date '9999-12-31' and deleted_at is null)
    or (status='active' and ended_at is null and ended_on is null))
);
alter table public.adventure_recurring_tasks enable row level security;
revoke all on public.adventure_recurring_tasks from public,anon,authenticated,service_role;
grant select,insert,update on public.adventure_recurring_tasks to service_role;
create index adventure_recurring_goal on public.adventure_recurring_tasks(owner_id,goal_id,status) where deleted_at is null;
create index adventure_recurring_start on public.adventure_recurring_tasks(owner_id,start_on);
create index adventure_recurring_end on public.adventure_recurring_tasks(owner_id,ended_on);
alter table public.adventure_goals alter column attainment_action_count type bigint;
alter table public.adventure_goals add constraint adventure_attainment_safe check(attainment_action_count between 0 and 9007199254740991);
alter table public.adventure_tasks drop constraint adventure_tasks_kind_check;
alter table public.adventure_tasks add column recurring_parent_id uuid;
alter table public.adventure_tasks add constraint adventure_tasks_kind_check check((kind='once' and recurring_parent_id is null) or
  (kind='recurring_child' and recurring_parent_id is not null and status='completed' and deleted_at is null and planned_on=completed_on));
alter table public.adventure_tasks add constraint adventure_child_parent_fk foreign key(owner_id,recurring_parent_id) references public.adventure_recurring_tasks(owner_id,id);
alter table public.adventure_tasks add constraint adventure_child_identity unique(owner_id,id,recurring_parent_id);
create index adventure_child_parent on public.adventure_tasks(owner_id,recurring_parent_id);
alter table public.adventure_events add column recurring_parent_id uuid;
alter table public.adventure_events drop constraint adventure_events_kind_check;
alter table public.adventure_events add constraint adventure_events_kind_check check(kind in (
 'goal_created','goal_updated','goal_focused','goal_reordered','goal_migrated','goal_achieved','goal_ended',
 'task_created','task_updated','task_rescheduled','task_migrated','task_ended','task_deleted','task_completed','task_completion_cancelled',
 'recurring_created','recurring_updated','recurring_ended','recurring_deleted'));
alter table public.adventure_events drop constraint adventure_events_entity_type_check;
alter table public.adventure_events add constraint adventure_events_entity_type_check check(entity_type in ('account','goal','task','recurring_task'));
alter table public.adventure_events add constraint adventure_event_parent_fk foreign key(owner_id,recurring_parent_id) references public.adventure_recurring_tasks(owner_id,id);
alter table public.adventure_events add constraint adventure_event_child_fk foreign key(owner_id,task_id,recurring_parent_id) references public.adventure_tasks(owner_id,id,recurring_parent_id);
alter table public.adventure_events add constraint adventure_parent_event_identity check(
 (kind not like 'recurring_%' and entity_type<>'recurring_task') or
 (kind in ('recurring_created','recurring_updated','recurring_ended','recurring_deleted') and entity_type='recurring_task' and task_id is null and recurring_parent_id is not null and entity_id=recurring_parent_id));
create index adventure_recurring_completions on public.adventure_events(owner_id,recurring_parent_id,occurred_on,occurred_at,id) where kind='task_completed' and invalidated_at is null;

-- Constant-time boundaries always derive from the original anchor, never the previous clamp.
create function public.adventure_recurring_boundary(p_anchor date,p_type text,p_index bigint)
returns date language plpgsql immutable security invoker set search_path='' as $$
declare d date; m bigint; y integer; mo integer;
begin
 if p_anchor is null or p_anchor not between date '0001-01-01' and date '9999-12-31' or p_index is null or p_index<0 then raise exception 'INVALID_COMMAND'; end if;
 if p_type='week' then
   if p_index>521722 then raise exception 'CAPACITY_REACHED'; end if;
   d:=p_anchor+(p_index*7)::integer;
 elsif p_type in ('month','quarter','year') then
   if p_index>119987 then raise exception 'CAPACITY_REACHED'; end if;
   m:=(extract(year from p_anchor)::bigint-1)*12+extract(month from p_anchor)::bigint-1+p_index*case p_type when 'month' then 1 when 'quarter' then 3 else 12 end;
   if m>119987 then raise exception 'CAPACITY_REACHED'; end if;
   y:=(m/12+1)::integer;mo:=(m%12+1)::integer;
   d:=make_date(y,mo,1)+least(extract(day from p_anchor)::integer,
     extract(day from (make_date(y,mo,1)+interval '1 month - 1 day'))::integer)-1;
 else raise exception 'INVALID_COMMAND'; end if;
 if d not between date '0001-01-01' and date '9999-12-31' then raise exception 'CAPACITY_REACHED'; end if;
 return d;
exception when datetime_field_overflow or numeric_value_out_of_range then raise exception 'CAPACITY_REACHED';
end $$;
create function public.adventure_recurring_period(p_anchor date,p_type text,p_day date)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare k bigint; step integer; first_day date; next_day date;
begin
 if p_day is null or p_day not between date '0001-01-01' and date '9999-12-31' then raise exception 'INVALID_COMMAND'; end if;
 if p_day<p_anchor then return null; end if;
 if p_type='week' then k:=(p_day-p_anchor)/7;
 else
   step:=case p_type when 'month' then 1 when 'quarter' then 3 when 'year' then 12 end;
   if step is null then raise exception 'INVALID_COMMAND'; end if;
   k:=((extract(year from p_day)::bigint-extract(year from p_anchor)::bigint)*12+extract(month from p_day)::bigint-extract(month from p_anchor)::bigint)/step;
 end if;
 first_day:=public.adventure_recurring_boundary(p_anchor,p_type,k);
 if first_day>p_day then k:=k-1; first_day:=public.adventure_recurring_boundary(p_anchor,p_type,k); end if;
 next_day:=public.adventure_recurring_boundary(p_anchor,p_type,k+1);
 return jsonb_build_object('number',k+1,'startOn',first_day,'endOn',next_day-1);
end $$;

-- Validate physical parent/child references and freeze completion snapshots and child rows.
create function public.adventure_recurring_integrity() returns trigger language plpgsql security invoker set search_path='' as $$
declare t public.adventure_tasks; p public.adventure_recurring_tasks; r jsonb; period jsonb;
begin
 if tg_table_name='adventure_tasks' then
   if tg_op='UPDATE' and old.kind='recurring_child' and new is distinct from old then raise exception 'IMMUTABLE_RECURRING_CHILD'; end if;
   return new;
 end if;
 if new.task_id is not null then
   select * into strict t from public.adventure_tasks where owner_id=new.owner_id and id=new.task_id;
   if new.recurring_parent_id is distinct from t.recurring_parent_id then raise exception 'INCONSISTENT_RECURRING_IDENTITY'; end if;
   if t.kind='recurring_child' then
     if new.kind not in ('task_completed','task_completion_cancelled') then raise exception 'INCONSISTENT_RECURRING_IDENTITY'; end if;
     if new.kind='task_completed' then
       select * into strict p from public.adventure_recurring_tasks where owner_id=new.owner_id and id=t.recurring_parent_id;
       r:=new.snapshot->'recurring';period:=public.adventure_recurring_period(p.start_on,p.period_type,new.occurred_on);
       if r is null or (tg_op='INSERT' and (r->>'requiredCount')::numeric is distinct from p.required_count::numeric) or (r->>'parentId')::uuid is distinct from p.id or (r->>'childId')::uuid is distinct from t.id
         or new.snapshot->>'title' is distinct from r->>'title' or new.snapshot->>'description' is distinct from r->>'description'
         or new.snapshot->'categoryLabel' is distinct from r->'categoryLabel' or new.snapshot->'goalTitle' is distinct from r->'goalTitle'
         or r->>'title' is distinct from t.title or r->>'description' is distinct from t.description
         or r->>'anchorOn' is distinct from p.start_on::text or r->>'periodType' is distinct from p.period_type
         or r->>'periodNumber' is distinct from period->>'number' or r->>'periodStartOn' is distinct from period->>'startOn'
         or r->>'periodEndOn' is distinct from period->>'endOn' or r->>'occurredOn' is distinct from new.occurred_on::text
         or (r->>'occurredAt')::timestamptz is distinct from new.occurred_at or t.completed_at is distinct from new.occurred_at
         or t.completed_on is distinct from new.occurred_on or new.amount is distinct from 1
         or new.calculation is distinct from jsonb_build_object('type','fixed_task','completionId',new.id,'count',1,'coefficient',1)
         or (r->>'goalId')::uuid is distinct from new.goal_id
         or t.goal_id is distinct from coalesce(new.goal_id,(select id from public.adventure_goals where owner_id=new.owner_id and kind='inbox'))
         then raise exception 'INCONSISTENT_RECURRING_SNAPSHOT'; end if;
       if tg_op='UPDATE' and (new.snapshot-'result' is distinct from old.snapshot-'result' or new.amount is distinct from old.amount or new.calculation is distinct from old.calculation
         or new.goal_id is distinct from old.goal_id or new.occurred_at is distinct from old.occurred_at or new.occurred_on is distinct from old.occurred_on) then raise exception 'IMMUTABLE_RECURRING_SNAPSHOT'; end if;
     end if;
   end if;
 elsif new.recurring_parent_id is not null and new.entity_type<>'recurring_task' then raise exception 'INCONSISTENT_RECURRING_IDENTITY'; end if;
 return new;
end $$;
create trigger adventure_child_immutable before update on public.adventure_tasks for each row execute function public.adventure_recurring_integrity();
create trigger adventure_event_recurring_integrity before insert or update on public.adventure_events for each row execute function public.adventure_recurring_integrity();

create function public.adventure_recurring_state(p_owner uuid,p_id uuid,p_today date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.adventure_recurring_tasks; q jsonb; c bigint; n bigint; s boolean; total bigint;
begin
 select * into p from public.adventure_recurring_tasks where owner_id=p_owner and id=p_id and deleted_at is null;
 if not found then raise exception 'NOT_FOUND'; end if;
 q:=public.adventure_recurring_period(p.start_on,p.period_type,coalesce(p.ended_on,p_today));
 select count(*) into total from public.adventure_events where owner_id=p_owner and recurring_parent_id=p_id and kind='task_completed' and invalidated_at is null;
 if q is null then
   if p.tracked_period_no<>0 or total<>0 then raise exception 'INCONSISTENT_RECURRING_COUNTER'; end if;
   return jsonb_build_object('period',null,'effectiveChildren',0);
 end if;
 n:=(q->>'number')::bigint;
 select count(*) into c from public.adventure_events where owner_id=p_owner and recurring_parent_id=p_id and kind='task_completed' and invalidated_at is null and occurred_on between (q->>'startOn')::date and (q->>'endOn')::date and (snapshot->'recurring'->>'periodNumber')::bigint=n;
 s:=c>=p.required_count;
 if n<p.tracked_period_no or (n=p.tracked_period_no and s<>p.tracked_period_satisfied) or (n>p.tracked_period_no and c<>0) then raise exception 'INCONSISTENT_RECURRING_COUNTER'; end if;
 return jsonb_build_object('effectiveChildren',total,'period',q||jsonb_build_object('completed',c,'required',p.required_count,'satisfied',s,'ratio',least(1,c::numeric/p.required_count)));
end $$;

-- Strict SQL validation is repeated behind the HTTP schema boundary.
create function public.adventure_recurring_check(p_owner uuid,p_command jsonb,p_today date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare typ text:=p_command->>'type'; keys text[]; optional text[]:='{}'; p public.adventure_recurring_tasks; e public.adventure_events; s jsonb; d date; g public.adventure_goals;
begin
 if p_owner is null or p_today is null or jsonb_typeof(p_command) is distinct from 'object' or octet_length(p_command::text)>32768 then raise exception 'INVALID_COMMAND'; end if;
 case typ
 when 'createRecurringTask' then keys:=array['type','today','title','description','periodType','startOn','requiredCount','destination'];
 when 'editRecurringTask' then keys:=array['type','today','id','title','description','requiredCount'];optional:=array['startOn','destination'];
 when 'recordRecurringCompletion','endRecurringTask','deleteRecurringTask' then keys:=array['type','today','id'];
 when 'cancelRecurringCompletion' then keys:=array['type','today','completionId'];
 else raise exception 'INVALID_COMMAND'; end case;
 if not(p_command ?& keys) or p_command-keys-optional<>'{}'::jsonb then raise exception 'INVALID_COMMAND'; end if;
 if jsonb_typeof(p_command->'today') is distinct from 'string' or p_command->>'today' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_COMMAND'; end if;
 d:=(p_command->>'today')::date;
 if d not between date '0001-01-01' and date '9999-12-31' then raise exception 'INVALID_COMMAND'; end if;
 if d<>p_today then raise exception 'PLANNING_DATE_CHANGED'; end if;
 if p_command ? 'requiredCount' and (jsonb_typeof(p_command->'requiredCount') is distinct from 'number' or (p_command->>'requiredCount')::numeric<>trunc((p_command->>'requiredCount')::numeric) or (p_command->>'requiredCount')::numeric not between 1 and 9007199254740991) then raise exception 'INVALID_COMMAND'; end if;
 if p_command ? 'title' and (jsonb_typeof(p_command->'title') is distinct from 'string' or length(btrim(p_command->>'title')) not between 1 and 200 or jsonb_typeof(p_command->'description') is distinct from 'string' or length(p_command->>'description')>4000) then raise exception 'INVALID_COMMAND'; end if;
 if typ='createRecurringTask' and (jsonb_typeof(p_command->'periodType') is distinct from 'string' or p_command->>'periodType' not in ('week','month','quarter','year')) then raise exception 'INVALID_COMMAND'; end if;
 if p_command ? 'startOn' then
   if jsonb_typeof(p_command->'startOn') is distinct from 'string' or p_command->>'startOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_COMMAND'; end if;
   d:=(p_command->>'startOn')::date;
   if d not between date '0001-01-01' and date '9999-12-31' then raise exception 'INVALID_COMMAND'; end if;
 end if;
 if typ='cancelRecurringCompletion' then
   if jsonb_typeof(p_command->'completionId') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
   select * into e from public.adventure_events where owner_id=p_owner and id=(p_command->>'completionId')::uuid and kind='task_completed' and recurring_parent_id is not null;
   if not found then raise exception 'NOT_FOUND'; end if;
   select * into p from public.adventure_recurring_tasks where owner_id=p_owner and id=e.recurring_parent_id and deleted_at is null;
 elsif typ<>'createRecurringTask' then
   if jsonb_typeof(p_command->'id') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
   select * into p from public.adventure_recurring_tasks where owner_id=p_owner and id=(p_command->>'id')::uuid and deleted_at is null;
 end if;
 if typ<>'createRecurringTask' then
   if p.id is null then raise exception 'NOT_FOUND'; end if;
   if p.status='ended' or exists(select 1 from public.adventure_goals where owner_id=p_owner and id=p.goal_id and status<>'active') or (e.goal_id is not null and exists(select 1 from public.adventure_goals where owner_id=p_owner and id=e.goal_id and status<>'active')) then raise exception 'READ_ONLY'; end if;
   if typ='cancelRecurringCompletion' then
     if e.invalidated_at is not null then raise exception 'COMPLETION_CHANGED'; end if;
     if e.occurred_on<>p_today then raise exception 'DATE_LOCKED'; end if;
   end if;
   if p.start_on>p_today and typ in ('recordRecurringCompletion','endRecurringTask') then raise exception 'RECURRING_NOT_STARTED'; end if;
   if p.start_on<=p_today and (typ='deleteRecurringTask' or p_command ? 'startOn') then raise exception 'RECURRING_ALREADY_STARTED'; end if;
   s:=public.adventure_recurring_state(p_owner,p.id,p_today);
   if typ='recordRecurringCompletion' and (s->'period'->>'satisfied')::boolean then raise exception 'PERIOD_FULL'; end if;
 end if;
 if p_command ? 'startOn' then
   if (p_command->>'startOn')::date<p_today then raise exception 'RECURRING_START_PAST'; end if;
   -- Reject anchors whose very first complete period cannot be represented.
   perform public.adventure_recurring_period((p_command->>'startOn')::date,coalesce(p.period_type,p_command->>'periodType'),(p_command->>'startOn')::date);
 end if;
 if p_command ? 'destination' then
   if jsonb_typeof(p_command->'destination') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
   if p_command->>'destination'<>'' then
     select * into g from public.adventure_goals where owner_id=p_owner and id=(p_command->>'destination')::uuid and kind='real';
     if not found then raise exception 'NOT_FOUND'; end if;
     if g.status<>'active' then raise exception 'READ_ONLY'; end if;
   end if;
 end if;
 return jsonb_build_object('allowed',true,'parentId',p.id,'childId',e.task_id,'completionId',e.id,'state',s);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception 'INVALID_COMMAND';
end $$;
create function public.adventure_recurring_capability(p_owner uuid,p_command jsonb,p_today date)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform public.adventure_recurring_check(p_owner,p_command,p_today);return '{"allowed":true}'::jsonb;
exception when raise_exception then
 if sqlerrm not in ('NOT_FOUND','READ_ONLY','DATE_LOCKED','COMPLETION_CHANGED','PERIOD_FULL','RECURRING_NOT_STARTED','RECURRING_ALREADY_STARTED','RECURRING_START_PAST') then raise; end if;
 return jsonb_build_object('allowed',false,'reason',case sqlerrm when 'PERIOD_FULL' then '本期已满足要求次数' when 'READ_ONLY' then '已进入终态，只能查看' when 'DATE_LOCKED' then '仅完成当天可以撤销' when 'RECURRING_NOT_STARTED' then '周期任务尚未开始' when 'RECURRING_ALREADY_STARTED' then '开始日已到' else '当前操作不可用' end);
end $$;

create function public.adventure_recurring_parent_view(p_owner uuid,p_id uuid,p_today date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.adventure_recurring_tasks; g public.adventure_goals; s jsonb; edit jsonb; caps jsonb;
begin
 select * into p from public.adventure_recurring_tasks where owner_id=p_owner and id=p_id and deleted_at is null;
 if not found then raise exception 'NOT_FOUND'; end if;
 select * into strict g from public.adventure_goals where owner_id=p_owner and id=p.goal_id;
 s:=public.adventure_recurring_state(p_owner,p_id,p_today);
 edit:=jsonb_build_object('type','editRecurringTask','id',p_id,'today',p_today,'title',p.title,'description',p.description,'requiredCount',p.required_count);
 caps:=jsonb_build_object('editRecurringTask',public.adventure_recurring_capability(p_owner,edit,p_today),
   'changeDestination',public.adventure_recurring_capability(p_owner,edit,p_today),
   'changeStartOn',public.adventure_recurring_capability(p_owner,edit||jsonb_build_object('startOn',p.start_on),p_today),
   'recordRecurringCompletion',public.adventure_recurring_capability(p_owner,jsonb_build_object('type','recordRecurringCompletion','id',p_id,'today',p_today),p_today),
   'endRecurringTask',public.adventure_recurring_capability(p_owner,jsonb_build_object('type','endRecurringTask','id',p_id,'today',p_today),p_today),
   'deleteRecurringTask',public.adventure_recurring_capability(p_owner,jsonb_build_object('type','deleteRecurringTask','id',p_id,'today',p_today),p_today));
 return jsonb_build_object('kind','recurring','id',p.id,'title',p.title,'description',p.description,'periodType',p.period_type,'startOn',p.start_on,'requiredCount',p.required_count,
  'status',case when p.status='ended' then 'ended' when p.start_on>p_today then 'not_started' else 'active' end,'endedAt',p.ended_at,'endedOn',p.ended_on,
  'goalId',case when g.kind='real' then g.id end,'goalTitle',case when g.kind='real' then g.title end,'categoryLabel',case when g.kind='real' then g.category_label end,'independent',g.kind='inbox',
  'completedPeriods',p.completed_periods,'currentPeriod',s->'period','effectiveChildren',s->'effectiveChildren','capabilities',caps);
end $$;
create function public.adventure_recurring_child_view(p_owner uuid,p_id uuid,p_today date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.adventure_events;
begin
 select * into e from public.adventure_events where owner_id=p_owner and task_id=p_id and kind='task_completed' and recurring_parent_id is not null;
 if not found then raise exception 'NOT_FOUND'; end if;
 return jsonb_build_object('kind','recurring_child','id',p_id,'parentId',e.recurring_parent_id,'completionId',e.id,
  'status',case when e.invalidated_at is null then 'completed' else 'cancelled' end,'invalidatedAt',e.invalidated_at,
  'snapshot',e.snapshot->'recurring','reward',jsonb_build_object('amount',e.amount,'calculation',e.calculation),
  'capabilities',jsonb_build_object('cancelRecurringCompletion',public.adventure_recurring_capability(p_owner,jsonb_build_object('type','cancelRecurringCompletion','completionId',e.id,'today',p_today),p_today)));
end $$;

create function public.adventure_recurring_apply(p_owner uuid,p_request_id text,p_revision bigint,p_command jsonb,p_now timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare typ text:=p_command->>'type'; today date:=(p_now at time zone 'Asia/Shanghai')::date;
 p public.adventure_recurring_tasks; old_parent public.adventure_recurring_tasks; g public.adventure_goals; done public.adventure_events;
 checked jsonb; state jsonb; q jsonb; counter jsonb; snap jsonb; source jsonb; reward jsonb; result jsonb;
 child_id uuid; event_id uuid:=gen_random_uuid(); event_kind text; delta bigint:=0; c bigint:=0; n bigint:=0; satisfied boolean:=false; prior_satisfied boolean:=false; count_delta integer:=0;
 before_growth jsonb; after_growth jsonb; unlocked jsonb; lost jsonb;
begin
 checked:=public.adventure_recurring_check(p_owner,p_command,today);
 before_growth:=public.adventure_growth(p_owner);
 if typ<>'createRecurringTask' then
   select * into strict p from public.adventure_recurring_tasks where owner_id=p_owner and id=(checked->>'parentId')::uuid;
   old_parent:=p;state:=checked->'state';q:=state->'period';
   if q<>'null'::jsonb then
     n:=(q->>'number')::bigint;c:=(q->>'completed')::bigint;
     prior_satisfied:=case when p.tracked_period_no=n then p.tracked_period_satisfied else false end;
   end if;
 end if;
 if typ='createRecurringTask' or (typ='editRecurringTask' and p_command ? 'destination') then
   if p_command->>'destination'='' then
     select * into g from public.adventure_goals where owner_id=p_owner and kind='inbox';
     if not found then insert into public.adventure_goals(owner_id,kind,title,standards,created_at,updated_at)
       values(p_owner,'inbox','独立任务','["系统收纳目标，仅承接独立任务。"]',p_now,p_now) returning * into g; end if;
   else select * into strict g from public.adventure_goals where owner_id=p_owner and id=(p_command->>'destination')::uuid; end if;
 else select * into strict g from public.adventure_goals where owner_id=p_owner and id=p.goal_id; end if;
 case typ
 when 'createRecurringTask' then
   insert into public.adventure_recurring_tasks(owner_id,goal_id,title,description,period_type,start_on,required_count,created_at,updated_at)
    values(p_owner,g.id,btrim(p_command->>'title'),btrim(p_command->>'description'),p_command->>'periodType',(p_command->>'startOn')::date,(p_command->>'requiredCount')::bigint,p_now,p_now) returning * into p;
   q:=public.adventure_recurring_period(p.start_on,p.period_type,today);n:=coalesce((q->>'number')::bigint,0);event_kind:='recurring_created';
 when 'editRecurringTask' then
   update public.adventure_recurring_tasks set title=btrim(p_command->>'title'),description=btrim(p_command->>'description'),required_count=(p_command->>'requiredCount')::bigint,
     goal_id=g.id,start_on=case when p_command ? 'startOn' then (p_command->>'startOn')::date else start_on end,updated_at=p_now
     where owner_id=p_owner and id=p.id returning * into p;
   q:=public.adventure_recurring_period(p.start_on,p.period_type,today);n:=coalesce((q->>'number')::bigint,0);event_kind:='recurring_updated';
 when 'recordRecurringCompletion' then
   child_id:=gen_random_uuid();delta:=1;c:=c+1;event_kind:='task_completed';
   insert into public.adventure_tasks(id,owner_id,goal_id,kind,recurring_parent_id,title,description,planned_on,status,completed_at,completed_on,created_at,updated_at)
    values(child_id,p_owner,p.goal_id,'recurring_child',p.id,p.title,p.description,today,'completed',p_now,today,p_now,p_now);
   source:=jsonb_build_object('parentId',p.id,'childId',child_id,'title',p.title,'description',p.description,'periodType',p.period_type,'anchorOn',p.start_on,
    'periodNumber',n,'periodStartOn',q->>'startOn','periodEndOn',q->>'endOn','requiredCount',p.required_count,'occurredAt',p_now,'occurredOn',today,
    'goalId',case when g.kind='real' then g.id end,'goalTitle',case when g.kind='real' then g.title end,'categoryLabel',case when g.kind='real' then g.category_label end);
   reward:=jsonb_build_object('amount',1,'calculation',jsonb_build_object('type','fixed_task','completionId',event_id,'count',1,'coefficient',1));
 when 'cancelRecurringCompletion' then
   select * into strict done from public.adventure_events where owner_id=p_owner and id=(p_command->>'completionId')::uuid;
   child_id:=done.task_id;c:=c-1;delta:=-1;event_kind:='task_completion_cancelled';
   reward:=jsonb_build_object('amount',done.amount,'calculation',done.calculation);
 when 'endRecurringTask' then
   update public.adventure_recurring_tasks set status='ended',ended_at=p_now,ended_on=today,updated_at=p_now where owner_id=p_owner and id=p.id returning * into p;
   event_kind:='recurring_ended';
 when 'deleteRecurringTask' then
   update public.adventure_recurring_tasks set deleted_at=p_now,updated_at=p_now where owner_id=p_owner and id=p.id returning * into p;
   event_kind:='recurring_deleted';
 end case;
 satisfied:=n>0 and c>=p.required_count;count_delta:=satisfied::integer-prior_satisfied::integer;
 counter:=jsonb_build_object('periodNumber',n,'previousTrackedPeriod',coalesce(old_parent.tracked_period_no,0),
  'previousTrackedSatisfied',coalesce(old_parent.tracked_period_satisfied,false),'beforeRequired',coalesce(old_parent.required_count,p.required_count),'afterRequired',p.required_count,
  'beforeSatisfied',prior_satisfied,'afterSatisfied',satisfied,'delta',count_delta,'beforeCompletedPeriods',p.completed_periods,'afterCompletedPeriods',p.completed_periods+count_delta);
 update public.adventure_recurring_tasks set tracked_period_no=n,tracked_period_satisfied=satisfied,completed_periods=completed_periods+count_delta,updated_at=p_now where owner_id=p_owner and id=p.id returning * into p;
 snap:=jsonb_build_object('before',case when old_parent.id is not null then to_jsonb(old_parent)-'owner_id' end,'after',to_jsonb(p)-'owner_id','recurringCounter',counter,
  'title',p.title,'description',p.description,'goalTitle',case when g.kind='real' then g.title end,'categoryLabel',case when g.kind='real' then g.category_label end);
 if source is not null then snap:=snap||jsonb_build_object('recurring',source,'plannedOn',null); end if;
 insert into public.adventure_events(id,owner_id,event_group_id,kind,entity_type,entity_id,task_id,recurring_parent_id,goal_id,
   occurred_at,occurred_on,actor_owner_id,request_id,command_hash,command_type,applied_revision,amount,calculation,snapshot,created_at)
 values(event_id,p_owner,gen_random_uuid(),event_kind,case when child_id is null then 'recurring_task' else 'task' end,coalesce(child_id,p.id),child_id,p.id,
   case when typ='cancelRecurringCompletion' then done.goal_id when g.kind='real' then g.id end,p_now,today,p_owner,p_request_id,
   encode(sha256(convert_to(p_command::text,'UTF8')),'hex'),typ,p_revision+1,case when delta=1 then 1 end,case when delta=1 then reward->'calculation' end,snap,p_now);
 if typ='cancelRecurringCompletion' then
   update public.adventure_events set invalidated_at=p_now,invalidated_by_event_id=event_id where owner_id=p_owner and id=done.id and invalidated_at is null;
 end if;
 if (select total_xp::numeric+delta from public.adventure_accounts where owner_id=p_owner) not between 0 and 9007199254740991 then raise exception 'CAPACITY_REACHED'; end if;
 update public.adventure_accounts set total_xp=total_xp+delta,revision=p_revision+1,updated_at=p_now where owner_id=p_owner;
 if (select total_xp from public.adventure_accounts where owner_id=p_owner)<>(select coalesce(sum(amount),0) from public.adventure_events where owner_id=p_owner and kind in ('task_completed','goal_achieved') and invalidated_at is null) then raise exception 'INCONSISTENT_REWARDS'; end if;
 after_growth:=public.adventure_growth(p_owner);
 select coalesce(jsonb_agg(a->>'label'),'[]'::jsonb) into unlocked from jsonb_array_elements(after_growth->'achievements') a where (a->>'unlocked')::boolean and not exists(select 1 from jsonb_array_elements(before_growth->'achievements') b where b->>'id'=a->>'id' and (b->>'unlocked')::boolean);
 select coalesce(jsonb_agg(b->>'label'),'[]'::jsonb) into lost from jsonb_array_elements(before_growth->'achievements') b where (b->>'unlocked')::boolean and not exists(select 1 from jsonb_array_elements(after_growth->'achievements') a where b->>'id'=a->>'id' and (a->>'unlocked')::boolean);
 result:=jsonb_build_object('entityId',coalesce(child_id,p.id),'message',case typ when 'recordRecurringCompletion' then '已记录一次，获得 1 点经验' when 'cancelRecurringCompletion' then '已撤销本次完成，成长已同步更新' when 'endRecurringTask' then '周期任务已结束' when 'deleteRecurringTask' then '未开始的周期任务已删除' else '已保存周期任务' end);
 if child_id is not null then
   result:=result||jsonb_build_object('completionId',case when delta=1 then event_id else done.id end,'reward',reward,
    'growthChange',jsonb_build_object('xpDelta',delta,'before',before_growth,'after',after_growth,'unlocked',unlocked,'lost',lost));
   if source is not null then result:=result||jsonb_build_object('source',source||jsonb_build_object('taskKind','recurring_child')); end if;
 end if;
 if octet_length(result::text)>1000000 then raise exception 'CAPACITY_REACHED'; end if;
 update public.adventure_events set snapshot=snapshot||jsonb_build_object('result',result) where owner_id=p_owner and id=event_id;
 return jsonb_build_object('version',p_revision+1,'result',result);
end $$;

-- Every new read takes the same account share lock, then captures Beijing time.
create function public.adventure_recurring_read_basis(p_owner uuid,p_expected_version bigint,p_today date)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare v bigint; d date; v_exists boolean;
begin
 if p_owner is null or p_expected_version is null or p_expected_version not between 0 and 9007199254740991 or p_today is null or p_today not between date '0001-01-01' and date '9999-12-31' then raise exception 'INVALID_COMMAND'; end if;
 select revision into v from public.adventure_accounts where owner_id=p_owner for share;
 v_exists:=found;v:=coalesce(v,0);d:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
 if d<>p_today then raise exception 'PLANNING_DATE_CHANGED'; end if;
 if v<>p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
 -- No row was locked: callers must use a fixed empty result or NOT_FOUND.
 if not v_exists then return null; end if;
 return jsonb_build_object('version',v,'today',d,'timeZone','Asia/Shanghai');
end $$;
create function public.adventure_recurring_bounded(p_result jsonb) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
begin
 if octet_length(p_result::text)>1000000 then raise exception 'CAPACITY_REACHED'; end if;return p_result;
end $$;
create function public.adventure_recurring_list(p_owner uuid,p_expected_version bigint,p_today date,p_date date,p_scope text default 'all',p_search text default '',p_page integer default 1)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare basis jsonb; total bigint; items jsonb;
begin
 if p_date is null or p_date not between date '0001-01-01' and date '9999-12-31' or p_scope is null or p_scope not in ('all','focus') or p_search is null or length(btrim(p_search))>100 or p_page is null or p_page not between 1 and 1000000 then raise exception 'INVALID_COMMAND'; end if;
 basis:=public.adventure_recurring_read_basis(p_owner,p_expected_version,p_today);
 if basis is null then
   return jsonb_build_object('version',0,'today',p_today,'timeZone','Asia/Shanghai','date',p_date,'scope',p_scope,'search',btrim(p_search),'page',p_page,'pageSize',10,'total',0,'parents','[]'::jsonb);
 end if;
 with filtered as materialized (
  select p.*,case when p.status='ended' then 2 when p.start_on>p_today then 1 else 0 end rank
  from public.adventure_recurring_tasks p join public.adventure_goals g on (g.owner_id,g.id)=(p.owner_id,p.goal_id)
  where p.owner_id=p_owner and p.deleted_at is null and (p_scope='all' or g.focused or g.kind='inbox')
  and ((p.status='ended' and p.ended_on=p_date) or (p.status='active' and ((p.start_on<=p_today and p_date=p_today) or (p.start_on>p_today and p.start_on=p_date))))
  and (btrim(p_search)='' or position(lower(btrim(p_search)) in lower(p.title||' '||p.description||' '||case when g.kind='real' then g.title else '独立任务' end))>0)
 ) select (select count(*) from filtered),(select coalesce(jsonb_agg(item order by rank,created_at,id),'[]'::jsonb) from (
  select rank,created_at,id,public.adventure_recurring_parent_view(p_owner,id,p_today) item from filtered order by rank,created_at,id limit 10 offset (p_page::bigint-1)*10) batch) into total,items;
 return public.adventure_recurring_bounded(basis||jsonb_build_object('date',p_date,'scope',p_scope,'search',btrim(p_search),'page',p_page,'pageSize',10,'total',total,'parents',items));
end $$;
create function public.adventure_recurring_detail(p_owner uuid,p_expected_version bigint,p_today date,p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare basis jsonb;
begin
 basis:=public.adventure_recurring_read_basis(p_owner,p_expected_version,p_today);
 if basis is null then raise exception 'NOT_FOUND'; end if;
 return public.adventure_recurring_bounded(basis||jsonb_build_object('parent',public.adventure_recurring_parent_view(p_owner,p_id,p_today)));
end $$;
create function public.adventure_recurring_child(p_owner uuid,p_expected_version bigint,p_today date,p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare basis jsonb;
begin
 basis:=public.adventure_recurring_read_basis(p_owner,p_expected_version,p_today);
 if basis is null then raise exception 'NOT_FOUND'; end if;
 return public.adventure_recurring_bounded(basis||jsonb_build_object('child',public.adventure_recurring_child_view(p_owner,p_id,p_today)));
end $$;
create function public.adventure_recurring_children(p_owner uuid,p_expected_version bigint,p_today date,p_parent_id uuid,p_page integer default 1)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare basis jsonb; total bigint; items jsonb;
begin
 if p_page is null or p_page not between 1 and 1000000 then raise exception 'INVALID_COMMAND'; end if;
 basis:=public.adventure_recurring_read_basis(p_owner,p_expected_version,p_today);
 if basis is null then raise exception 'NOT_FOUND'; end if;
 perform public.adventure_recurring_state(p_owner,p_parent_id,p_today);
 select count(*) into total from public.adventure_events where owner_id=p_owner and recurring_parent_id=p_parent_id and kind='task_completed' and invalidated_at is null;
 select coalesce(jsonb_agg(item order by occurred_at desc,id desc),'[]'::jsonb) into items from (
  select occurred_at,id,public.adventure_recurring_child_view(p_owner,task_id,p_today) item from public.adventure_events
  where owner_id=p_owner and recurring_parent_id=p_parent_id and kind='task_completed' and invalidated_at is null
  order by occurred_at desc,id desc limit 10 offset (p_page::bigint-1)*10) batch;
 return public.adventure_recurring_bounded(basis||jsonb_build_object('parentId',p_parent_id,'page',p_page,'pageSize',10,'total',total,'children',items));
end $$;
create function public.adventure_date_task_list(p_owner uuid,p_expected_version bigint,p_today date,p_date date,p_scope text default 'all',p_search text default '',p_page integer default 1)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare basis jsonb; total bigint; completed bigint; items jsonb;
begin
 if p_date is null or p_date not between date '0001-01-01' and date '9999-12-31' or p_scope is null or p_scope not in ('all','focus') or p_search is null or length(btrim(p_search))>100 or p_page is null or p_page not between 1 and 1000000 then raise exception 'INVALID_COMMAND'; end if;
 basis:=public.adventure_recurring_read_basis(p_owner,p_expected_version,p_today);
 if basis is null then
   return jsonb_build_object('version',0,'today',p_today,'timeZone','Asia/Shanghai','date',p_date,'scope',p_scope,'search',btrim(p_search),'page',p_page,'pageSize',10,'total',0,'tasks','[]'::jsonb , 'progress',jsonb_build_object('completed',0,'total',0,'ratio',null));
 end if;
 with filtered as materialized (
  select t.id,t.kind,t.status,case when t.status='completed' then 2 when t.planned_on<p_today then 0 else 1 end rank,
   case when t.status='completed' then e.occurred_at else t.planned_on::timestamp at time zone 'Asia/Shanghai' end sort_at,t.created_at
  from public.adventure_tasks t join public.adventure_goals g on (g.owner_id,g.id)=(t.owner_id,t.goal_id)
  left join public.adventure_events e on e.owner_id=t.owner_id and e.task_id=t.id and e.kind='task_completed' and e.invalidated_at is null
  where t.owner_id=p_owner and t.deleted_at is null and (p_scope='all' or g.focused or g.kind='inbox')
   and (t.kind='once' or e.id is not null)
   and case when p_date<p_today then t.status='completed' and e.occurred_on=p_date
     when p_date>p_today then t.kind='once' and t.status='pending' and t.planned_on=p_date
     else (t.kind='once' and t.status='pending' and t.planned_on<=p_today) or (t.status='completed' and e.occurred_on=p_today) end
   and (btrim(p_search)='' or position(lower(btrim(p_search)) in lower(case when t.kind='recurring_child' then
     coalesce(e.snapshot->>'title','')||' '||coalesce(e.snapshot->>'description','')||' '||coalesce(e.snapshot->>'goalTitle','独立任务') else t.title||' '||t.description end))>0)
 ) select (select count(*) from filtered),(select count(*) from filtered where status='completed'),
  (select coalesce(jsonb_agg(item order by rank,sort_at,sort_created,id),'[]'::jsonb) from (
    select rank,sort_at,case when status='pending' then created_at end sort_created,id,
    case when kind='once' then public.adventure_task_view(p_owner,id,p_today)||jsonb_build_object('kind','once') else public.adventure_recurring_child_view(p_owner,id,p_today) end item
    from filtered order by rank,sort_at,sort_created,id limit 10 offset (p_page::bigint-1)*10) batch) into total,completed,items;
 return public.adventure_recurring_bounded(basis||jsonb_build_object('date',p_date,'scope',p_scope,'search',btrim(p_search),'page',p_page,'pageSize',10,'total',total,'tasks',items,
 'progress',jsonb_build_object('completed',completed,'total',total,'ratio',case when total=0 then null else completed::numeric/total end)));
end $$;

create or replace function public.adventure_task_check(p_owner uuid, p_command jsonb, p_today date)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_type text := p_command->>'type';
  v_keys text[];
  v_task public.adventure_tasks;
  v_goal public.adventure_goals;
  v_done public.adventure_events;
  v_day date;
begin
  if p_owner is null or p_today is null or jsonb_typeof(p_command) is distinct from 'object'
    or pg_column_size(p_command)>32768 then raise exception 'INVALID_COMMAND'; end if;
  if v_type is null or v_type not in ('createTask','editTask','completeTask','cancelTaskCompletion','deleteTask') then raise exception 'INVALID_COMMAND'; end if;
  case v_type
    when 'createTask' then v_keys:=array['type','title','description','plannedOn','destination'];
    when 'editTask' then v_keys:=array['type','id','title','description','plannedOn','destination'];
    when 'completeTask' then v_keys:=array['type','id'];
    when 'deleteTask' then v_keys:=array['type','id'];
    when 'cancelTaskCompletion' then v_keys:=array['type','completionId'];
    else raise exception 'INVALID_COMMAND';
  end case;
  if p_command-v_keys <> '{}'::jsonb or not(p_command ?& v_keys) then raise exception 'INVALID_COMMAND'; end if;
  if v_type in ('createTask','editTask') then
    if jsonb_typeof(p_command->'title') is distinct from 'string' or length(btrim(p_command->>'title')) not between 1 and 200
      or jsonb_typeof(p_command->'description') is distinct from 'string' or length(p_command->>'description')>4000 then raise exception 'INVALID_COMMAND'; end if;
  end if;
  if v_type='createTask' then
    if jsonb_typeof(p_command->'plannedOn') is distinct from 'string' or p_command->>'plannedOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(p_command->'destination') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
    v_day:=(p_command->>'plannedOn')::date;
    if v_day::text<>p_command->>'plannedOn' then raise exception 'INVALID_COMMAND'; end if;
    if v_day<p_today then raise exception 'RESCHEDULE_PAST'; end if;
    if coalesce(p_command->>'destination','')='' then return jsonb_build_object('allowed',true); end if;
    select * into v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'destination')::uuid and kind='real';
    if not found then raise exception 'NOT_FOUND'; end if;
  else
    if v_type='cancelTaskCompletion' then
      if jsonb_typeof(p_command->'completionId') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
      select * into v_done from public.adventure_events where owner_id=p_owner and id=(p_command->>'completionId')::uuid and kind='task_completed';
      if not found then raise exception 'NOT_FOUND'; end if;
      if v_done.invalidated_at is not null then raise exception 'COMPLETION_CHANGED'; end if;
      if v_done.occurred_on<>p_today then raise exception 'DATE_LOCKED'; end if;
      select * into v_task from public.adventure_tasks where kind='once' and owner_id=p_owner and id=v_done.task_id and deleted_at is null;
    else
      if jsonb_typeof(p_command->'id') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
      select * into v_task from public.adventure_tasks where kind='once' and owner_id=p_owner and id=(p_command->>'id')::uuid and deleted_at is null;
    end if;
    if not found then raise exception 'NOT_FOUND'; end if;
    if v_task.status='ended' then raise exception 'READ_ONLY'; end if;
    if v_type in ('editTask','completeTask') and v_task.status<>'pending' then raise exception 'TASK_NOT_PENDING'; end if;
    if v_type='editTask' then
      if jsonb_typeof(p_command->'plannedOn') is distinct from 'string' or p_command->>'plannedOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_COMMAND'; end if;
      v_day:=(p_command->>'plannedOn')::date;
      if v_day::text<>p_command->>'plannedOn' then raise exception 'INVALID_COMMAND'; end if;
      if v_day<p_today and v_day<>v_task.planned_on then raise exception 'RESCHEDULE_PAST'; end if;
      if v_type='editTask' then
        if jsonb_typeof(p_command->'destination') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
        if p_command->>'destination'<>'' then
          select * into v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'destination')::uuid and kind='real';
          if not found then raise exception 'NOT_FOUND'; end if;
          if v_goal.status<>'active' then raise exception 'READ_ONLY'; end if;
        end if;
      end if;
    end if;
    if v_type='deleteTask' then
      if v_task.status<>'pending' then raise exception 'TASK_NOT_PENDING'; end if;
    end if;
    if v_type='cancelTaskCompletion' then
      if v_task.status<>'completed' or v_task.completed_on<>p_today or v_task.completed_at<>v_done.occurred_at then raise exception 'COMPLETION_CHANGED'; end if;
      if exists(select 1 from public.adventure_goals where owner_id=p_owner and id=v_done.goal_id and status<>'active') then raise exception 'READ_ONLY'; end if;
    end if;
    select * into v_goal from public.adventure_goals where owner_id=p_owner and id=v_task.goal_id;
  end if;
  if v_goal.status<>'active' then raise exception 'READ_ONLY'; end if;
  return jsonb_build_object('allowed',true,'taskId',v_task.id,'completionId',v_done.id);
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then raise exception 'INVALID_COMMAND';
end $$;

create or replace function public.adventure_task_impact(p_owner uuid,p_command jsonb,p_today date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_task public.adventure_tasks;
  v_goal public.adventure_goals;
begin
  if p_command->>'type' is distinct from 'deleteTask' then raise exception 'INVALID_COMMAND'; end if;
  perform public.adventure_task_check(p_owner,p_command,p_today);
  select * into strict v_task from public.adventure_tasks where kind='once' and owner_id=p_owner and id=(p_command->>'id')::uuid and deleted_at is null;
  select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=v_task.goal_id;
  return jsonb_build_object('operation',p_command->>'type','entityId',v_task.id,'title',v_task.title,
    'stoppingGoals','[]'::jsonb,
    'stoppingTasks','[]'::jsonb,
    'preservedCompletedTasks',case when v_task.status='completed' then 1 else 0 end,
    'preservedAchievedGoals',0,
    'historicalArrangements',(select count(*) from public.adventure_events where owner_id=p_owner and task_id=v_task.id
      and kind='task_rescheduled'),
    'goalId',case when v_goal.kind='real' then v_goal.id end,
    'plannedOn',v_task.planned_on);
end $$;

create or replace function public.adventure_migration_check(p_owner uuid,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_goal public.adventure_goals; v_task public.adventure_tasks; v_target public.adventure_goals; v_destination text:=p_command->>'destination';
begin
  if p_owner is null or jsonb_typeof(p_command) is distinct from 'object' or pg_column_size(p_command)>32768
    or p_command->>'type' is distinct from 'taskDestination' or p_command-array['type','id','destination']<>'{}'::jsonb
    or not(p_command ?& array['type','id','destination']) or jsonb_typeof(p_command->'id') is distinct from 'string'
    or jsonb_typeof(p_command->'destination') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
  select * into v_task from public.adventure_tasks where kind='once' and owner_id=p_owner and id=(p_command->>'id')::uuid and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_task.status='ended' then raise exception 'READ_ONLY'; end if;
  if v_task.status<>'pending' then raise exception 'TASK_NOT_PENDING'; end if;
  select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=v_task.goal_id;
  if v_goal.status<>'active' or exists(select 1 from public.adventure_events e left join public.adventure_goals g on (g.owner_id,g.id)=(e.owner_id,e.goal_id)
    where e.owner_id=p_owner and e.task_id=v_task.id and e.kind='task_completed' and e.invalidated_at is null and g.status<>'active') then raise exception 'READ_ONLY'; end if;
  if v_destination='' then
    if v_goal.kind='inbox' then raise exception 'SAME_DESTINATION'; end if;
  else
    select * into v_target from public.adventure_goals where owner_id=p_owner and id=v_destination::uuid and kind='real';
    if not found then raise exception 'NOT_FOUND'; end if;
    if v_target.id=v_goal.id then raise exception 'SAME_DESTINATION'; end if;
    if v_target.status<>'active' then raise exception 'READ_ONLY'; end if;
  end if;
  return '{"allowed":true}'::jsonb;
exception when invalid_text_representation then raise exception 'INVALID_COMMAND';
end $$;

create or replace function public.adventure_migration_options(p_owner uuid,p_kind text,p_id uuid,p_page integer default 1)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare v_revision bigint; v_options jsonb; v_total bigint; v_result jsonb;
begin
  if p_owner is null or p_id is null or p_kind is distinct from 'task' or p_page is null or p_page not between 1 and 1000000 then raise exception 'INVALID_COMMAND'; end if;
  select revision into v_revision from public.adventure_accounts where owner_id=p_owner for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not exists(select 1 from public.adventure_tasks where kind='once' and owner_id=p_owner and id=p_id and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  with candidates as materialized (
    select ''::text id,'独立任务'::text name,0 rank
    union all select g.id::text,g.title::text,1 from public.adventure_goals g where g.owner_id=p_owner and g.kind='real'
  ) select (select count(*) from candidates),
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'capability',public.adventure_migration_capability(p_owner,
      jsonb_build_object('type','taskDestination','id',p_id,'destination',id))) order by rank,name,id),'[]')
      from (select * from candidates order by rank,name,id limit 20 offset (p_page::bigint-1)*20) page) into v_total,v_options;
  v_result:=jsonb_build_object('version',coalesce(v_revision,0),'kind',p_kind,'entityId',p_id,'page',p_page,'pageSize',20,'total',v_total,'options',v_options);
  if octet_length(v_result::text)>1000000 then raise exception 'CAPACITY_REACHED'; end if;
  return v_result;
end $$;

create or replace function public.adventure_task_history(p_owner uuid,p_task uuid,p_page integer default 1)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare v_version bigint; v_title text; v_items jsonb; v_total bigint; v_result jsonb;
begin
  if p_owner is null or p_page is null or p_page not between 1 and 1000000 then raise exception 'INVALID_COMMAND'; end if;
  select revision into v_version from public.adventure_accounts where owner_id=p_owner for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  select title into v_title from public.adventure_tasks where kind='once' and owner_id=p_owner and id=p_task and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  select count(*) into v_total from public.adventure_events where owner_id=p_owner and task_id=p_task and kind in ('task_created','task_rescheduled');
  select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'kind',h.kind,
        'sourceEventId',h.snapshot->>'sourceEventId','oldPlannedOn',h.snapshot->>'oldPlannedOn',
        'newPlannedOn',coalesce(h.snapshot->>'newPlannedOn',h.snapshot->>'plannedOn'),
        'occurredAt',h.occurred_at,'title',h.snapshot->>'title','description',h.snapshot->>'description',
        'goalId',h.goal_id,'goalTitle',h.snapshot->>'goalTitle')
        order by h.applied_revision,h.id),'[]'::jsonb) into v_items from (
    select * from public.adventure_events where owner_id=p_owner and task_id=p_task and kind in ('task_created','task_rescheduled')
      order by applied_revision,id limit 5 offset (p_page::bigint-1)*5
  ) h;
  v_result:=jsonb_build_object('version',v_version,'taskId',p_task,'title',v_title,'page',p_page,'pageSize',5,'total',v_total,'items',v_items);
  if octet_length(v_result::text)>900000 then raise exception 'CAPACITY_REACHED'; end if;
  return v_result;
end $$;

create or replace function public.adventure_task_view(p_owner uuid,p_task uuid,p_today date)
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object('id',t.id,'title',t.title,'description',t.description,'plannedOn',t.planned_on,
      'rescheduleMin',p_today,
      'arrangements',(select coalesce(jsonb_agg(jsonb_build_object('id',a->'id','kind',a->'kind','sourceEventId',a->'sourceEventId','oldPlannedOn',a->'oldPlannedOn','newPlannedOn',a->'newPlannedOn','occurredAt',a->'occurredAt')),'[]'::jsonb) from jsonb_array_elements(history.value->'items') a),'totalArrangements',history.value->'total',
      'status',t.status,'completedOn',t.completed_on,'completionId',e.id,
      'reward',case when e.id is not null then jsonb_build_object('amount',e.amount,'calculation',e.calculation) end,
      'completionOrigin',case when e.id is not null then jsonb_build_object('goalId',e.goal_id,'goalTitle',e.snapshot->>'goalTitle','categoryLabel',e.snapshot->'categoryLabel','title',e.snapshot->>'title','description',e.snapshot->>'description','plannedOn',e.snapshot->>'plannedOn','occurredOn',e.occurred_on) end,
      'goalId',case when g.kind='real' then g.id end,'goalTitle',case when g.kind='real' then g.title end,
      'independent',g.kind='inbox','overdue',t.status='pending' and t.planned_on<p_today,
      'progress',(select jsonb_build_object('completed',count(*) filter(where x.status='completed'),'total',count(*),
        'ratio',case when count(*)=0 then null else (count(*) filter(where x.status='completed'))::numeric/count(*) end)
        from public.adventure_tasks x where x.kind='once' and x.owner_id=t.owner_id and x.goal_id=t.goal_id and x.deleted_at is null and x.status in ('pending','completed')),
      'capabilities',jsonb_build_object(
        'edit',public.adventure_task_capability(p_owner,jsonb_build_object('type','editTask','id',t.id,'title',t.title,'description',t.description,'plannedOn',t.planned_on,'destination',case when g.kind='inbox' then '' else g.id::text end),p_today),
        'complete',public.adventure_task_capability(p_owner,jsonb_build_object('type','completeTask','id',t.id),p_today),
        'cancel',case when e.id is null then '{"allowed":false,"reason":"任务尚未完成"}'::jsonb else public.adventure_task_capability(p_owner,jsonb_build_object('type','cancelTaskCompletion','completionId',e.id),p_today) end,
        'reschedule',jsonb_build_object('allowed',false,'reason','请在编辑任务中修改日期'),'migrate',jsonb_build_object('allowed',false,'reason','请在编辑任务中修改归属'),
        'end',jsonb_build_object('allowed',false,'reason','请在编辑任务中删除未完成任务'),
        'delete',public.adventure_task_capability(p_owner,jsonb_build_object('type','deleteTask','id',t.id),p_today)))
  from public.adventure_tasks t join public.adventure_goals g on (g.owner_id,g.id)=(t.owner_id,t.goal_id)
    left join public.adventure_events e on e.owner_id=t.owner_id and e.task_id=t.id and e.kind='task_completed' and e.invalidated_at is null
  cross join lateral (select public.adventure_task_history(p_owner,t.id,1) value) history
  where t.kind='once' and t.owner_id=p_owner and t.id=p_task and t.deleted_at is null;
$$;

create or replace function public.adventure_lifecycle_impact(p_owner uuid,p_command jsonb,p_today date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_goal public.adventure_goals;
begin
  perform public.adventure_lifecycle_check(p_owner,p_command,p_today);
  select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid;
  return jsonb_build_object('operation','endGoal','entityId',v_goal.id,'title',v_goal.title,'stoppingGoals','[]'::jsonb,'stoppingTasks','[]'::jsonb,
    'preservedCompletedTasks',(select count(*) from public.adventure_tasks where kind='once' and owner_id=p_owner and goal_id=v_goal.id and status='completed' and deleted_at is null),
    'preservedAchievedGoals',0);
end $$;

create or replace function public.adventure_planning_check(p_owner uuid,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_type text:=p_command->>'type'; v_goal public.adventure_goals; v_keys text[];
begin
  if p_owner is null or jsonb_typeof(p_command) is distinct from 'object' or pg_column_size(p_command)>32768 or v_type is null then raise exception 'INVALID_COMMAND'; end if;
  if v_type in ('createTask','editTask','completeTask','cancelTaskCompletion','deleteTask') then
    return public.adventure_task_check(p_owner,p_command,(clock_timestamp() at time zone 'Asia/Shanghai')::date);
  end if;
  if v_type='endGoal' then return public.adventure_lifecycle_check(p_owner,p_command,(clock_timestamp() at time zone 'Asia/Shanghai')::date); end if;
  case v_type
    when 'createGoal' then v_keys:=array['type','title','standards'];
    when 'editGoal' then v_keys:=array['type','id','title','standards'];
    when 'achieveGoal' then v_keys:=array['type','id'];
    when 'reorderGoals' then v_keys:=array['type','id','direction'];
    else raise exception 'INVALID_COMMAND';
  end case;
  if not(p_command ?& v_keys) or (p_command-v_keys-CASE v_type
      when 'createGoal' then array['categoryLabel'] when 'editGoal' then array['categoryLabel']
      when 'achieveGoal' then array['coefficient','reflection'] when 'reorderGoals' then array['targetId'] end)<>'{}'::jsonb
    then raise exception 'INVALID_COMMAND'; end if;
  if v_type in ('createGoal','editGoal') then
    if jsonb_typeof(p_command->'title') is distinct from 'string' or length(btrim(p_command->>'title')) not between 1 and 200
      or jsonb_typeof(p_command->'standards') is distinct from 'array' or jsonb_array_length(p_command->'standards') not between 1 and 50
      or exists(select 1 from jsonb_array_elements(p_command->'standards') item where jsonb_typeof(item) is distinct from 'string' or length(btrim(item #>> '{}')) not between 1 and 4000)
      or (p_command ? 'categoryLabel' and jsonb_typeof(p_command->'categoryLabel') not in ('string','null'))
      or length(btrim(p_command->>'categoryLabel',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))>200 then raise exception 'INVALID_COMMAND'; end if;
  end if;
  if v_type<>'createGoal' then
    if jsonb_typeof(p_command->'id') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
    select * into v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid and kind='real';
    if not found then raise exception 'NOT_FOUND'; end if;
    if v_goal.status<>'active' then raise exception 'READ_ONLY'; end if;
  end if;
  if v_type='achieveGoal' then
    if (p_command ? 'coefficient' and (jsonb_typeof(p_command->'coefficient') is distinct from 'number' or p_command->>'coefficient' not in ('1','2','3')))
      or (p_command ? 'reflection' and (jsonb_typeof(p_command->'reflection') is distinct from 'string' or length(p_command->>'reflection')>4000)) then raise exception 'INVALID_COMMAND'; end if;
    if exists(select 1 from public.adventure_recurring_tasks where owner_id=p_owner and goal_id=v_goal.id and status='active' and deleted_at is null) then raise exception 'PENDING_RECURRING_TASKS'; end if;
  if exists(select 1 from public.adventure_tasks where owner_id=p_owner and goal_id=v_goal.id and status='pending' and deleted_at is null) then raise exception 'PENDING_TASKS'; end if;
  elsif v_type='reorderGoals' then
    if jsonb_typeof(p_command->'direction') is distinct from 'string' or p_command->>'direction' not in ('up','down') then raise exception 'INVALID_COMMAND'; end if;
    if p_command ? 'targetId' and (jsonb_typeof(p_command->'targetId') is distinct from 'string' or not exists(
      select 1 from public.adventure_goals where owner_id=p_owner and id=(p_command->>'targetId')::uuid and id<>v_goal.id and kind='real' and status='active')) then raise exception 'INVALID_COMMAND'; end if;
  end if;
  return '{"allowed":true}'::jsonb;
exception when invalid_text_representation then raise exception 'INVALID_COMMAND';
end $$;

create or replace function public.adventure_lifecycle_check(p_owner uuid,p_command jsonb,p_today date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_goal public.adventure_goals;
begin
  if p_owner is null or p_today is null or jsonb_typeof(p_command) is distinct from 'object' or pg_column_size(p_command)>32768
    or p_command->>'type' is distinct from 'endGoal' or p_command-array['type','id']<>'{}'::jsonb or not(p_command ?& array['type','id'])
    or jsonb_typeof(p_command->'id') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
  select * into v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid and kind='real';
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_goal.status<>'active' then raise exception 'READ_ONLY'; end if;
  if exists(select 1 from public.adventure_recurring_tasks where owner_id=p_owner and goal_id=v_goal.id and status='active' and deleted_at is null) then raise exception 'PENDING_RECURRING_TASKS'; end if;
  if exists(select 1 from public.adventure_tasks where owner_id=p_owner and goal_id=v_goal.id and status='pending' and deleted_at is null) then raise exception 'PENDING_TASKS'; end if;
  return jsonb_build_object('allowed',true,'entityId',v_goal.id,'title',v_goal.title);
exception when invalid_text_representation then raise exception 'INVALID_COMMAND';
end $$;

create or replace function public.adventure_goal_view(p_owner uuid,p_goal uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object('id',g.id,'title',g.title,'standards',g.standards,'categoryLabel',g.category_label,
    'taskCount',(select count(*) from public.adventure_tasks t where t.owner_id=g.owner_id and t.goal_id=g.id and t.kind='once' and t.deleted_at is null and t.status in ('pending','completed'))+(select count(*) from public.adventure_recurring_tasks p where p.owner_id=g.owner_id and p.goal_id=g.id and p.status='active' and p.deleted_at is null),
    'focused',g.focused,'sortOrder',g.sort_order,'createdAt',g.created_at,'status',g.status,'terminatedAt',g.terminated_at,
    'achievement',(select jsonb_build_object('id',e.id,'occurredOn',e.occurred_on,'reflection',e.snapshot->>'reflection',
      'reward',jsonb_build_object('amount',e.amount,'calculation',e.calculation)) from public.adventure_events e
      where e.owner_id=g.owner_id and e.goal_id=g.id and e.kind='goal_achieved'),
    'progress',(select jsonb_build_object('completed',count(*) filter(where t.status='completed'),'total',count(*),
      'ratio',case when count(*)=0 then null else (count(*) filter(where t.status='completed'))::numeric/count(*) end)
      from public.adventure_tasks t where t.kind='once' and t.owner_id=g.owner_id and t.goal_id=g.id and t.deleted_at is null and t.status in ('pending','completed')),
    'capabilities',jsonb_build_object('edit',cap.edit,'reorder',cap.edit,
      'moveUp',jsonb_build_object('allowed',g.status='active' and exists(select 1 from public.adventure_goals n where n.owner_id=g.owner_id and n.kind='real' and n.status='active' and (n.sort_order,n.id)<(g.sort_order,g.id))),
      'moveDown',jsonb_build_object('allowed',g.status='active' and exists(select 1 from public.adventure_goals n where n.owner_id=g.owner_id and n.kind='real' and n.status='active' and (n.sort_order,n.id)>(g.sort_order,g.id))),
      'achieve',case when exists(select 1 from public.adventure_recurring_tasks p where p.owner_id=g.owner_id and p.goal_id=g.id and p.status='active' and p.deleted_at is null) then '{"allowed":false,"reason":"请先处理未结束周期任务"}'::jsonb when g.status='active' and exists(select 1 from public.adventure_tasks t where t.kind='once' and t.owner_id=g.owner_id and t.goal_id=g.id and t.status='pending' and t.deleted_at is null)
        then '{"allowed":false,"reason":"请先处理未完成任务"}'::jsonb else cap.edit end,
      'end',public.adventure_lifecycle_capability(p_owner,jsonb_build_object('type','endGoal','id',g.id),(clock_timestamp() at time zone 'Asia/Shanghai')::date),'createTask',cap.edit))
  from public.adventure_goals g cross join lateral (select case when g.status='active' then '{"allowed":true}'::jsonb else '{"allowed":false,"reason":"目标已进入终态，只能查看"}'::jsonb end edit) cap
  where g.owner_id=p_owner and g.id=p_goal and g.kind='real';
$$;

create or replace function public.adventure_workspace_read(p_owner uuid,p_page integer default 1,p_page_size integer default 20,p_task_range text default 'today',p_task_page integer default 1,p_task_scope text default 'all',p_search text default '',p_goal_id uuid default null,p_goal_task_page integer default 1,p_include_terminal boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout='3s' as $$
declare
  v_result jsonb;
  v_revision bigint;
  v_today date;
  v_tasks jsonb;
  v_progress jsonb;
  v_detail jsonb;
  v_total bigint;
  v_later jsonb:='{"allowed":false,"reason":"此操作尚未交付"}';
begin
  if p_task_range is null or p_task_range not in ('today','future','past') or p_task_page is null or p_task_page not between 1 and 1000000
    or p_goal_task_page is null or p_goal_task_page not between 1 and 1000000
    or p_task_scope is null or p_task_scope not in ('all','focus') or p_search is null or length(btrim(p_search))>100 then raise exception 'INVALID_COMMAND'; end if;
  v_result:=public.adventure_planning_read(p_owner,p_page,p_page_size,p_include_terminal);
  v_today:=(v_result->>'today')::date;
  -- The nested base read may have returned an absent-owner snapshot. Reacquire
  -- a real row lock or finish that empty snapshot without querying owner facts.
  select revision into v_revision from public.adventure_accounts where owner_id=p_owner for share;
  if not found then
    if p_goal_id is not null then raise exception 'NOT_FOUND'; end if;
    return v_result||jsonb_build_object('tasks','[]'::jsonb,'totalTasks',0,'taskPage',p_task_page,'taskRange',p_task_range,
      'includeTerminal',p_include_terminal,'taskScope',p_task_scope,'search',btrim(p_search),
      'taskProgress',jsonb_build_object('completed',0,'total',0,'ratio',null),
      'todayTaskProgress',jsonb_build_object('completed',0,'total',0,'ratio',null),
      'recurring',jsonb_build_object('version',1,'timeZone','Asia/Shanghai','clientVersion','recurring-1'));
  end if;
  if v_revision<>(v_result->>'version')::bigint then raise exception 'VERSION_CONFLICT'; end if;
  with filtered as materialized (
    select t.* from public.adventure_tasks t join public.adventure_goals g on (g.owner_id,g.id)=(t.owner_id,t.goal_id)
    where t.kind='once' and t.owner_id=p_owner and t.deleted_at is null and
      case p_task_range when 'today' then (t.planned_on=v_today and t.status<>'completed' or t.status='completed' and t.completed_on=v_today) when 'past' then t.planned_on<v_today else t.planned_on>v_today end
      and (p_task_scope='all' or g.focused or g.kind='inbox')
      and (btrim(p_search)='' or position(lower(btrim(p_search)) in lower(t.title))>0 or position(lower(btrim(p_search)) in lower(t.description))>0)
  )

  select (select count(*) from filtered),
    (select jsonb_build_object('completed',count(*) filter(where status='completed'),'total',count(*),
      'ratio',case when count(*)=0 then null else (count(*) filter(where status='completed'))::numeric/count(*) end)
      from filtered where status in ('pending','completed')),
    (select coalesce(jsonb_agg(item order by status_rank,planned_on,created_at,id),'[]'::jsonb) from (
    select case t.status when 'pending' then 0 when 'completed' then 1 else 2 end status_rank,t.planned_on,t.created_at,t.id,public.adventure_task_view(p_owner,t.id,v_today) item
    from filtered t
    order by status_rank,t.planned_on,t.created_at,t.id limit p_page_size offset (p_task_page::bigint-1)*p_page_size
  ) tasks) into v_total,v_progress,v_tasks;
  v_result:=v_result||jsonb_build_object('today',v_today,'tasks',v_tasks,'totalTasks',v_total,'taskPage',p_task_page,'taskRange',p_task_range,
    'includeTerminal',p_include_terminal,
    'taskScope',p_task_scope,'search',btrim(p_search),'taskProgress',v_progress,
    'todayTaskProgress',public.adventure_date_task_list(p_owner,(v_result->>'version')::bigint,v_today,v_today,p_task_scope,'',1)->'progress',
    'recurring',jsonb_build_object('version',1,'timeZone','Asia/Shanghai','clientVersion','recurring-1'));
  if p_goal_id is not null then
    v_detail:=public.adventure_goal_view(p_owner,p_goal_id);
    if v_detail is null then raise exception 'NOT_FOUND'; end if;
    v_result:=v_result||jsonb_build_object('goalDetail',jsonb_build_object('goal',v_detail,
      'taskPage',p_goal_task_page,'totalTasks',(select count(*) from public.adventure_tasks t where t.kind='once' and t.owner_id=p_owner and t.deleted_at is null and (t.goal_id=p_goal_id or exists(select 1 from public.adventure_events e where e.owner_id=p_owner and e.task_id=t.id and e.kind='task_completed' and e.invalidated_at is null and e.goal_id=p_goal_id))),
      'totalRelatedTasks',(select count(*) from public.adventure_tasks where kind='once' and owner_id=p_owner and deleted_at is null and goal_id=p_goal_id and status in ('pending','completed')),
      'relatedTasks',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'plannedOn',planned_on,'completedAt',completed_at) order by planned_on,created_at,id),'[]'::jsonb) from (
        select id,title,planned_on,completed_at,created_at from public.adventure_tasks where kind='once' and owner_id=p_owner and goal_id=p_goal_id and deleted_at is null and status in ('pending','completed')
        order by planned_on,created_at,id limit p_page_size offset (p_goal_task_page::bigint-1)*p_page_size) related),
      'tasks',(select coalesce(jsonb_agg(item order by planned_on,created_at,id),'[]') from (
        select planned_on,created_at,id,public.adventure_task_view(p_owner,id,v_today) item from public.adventure_tasks
        where kind='once' and owner_id=p_owner and deleted_at is null and (goal_id=p_goal_id or exists(select 1 from public.adventure_events e where e.owner_id=p_owner and e.task_id=adventure_tasks.id and e.kind='task_completed' and e.invalidated_at is null and e.goal_id=p_goal_id)) order by planned_on,created_at,id
        limit p_page_size offset (p_goal_task_page::bigint-1)*p_page_size) history)));
  end if;
  v_result:=jsonb_set(v_result,'{capabilities,createTask}','{"allowed":true}');
  if octet_length(v_result::text)>1000000 then raise exception 'CAPACITY_REACHED'; end if;
  return v_result;
end $$;

create or replace function public.adventure_task_list(p_owner uuid,p_date date,p_scope text,p_expected_version bigint,p_today date,p_page integer default 1)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare
  v_version bigint;
  v_has_account boolean;
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
  v_has_account:=found;v_version:=coalesce(v_version,0);
  v_today:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
  if v_version<>p_expected_version or v_today<>p_today then raise exception 'VERSION_CONFLICT'; end if;
  if not v_has_account then
    return jsonb_build_object('version',0,'today',v_today,'date',p_date,'scope',p_scope,'page',p_page,'pageSize',10,'total',0,'tasks','[]'::jsonb,'progress',jsonb_build_object('completed',0,'total',0,'ratio',null));
  end if;
  with filtered as materialized (
    select t.*,case when t.status='completed' then 2 when t.planned_on<v_today then 0 else 1 end rank
    from public.adventure_tasks t join public.adventure_goals g on (g.owner_id,g.id)=(t.owner_id,t.goal_id)
    where t.kind='once' and t.owner_id=p_owner and t.deleted_at is null and (p_scope='all' or g.focused or g.kind='inbox')
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

create or replace function public.adventure_planning_read(p_owner uuid,p_page integer default 1,p_page_size integer default 20,p_include_terminal boolean default false)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare v_account public.adventure_accounts; v_result jsonb;
begin
  if p_owner is null or p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not between 1 and 50
    or p_include_terminal is null then raise exception 'INVALID_COMMAND'; end if;
  select * into v_account from public.adventure_accounts where owner_id=p_owner for share;
  if not found then
    -- Pin the absent-owner snapshot; later statements may see its first commit.
    return jsonb_build_object('version',0,'today',(clock_timestamp() at time zone 'Asia/Shanghai')::date,
      'page',p_page,'pageSize',p_page_size,'totalGoals',0,'goals','[]'::jsonb,'growth',public.adventure_growth(null),
      'capabilities',jsonb_build_object('createGoal','{"allowed":true}'::jsonb,'createTask','{"allowed":true}'::jsonb,'growth','{"allowed":true}'::jsonb,'progress','{"allowed":true}'::jsonb),
      'limits',jsonb_build_object('name',200,'standard',4000,'standards',50));
  end if;
  if v_account.total_xp<>(select coalesce(sum(amount),0) from public.adventure_events where owner_id=p_owner and kind in ('task_completed','goal_achieved') and invalidated_at is null) then raise exception 'INCONSISTENT_REWARDS'; end if;
  select jsonb_build_object('version',v_account.revision,'today',(clock_timestamp() at time zone 'Asia/Shanghai')::date,
    'page',p_page,'pageSize',p_page_size,
    'totalGoals',(select count(*) from public.adventure_goals g where g.owner_id=p_owner and g.kind='real' and (g.status='active' or p_include_terminal)),
    'goals',coalesce((select jsonb_agg(item order by terminal_rank,sort_rank,terminated_at desc,id) from (
      select g.id,case when g.status='active' then 0 else 1 end terminal_rank,case when g.status='active' then g.sort_order end sort_rank,
        case when g.status<>'active' then g.terminated_at end terminated_at,public.adventure_goal_view(p_owner,g.id) item
      from public.adventure_goals g where g.owner_id=p_owner and g.kind='real' and (g.status='active' or p_include_terminal)
      order by terminal_rank,sort_rank,terminated_at desc,g.id limit p_page_size offset (p_page::bigint-1)*p_page_size) goals),'[]'::jsonb),
    'growth',public.adventure_growth(p_owner),
    'capabilities',jsonb_build_object('createGoal','{"allowed":true}'::jsonb,'createTask','{"allowed":true}'::jsonb,'growth','{"allowed":true}'::jsonb,'progress','{"allowed":true}'::jsonb),
    'limits',jsonb_build_object('name',200,'standard',4000,'standards',50)) into v_result;
  if octet_length(v_result::text)>1000000 then raise exception 'CAPACITY_REACHED'; end if;
  return v_result;
end $$;

create or replace function public.adventure_planning_command(p_owner uuid,p_request_id text,p_expected_version bigint,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare
  v_account public.adventure_accounts; v_prior public.adventure_events; v_goal public.adventure_goals;
  v_hash text:=encode(sha256(convert_to(p_command::text,'UTF8')),'hex'); v_type text:=p_command->>'type';
  v_recurring boolean:=v_type in ('createRecurringTask','editRecurringTask','recordRecurringCompletion','cancelRecurringCompletion','endRecurringTask','deleteRecurringTask');
  v_kind text; v_before jsonb; v_after jsonb; v_now timestamptz; v_order bigint; v_result jsonb;
begin
  if octet_length(p_command::text)>32768 then raise exception 'COMMAND_TOO_LARGE'; end if;
  if p_owner is null or p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,128}$'
    or p_expected_version is null or p_expected_version not between 0 and 9007199254740991
    or p_command is null or jsonb_typeof(p_command) is distinct from 'object' then raise exception 'INVALID_COMMAND'; end if;
  insert into public.adventure_accounts(owner_id) values(p_owner) on conflict do nothing;
  select * into strict v_account from public.adventure_accounts where owner_id=p_owner for update;
  select * into v_prior from public.adventure_events where owner_id=p_owner and request_id=p_request_id;
  if found then
    if v_prior.command_hash<>v_hash then raise exception 'REQUEST_ID_REUSED'; end if;
    if jsonb_typeof(v_prior.snapshot->'result') is distinct from 'object'
      or jsonb_typeof(v_prior.snapshot->'result'->'entityId') is distinct from 'string'
      or jsonb_typeof(v_prior.snapshot->'result'->'message') is distinct from 'string'
      or not public.adventure_receipt_safe(v_prior.snapshot->'result','result') then raise exception 'REPLAY_UNAVAILABLE'; end if;
    return jsonb_build_object('version',v_prior.applied_revision,'result',v_prior.snapshot->'result');
  end if;
  if v_type is null or v_type not in ('createGoal','editGoal','reorderGoals','endGoal','achieveGoal','createTask','editTask','completeTask','cancelTaskCompletion','deleteTask','createRecurringTask','editRecurringTask','recordRecurringCompletion','cancelRecurringCompletion','endRecurringTask','deleteRecurringTask') then raise exception 'INVALID_COMMAND'; end if;
  v_now:=clock_timestamp();
  if v_recurring then
    if jsonb_typeof(p_command->'today') is distinct from 'string' or p_command->>'today' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_COMMAND'; end if;
    if (p_command->>'today')::date<>(v_now at time zone 'Asia/Shanghai')::date then raise exception 'PLANNING_DATE_CHANGED'; end if;
  end if;
  if v_account.revision<>p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if v_account.revision>=9007199254740991 then raise exception 'CAPACITY_REACHED'; end if;
  if v_recurring then
    return public.adventure_recurring_apply(p_owner,p_request_id,v_account.revision,p_command,v_now);
  end if;
  -- Execute only after the account lock, receipt and version checks above.
  if v_type='endGoal' then
    declare
      p_revision bigint:=v_account.revision; p_now timestamptz:=v_now; v_today date:=(p_now at time zone 'Asia/Shanghai')::date; v_goal public.adventure_goals;
      v_before jsonb; v_after jsonb; v_impact jsonb; v_result jsonb;
    begin
      perform public.adventure_lifecycle_check(p_owner,p_command,v_today);
      v_impact:=public.adventure_lifecycle_impact(p_owner,p_command,v_today);
      select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid;
      v_before:=to_jsonb(v_goal)-'owner_id';
      update public.adventure_goals set status='ended',focused=false,terminated_at=p_now,termination_cause='ended',updated_at=p_now
        where owner_id=p_owner and id=v_goal.id returning * into v_goal;
      v_after:=to_jsonb(v_goal)-'owner_id';
      v_result:=jsonb_build_object('entityId',v_goal.id,'message','目标已结束');
      insert into public.adventure_events(id,owner_id,event_group_id,kind,entity_type,entity_id,goal_id,occurred_at,occurred_on,actor_owner_id,
        request_id,command_hash,command_type,applied_revision,snapshot,created_at)
        values(gen_random_uuid(),p_owner,gen_random_uuid(),'goal_ended','goal',v_goal.id,v_goal.id,p_now,v_today,p_owner,p_request_id,
          encode(sha256(convert_to(p_command::text,'UTF8')),'hex'),'endGoal',p_revision+1,jsonb_build_object('before',v_before,'after',v_after,'impact',v_impact,'result',v_result),p_now);
      if (select total_xp from public.adventure_accounts where owner_id=p_owner)<>(select coalesce(sum(amount),0) from public.adventure_events
        where owner_id=p_owner and kind in ('task_completed','goal_achieved') and invalidated_at is null) then raise exception 'INCONSISTENT_REWARDS'; end if;
      update public.adventure_accounts set revision=p_revision+1,updated_at=p_now where owner_id=p_owner;
      return jsonb_build_object('version',p_revision+1,'result',v_result);
    end;
  elsif v_type in ('createTask','editTask','completeTask','cancelTaskCompletion','deleteTask') then
    declare
      p_revision bigint:=v_account.revision; p_now timestamptz:=v_now;
      v_type text:=p_command->>'type';
      v_today date:=(p_now at time zone 'Asia/Shanghai')::date;
      v_task public.adventure_tasks;
      v_goal public.adventure_goals;
      v_done public.adventure_events;
      v_event uuid:=gen_random_uuid();
      v_group uuid:=gen_random_uuid();
      v_kind text;
      v_before jsonb;
      v_after jsonb;
      v_snapshot jsonb;
      v_before_growth jsonb;
      v_after_growth jsonb;
      v_delta bigint:=0;
      v_reward jsonb;
      v_result jsonb;
      v_unlocked jsonb;
      v_lost jsonb;
      v_impact jsonb;
    begin
      perform public.adventure_task_check(p_owner,p_command,v_today);
      if v_type='deleteTask' then v_impact:=public.adventure_task_impact(p_owner,p_command,v_today); end if;
      v_before_growth:=public.adventure_growth(p_owner);
      if v_type in ('createTask','editTask') then
        if coalesce(p_command->>'destination','')='' then
          select * into v_goal from public.adventure_goals where owner_id=p_owner and kind='inbox';
          if not found then
            insert into public.adventure_goals(owner_id,kind,title,standards,created_at,updated_at)
              values(p_owner,'inbox','独立任务','["系统收纳目标，仅承接独立任务。"]',p_now,p_now) returning * into v_goal;
          end if;
        else
          select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'destination')::uuid;
        end if;
        if v_type='createTask' then
        insert into public.adventure_tasks(owner_id,goal_id,title,description,planned_on,created_at,updated_at)
          values(p_owner,v_goal.id,btrim(p_command->>'title'),btrim(p_command->>'description'),(p_command->>'plannedOn')::date,p_now,p_now) returning * into v_task;
        v_kind:='task_created';
        else
          select to_jsonb(t)-'owner_id' into v_before from public.adventure_tasks t where owner_id=p_owner and id=(p_command->>'id')::uuid;
          update public.adventure_tasks set goal_id=v_goal.id,title=btrim(p_command->>'title'),description=btrim(p_command->>'description'),planned_on=(p_command->>'plannedOn')::date,updated_at=p_now
            where owner_id=p_owner and id=(p_command->>'id')::uuid returning * into v_task;
          v_kind:=case when (v_before->>'planned_on')::date<>v_task.planned_on then 'task_rescheduled' when (v_before->>'goal_id')::uuid<>v_task.goal_id then 'task_migrated' else 'task_updated' end;
        end if;
      else
        if v_type='cancelTaskCompletion' then
          select * into strict v_done from public.adventure_events where owner_id=p_owner and id=(p_command->>'completionId')::uuid;
          select * into strict v_task from public.adventure_tasks where owner_id=p_owner and id=v_done.task_id;
        else
          select * into strict v_task from public.adventure_tasks where owner_id=p_owner and id=(p_command->>'id')::uuid;
        end if;
        v_before:=to_jsonb(v_task)-'owner_id';
        select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=v_task.goal_id;
        case v_type
          when 'completeTask' then
            update public.adventure_tasks set status='completed',completed_at=p_now,completed_on=v_today,updated_at=p_now
              where owner_id=p_owner and id=v_task.id returning * into v_task;
            v_kind:='task_completed';v_delta:=1;
          when 'deleteTask' then
            update public.adventure_tasks set deleted_at=p_now,updated_at=p_now
              where owner_id=p_owner and id=v_task.id returning * into v_task;
            v_kind:='task_deleted';
          when 'cancelTaskCompletion' then
            update public.adventure_tasks set status='pending',completed_at=null,completed_on=null,updated_at=p_now
              where owner_id=p_owner and id=v_task.id returning * into v_task;
            v_kind:='task_completion_cancelled';v_delta:=-v_done.amount;
        end case;
      end if;
      v_after:=to_jsonb(v_task)-'owner_id';
      v_snapshot:=jsonb_build_object('before',v_before,'after',v_after,'title',v_task.title,'description',v_task.description,
        'completionId',case when v_type='cancelTaskCompletion' then v_done.id end,
        'plannedOn',v_task.planned_on,
        'goalTitle',case when v_goal.kind='real' then v_goal.title end,'goalStandards',case when v_goal.kind='real' then v_goal.standards end,
        'impact',v_impact);
      if v_kind='task_rescheduled' then
        v_snapshot:=v_snapshot||jsonb_build_object('oldPlannedOn',v_before->>'planned_on','newPlannedOn',v_task.planned_on,
          'sourceEventId',(select id from public.adventure_events where owner_id=p_owner and task_id=v_task.id
            and kind in ('task_created','task_rescheduled') order by applied_revision desc,id desc limit 1));
      end if;
      if v_before is not null and (v_before->>'goal_id')::uuid<>v_task.goal_id then
        v_snapshot:=v_snapshot||jsonb_build_object('origin',(select jsonb_build_object('goalId',case when g.kind='real' then g.id end,'goalTitle',case when g.kind='real' then g.title end) from public.adventure_goals g where g.owner_id=p_owner and g.id=(v_before->>'goal_id')::uuid));
      end if;
      if v_type='completeTask' then
        v_snapshot:=v_snapshot||jsonb_build_object('categoryLabel',case when v_goal.kind='real' then v_goal.category_label end);
        v_reward:=jsonb_build_object('amount',v_delta,'calculation',jsonb_build_object(
          'type','fixed_task','completionId',v_event,'count',1,'coefficient',1));
      elsif v_type='cancelTaskCompletion' then
        v_reward:=jsonb_build_object('amount',v_done.amount,'calculation',v_done.calculation);
      end if;
      insert into public.adventure_events(id,owner_id,event_group_id,kind,entity_type,entity_id,task_id,goal_id,
        occurred_at,occurred_on,actor_owner_id,request_id,command_hash,command_type,applied_revision,amount,calculation,snapshot,created_at)
        values(v_event,p_owner,v_group,v_kind,'task',v_task.id,v_task.id,case when v_goal.kind='real' then v_goal.id end,
          p_now,v_today,p_owner,p_request_id,encode(sha256(convert_to(p_command::text,'UTF8')),'hex'),v_type,p_revision+1,
          case when v_type='completeTask' then v_delta end,case when v_type='completeTask' then v_reward->'calculation' end,v_snapshot,p_now);
      if v_type='cancelTaskCompletion' then
        update public.adventure_events set invalidated_at=p_now,invalidated_by_event_id=v_event
          where owner_id=p_owner and id=v_done.id and invalidated_at is null;
      end if;
      if (select total_xp::numeric+v_delta from public.adventure_accounts where owner_id=p_owner) not between 0 and 9007199254740991 then raise exception 'CAPACITY_REACHED'; end if;
      update public.adventure_accounts set total_xp=total_xp+v_delta,revision=p_revision+1,updated_at=p_now where owner_id=p_owner;
      if (select total_xp from public.adventure_accounts where owner_id=p_owner) <>
        (select coalesce(sum(amount),0) from public.adventure_events where owner_id=p_owner and kind in ('task_completed','goal_achieved') and invalidated_at is null)
        then raise exception 'INCONSISTENT_REWARDS'; end if;
      v_after_growth:=public.adventure_growth(p_owner);
      select coalesce(jsonb_agg(a->>'label'),'[]'::jsonb) into v_unlocked from jsonb_array_elements(v_after_growth->'achievements') a
        where (a->>'unlocked')::boolean and not exists(select 1 from jsonb_array_elements(v_before_growth->'achievements') b where b->>'id'=a->>'id' and (b->>'unlocked')::boolean);
      select coalesce(jsonb_agg(b->>'label'),'[]'::jsonb) into v_lost from jsonb_array_elements(v_before_growth->'achievements') b
        where (b->>'unlocked')::boolean and not exists(select 1 from jsonb_array_elements(v_after_growth->'achievements') a where a->>'id'=b->>'id' and (a->>'unlocked')::boolean);
      v_result:=jsonb_build_object('entityId',v_task.id,'message',case v_type
        when 'createTask' then '已创建任务' when 'editTask' then '已保存任务'
        when 'deleteTask' then '未完成任务已删除'
        when 'cancelTaskCompletion' then '已取消完成，成长已同步更新'
        else '已完成，获得 1 点经验' || case when (v_after_growth->>'level')::bigint>(v_before_growth->>'level')::bigint then '，升至 '||(v_after_growth->>'level')||' 级' else '' end
          || case when jsonb_array_length(v_unlocked)>0 then '，点亮：'||(select string_agg(value, '、') from jsonb_array_elements_text(v_unlocked)) else '' end end,
        'completionId',case when v_type='completeTask' then v_event when v_type='cancelTaskCompletion' then v_done.id end,
        'reward',v_reward,'growthChange',jsonb_build_object('xpDelta',v_delta,'before',v_before_growth,'after',v_after_growth,'unlocked',v_unlocked,'lost',v_lost));
      update public.adventure_events set snapshot=snapshot||jsonb_build_object('result',v_result) where owner_id=p_owner and id=v_event;
      return jsonb_build_object('version',p_revision+1,'result',v_result);
    end;
  elsif v_type='achieveGoal' then
    declare
      p_revision bigint:=v_account.revision; p_now timestamptz:=v_now;
      v_goal public.adventure_goals;
      v_plan jsonb;
      v_reward jsonb;
      v_amount bigint;
      v_event uuid:=gen_random_uuid();
      v_source jsonb;
      v_before jsonb;
      v_after jsonb;
      v_unlocked jsonb;
      v_result jsonb;
    begin
      perform public.adventure_planning_check(p_owner,p_command);
      select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid;
      v_before:=public.adventure_growth(p_owner);
      v_plan:=public.adventure_goal_reward(p_owner,v_goal.id,coalesce((p_command->>'coefficient')::integer,1));
      v_reward:=v_plan->'reward';v_amount:=(v_reward->>'amount')::bigint;
      if (v_before->>'totalXp')::bigint>9007199254740991-v_amount then raise exception 'CAPACITY_REACHED'; end if;
      v_source:=jsonb_build_object('goalId',v_goal.id,'title',v_goal.title,'standards',v_goal.standards,
        'categoryLabel',v_goal.category_label,'actionSources',v_plan->'actionSources',
        'stoppedTasks',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'description',description,'plannedOn',planned_on) order by planned_on,created_at,id),'[]')
          from public.adventure_tasks where owner_id=p_owner and goal_id=v_goal.id and status='pending' and deleted_at is null));
      if octet_length(v_source::text)>900000 then raise exception 'CAPACITY_REACHED'; end if;
      update public.adventure_goals set status='achieved',focused=false,terminated_at=p_now,termination_cause='achieved',
        achieved_at=p_now,achieved_on=(p_now at time zone 'Asia/Shanghai')::date,
        attainment_coefficient=coalesce((p_command->>'coefficient')::integer,1),attainment_reflection=btrim(coalesce(p_command->>'reflection','')),
        attainment_action_count=(v_reward->'calculation'->>'count')::integer,
        attainment_action_ids=array(select value::uuid from jsonb_array_elements_text(v_reward->'calculation'->'actionIds')),
        attainment_snapshot=v_source,updated_at=p_now where owner_id=p_owner and id=v_goal.id;
      insert into public.adventure_events(id,owner_id,event_group_id,kind,entity_type,entity_id,goal_id,
        occurred_at,occurred_on,actor_owner_id,request_id,command_hash,command_type,applied_revision,amount,calculation,snapshot,created_at)
        values(v_event,p_owner,gen_random_uuid(),'goal_achieved','goal',v_goal.id,v_goal.id,p_now,(p_now at time zone 'Asia/Shanghai')::date,
          p_owner,p_request_id,encode(sha256(convert_to(p_command::text,'UTF8')),'hex'),'achieveGoal',p_revision+1,v_amount,v_reward->'calculation',
          v_source||jsonb_build_object('before',to_jsonb(v_goal)-'owner_id','reflection',btrim(coalesce(p_command->>'reflection',''))),p_now);
      update public.adventure_accounts set total_xp=total_xp+v_amount,revision=p_revision+1,updated_at=p_now where owner_id=p_owner;
      if (select total_xp from public.adventure_accounts where owner_id=p_owner) <>
        (select coalesce(sum(amount),0) from public.adventure_events where owner_id=p_owner and kind in ('task_completed','goal_achieved') and invalidated_at is null)
        then raise exception 'INCONSISTENT_REWARDS'; end if;
      v_after:=public.adventure_growth(p_owner);
      select coalesce(jsonb_agg(a->>'label'),'[]') into v_unlocked from jsonb_array_elements(v_after->'achievements') a
        where (a->>'unlocked')::boolean and not exists(select 1 from jsonb_array_elements(v_before->'achievements') b where b->>'id'=a->>'id' and (b->>'unlocked')::boolean);
      v_result:=jsonb_build_object('entityId',v_goal.id,'achievementId',v_event,'reward',v_reward,
        'message','目标已达成，获得 '||v_amount||' 点经验' || case when (v_after->>'level')::bigint>(v_before->>'level')::bigint then '，升至 '||(v_after->>'level')||' 级' else '' end
          || case when jsonb_array_length(v_unlocked)>0 then '，点亮：'||(select string_agg(value,'、') from jsonb_array_elements_text(v_unlocked)) else '' end,
        'growthChange',jsonb_build_object('xpDelta',v_amount,'before',v_before,'after',v_after,'unlocked',v_unlocked,'lost','[]'::jsonb));
      if octet_length(v_result::text)>1000000 then raise exception 'CAPACITY_REACHED'; end if;
      update public.adventure_events set snapshot=snapshot||jsonb_build_object('result',v_result) where owner_id=p_owner and id=v_event;
      return jsonb_build_object('version',p_revision+1,'result',v_result);
    end;
  end if;
  perform public.adventure_planning_check(p_owner,p_command);
  case v_type
    when 'createGoal' then
      select coalesce(max(sort_order),-1)+1 into v_order from public.adventure_goals where owner_id=p_owner and kind='real' and status='active';
      if v_order>9007199254740991 then raise exception 'CAPACITY_REACHED'; end if;
      insert into public.adventure_goals(owner_id,title,standards,category_label,sort_order,created_at,updated_at)
        values(p_owner,btrim(p_command->>'title'),p_command->'standards',nullif(btrim(p_command->>'categoryLabel',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'),''),v_order,v_now,v_now) returning * into v_goal;
      v_kind:='goal_created'; v_after:=to_jsonb(v_goal)-'owner_id';
    when 'editGoal' then
      select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid;
      v_before:=to_jsonb(v_goal)-'owner_id';
      update public.adventure_goals set title=btrim(p_command->>'title'),standards=p_command->'standards',
        category_label=case when p_command ? 'categoryLabel' then nullif(btrim(p_command->>'categoryLabel',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'),'') else category_label end,updated_at=v_now
        where owner_id=p_owner and id=v_goal.id returning * into v_goal;
      v_kind:='goal_updated';v_after:=to_jsonb(v_goal)-'owner_id';
    when 'reorderGoals' then
      select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid;
      v_before:=jsonb_build_object('goalIds',(select jsonb_agg(id order by sort_order,id) from public.adventure_goals where owner_id=p_owner and kind='real' and status='active'));
      with ordered as (
        select id,row_number() over(order by sort_order,id) as ord from public.adventure_goals where owner_id=p_owner and kind='real' and status='active'
      ), source as (select ord from ordered where id=v_goal.id), target as (
        select s.ord old_ord,case when p_command ? 'targetId' then (select ord from ordered where id=(p_command->>'targetId')::uuid)
          when p_command->>'direction'='up' then greatest(s.ord-1,1) else least(s.ord+1,(select max(ord) from ordered)) end new_ord from source s
      ), moved as (
        select o.id,case when o.id=v_goal.id then t.new_ord when t.new_ord<t.old_ord and o.ord>=t.new_ord and o.ord<t.old_ord then o.ord+1
          when t.new_ord>t.old_ord and o.ord<=t.new_ord and o.ord>t.old_ord then o.ord-1 else o.ord end ord from ordered o cross join target t
      ) update public.adventure_goals g set sort_order=m.ord-1,updated_at=v_now from moved m where g.owner_id=p_owner and g.id=m.id;
      v_kind:='goal_reordered';v_after:=jsonb_build_object('goalIds',(select jsonb_agg(id order by sort_order,id) from public.adventure_goals where owner_id=p_owner and kind='real' and status='active'));
  end case;
  v_result:=jsonb_build_object('entityId',v_goal.id,'message',case when v_type='createGoal' then '已创建' else '已保存' end);
  insert into public.adventure_events(owner_id,event_group_id,kind,entity_type,entity_id,goal_id,occurred_at,occurred_on,actor_owner_id,
    request_id,command_hash,command_type,applied_revision,snapshot,created_at)
    values(p_owner,gen_random_uuid(),v_kind,'goal',v_goal.id,v_goal.id,v_now,(v_now at time zone 'Asia/Shanghai')::date,p_owner,
      p_request_id,v_hash,v_type,v_account.revision+1,jsonb_build_object('before',v_before,'after',v_after,'result',v_result),v_now);
  if v_account.total_xp<>(select coalesce(sum(amount),0) from public.adventure_events where owner_id=p_owner and kind in ('task_completed','goal_achieved') and invalidated_at is null) then raise exception 'INCONSISTENT_REWARDS'; end if;
  update public.adventure_accounts set revision=revision+1,updated_at=v_now where owner_id=p_owner;
  return jsonb_build_object('version',v_account.revision+1,'result',v_result);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'INVALID_COMMAND';
end $$;

create or replace function public.adventure_planning_preview(p_owner uuid, p_expected_version bigint, p_command jsonb)
returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '3s' as $$
declare
  v_revision bigint;
  v_has_account boolean;
  v_type text:=p_command->>'type';
  v_recurring boolean:=v_type in ('createRecurringTask','editRecurringTask','recordRecurringCompletion','cancelRecurringCompletion','endRecurringTask','deleteRecurringTask');
  v_before jsonb;
  v_after jsonb;
  v_today date;
  v_done public.adventure_events;
  v_goal public.adventure_goals;
  v_plan jsonb;
  v_count bigint;
  v_preview jsonb;
begin
  if p_owner is null or p_expected_version is null or p_expected_version not between 0 and 9007199254740991
    then raise exception 'INVALID_COMMAND'; end if;
  select revision into v_revision from public.adventure_accounts where owner_id = p_owner for share;
  v_has_account:=found;
  v_revision := coalesce(v_revision,0);
  v_today:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
  if v_recurring then
    if jsonb_typeof(p_command->'today') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
    if (p_command->>'today')::date<>v_today then raise exception 'PLANNING_DATE_CHANGED'; end if;
  end if;
  if v_revision <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if not v_has_account and (
    v_type in ('editGoal','reorderGoals','endGoal','achieveGoal','editTask','completeTask','cancelTaskCompletion','deleteTask',
      'editRecurringTask','recordRecurringCompletion','cancelRecurringCompletion','endRecurringTask','deleteRecurringTask')
    or (v_type in ('createTask','createRecurringTask') and coalesce(p_command->>'destination','')<>'')) then
    raise exception 'NOT_FOUND';
  end if;
  if v_recurring then
    v_plan:=public.adventure_recurring_check(p_owner,p_command,v_today);
    if p_command->>'type' in ('endRecurringTask','deleteRecurringTask') then
      v_plan:=public.adventure_recurring_parent_view(p_owner,(p_command->>'id')::uuid,v_today);
      return jsonb_build_object('version',v_revision,'today',v_today,'allowed',true,'requiresConfirmation',true,'operation',p_command->>'type','entityId',p_command->>'id','title',v_plan->>'title','effectiveChildren',v_plan->'effectiveChildren','completedPeriods',v_plan->'completedPeriods','message','确认后不可恢复，已有完成事实与奖励保留');
    elsif p_command->>'type'='cancelRecurringCompletion' then
      select * into strict v_done from public.adventure_events where owner_id=p_owner and id=(p_command->>'completionId')::uuid;
      return jsonb_build_object('version',v_revision,'today',v_today,'allowed',true,'requiresConfirmation',true,'operation','cancelRecurringCompletion','completionId',v_done.id,'parentId',v_done.recurring_parent_id,'childId',v_done.task_id,'reward',jsonb_build_object('amount',v_done.amount,'calculation',v_done.calculation),'growthBefore',public.adventure_growth(p_owner),'growthAfter',public.adventure_growth(p_owner,-1,-1),'message','撤销使本次行动失效，不恢复为待办');
    end if;
    return jsonb_build_object('version',v_revision,'today',v_today,'allowed',true,'requiresConfirmation',false,'message','保存后更新周期任务');
  end if;
  if p_command->>'type'='endTask' then raise exception 'INVALID_COMMAND'; end if;
  if p_command->>'type' in ('endGoal','deleteTask') then
    if p_command->>'type'='deleteTask' then
      v_preview:=public.adventure_task_impact(p_owner,p_command,v_today)
        || jsonb_build_object('version',v_revision,'today',v_today,'allowed',true,'requiresConfirmation',true,
          'message','删除后任务将从规划中移除，保留历史事实和请求回执，不扣除经验。');
    else
      v_preview:=public.adventure_lifecycle_impact(p_owner,p_command,v_today)
      || jsonb_build_object('version',v_revision,'today',v_today,'allowed',true,'requiresConfirmation',true,
        'message','结束目标后不可恢复；已有完成记录和经验保持不变。');
    end if;
    if octet_length(v_preview::text)>900000 then raise exception 'CAPACITY_REACHED'; end if;
    return v_preview;
  end if;
  if p_command->>'type' in ('rescheduleTask','migrateTask') then raise exception 'INVALID_COMMAND'; end if;
  if p_command->>'type' in ('createTask','editTask','completeTask','cancelTaskCompletion','deleteTask') then
    perform public.adventure_task_check(p_owner,p_command,v_today);
  else perform public.adventure_planning_check(p_owner,p_command); end if;
  if p_command->>'type'='achieveGoal' then
    select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid;
    v_plan:=public.adventure_goal_reward(p_owner,v_goal.id,1);
    v_count:=(v_plan->'reward'->'calculation'->>'count')::bigint;
    v_preview:=jsonb_build_object('version',v_revision,'today',v_today,'allowed',true,'requiresConfirmation',true,'operation','achieveGoal',
      'goalId',v_goal.id,'title',v_goal.title,'standards',v_goal.standards,
      'message','达成后不可撤销，已有成果与任务历史将只读保留。',
      'rewards',(select jsonb_agg(jsonb_build_object('amount',case when v_count=0 then 1 else v_count*c end,
        'calculation',(v_plan->'reward'->'calculation')||jsonb_build_object('coefficient',c)) order by c) from generate_series(1,3) c),
      'stoppingTasks',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'plannedOn',planned_on) order by planned_on,created_at,id),'[]')
        from public.adventure_tasks where owner_id=p_owner and goal_id=v_goal.id and status='pending' and deleted_at is null));
    if octet_length(v_preview::text)>1000000 then raise exception 'CAPACITY_REACHED'; end if;
    return v_preview;
  end if;
  if p_command->>'type'='cancelTaskCompletion' then
    select * into strict v_done from public.adventure_events where owner_id=p_owner and id=(p_command->>'completionId')::uuid;
    v_before:=public.adventure_growth(p_owner);v_after:=public.adventure_growth(p_owner,-v_done.amount,-1);
    return jsonb_build_object('version',v_revision,'today',v_today,
      'allowed',true,'requiresConfirmation',true,'message','取消后移除这次行动和 '||v_done.amount||' 点经验，等级及成就随有效记录更新',
      'reward',jsonb_build_object('amount',v_done.amount,'calculation',v_done.calculation),
      'growthBefore',v_before,'growthAfter',v_after,'completionId',p_command->>'completionId');
  end if;
  return jsonb_build_object('version',v_revision,'today',v_today,
    'allowed',true,'requiresConfirmation',false,'message',case when p_command->>'type'='completeTask' then '可直接完成行动，按实际完成日记录并实时获得 1 点经验' else '保存后更新规划，不改变目标状态或经验' end);
end $$;

create or replace function public.adventure_receipt_safe(j jsonb, shape text)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare k text; v jsonb; allowed text[]; child text; expected_type text; date_year integer; date_month integer; date_day integer; days_in_month integer;
begin
  if jsonb_typeof(j) is distinct from 'object' then return false; end if;
  allowed:=case shape
    when 'result' then array['entityId','message','completionId','achievementId','reward','growthChange','source']
    when 'source' then array['goalId','goalTitle','title','description','plannedOn','occurredOn','categoryLabel','taskKind','parentId','childId','occurredAt','periodType','anchorOn','periodNumber','periodStartOn','periodEndOn','requiredCount']
    when 'reward' then array['amount','calculation']
    when 'calculation' then array['type','completionId','count','coefficient','actionIds','fallback']
    when 'change' then array['xpDelta','before','after','unlocked','lost']
    when 'growth' then array['level','totalXp','progress','needed','remaining','actions','achievedGoals','achievements']
    when 'achievement' then array['id','label','threshold','count','remaining','unlocked']
    else array[]::text[] end;
  if (shape='result' and not (j ?& array['entityId','message']))
    or (shape='reward' and not (j ?& array['amount','calculation']))
    or (shape='calculation' and not (j ?& array['type','count','coefficient']))
    or (shape='change' and not (j ?& array['xpDelta','before','after','unlocked','lost']))
    or (shape='growth' and not (j ?& array['level','totalXp','progress','needed','remaining','actions','achievedGoals']))
    or (shape='achievement' and not (j ?& array['id','label','threshold','count','unlocked'])) then return false; end if;
  for k,v in select key,value from jsonb_each(j) loop
    if not (k=any(allowed)) then return false; end if;
    child:=case when shape='result' and k='reward' then 'reward'
      when shape='result' and k='growthChange' then 'change'
      when shape='result' and k='source' then 'source'
      when shape='reward' and k='calculation' then 'calculation'
      when shape='change' and k in ('before','after') then 'growth' end;
    if child is not null then
      if shape='result' and k='reward' and v='null'::jsonb then continue; end if;
      if not public.adventure_receipt_safe(v,child) then return false; end if;
    elsif shape='growth' and k='achievements' then
      if jsonb_typeof(v) is distinct from 'array' then return false; end if;
      for v in select value from jsonb_array_elements(v) loop
        if not public.adventure_receipt_safe(v,'achievement') then return false; end if;
      end loop;
    elsif (shape='calculation' and k='actionIds') or (shape='change' and k in ('unlocked','lost')) then
      if jsonb_typeof(v) is distinct from 'array' then return false; end if;
      if exists(select 1 from jsonb_array_elements(v) a where jsonb_typeof(a) is distinct from 'string') then return false; end if;
      if shape='calculation' and exists(select 1 from jsonb_array_elements_text(v) a where a !~* '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$') then return false; end if;
    else
      expected_type:=case
        when shape='result' and k in ('entityId','message','completionId','achievementId') then 'string'
        when shape='source' and k in ('periodNumber','requiredCount') then 'number'
        when shape='source' then 'string'
        when shape='reward' and k='amount' then 'number'
        when shape='calculation' and k in ('type','completionId') then 'string'
        when shape='calculation' and k in ('count','coefficient') then 'number'
        when shape='calculation' and k='fallback' then 'boolean'
        when shape='change' and k='xpDelta' then 'number'
        when shape='growth' then 'number'
        when shape='achievement' and k in ('id','label') then 'string'
        when shape='achievement' and k in ('threshold','count','remaining') then 'number'
        when shape='achievement' and k='unlocked' then 'boolean' end;
      if expected_type is null then return false; end if;
      if v='null'::jsonb and ((shape='result' and k='completionId') or (shape='source' and k in ('goalId','goalTitle','categoryLabel'))) then continue; end if;
      if jsonb_typeof(v) is distinct from expected_type then return false; end if;
      if expected_type='number' and (v::text::numeric <> trunc(v::text::numeric) or abs(v::text::numeric)>9007199254740991 or (v::text::numeric<0 and not (shape='change' and k='xpDelta'))) then return false; end if;
      if (shape='result' and k in ('entityId','completionId','achievementId')) or (shape='source' and k in ('goalId','parentId','childId')) or (shape='calculation' and k='completionId') then
        if (v #>> '{}') !~* '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$' then return false; end if;
      elsif shape='source' and k in ('plannedOn','occurredOn','anchorOn','periodStartOn','periodEndOn') then
        -- ISO 8601 includes year 0000; PostgreSQL date casts do not.
        if (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
        date_year:=substring(v #>> '{}' from 1 for 4)::integer;
        date_month:=substring(v #>> '{}' from 6 for 2)::integer;
        date_day:=substring(v #>> '{}' from 9 for 2)::integer;
        if date_month not between 1 and 12 then return false; end if;
        days_in_month:=case when date_month=2 then case when date_year%400=0 or (date_year%4=0 and date_year%100<>0) then 29 else 28 end
          when date_month in (4,6,9,11) then 30 else 31 end;
        if date_day not between 1 and days_in_month then return false; end if;
      end if;
    end if;
  end loop;
  if shape='source' then
    if j ? 'taskKind' and j->>'taskKind' not in ('once','recurring_child') then return false; end if;
    if j ? 'periodType' and j->>'periodType' not in ('week','month','quarter','year') then return false; end if;
    if j ? 'periodNumber' and (j->>'periodNumber')::numeric<1 or j ? 'requiredCount' and (j->>'requiredCount')::numeric<1 then return false; end if;
    if j ? 'occurredAt' then perform (j->>'occurredAt')::timestamptz; end if;
  end if;
  if shape='reward' and (j->>'amount')::numeric <= 0 then return false; end if;
  if shape='growth' and j ? 'achievements' and jsonb_array_length(j->'achievements')>7 then return false; end if;
  if shape='calculation' then
    if j->>'type'='fixed_task' then
      if j-array['type','completionId','count','coefficient']<>'{}'::jsonb
        or not (j ? 'completionId') or (j->>'count')::numeric<=0 or (j->>'coefficient')::numeric<=0 then return false; end if;
    elsif j->>'type'='goal_actions' then
      if j-array['type','actionIds','count','coefficient','fallback']<>'{}'::jsonb
        or not (j ?& array['actionIds','fallback']) or (j->>'coefficient')::numeric not between 1 and 3
        or (j->>'count')::numeric<>jsonb_array_length(j->'actionIds')
        or (j->>'fallback')::boolean<>(jsonb_array_length(j->'actionIds')=0)
        or (select count(distinct lower(value)) from jsonb_array_elements_text(j->'actionIds'))<>jsonb_array_length(j->'actionIds') then return false; end if;
    else return false; end if;
  end if;
  return true;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation or numeric_value_out_of_range then return false;
end $$;

create or replace function public.adventure_reward_view(p_owner uuid,p_event uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select (case when snapshot ? 'recurring' then jsonb_build_object('recurring',snapshot->'recurring') else '{}'::jsonb end)||jsonb_build_object('id',id,'kind',kind,'entityId',entity_id,'title',snapshot->>'title',
    'occurredAt',occurred_at,'occurredOn',occurred_on,'amount',amount,
    'calculation',calculation-'actionIds','categoryLabel',snapshot->'categoryLabel','goalId',goal_id,
    'goalTitle',case when kind='goal_achieved' then snapshot->>'title' else snapshot->>'goalTitle' end)
  from public.adventure_events where owner_id=p_owner and id=p_event
    and kind in ('task_completed','goal_achieved') and invalidated_at is null;
$$;

create or replace function public.adventure_reward_source(p_owner uuid,p_event uuid,p_page integer default 1,p_version bigint default null)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare v_version bigint; e public.adventure_events; v_items jsonb; v_result jsonb;
begin
  if p_owner is null or p_page is null or p_page not between 1 and 1000000 or p_version<0 then raise exception 'INVALID_COMMAND'; end if;
  select revision into v_version from public.adventure_accounts where owner_id=p_owner for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_version is not null and p_version<>coalesce(v_version,0) then raise exception 'VERSION_CONFLICT'; end if;
  select * into e from public.adventure_events where owner_id=p_owner and id=p_event
    and kind in ('task_completed','goal_achieved') and invalidated_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  select coalesce(jsonb_agg((case when s->'source' ? 'recurring' then jsonb_build_object('recurring',s->'source'->'recurring') else '{}'::jsonb end)||jsonb_build_object('taskId',s->>'taskId','completionId',s->>'completionId',
    'goalId',s->>'goalId','occurredOn',s->>'occurredOn',
    'title',s->'source'->>'title','description',s->'source'->>'description','plannedOn',s->'source'->>'plannedOn',
    'categoryLabel',s->'source'->'categoryLabel','goalTitle',s->'source'->>'goalTitle') order by n),'[]'::jsonb)
    into v_items from (select s,n from jsonb_array_elements(coalesce(e.snapshot->'actionSources','[]'::jsonb)) with ordinality a(s,n)
      order by n limit 5 offset (p_page::bigint-1)*5) sources;
  v_result:=jsonb_build_object('version',coalesce(v_version,0),'event',public.adventure_reward_view(p_owner,e.id),
    'description',e.snapshot->>'description','plannedOn',e.snapshot->>'plannedOn',
    'standards',coalesce(e.snapshot->'standards',nullif(e.snapshot->'goalStandards','null'::jsonb),'[]'::jsonb),
    'reflection',e.snapshot->>'reflection','page',p_page,'pageSize',5,
    'totalSources',jsonb_array_length(coalesce(e.snapshot->'actionSources','[]'::jsonb)),'actionSources',v_items);
  if octet_length(v_result::text)>900000 then raise exception 'CAPACITY_REACHED'; end if;
  return v_result;
end $$;

create or replace function public.adventure_goal_reward(p_owner uuid,p_goal uuid,p_coefficient integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_actions jsonb;
  v_sources jsonb;
  v_count bigint;
  v_reward jsonb;
begin
  if p_coefficient is null or p_coefficient not between 1 and 3 then raise exception 'INVALID_COMMAND'; end if;
  select coalesce(jsonb_agg(task_id order by task_id),'[]'),coalesce(jsonb_agg(jsonb_build_object(
    'taskId',task_id,'completionId',id,'goalId',goal_id,'occurredOn',occurred_on,
    'source',snapshot-'result') order by task_id),'[]'),count(*)
    into v_actions,v_sources,v_count from (
      select distinct on(task_id) * from public.adventure_events where owner_id=p_owner and goal_id=p_goal
        and kind='task_completed' and invalidated_at is null order by task_id,occurred_at,id
    ) actions;
  if v_count::numeric*p_coefficient>9007199254740991 then raise exception 'CAPACITY_REACHED'; end if;
  v_reward:=jsonb_build_object('reward',jsonb_build_object('amount',case when v_count=0 then 1 else v_count*p_coefficient end,
    'calculation',jsonb_build_object('type','goal_actions','actionIds',v_actions,'count',v_count,'coefficient',p_coefficient,'fallback',v_count=0)),
    'actionSources',v_sources);
  if octet_length(v_reward::text)>900000 then raise exception 'CAPACITY_REACHED'; end if;
  return v_reward;
end $$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as signature from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'adventure\_%' escape '\' loop
    execute format('revoke execute on function %s from public, anon, authenticated',r.signature);
    execute format('grant execute on function %s to service_role',r.signature);
  end loop;
end $$;
-- Reject unsafe inherited or default grants before exposing the new schema.
do $$
begin
  if exists(select 1 from pg_class c where c.relnamespace='public'::regnamespace and c.relname like 'adventure\_%' escape '\'
    and c.relkind='r' and (not c.relrowsecurity or c.relforcerowsecurity or has_table_privilege('anon',c.oid,'select,insert,update,delete,truncate,references,trigger')
      or has_table_privilege('authenticated',c.oid,'select,insert,update,delete,truncate,references,trigger') or has_table_privilege('service_role',c.oid,'delete,truncate,references,trigger')
      or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl where acl.grantee=0)
      or exists(select 1 from pg_roles role where
        ((pg_has_role('anon',role.oid,'MEMBER') or pg_has_role('authenticated',role.oid,'MEMBER'))
          and (has_table_privilege(role.oid,c.oid,'select,insert,update,delete,truncate,references,trigger')
            or case when current_setting('server_version_num')::integer>=170000 then has_table_privilege(role.oid,c.oid,'maintain') else false end))
        or (pg_has_role('service_role',role.oid,'MEMBER')
          and (has_table_privilege(role.oid,c.oid,'delete,truncate,references,trigger')
            or has_table_privilege(role.oid,c.oid,'select with grant option,insert with grant option,update with grant option')
            or case when current_setting('server_version_num')::integer>=170000 then has_table_privilege(role.oid,c.oid,'maintain') else false end)))
      or exists(select 1 from unnest(array['select','insert','update']) v where not has_table_privilege('service_role',c.oid,v))))
    or exists(select 1 from pg_class c join pg_attribute a on a.attrelid=c.oid where c.relnamespace='public'::regnamespace
      and c.relname like 'adventure\_%' escape '\' and c.relkind='r' and a.attnum>0 and not a.attisdropped
      and (has_column_privilege('anon',c.oid,a.attname,'select,insert,update,references') or has_column_privilege('authenticated',c.oid,a.attname,'select,insert,update,references')
        or has_column_privilege('service_role',c.oid,a.attname,'references')
        or exists(select 1 from aclexplode(a.attacl) acl where acl.grantee=0)
        or exists(select 1 from pg_roles role where
          ((pg_has_role('anon',role.oid,'MEMBER') or pg_has_role('authenticated',role.oid,'MEMBER'))
            and has_column_privilege(role.oid,c.oid,a.attname,'select,insert,update,references'))
          or (pg_has_role('service_role',role.oid,'MEMBER') and
            (has_column_privilege(role.oid,c.oid,a.attname,'references') or has_column_privilege(role.oid,c.oid,a.attname,'select with grant option,insert with grant option,update with grant option'))))))
    or exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'adventure\_%' escape '\'
      and (p.prosecdef or not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) c where c in ('search_path=""','search_path='))
        or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or not has_function_privilege('service_role',p.oid,'execute')
        or exists(select 1 from pg_roles role where (pg_has_role('anon',role.oid,'MEMBER') or pg_has_role('authenticated',role.oid,'MEMBER'))
          and has_function_privilege(role.oid,p.oid,'execute'))
        or exists(select 1 from pg_roles role where pg_has_role('service_role',role.oid,'MEMBER') and has_function_privilege(role.oid,p.oid,'execute with grant option'))))
    or has_schema_privilege('anon','public','create') or has_schema_privilege('authenticated','public','create')
    or exists(select 1 from pg_roles role where (pg_has_role('anon',role.oid,'MEMBER') or pg_has_role('authenticated',role.oid,'MEMBER')
      or pg_has_role('service_role',role.oid,'MEMBER')) and has_schema_privilege(role.oid,'public','create'))
    or not coalesce((select rolbypassrls from pg_roles where rolname='service_role'),false)
    or exists(select 1 from pg_roles role where (pg_has_role('anon',role.oid,'MEMBER') or pg_has_role('authenticated',role.oid,'MEMBER'))
      and (role.rolsuper or role.rolbypassrls or role.rolcreaterole or role.rolcreatedb or role.rolreplication))
    or exists(select 1 from pg_roles role where pg_has_role('service_role',role.oid,'MEMBER')
      and (role.rolsuper or role.rolcreaterole or role.rolcreatedb or role.rolreplication))
    then raise exception 'GOAL_MIGRATION_UNSAFE_SECURITY'; end if;
end $$;

do $$ begin
 if exists(select 1 from public.adventure_recurring_tasks) or
   exists(select 1 from public.adventure_tasks where kind<>'once' or recurring_parent_id is not null) or
   exists(select 1 from public.adventure_events where recurring_parent_id is not null) then raise exception 'RECURRING_UPGRADE_CHANGED_FACTS'; end if;
 if (select count(*) from pg_constraint where conrelid='public.adventure_events'::regclass and conname in ('adventure_event_parent_fk','adventure_event_child_fk'))<>2 then raise exception 'RECURRING_INCOMPLETE_UPGRADE'; end if;
end $$;
notify pgrst,'reload schema';
commit;
