-- Historical account-entries/transfers stage, before #126; synthetic fixture only.
do $$
declare o uuid := '12000000-0000-4000-8000-000000000001';
  p uuid := '12000000-0000-4000-8000-000000000002';
  c uuid := '12000000-0000-4000-8000-000000000003'; id uuid; account uuid;
begin
  if public.ledger_list(o)->>'total' <> '0' or public.ledger_accounts_list(o)->'accounts' <> '[]'::jsonb then
    raise exception 'UNASSIGNED_VISIBLE'; end if;
  foreach id in array array[p,c] loop
    begin perform public.ledger_detail(o,id); raise exception 'UNASSIGNED_DETAIL';
      exception when raise_exception then if sqlerrm <> 'NOT_FOUND' then raise; end if; end;
    begin perform public.ledger_delete_preview(o,id); raise exception 'UNASSIGNED_PREVIEW';
      exception when raise_exception then if sqlerrm <> 'NOT_FOUND' then raise; end if; end;
    begin perform public.ledger_delete(o,id,repeat('0',64)); raise exception 'UNASSIGNED_DELETE';
      exception when raise_exception then if sqlerrm <> 'NOT_FOUND' then raise; end if; end;
    begin perform public.ledger_refund(o,id,jsonb_build_object('requestId',gen_random_uuid(),'amountCents',1,'occurredAt','2025-01-03T00:00:00Z','note','')); raise exception 'UNASSIGNED_REFUND';
      exception when raise_exception then if sqlerrm <> 'NOT_FOUND' then raise; end if; end;
  end loop;
  account := (public.ledger_account_create(o,jsonb_build_object('requestId',gen_random_uuid(),'name','历史合成账户','balanceCents',0))->>'accountId')::uuid;
  begin perform public.ledger_create(o,jsonb_build_object('requestId','12000000-0000-4000-8000-000000000004','direction','expense','amountCents',-100,'occurredAt','2025-01-02T03:04:05Z','accountId',account,'categoryCode','dining','note',''));
    raise exception 'UNASSIGNED_RETRY'; exception when raise_exception then if sqlerrm <> 'NOT_FOUND' then raise; end if; end;
  begin perform public.ledger_refund(o,p,jsonb_build_object('requestId','12000000-0000-4000-8000-000000000005','amountCents',3000,'occurredAt','2025-01-03T00:00:00Z','note','旧退款'));
    raise exception 'UNASSIGNED_REFUND_RETRY'; exception when raise_exception then if sqlerrm <> 'NOT_FOUND' then raise; end if; end;
end $$;
