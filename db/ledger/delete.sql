-- Install after create-ledger.sql, list-ledger.sql and refunds.sql.
begin;
-- A fixed-size fingerprint of the exact target + sorted active child IDs. Neither
-- unrelated owner revisions nor a same-size replacement can substitute for it.
create function public.ledger_delete_scope(p_owner uuid, p_id uuid) returns table(scope text, refund_count bigint)
language sql stable set search_path = pg_catalog, public as $$
  select encode(sha256(convert_to(p_owner::text || ':' || string_agg(id::text, ',' order by id), 'UTF8')), 'hex'), count(*) - 1
    from (select p_id as id union all select id from public.ledger_entries
      where owner_id = p_owner and parent_entry_id = p_id and deleted_at is null) affected;
$$;
create function public.ledger_delete_preview(p_owner uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v bigint; entry public.ledger_entries; impact record;
begin
  select revision into v from public.ledger_owner_revision where owner_id = p_owner for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into entry from public.ledger_entries where owner_id = p_owner and id = p_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into impact from public.ledger_delete_scope(p_owner, p_id);
  return jsonb_build_object('entry',public.ledger_entry_json(entry),'refundCount',impact.refund_count,'scope',impact.scope,'version',v);
end $$;
create function public.ledger_delete(p_owner uuid, p_id uuid, p_scope text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v bigint; entry public.ledger_entries; impact record;
begin
  if p_owner is null or p_id is null or p_scope is null or p_scope !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_ENTRY'; end if;
  select revision into v from public.ledger_owner_revision where owner_id = p_owner for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into entry from public.ledger_entries where owner_id = p_owner and id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if entry.deleted_at is not null then return jsonb_build_object('entryId',p_id,'version',v,'deleted',true); end if;
  select * into impact from public.ledger_delete_scope(p_owner, p_id);
  if impact.scope <> p_scope then raise exception 'DELETE_SCOPE_CHANGED'; end if;
  update public.ledger_entries set deleted_at = now() where owner_id = p_owner and id = p_id;
  update public.ledger_entries set deleted_at = now() where owner_id = p_owner and parent_entry_id = p_id and deleted_at is null;
  update public.ledger_owner_revision set revision = revision + 1, updated_at = now() where owner_id = p_owner returning revision into v;
  return jsonb_build_object('entryId',p_id,'version',v,'deleted',true);
end $$;
revoke all on function public.ledger_delete_scope(uuid,uuid), public.ledger_delete_preview(uuid,uuid), public.ledger_delete(uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.ledger_delete_preview(uuid,uuid), public.ledger_delete(uuid,uuid,text) to service_role;
notify pgrst, 'reload schema';
commit;
