-- 通过 Supabase apply_migration 执行。仅新增独立个人状态表，不修改旧 tasks/schedules。
create table public.adventure_states (
  owner_id uuid primary key,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  journal jsonb not null default '{}'::jsonb check (jsonb_typeof(journal) = 'object'),
  version bigint not null default 0 check (version >= 0 and version <= 9007199254740991),
  updated_at timestamptz not null default now()
);
alter table public.adventure_states enable row level security;
revoke all on public.adventure_states from public, anon, authenticated, service_role;
grant select, insert, update on public.adventure_states to service_role;
comment on table public.adventure_states is '人生冒险账户聚合；仅 Worker verified owner + version CAS；浏览器禁止直接访问';
