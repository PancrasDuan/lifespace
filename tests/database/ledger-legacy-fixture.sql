-- Synthetic pre-upgrade facts. Their ownership remains unresolved after upgrade.
insert into public.ledger_owner_revision(owner_id,revision) values ('12000000-0000-4000-8000-000000000001',2);
insert into public.ledger_entries(id,owner_id,request_id,direction,amount_cents,occurred_at,account_name,category_code,note,parent_entry_id) values
('12000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000004','expense',-10000,'2025-01-02T03:04:05Z','旧名称保留','dining','旧支出',null),
('12000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000005','income',3000,'2025-01-03T00:00:00Z','旧名称保留','dining','旧退款','12000000-0000-4000-8000-000000000002');
