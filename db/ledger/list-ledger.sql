-- Install after create-ledger.sql. Service-only, owner-scoped date queries.
begin;
drop function public.ledger_list(uuid, integer);
create function public.ledger_list(p_owner uuid, p_page integer default 1, p_start_date date default null, p_end_date date default null, p_version bigint default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v bigint; items jsonb; total bigint; starts timestamptz; ends timestamptz;
begin
  if p_owner is null or p_page is null or p_page < 1 or p_page > 1000000
    or (p_start_date is null) <> (p_end_date is null)
    or p_start_date > p_end_date or not isfinite(p_start_date) or not isfinite(p_end_date)
    or p_start_date < date '0001-01-01' or p_end_date > date '9999-12-31'
    or p_version < 0 or p_version > 9007199254740991 then raise exception 'INVALID_QUERY'; end if;
  starts := p_start_date::timestamp at time zone 'Asia/Shanghai';
  ends := (p_end_date + 1)::timestamp at time zone 'Asia/Shanghai';
  select revision into v from public.ledger_owner_revision where owner_id = p_owner for share;
  if not found then
    if p_version is not null and p_version <> 0 then raise exception 'LIST_CHANGED'; end if;
    return jsonb_build_object('items','[]'::jsonb,'total',0,'page',p_page,'pageSize',30,'version',0);
  end if;
  if p_version is not null and p_version <> v then raise exception 'LIST_CHANGED'; end if;
  select count(*) into total from public.ledger_entries where owner_id = p_owner and deleted_at is null
    and (starts is null or occurred_at >= starts) and (ends is null or occurred_at < ends);
  select coalesce(jsonb_agg(public.ledger_entry_json(e) order by e.occurred_at desc, e.id desc), '[]'::jsonb) into items
    from (select * from public.ledger_entries where owner_id = p_owner and deleted_at is null
      and (starts is null or occurred_at >= starts) and (ends is null or occurred_at < ends)
      order by occurred_at desc, id desc limit 30 offset (p_page::bigint - 1) * 30) e;
  return jsonb_build_object('items',items,'total',total,'page',p_page,'pageSize',30,'version',v);
end $$;
revoke all on function public.ledger_list(uuid,integer,date,date,bigint) from public, anon, authenticated, service_role;
grant execute on function public.ledger_list(uuid,integer,date,date,bigint) to service_role;
notify pgrst, 'reload schema';
commit;
