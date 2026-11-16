-- #209 additive Token backend; apply as one transaction. No production operation is performed by tests.
begin;
-- Token schema v1 validators and canonical bytes. Internal helpers never grant API access.
create schema token_private;
revoke all on schema token_private from public, anon, authenticated, service_role;

create function token_private.require(ok boolean) returns void language plpgsql immutable set search_path='' as $$
begin if ok is distinct from true then raise exception 'TOKEN_INVALID' using errcode='22023'; end if; end $$;
-- JS string limits count UTF-16 code units rather than Unicode scalar values.
create function token_private.string_length(v text) returns integer language sql immutable strict set search_path='' as $$
  select coalesce(sum(case when ascii(ch)>65535 then 2 else 1 end),0)::integer from regexp_split_to_table(v,'') ch where ch<>''
$$;
create function token_private.object(v jsonb, allowed text[], required text[]) returns void language plpgsql immutable set search_path='' as $$
begin
  perform token_private.require(jsonb_typeof(v)='object');
  perform token_private.require(not exists(select from jsonb_object_keys(v) k where not k=any(allowed)) and v ?& required);
end $$;
create function token_private.metrics(v jsonb) returns void language plpgsql immutable set search_path='' as $$
declare k text; n jsonb;
begin
  perform token_private.object(v,array['input','output','total','cacheRead','cacheWrite','reasoning'],array[]::text[]);
  for k,n in select * from jsonb_each(v) loop
    perform token_private.require(n='null' or (jsonb_typeof(n)='number' and n::numeric between 0 and 9007199254740991 and trunc(n::numeric)=n::numeric));
  end loop;
  if jsonb_typeof(v->'input')='number' and jsonb_typeof(v->'output')='number' and jsonb_typeof(v->'total')='number' then
    perform token_private.require((v->>'total')::numeric=(v->>'input')::numeric+(v->>'output')::numeric);
  end if;
  foreach k in array array['cacheRead','cacheWrite','reasoning'] loop
    if jsonb_typeof(v->k)='number' and jsonb_typeof(v->case when k='reasoning' then 'output' else 'input' end)='number' then
      perform token_private.require((v->>k)::numeric <= (v->>case when k='reasoning' then 'output' else 'input' end)::numeric);
    end if;
  end loop;
end $$;
create function token_private.cost(v jsonb) returns void language plpgsql immutable set search_path='' as $$
declare k text; known boolean:=false; unknown boolean:=false;
begin
  perform token_private.object(v,array['currency','actual','apiEstimate','unclassified','coverage'],array['currency','coverage']);
  perform token_private.require(jsonb_typeof(v->'currency')='string' and v->>'currency' ~ '^[A-Z]{3}$');
  perform token_private.require(v->>'coverage'=any(array['complete','partial','unverified','unknown']));
  foreach k in array array['actual','apiEstimate','unclassified'] loop
    if v ? k then
      if v->k='null' then unknown:=true;
      else
        perform token_private.require(jsonb_typeof(v->k)='string' and token_private.string_length(v->>k)<=400 and v->>k ~ '^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$');
        known:=true;
      end if;
    end if;
  end loop;
  perform token_private.require(case when v->>'coverage'='unknown' then not known else known end and not (v->>'coverage'='complete' and unknown));
end $$;
create function token_private.money(n numeric) returns text language sql immutable set search_path='' as $$
  select case when strpos(n::text,'.')>0 then rtrim(rtrim(n::text,'0'),'.') else n::text end
$$;
create function token_private.sum_cost(items jsonb, currency text) returns jsonb language plpgsql immutable set search_path='' as $$
declare r jsonb:=jsonb_build_object('currency',currency); k text; n numeric; has_known boolean:=false; cov text;
begin
  foreach k in array array['actual','apiEstimate','unclassified'] loop
    select sum((i->'cost'->>k)::numeric) into n from jsonb_array_elements(items) i where jsonb_typeof(i->'cost'->k)='string';
    if n is not null then
      if token_private.string_length(token_private.money(n))>400 then raise exception 'TOKEN_TOTAL_OVERFLOW' using errcode='22023'; end if;
      r:=r||jsonb_build_object(k,token_private.money(n)); has_known:=true;
    elsif exists(select from jsonb_array_elements(items) i where i->'cost'->k='null') then r:=r||jsonb_build_object(k,null); end if;
  end loop;
  cov:=case when not has_known then 'unknown'
    when exists(select from jsonb_array_elements(items) i where i->'cost'->>'coverage' in ('partial','unknown')) then 'partial'
    when exists(select from jsonb_array_elements(items) i where i->'cost'->>'coverage'='unverified') then 'unverified' else 'complete' end;
  return r||jsonb_build_object('coverage',cov);
