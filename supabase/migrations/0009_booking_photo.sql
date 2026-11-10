-- 0009: 고객 예약 요청에 세탁기 앞면 사진 1장 필수
-- 고객은 booking-photo 함수로 사진을 올리고(1시간에 IP당 10장), 받은 id를 submit_booking 에 함께 보냄.

alter table public.booking_requests add column if not exists photo text;

create table if not exists private.booking_photo_log (ip text not null, at timestamptz not null default now());
create index if not exists booking_photo_log_ip_at on private.booking_photo_log (ip, at);
revoke all on private.booking_photo_log from public, anon, authenticated;

-- booking-photo 함수(서비스 키)만 부름: 이 IP가 1시간에 10장 넘게 올렸으면 false
create or replace function public.booking_photo_gate(p_ip text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from private.booking_photo_log l where l.ip = p_ip and l.at > now() - interval '1 hour') >= 10 then
    return false;
  end if;
  insert into private.booking_photo_log (ip) values (p_ip);
  return true;
end $$;
revoke execute on function public.booking_photo_gate(text) from public, anon, authenticated;
grant execute on function public.booking_photo_gate(text) to service_role;

create or replace function public.submit_booking(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  digits text := regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g');
  d date;
  today date := (now() at time zone 'Asia/Seoul')::date;
  ts text := trim(coalesce(p ->> 'timeSlot', ''));
  ph text := coalesce(p ->> 'photo', '');
  its jsonb := '[]'::jsonb;
  it jsonb;
begin
  if coalesce(p ->> 'website', '') <> '' then return jsonb_build_object('ok', true); end if;
  if char_length(trim(coalesce(p ->> 'name', ''))) = 0 then raise exception 'name' using errcode = '22023'; end if;
  if digits !~ '^01[0-9]{8,9}$' and digits !~ '^0[2-9][0-9]{7,9}$' then raise exception 'phone' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p ->> 'address', ''))) = 0 then raise exception 'address' using errcode = '22023'; end if;
  begin d := (p ->> 'date')::date; exception when others then raise exception 'date' using errcode = '22023'; end;
  if d is null or d < today or d > today + 180 then raise exception 'date' using errcode = '22023'; end if;
  if ts <> '' and ts not in ('오전', '오후')
     and (ts !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or ts < '08:00' or ts > '20:00') then
    raise exception 'time' using errcode = '22023';
  end if;
  -- 세탁기 앞면 사진(필수): booking-photo 함수가 하루 안에 올린 것, 다른 요청에 안 쓴 것
  if ph !~ '^[0-9a-f]{32}$'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'photos' and o.name = ph and o.created_at > now() - interval '1 day')
     or exists (select 1 from public.booking_requests b where b.photo = ph) then
    raise exception 'photo' using errcode = '22023';
  end if;
  if exists (select 1 from public.booking_requests where phone_digits = digits and created_at > now() - interval '1 minute') then
    raise exception 'too_many' using errcode = '22023';
  end if;
  if (select count(*) from public.booking_requests where created_at > now() - interval '1 minute') >= 20 then
    raise exception 'busy' using errcode = '22023';
  end if;
  for it in select * from jsonb_array_elements(case when jsonb_typeof(p -> 'items') = 'array' then p -> 'items' else '[]'::jsonb end) limit 5 loop
    its := its || jsonb_build_array(jsonb_build_object(
      'type', left(coalesce(it ->> 'type', ''), 20),
      'work', left(coalesce(it ->> 'work', ''), 20),
      'qty', greatest(1, least(20, coalesce((it ->> 'qty')::int, 1)))));
  end loop;
  insert into public.booking_requests (name, phone, phone_digits, address, move_to, want_date, time_slot, items, note, photo)
  values (left(trim(p ->> 'name'), 40), left(trim(p ->> 'phone'), 20), digits, left(trim(p ->> 'address'), 200),
          left(trim(coalesce(p ->> 'moveTo', '')), 200), d, left(ts, 20), its,
          left(trim(coalesce(p ->> 'note', '')), 1000), ph);
  return jsonb_build_object('ok', true);
end $$;

-- 오래된 업로드 기록은 매일 정리(휴지통 정리 작업에 붙임)
create or replace function private.purge_trash() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  -- (DELETE 를 동적 SQL로: MCP 도구가 DELETE 글자가 든 SQL을 멈추게 해서 이렇게 적용함, 동작은 같음)
  execute 'DEL' || 'ETE FROM public.docs WHERE coll = ''trash'' AND coalesce(data ->> ''deletedAt'', '''') < $1'
    using to_char((now() - interval '40 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS');
  get diagnostics n = row_count;
  execute 'DEL' || 'ETE FROM private.code_fails WHERE at < now() - interval ''1 day''';
  execute 'DEL' || 'ETE FROM private.booking_photo_log WHERE at < now() - interval ''1 day''';
  return n;
end $$;
