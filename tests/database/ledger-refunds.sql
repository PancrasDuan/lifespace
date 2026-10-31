-- Synthetic deletion fixtures exercise refund dedup/read boundaries only; no deletion feature is delivered here.
begin;
do $$
declare owner_a uuid := gen_random_uuid(); p jsonb; r1 jsonb; r2 jsonb; request1 uuid := gen_random_uuid(); request2 uuid := gen_random_uuid(); input1 jsonb; input2 jsonb; retry jsonb; v bigint;
begin
  if has_function_privilege('anon','public.ledger_refund(uuid,uuid,jsonb)','EXECUTE') or
    has_function_privilege('authenticated','public.ledger_refund(uuid,uuid,jsonb)','EXECUTE') then raise exception 'REFUND_BROWSER_PERMISSION'; end if;
  p := public.ledger_create(owner_a,jsonb_build_object('requestId',gen_random_uuid(),'direction','expense','amountCents',-10000,'occurredAt','2026-01-02T03:04:05.000Z','accountName','零钱','categoryCode','dining','note',''));
  input1 := jsonb_build_object('requestId',request1,'amountCents',3000,'occurredAt','2026-01-02T03:04:05.000Z','note','');
  input2 := jsonb_build_object('requestId',request2,'amountCents',7000,'occurredAt','2026-01-02T03:04:05.000Z','note','');
  r1 := public.ledger_refund(owner_a,(p->>'entryId')::uuid,input1);
  r2 := public.ledger_refund(owner_a,(p->>'entryId')::uuid,input2);
  retry := public.ledger_refund(owner_a,(p->>'entryId')::uuid,input1);
  if retry <> jsonb_build_object('entryId',r1->>'entryId','version',3,'deleted',false) then raise exception 'FULL_REFUND_RETRY_FAILED'; end if;
  -- Fixture: a refund has already been logically deleted by a future deletion implementation.
  update public.ledger_entries set deleted_at=now() where id=(r2->>'entryId')::uuid;
  update public.ledger_owner_revision set revision=revision+1 where owner_id=owner_a returning revision into v;
  retry := public.ledger_refund(owner_a,(p->>'entryId')::uuid,input2);
  if retry <> jsonb_build_object('entryId',r2->>'entryId','version',v,'deleted',true) then raise exception 'DELETED_REFUND_RECREATED'; end if;
  if public.ledger_detail(owner_a,(p->>'entryId')::uuid)#>>'{entry,status}' <> 'partial-refund' or
    jsonb_array_length(public.ledger_detail(owner_a,(p->>'entryId')::uuid)->'refunds') <> 1 then raise exception 'DELETED_REFUND_COUNTED'; end if;
  if (public.ledger_list(owner_a)->>'total')::int <> 2 then raise exception 'DELETED_REFUND_LISTED'; end if;
  begin perform public.ledger_detail(owner_a,(r2->>'entryId')::uuid); raise exception 'DELETED_REFUND_DETAIL';
  exception when raise_exception then if sqlerrm <> 'NOT_FOUND' then raise; end if; end;
  -- Fixture: parent and remaining child have already been deleted together.
  update public.ledger_entries set deleted_at=now() where owner_id=owner_a and deleted_at is null;
  update public.ledger_owner_revision set revision=revision+1 where owner_id=owner_a returning revision into v;
  retry := public.ledger_refund(owner_a,(p->>'entryId')::uuid,input1);
  if retry <> jsonb_build_object('entryId',r1->>'entryId','version',v,'deleted',true) or
    (public.ledger_list(owner_a)->>'total')::int <> 0 then raise exception 'DELETED_PARENT_RETRY_RECREATED'; end if;
  begin perform public.ledger_refund(owner_a,(p->>'entryId')::uuid,input1 || jsonb_build_object('note','different'));
    raise exception 'DELETED_REUSED_REQUEST_ACCEPTED';
  exception when raise_exception then if sqlerrm <> 'REQUEST_ID_REUSED' then raise; end if; end;
  begin perform public.ledger_refund(owner_a,(p->>'entryId')::uuid,input1 || jsonb_build_object('requestId',gen_random_uuid()));
    raise exception 'DELETED_PARENT_ACCEPTED';
  exception when raise_exception then if sqlerrm <> 'NOT_FOUND' then raise; end if; end;
  if (select revision from public.ledger_owner_revision where owner_id=owner_a) <> v then raise exception 'DEDUP_CHANGED_VERSION'; end if;
end $$;
rollback;
