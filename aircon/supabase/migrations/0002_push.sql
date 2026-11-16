-- 푸시 알림: 새 예약·새 고객 요청·매일 18:00(KST) 내일 예약 확인 알림
-- 비밀값(vapid_public, vapid_private, push_hook_secret)은 Vault에 따로 넣습니다(저장소에 올리지 않음).

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- Edge Function(push, staff-admin)이 서비스 키로 읽는 설정
create function public.push_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_object_agg(name, decrypted_secret)
    from vault.decrypted_secrets
   where name in ('vapid_public', 'vapid_private', 'push_hook_secret')
$$;
revoke execute on function public.push_config() from public, anon, authenticated;
grant execute on function public.push_config() to service_role;

create function private.notify_push(payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://ncsxszunxdetpwqnkjhq.supabase.co/functions/v1/push',
    body := payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_hook_secret')),
    timeout_milliseconds := 8000);
end $$;
revoke execute on function private.notify_push(jsonb) from public, authenticated;

create function private.on_reservation_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.coll = 'reservations' then
    perform private.notify_push(jsonb_build_object('type', 'reservation', 'path', new.path));
  end if;
  return null;
end $$;
create trigger docs_push after insert on public.docs
  for each row execute function private.on_reservation_insert();

create function private.on_booking_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify_push(jsonb_build_object('type', 'booking', 'id', new.id));
  return null;
end $$;
create trigger booking_push after insert on public.booking_requests
  for each row execute function private.on_booking_insert();

-- 매일 09:00 UTC = 18:00 KST
select cron.schedule('daily-reminder', '0 9 * * *', $$ select private.notify_push('{"type":"daily"}'::jsonb) $$);
