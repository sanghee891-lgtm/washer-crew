-- 0007: 알림 함수 호출 대기 시간 8초 → 30초 (함수가 처음 깨어날 때 6~9초 걸려 8초로는 시간 초과가 기록됨)
create or replace function private.notify_push(payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://ncsxszunxdetpwqnkjhq.supabase.co/functions/v1/push',
    body := payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_hook_secret')),
    timeout_milliseconds := 30000);
end $$;