end $$;
create function token_private.sum_metrics(items jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb:='{}'; k text; n numeric;
begin
  foreach k in array array['input','output','total','cacheRead','cacheWrite','reasoning'] loop
    if exists(select from jsonb_array_elements(items) item where not (item->'metrics' ? k)) then continue;
    elsif exists(select from jsonb_array_elements(items) item where item->'metrics'->k='null') then result:=result||jsonb_build_object(k,null);
    else
      select coalesce(sum((item->'metrics'->>k)::numeric),0) into n from jsonb_array_elements(items) item;
      if n>9007199254740991 then raise exception 'TOKEN_TOTAL_OVERFLOW' using errcode='22023'; end if;
      result:=result||jsonb_build_object(k,n);
    end if;
  end loop;
  return result;
end $$;
create function token_private.content(v jsonb) returns void language plpgsql immutable set search_path='' as $$
declare model_item jsonb; k text; items jsonb;
begin
  perform token_private.object(v,array['metrics','cost','models'],array['metrics','cost','models']);
  perform token_private.metrics(v->'metrics'); perform token_private.cost(v->'cost');
  perform token_private.object(v->'models',array['coverage','items'],array['coverage','items']);
  items:=v->'models'->'items';
  perform token_private.require(v->'models'->>'coverage' in ('complete','partial','missing') and jsonb_typeof(items)='array');
  -- Bounded transport, not a different meaning for model identity.
  perform token_private.require(jsonb_array_length(items)<=500 and (v->'models'->>'coverage'<>'missing' or jsonb_array_length(items)=0));
  for model_item in select * from jsonb_array_elements(items) loop
    perform token_private.object(model_item,array['modelId','providerId','metrics','cost'],array['modelId','providerId','metrics','cost']);
    foreach k in array array['modelId','providerId'] loop
      perform token_private.require(model_item->k='null' or (jsonb_typeof(model_item->k)='string' and token_private.string_length(model_item->>k) between 1 and 200));
    end loop;
    perform token_private.metrics(model_item->'metrics'); perform token_private.cost(model_item->'cost');
    perform token_private.require(model_item->'cost'->'currency'=v->'cost'->'currency');
  end loop;
  perform token_private.require(not exists(select from jsonb_array_elements(items) i group by i->'modelId' having count(*)>1));
  if v->'models'->>'coverage'='complete' then
    perform token_private.require(v->'metrics'=token_private.sum_metrics(items));
    perform token_private.require(v->'cost'=token_private.sum_cost(items,v->'cost'->>'currency'));
  end if;
end $$;
-- PostgreSQL collations sort Unicode scalar values; JS compares UTF-16 code units.
create function token_private.utf16(v text) returns bytea language plpgsql immutable strict set search_path='' as $$
declare r bytea:=''::bytea; n integer; c text;
begin
  for c in select regexp_split_to_table(v,'') loop
    n:=ascii(c);
    if n<=65535 then r:=r||decode(lpad(to_hex(n),4,'0'),'hex');
    else n:=n-65536; r:=r||decode(lpad(to_hex(55296+n/1024),4,'0')||lpad(to_hex(56320+n%1024),4,'0'),'hex'); end if;
  end loop;
  return r;
end $$;
create function token_private.canonical(v jsonb, models boolean default false) returns text language plpgsql immutable set search_path='' as $$
declare r text;
begin
  case jsonb_typeof(v)
    when 'object' then
      select '{'||coalesce(string_agg(to_json(k)::text||':'||token_private.canonical(n,k='items'),',' order by token_private.utf16(k)),'')||'}' into r from jsonb_each(v) e(k,n);
    when 'array' then
      if models then
        select '['||coalesce(string_agg(token_private.canonical(n),',' order by token_private.utf16(token_private.canonical(n->'modelId'))),'')||']' into r from jsonb_array_elements(v) n;
      else
        select '['||coalesce(string_agg(token_private.canonical(n),',' order by ord),'')||']' into r from jsonb_array_elements(v) with ordinality e(n,ord);
      end if;
    when 'number' then r:=trunc(v::numeric)::text;
    else r:=v::text;
  end case;
  return r;
end $$;
create extension if not exists pgcrypto with schema extensions;
create table token_private.devices (
  device_id text primary key check(device_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  hostname text not null check(token_private.string_length(hostname) between 1 and 253), platform text not null check(platform in ('macos','linux')),
  owner_id uuid not null, enabled boolean not null default true,
  generation bigint not null check(generation>0), token_hash bytea not null unique,
  created_at timestamptz not null default clock_timestamp(), bound_at timestamptz not null default clock_timestamp(),
  last_received_at timestamptz, sync_hours integer not null default 1 check(sync_hours in (1,3,6,8,12,24))
);
create table token_private.registrations (
  id uuid primary key, code text not null unique check(code ~ '^[A-Z2-9]{8}$'),
  claim_hash bytea not null, token_hash bytea not null,
  device_id text not null check(device_id ~ '^[A-Za-z0-9_-]{1,128}$'), hostname text not null check(token_private.string_length(hostname) between 1 and 253),
  platform text not null check(platform in ('macos','linux')), status text not null default 'pending' check(status in ('pending','approved','denied','claimed')),
  created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default clock_timestamp()+interval '10 minutes',
  polled_at timestamptz, owner_id uuid, generation bigint, replace_existing boolean not null default false
);
create table token_private.rate_limits (key text primary key, started_at timestamptz not null, count integer not null);
create table token_private.rollups (
  device_id text not null references token_private.devices, date date not null, agent text not null,
  generation bigint not null, revision numeric(40,0) not null check(revision>0), content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
  metrics jsonb not null, cost jsonb not null, model_coverage text not null, metadata jsonb not null,
  content_updated_at timestamptz not null default clock_timestamp(), received_at timestamptz not null default clock_timestamp(),
  primary key(device_id,date,agent)
);
create index token_rollups_date on token_private.rollups(date,agent,device_id);
create table token_private.models (
  device_id text not null, date date not null, agent text not null, model_key text not null, item jsonb not null,
  primary key(device_id,date,agent,model_key), foreign key(device_id,date,agent) references token_private.rollups on delete cascade
);
create index token_models_key on token_private.models(model_key,date);
alter table token_private.devices enable row level security;
alter table token_private.registrations enable row level security;
alter table token_private.rollups enable row level security;
alter table token_private.models enable row level security;
alter table token_private.rate_limits enable row level security;
revoke all on all tables in schema token_private from public,anon,authenticated,service_role;

create function token_private.rate(k text, maximum integer) returns boolean language plpgsql set search_path='' as $$
declare n integer;
begin
  insert into token_private.rate_limits values(k,clock_timestamp(),1)
  on conflict(key) do update set count=case when token_private.rate_limits.started_at<clock_timestamp()-interval '1 hour' then 1 else token_private.rate_limits.count+1 end,
    started_at=case when token_private.rate_limits.started_at<clock_timestamp()-interval '1 hour' then clock_timestamp() else token_private.rate_limits.started_at end
  returning count into n;
  return n<=maximum;
end $$;
-- Privileged Worker only. Inputs contain digests only.
create function public.token_registration_start(p_id uuid,p_code text,p_claim_hash text,p_token_hash text,p_device text,p_hostname text,p_platform text,p_ip_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform token_private.require(p_claim_hash ~ '^[a-f0-9]{64}$' and p_token_hash ~ '^[a-f0-9]{64}$' and p_ip_hash ~ '^[a-f0-9]{64}$');
  if not token_private.rate('start:'||p_ip_hash,10) then return jsonb_build_object('error','TOKEN_RATE_LIMIT'); end if;
  -- Erase expired registration claims after their bounded validity; no report history.
  perform pg_advisory_xact_lock(hashtextextended(p_device,209));
  delete from token_private.registrations where id in (select id from token_private.registrations where expires_at<clock_timestamp() for update skip locked);
  delete from token_private.rate_limits where key in (select key from token_private.rate_limits where started_at<clock_timestamp()-interval '2 hours' for update skip locked);
  if (select count(*) from token_private.registrations where device_id=p_device and status='pending')>=3 then return jsonb_build_object('error','TOKEN_RATE_LIMIT'); end if;
  insert into token_private.registrations(id,code,claim_hash,token_hash,device_id,hostname,platform)
    values(p_id,p_code,decode(p_claim_hash,'hex'),decode(p_token_hash,'hex'),p_device,p_hostname,p_platform);
  return jsonb_build_object('requestId',p_id,'expiresIn',600,'interval',5);
end $$;
create function public.token_registration_inspect(p_owner uuid,p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r token_private.registrations;
begin
  if not token_private.rate('inspect:'||p_owner,60) then return jsonb_build_object('error','TOKEN_RATE_LIMIT'); end if;
  select * into r from token_private.registrations where code=p_code and expires_at>clock_timestamp();
  if not found then return jsonb_build_object('error','TOKEN_NOT_FOUND'); end if;
  return jsonb_build_object('requestId',r.id,'deviceId',r.device_id,'hostname',r.hostname,'platform',r.platform,'status',r.status,'expiresAt',r.expires_at,
    'replacesExisting',exists(select from token_private.devices where device_id=r.device_id));
end $$;
create function public.token_registration_decide(p_owner uuid,p_id uuid,p_code text,p_approve boolean,p_replace boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare r token_private.registrations;
begin
  select * into r from token_private.registrations where id=p_id and code=p_code for update;
  if not found or r.expires_at<=clock_timestamp() then return jsonb_build_object('error','TOKEN_NOT_FOUND'); end if;
  if r.status<>'pending' then return jsonb_build_object('error','TOKEN_STATE_CONFLICT'); end if;
  if p_approve and not p_replace and exists(select from token_private.devices where device_id=r.device_id) then return jsonb_build_object('error','TOKEN_REBIND_REQUIRED'); end if;
  update token_private.registrations set status=case when p_approve then 'approved' else 'denied' end, owner_id=p_owner,replace_existing=p_replace where id=p_id;
  return jsonb_build_object('status',case when p_approve then 'approved' else 'denied' end);
end $$;
create function public.token_registration_claim(p_id uuid,p_claim_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r token_private.registrations; d token_private.devices;
begin
  select * into r from token_private.registrations where id=p_id and claim_hash=decode(p_claim_hash,'hex');
  if not found then return jsonb_build_object('error','TOKEN_NOT_FOUND'); end if;
  perform pg_advisory_xact_lock(hashtextextended(r.device_id,209));
  select * into r from token_private.registrations where id=p_id and claim_hash=decode(p_claim_hash,'hex') for update;
  if not found then return jsonb_build_object('error','TOKEN_NOT_FOUND'); end if;
  if r.expires_at<=clock_timestamp() then return jsonb_build_object('status','expired'); end if;
  if r.polled_at>clock_timestamp()-interval '5 seconds' then return jsonb_build_object('status','slow_down','interval',5); end if;
  update token_private.registrations set polled_at=clock_timestamp() where id=p_id;
  if r.status in ('pending','denied') then return jsonb_build_object('status',r.status); end if;
  -- The device lock also serializes uploads and revocation.
  select * into d from token_private.devices where device_id=r.device_id for update;
  if r.status='claimed' then
    if not found or not d.enabled or d.generation<>r.generation or d.token_hash<>r.token_hash then return jsonb_build_object('status','superseded'); end if;
  else
    if d.device_id is not null and not r.replace_existing then return jsonb_build_object('error','TOKEN_REBIND_REQUIRED'); end if;
    insert into token_private.devices(device_id,hostname,platform,owner_id,generation,token_hash)
    values(r.device_id,r.hostname,r.platform,r.owner_id,coalesce(d.generation,0)+1,r.token_hash)
    on conflict(device_id) do update set hostname=excluded.hostname,platform=excluded.platform,owner_id=excluded.owner_id,
      generation=excluded.generation,token_hash=excluded.token_hash,enabled=true,bound_at=clock_timestamp(),last_received_at=null
    returning * into d;
    update token_private.registrations set status='claimed',generation=d.generation where id=p_id;
  end if;
  return jsonb_build_object('status','claimed','deviceId',r.device_id,'generation',d.generation::text,'tokenExpiresAt',null);
end $$;
create function public.token_device_disable(p_device text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_device,209));
  update token_private.devices set enabled=false where device_id=p_device;
  if not found then return jsonb_build_object('error','TOKEN_NOT_FOUND'); end if;
  update token_private.registrations set status='denied' where device_id=p_device and status in ('pending','approved');
  return jsonb_build_object('disabled',true,'deviceId',p_device);
end $$;
create function token_private.authenticate(p_device text,p_generation text) returns token_private.devices language plpgsql set search_path='' as $$
declare d token_private.devices; t text;
begin
  if p_generation is null or p_generation !~ '^[1-9][0-9]{0,18}$' then raise exception 'TOKEN_CREDENTIAL_INVALID' using errcode='28000'; end if;
  t:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-lifespace-device-token','');
  if t !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'TOKEN_CREDENTIAL_INVALID' using errcode='28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_device,209));
  select * into d from token_private.devices where device_id=p_device for update;
  if not found or not d.enabled or d.generation::text is distinct from p_generation or d.token_hash<>extensions.digest(t,'sha256') then
    raise exception 'TOKEN_CREDENTIAL_INVALID' using errcode='28000';
  end if;
  return d;
end $$;
create function token_private.snapshot(v jsonb) returns void language plpgsql immutable set search_path='' as $$
declare i jsonb:=v->'identity'; m jsonb:=v->'metadata'; d date;
begin
  perform token_private.object(v,array['identity','content','metadata'],array['identity','content','metadata']);
  perform token_private.object(i,array['deviceId','date','agent'],array['deviceId','date','agent']);
  perform token_private.require(jsonb_typeof(i->'deviceId')='string' and i->>'deviceId' ~ '^[A-Za-z0-9_-]{1,128}$');
  perform token_private.require(jsonb_typeof(i->'date')='string' and i->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
  d:=(i->>'date')::date;
  perform token_private.require(d between date '0001-01-01' and date '9999-12-31');
  perform token_private.require(jsonb_typeof(i->'agent')='string' and i->>'agent' ~ '^[a-z][a-z0-9_-]{0,63}$');
  perform token_private.object(m,array['schemaVersion','statisticsVersion','tool','priceVersion','hostname','scannedAt','snapshotVersion'],array['schemaVersion','statisticsVersion','tool','priceVersion','scannedAt','snapshotVersion']);
  perform token_private.require(m->'schemaVersion'='1'::jsonb);
  perform token_private.require(jsonb_typeof(m->'statisticsVersion')='string' and token_private.string_length(m->>'statisticsVersion') between 1 and 100);
  perform token_private.object(m->'tool',array['name','version'],array['name','version']);
  perform token_private.require(m->'tool'->>'name'='tokscale' and jsonb_typeof(m->'tool'->'version')='string' and token_private.string_length(m->'tool'->>'version') between 1 and 40);
  perform token_private.require(m->'priceVersion'='null' or (jsonb_typeof(m->'priceVersion')='string' and token_private.string_length(m->>'priceVersion')<=200));
  if m ? 'hostname' then perform token_private.require(jsonb_typeof(m->'hostname')='string' and token_private.string_length(m->>'hostname') between 1 and 253); end if;
  perform token_private.require(jsonb_typeof(m->'snapshotVersion')='string' and m->>'snapshotVersion' ~ '^[1-9][0-9]{0,39}$');
  perform token_private.require(jsonb_typeof(m->'scannedAt')='string' and m->>'scannedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$');
  perform token_private.require(substring(m->>'scannedAt',12,2)::integer<=23 and substring(m->>'scannedAt',15,2)::integer<=59 and substring(m->>'scannedAt',18,2)::integer<=59);
  perform (substring(m->>'scannedAt',1,10))::date;
  perform (m->>'scannedAt')::timestamptz;
  perform token_private.content(v->'content');
end $$;
-- Deliberately SECURITY DEFINER: anon can only reach these two wrappers; custom
-- token authentication, row locking and all writes happen in the same transaction.
create function public.token_usage_upload(p_generation text,p_snapshot jsonb,p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d token_private.devices; r token_private.rollups; i jsonb:=p_snapshot->'identity'; c jsonb:=p_snapshot->'content';
  rev numeric; changed boolean; result text; now_at timestamptz;
begin
  perform token_private.require(octet_length(p_snapshot::text)<=1048576 and p_hash ~ '^[a-f0-9]{64}$');
  d:=token_private.authenticate(i->>'deviceId',p_generation);
  now_at:=clock_timestamp();
  perform token_private.snapshot(p_snapshot);
  if encode(extensions.digest(convert_to(token_private.canonical(c),'UTF8'),'sha256'),'hex')<>p_hash then raise exception 'TOKEN_HASH_MISMATCH' using errcode='22023'; end if;
  rev:=(p_snapshot->'metadata'->>'snapshotVersion')::numeric;
  select * into r from token_private.rollups where device_id=d.device_id and date=(i->>'date')::date and agent=i->>'agent' for update;
  if found and (r.generation>d.generation or (r.generation=d.generation and r.revision>rev)) then
    raise exception 'TOKEN_STALE_VERSION' using errcode='22023';
  end if;
  if r.generation=d.generation and r.revision=rev and r.content_hash<>p_hash then raise exception 'TOKEN_VERSION_CONFLICT' using errcode='22023'; end if;
  changed:=r.content_hash is distinct from p_hash;
  result:=case when r.generation=d.generation and r.revision=rev then 'duplicate' when changed then 'replaced' else 'unchanged' end;
  if r.device_id is null then
    insert into token_private.rollups(device_id,date,agent,generation,revision,content_hash,metrics,cost,model_coverage,metadata,received_at,content_updated_at)
      values(d.device_id,(i->>'date')::date,i->>'agent',d.generation,rev,p_hash,c->'metrics',c->'cost',c->'models'->>'coverage',p_snapshot->'metadata',now_at,now_at);
  elsif changed then
    update token_private.rollups set generation=d.generation,revision=rev,content_hash=p_hash,metrics=c->'metrics',cost=c->'cost',model_coverage=c->'models'->>'coverage',
      metadata=p_snapshot->'metadata',received_at=now_at,content_updated_at=now_at
      where device_id=d.device_id and date=(i->>'date')::date and agent=i->>'agent';
  else
    update token_private.rollups set generation=d.generation,revision=rev,metadata=p_snapshot->'metadata',received_at=now_at
      where device_id=d.device_id and date=(i->>'date')::date and agent=i->>'agent';
  end if;
  if changed then
    delete from token_private.models where device_id=d.device_id and date=(i->>'date')::date and agent=i->>'agent';
    insert into token_private.models select d.device_id,(i->>'date')::date,i->>'agent',token_private.canonical(item->'modelId'),item from jsonb_array_elements(c->'models'->'items') item;
  end if;
  update token_private.devices set last_received_at=now_at,hostname=coalesce(p_snapshot->'metadata'->>'hostname',hostname) where device_id=d.device_id;
  return jsonb_build_object('persisted',true,'deviceId',d.device_id,'date',i->>'date','agent',i->>'agent','generation',d.generation::text,
    'snapshotVersion',rev::text,'contentHash',p_hash,'result',result,'receivedAt',now_at);
end $$;
create function public.token_usage_heartbeat(p_device text,p_generation text,p_hostname text,p_sync_hours integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare d token_private.devices; t timestamptz;
begin
  d:=token_private.authenticate(p_device,p_generation);
  t:=clock_timestamp();
  perform token_private.require(token_private.string_length(p_hostname) between 1 and 253 and p_sync_hours in (1,3,6,8,12,24));
  update token_private.devices set last_received_at=t,hostname=p_hostname,sync_hours=p_sync_hours where device_id=p_device;
  return jsonb_build_object('persisted',true,'deviceId',p_device,'generation',d.generation::text,'receivedAt',t);
end $$;
-- Worker service role only: admission is checked online before this shared read.
create function public.token_dashboard_query(p_query jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare start_on date; end_on date; after_key text; page_rows jsonb; next_key text; lim integer:=250;
begin
  perform token_private.object(p_query,array['startDate','endDate','agent','deviceId','modelKey','after'],array['startDate','endDate']);
  start_on:=(p_query->>'startDate')::date; end_on:=(p_query->>'endDate')::date;
  perform token_private.require(start_on<=end_on and end_on-start_on<=366 and start_on>=date '0001-01-01' and end_on<=date '9999-12-31');
  if p_query ? 'agent' then perform token_private.require(p_query->>'agent' ~ '^[a-z][a-z0-9_-]{0,63}$'); end if;
  if p_query ? 'deviceId' then perform token_private.require(p_query->>'deviceId' ~ '^[A-Za-z0-9_-]{1,128}$'); end if;
  if p_query ? 'modelKey' then perform token_private.require(token_private.string_length(p_query->>'modelKey')<=1202); end if;
  after_key:=p_query->>'after';
  perform token_private.require(after_key is null or token_private.string_length(after_key)<=210);
  with selected as (
    select r.*,r.date::text||'/'||r.device_id||'/'||r.agent as key from token_private.rollups r
    where r.date between start_on and end_on and (not(p_query ? 'agent') or r.agent=p_query->>'agent') and (not(p_query ? 'deviceId') or r.device_id=p_query->>'deviceId')
      and (after_key is null or (r.date::text||'/'||r.device_id||'/'||r.agent) collate "C">after_key collate "C")
      and (not(p_query ? 'modelKey') or exists(select from token_private.models m where (m.device_id,m.date,m.agent)=(r.device_id,r.date,r.agent) and m.model_key=p_query->>'modelKey'))
    order by (r.date::text||'/'||r.device_id||'/'||r.agent) collate "C" limit lim+1
  ), rendered as (select r.key,jsonb_build_object('deviceId',r.device_id,'date',r.date,'agent',r.agent,'generation',r.generation::text,'snapshotVersion',r.revision::text,'contentHash',r.content_hash,
    'metrics',case when p_query ? 'modelKey' then (select m.item->'metrics' from token_private.models m where (m.device_id,m.date,m.agent)=(r.device_id,r.date,r.agent) and m.model_key=p_query->>'modelKey') else r.metrics end,
    'cost',case when p_query ? 'modelKey' then (select m.item->'cost' from token_private.models m where (m.device_id,m.date,m.agent)=(r.device_id,r.date,r.agent) and m.model_key=p_query->>'modelKey') else r.cost end,
    'modelCoverage',r.model_coverage,'models',(select coalesce(jsonb_agg(m.item order by token_private.utf16(m.model_key)),'[]'::jsonb) from token_private.models m where (m.device_id,m.date,m.agent)=(r.device_id,r.date,r.agent) and (not(p_query ? 'modelKey') or m.model_key=p_query->>'modelKey')),
    'receivedAt',r.received_at) data from selected r),
  sized as (select *,sum(octet_length(data::text)) over(order by key collate "C") bytes,row_number() over(order by key collate "C") n from rendered),
  page as (select * from sized where n<=lim and bytes<=4194304)
  select coalesce((select jsonb_agg(data order by key collate "C") from page),'[]'::jsonb),
    case when (select count(*) from selected)>(select count(*) from page) then (select key from page order by key collate "C" desc limit 1) else null end
    into page_rows,next_key;
  return jsonb_build_object('rows',page_rows,'nextCursor',next_key,'timeZone','Asia/Shanghai','scope',case when p_query ? 'modelKey' then 'model' else 'main' end);
end $$;
create function public.token_devices_query(p_after text default '') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; cursor text;
begin
  perform token_private.require(token_private.string_length(p_after)<=128);
  with selected as (select * from token_private.devices where device_id collate "C">p_after collate "C" order by device_id collate "C" limit 101),
  page as (select * from selected order by device_id collate "C" limit 100)
  select coalesce((select jsonb_agg(jsonb_build_object('deviceId',device_id,'hostname',hostname,'platform',platform,'enabled',enabled,'generation',generation::text,
      'lastReceivedAt',last_received_at,'syncHours',sync_hours,'overdue',enabled and (last_received_at is null or last_received_at<now()-make_interval(hours=>sync_hours*2))) order by device_id collate "C") from page),'[]'::jsonb),
    case when (select count(*) from selected)>100 then (select device_id from page order by device_id collate "C" desc limit 1) else null end into rows,cursor;
  return jsonb_build_object('devices',rows,'nextCursor',cursor,'serverTime',now());
end $$;
create function token_private.summary(items jsonb) returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('metrics',token_private.sum_metrics(items),'costs',coalesce((
    select jsonb_agg(token_private.sum_cost(entries,currency) order by currency collate "C")
    from (select i->'cost'->>'currency' currency,jsonb_agg(i) entries from jsonb_array_elements(items) i group by i->'cost'->>'currency') grouped
  ),'[]'::jsonb))
$$;
create function public.token_dashboard_summary(p_query jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare start_on date; end_on date; result jsonb;
begin
  perform token_private.object(p_query,array['startDate','endDate','agent','deviceId','modelKey'],array['startDate','endDate']);
  start_on:=(p_query->>'startDate')::date; end_on:=(p_query->>'endDate')::date;
  perform token_private.require(start_on<=end_on and end_on-start_on<=366 and start_on>=date '0001-01-01' and end_on<=date '9999-12-31');
  if (select count(*) from (
    select from token_private.rollups r where r.date between start_on and end_on
      and (not(p_query ? 'agent') or r.agent=p_query->>'agent') and (not(p_query ? 'deviceId') or r.device_id=p_query->>'deviceId')
      and (not(p_query ? 'modelKey') or exists(select from token_private.models m where (m.device_id,m.date,m.agent)=(r.device_id,r.date,r.agent) and m.model_key=p_query->>'modelKey'))
    limit 100001
  ) bounded)>100000 then raise exception 'TOKEN_QUERY_TOO_BROAD' using errcode='22023'; end if;
  with selected as materialized (
    select r.device_id,r.date,r.agent,
      case when p_query ? 'modelKey' then m.item->'metrics' else r.metrics end metrics,
      case when p_query ? 'modelKey' then m.item->'cost' else r.cost end cost
    from token_private.rollups r left join token_private.models m on (m.device_id,m.date,m.agent)=(r.device_id,r.date,r.agent) and m.model_key=p_query->>'modelKey'
    where r.date between start_on and end_on and (not(p_query ? 'agent') or r.agent=p_query->>'agent') and (not(p_query ? 'deviceId') or r.device_id=p_query->>'deviceId')
      and (not(p_query ? 'modelKey') or m.model_key is not null)
  ), daily as (
    select date,token_private.summary(jsonb_agg(jsonb_build_object('metrics',metrics,'cost',cost))) data from selected group by date
  ), models as (
    select m.model_key,m.item->'modelId' model_id,token_private.summary(jsonb_agg(m.item)) data
    from selected r join token_private.models m on (m.device_id,m.date,m.agent)=(r.device_id,r.date,r.agent)
    where not(p_query ? 'modelKey') or m.model_key=p_query->>'modelKey' group by m.model_key,m.item->'modelId'
  ) select jsonb_build_object('timeZone','Asia/Shanghai','scope',case when p_query ? 'modelKey' then 'model' else 'main' end,'rowCount',(select count(*) from selected),
    'totals',token_private.summary(coalesce((select jsonb_agg(jsonb_build_object('metrics',metrics,'cost',cost)) from selected),'[]'::jsonb)),
    'daily',coalesce((select jsonb_agg(jsonb_build_object('date',date)||data order by date) from daily),'[]'::jsonb),
    'models',coalesce((select jsonb_agg(jsonb_build_object('modelId',model_id)||data order by token_private.utf16(model_key)) from models),'[]'::jsonb)) into result;
  if octet_length(result::text)>4194304 then raise exception 'TOKEN_QUERY_TOO_BROAD' using errcode='22023'; end if;
  return result;
end $$;
revoke all on function public.token_dashboard_summary(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.token_dashboard_summary(jsonb) to service_role;
revoke all on all functions in schema token_private from public,anon,authenticated,service_role;
revoke all on function public.token_registration_start(uuid,text,text,text,text,text,text,text),public.token_registration_inspect(uuid,text),public.token_registration_decide(uuid,uuid,text,boolean,boolean),public.token_registration_claim(uuid,text),public.token_device_disable(text),public.token_dashboard_query(jsonb),public.token_devices_query(text),public.token_usage_upload(text,jsonb,text),public.token_usage_heartbeat(text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.token_registration_start(uuid,text,text,text,text,text,text,text),public.token_registration_inspect(uuid,text),public.token_registration_decide(uuid,uuid,text,boolean,boolean),public.token_registration_claim(uuid,text),public.token_device_disable(text),public.token_dashboard_query(jsonb),public.token_devices_query(text) to service_role;
grant execute on function public.token_usage_upload(text,jsonb,text),public.token_usage_heartbeat(text,text,text,integer) to anon;

commit;
