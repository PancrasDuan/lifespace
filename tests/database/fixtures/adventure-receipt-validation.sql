-- Test-only receipt corruption fixtures, shared with the existing goal-model HTTP regressions.
create function pg_temp.unsafe_receipt_fixture() returns trigger language plpgsql as $$
    begin
      if new.kind='task_created' and new.snapshot->>'title'='unsafe-receipt-fixture' and new.snapshot ? 'result' then
        new.snapshot := new.snapshot - 'result';
      elsif new.kind='task_created' and new.snapshot->>'title' in ('unsafe-cn-fixture','unsafe-en-fixture') and new.snapshot ? 'result' then
        new.snapshot := jsonb_set(new.snapshot,'{result}',new.snapshot->'result' || '{"unknownSource":{"alias":"retired"}}'::jsonb);
      elsif new.kind='task_created' and new.snapshot->>'title' like 'boundary-fresh-%' and new.snapshot ? 'result' then
        new.snapshot := jsonb_set(new.snapshot,'{result}',new.snapshot->'result' || jsonb_build_object('source',case new.snapshot->>'title'
          when 'boundary-fresh-0' then jsonb_build_object('goalId','FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF')
          when 'boundary-fresh-1' then jsonb_build_object('goalId','AAAAAAAA-AAAA-4AAA-AAAA-AAAAAAAAAAAA')
          when 'boundary-fresh-2' then jsonb_build_object('goalId','aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa')
          when 'boundary-fresh-3' then jsonb_build_object('goalId','00000000-0000-0000-0000-000000000000')
          when 'boundary-fresh-4' then jsonb_build_object('goalId','ffffffff-ffff-ffff-ffff-ffffffffffff')
          when 'boundary-fresh-5' then jsonb_build_object('plannedOn','0000-01-01')
          when 'boundary-fresh-6' then jsonb_build_object('plannedOn','0001-01-01')
          when 'boundary-fresh-7' then jsonb_build_object('occurredOn','9999-12-31')
          when 'boundary-fresh-8' then jsonb_build_object('plannedOn','0000-02-29')
          when 'boundary-fresh-9' then jsonb_build_object('plannedOn','1900-02-29')
          when 'boundary-fresh-10' then jsonb_build_object('plannedOn','2000-02-29')
          else jsonb_build_object('goalId','not-a-uuid') end));
      end if;
      return new;
    end $$;
    create trigger unsafe_receipt_fixture before update on public.adventure_events
      for each row execute function pg_temp.unsafe_receipt_fixture();
