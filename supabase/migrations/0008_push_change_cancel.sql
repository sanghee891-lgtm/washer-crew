-- 0008: 예약 변경·취소·삭제도 알림
-- 날짜·시간·주소가 바뀌거나, 취소(또는 취소 해제)되거나, 지워지면 바꾼 사람을 뺀 직원에게 알림.
-- 참여 표시·사진·입금·메모·작업 단계는 알리지 않음(너무 잦음).

create or replace function private.on_reservation_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify_push(jsonb_build_object(
    'type', 'res_change', 'path', new.path,
    'old', jsonb_build_object(
      'date', old.data ->> 'date', 'time', old.data ->> 'time', 'status', old.data ->> 'status',
      'address', old.data #>> '{customer,address}', 'moveTo', old.data #>> '{moveTo,address}')));
  return null;
end $$;
revoke execute on function private.on_reservation_update() from public, anon, authenticated;

create trigger docs_push_change after update on public.docs
  for each row when (
    old.coll = 'reservations' and (
      (old.data ->> 'date') is distinct from (new.data ->> 'date')
      or (old.data ->> 'time') is distinct from (new.data ->> 'time')
      or (coalesce(old.data ->> 'status', '') = 'canceled') <> (coalesce(new.data ->> 'status', '') = 'canceled')
      or (old.data #>> '{customer,address}') is distinct from (new.data #>> '{customer,address}')
      or (old.data #>> '{moveTo,address}') is distinct from (new.data #>> '{moveTo,address}')))
  execute function private.on_reservation_update();

-- 지우면(휴지통으로 옮기면) 알림
create or replace function private.on_reservation_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
declare tp text := 'trash/' || split_part(old.path, '/', 2);
begin
  if old.coll = 'reservations' then
    insert into public.docs (path, data)  -- coll 은 path 에서 자동 계산
    values (tp,
            old.data || jsonb_build_object('deletedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                                           'deletedBy', coalesce(private.my_staff_id(), '')))
    on conflict (path) do update set data = excluded.data, updated_at = now();
    -- 직원이 지운 경우만(5년 지난 기록을 서버가 정리할 때는 알리지 않음)
    if private.my_staff_id() is not null then
      perform private.notify_push(jsonb_build_object('type', 'res_delete', 'path', tp));
    end if;
  end if;
  return old;
end $$;
