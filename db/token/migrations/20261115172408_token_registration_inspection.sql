begin;

create or replace function public.token_registration_inspect(p_owner uuid,p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r token_private.registrations;
begin
  if not token_private.rate('inspect:'||p_owner,60) then return jsonb_build_object('error','TOKEN_RATE_LIMIT'); end if;
  select * into r from token_private.registrations where code=p_code and expires_at>clock_timestamp();
  if not found then return jsonb_build_object('error','TOKEN_NOT_FOUND'); end if;
  return jsonb_build_object('requestId',r.id,'deviceId',r.device_id,'hostname',r.hostname,'platform',r.platform,'status',r.status,'expiresAt',r.expires_at,
    'replacesExisting',exists(select from token_private.devices where device_id=r.device_id),
    'superseded',r.status='claimed' and not exists(select from token_private.devices where device_id=r.device_id and generation=r.generation and enabled));
end $$;

-- CREATE OR REPLACE preserves the existing ACL; restate it for an inspectable boundary.
revoke all on function public.token_registration_inspect(uuid,text) from public,anon,authenticated;
grant execute on function public.token_registration_inspect(uuid,text) to service_role;
commit;
