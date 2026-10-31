-- Supplemental physical retention / immutable-fact probe, isolated transaction only.
begin;
do $$
declare o uuid := gen_random_uuid(); parent jsonb; child jsonb; before_parent jsonb; before_child jsonb; preview jsonb; pid uuid; cid uuid;
begin
  parent := public.ledger_create(o,jsonb_build_object('requestId',gen_random_uuid(),'direction','expense','amountCents',-10000,
    'occurredAt','2026-01-02T03:04:05Z','accountName','保留探针','categoryCode','dining','note','原始事实'));
  pid := (parent->>'entryId')::uuid;
  child := public.ledger_refund(o,pid,jsonb_build_object('requestId',gen_random_uuid(),'amountCents',3000,'occurredAt','2026-01-02T03:04:05Z','note','退款原文'));
  cid := (child->>'entryId')::uuid;
  select to_jsonb(e)-'deleted_at' into before_parent from public.ledger_entries e where id=pid;
  select to_jsonb(e)-'deleted_at' into before_child from public.ledger_entries e where id=cid;
  preview := public.ledger_delete_preview(o,pid);
  perform public.ledger_delete(o,pid,preview->>'scope');
  if (select count(*) from public.ledger_entries where owner_id=o and deleted_at is not null) <> 2 then raise exception 'FACTS_NOT_RETAINED'; end if;
  if (select to_jsonb(e)-'deleted_at' from public.ledger_entries e where id=pid) <> before_parent or
     (select to_jsonb(e)-'deleted_at' from public.ledger_entries e where id=cid) <> before_child then raise exception 'DELETION_CHANGED_ORIGINAL_FACTS'; end if;
  if (select count(distinct deleted_at) from public.ledger_entries where owner_id=o) <> 1 then raise exception 'PARENT_CHILD_DELETED_SEPARATELY'; end if;
  begin update public.ledger_entries set deleted_at=null where id=pid; raise exception 'RESTORE_ALLOWED';
  exception when check_violation then null; end;
  begin delete from public.ledger_entries where id=cid; raise exception 'PHYSICAL_DELETE_ALLOWED';
  exception when check_violation then null; end;
  if (select revision from public.ledger_owner_revision where owner_id=o) <> 3 then raise exception 'DELETE_VERSION_INCREMENT'; end if;
end $$;
rollback;
