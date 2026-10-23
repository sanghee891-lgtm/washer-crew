-- 0006: 고객 예약 시간 08:00~20:00, 지운 예약 휴지통(30일), 매일 자동 백업(30일), 직원별 알림 현황

-- ---------------- 1. 고객 예약 시간: 08:00~20:00 (빈칸=상관없음, 예전 오전/오후도 허용) ----------------
create or replace function public.submit_booking(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  digits text := regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g');
  d date;
  today date := (now() at time zone 'Asia/Seoul')::date;
  ts text := trim(coalesce(p ->> 'timeSlot', ''));
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
  insert into public.booking_requests (name, phone, phone_digits, address, move_to, want_date, time_slot, items, note)
  values (left(trim(p ->> 'name'), 40), left(trim(p ->> 'phone'), 20), digits, left(trim(p ->> 'address'), 200),
          left(trim(coalesce(p ->> 'moveTo', '')), 200), d, left(ts, 20), its,
          left(trim(coalesce(p ->> 'note', '')), 1000));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------- 2. 휴지통: 예약을 지우면 trash/<id> 로 옮겨 30일 보관 ----------------
create or replace function private.on_reservation_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.coll = 'reservations' then
    insert into public.docs (path, data)  -- coll 은 path 에서 자동 계산
    values ('trash/' || split_part(old.path, '/', 2),
            old.data || jsonb_build_object('deletedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                                           'deletedBy', coalesce(private.my_staff_id(), '')))
    on conflict (path) do update set data = excluded.data, updated_at = now();
  end if;
  return old;
end $$;
drop trigger if exists docs_trash on public.docs;
create trigger docs_trash before delete on public.docs
  for each row when (old.coll = 'reservations') execute function private.on_reservation_delete();

-- 휴지통 문서는 예약처럼: 넣은 사람·사장님만 지울 수 있음(되살리거나 영구 삭제)
drop policy if exists docs_delete on public.docs;
create policy docs_delete on public.docs for delete to authenticated
  using (private.can_write(path)
         and (coll not in ('reservations', 'trash') or private.is_owner()
              or (data ->> 'createdBy') = private.my_staff_id()));

-- ---------------- 3. 매일 자동 백업(서버 안, 30일 보관) ----------------
create table if not exists private.backups (
  id bigserial primary key,
  taken_at timestamptz not null default now(),
  docs jsonb not null,
  bookings jsonb not null
);
revoke all on private.backups from public, anon, authenticated;

create or replace function private.take_backup() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n_docs int; n_book int;
begin
  insert into private.backups (docs, bookings)
  select coalesce((select jsonb_agg(jsonb_build_object('path', path, 'data', data)) from public.docs where path not like 'data/users/%'), '[]'::jsonb),
         coalesce((select jsonb_agg(to_jsonb(b)) from public.booking_requests b), '[]'::jsonb);
  delete from private.backups where taken_at < now() - interval '30 days';
  select count(*) into n_docs from public.docs where path not like 'data/users/%';
  select count(*) into n_book from public.booking_requests;
  return jsonb_build_object('docs', n_docs, 'bookings', n_book);
end $$;
revoke execute on function private.take_backup() from public, anon, authenticated;

-- 휴지통 30일 지난 것 정리(사진은 사장님 앱이 먼저 지움, 남은 문서는 40일 뒤 서버가 정리)
create or replace function private.purge_trash() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.docs where coll = 'trash' and coalesce(data ->> 'deletedAt', '') < to_char((now() - interval '40 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS');
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function private.purge_trash() from public, anon, authenticated;

-- 매일 18:30 UTC = 03:30 KST
select cron.unschedule(jobid) from cron.job where jobname = 'daily-backup';
select cron.schedule('daily-backup', '30 18 * * *', $$ select private.take_backup(); select private.purge_trash(); $$);

-- 사장님: 지금 장부 전체를 파일로 받기
create or replace function public.export_backup() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_owner() then raise exception 'owner_only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'app', 'washer-crew',
    'taken_at', now(),
    'docs', coalesce((select jsonb_agg(jsonb_build_object('path', path, 'data', data) order by path) from public.docs where path not like 'data/users/%'), '[]'::jsonb),
    'bookings', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at) from public.booking_requests b), '[]'::jsonb),
    'auto_backups', coalesce((select jsonb_agg(taken_at order by taken_at desc) from private.backups), '[]'::jsonb));
end $$;
revoke execute on function public.export_backup() from public, anon;
grant execute on function public.export_backup() to authenticated;

-- ---------------- 4. 사장님: 직원별 알림 켜짐 현황 ----------------
create or replace function public.push_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when private.is_owner() then coalesce((
    select jsonb_agg(jsonb_build_object('staff_id', a.staff_id, 'devices',
             (select count(*) from public.push_subscriptions s where s.uid = a.uid),
             'last', (select max(created_at) from public.push_subscriptions s where s.uid = a.uid)))
      from public.staff_accounts a), '[]'::jsonb) end
$$;
revoke execute on function public.push_status() from public, anon;
grant execute on function public.push_status() to authenticated;

-- 첫 백업 바로 하나 만들어 둠
select private.take_backup();

-- ---------------- 5. 보안 정리: 밖에서 부를 필요 없는 함수 닫기 ----------------
-- rls_auto_enable 은 새 표에 RLS를 켜는 이벤트 트리거 전용(직접 부를 일 없음)
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- ---------------- 6. 로그인 화면 직원 이름 보호: 가게 코드 6자리 ----------------
-- 가게 코드를 맞게 넣은 기기에만 직원 이름 목록을 보여 줌(기기에 기억). 틀린 시도는 IP별로 10분에 10번까지.
create table if not exists private.settings (key text primary key, value text not null);
revoke all on private.settings from public, anon, authenticated;
insert into private.settings (key, value)
values ('shop_code', lpad((100000 + floor(random() * 899999))::int::text, 6, '0'))
on conflict (key) do nothing;

create table if not exists private.code_fails (ip text not null, at timestamptz not null default now());
create index if not exists code_fails_ip_at on private.code_fails (ip, at);
revoke all on private.code_fails from public, anon, authenticated;

create or replace function private.client_ip() returns text
language sql stable set search_path = '' as $$
  select coalesce(split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1), 'unknown')
$$;

create or replace function public.login_staff_roles(p_code text)
returns table(id text, name text, is_owner boolean)
language plpgsql security definer set search_path = '' as $$
declare v_ip text := private.client_ip();
begin
  if (select count(*) from private.code_fails f where f.ip = v_ip and f.at > now() - interval '10 minutes') >= 10 then
    raise exception 'too_many' using errcode = '22023';
  end if;
  if coalesce(p_code, '') <> (select st.value from private.settings st where st.key = 'shop_code') then
    -- 오류를 내면 실패 기록도 되돌려지므로, 기록만 남기고 빈 목록을 돌려줌(앱은 '코드가 맞지 않아요')
    insert into private.code_fails (ip) values (v_ip);
    delete from private.code_fails where at < now() - interval '1 day';
    return;
  end if;
  return query
    select s ->> 'id', s ->> 'name', a.is_owner
      from public.docs d, jsonb_array_elements(d.data -> 'list') with ordinality as e(s, n)
      join public.staff_accounts a on a.staff_id = s ->> 'id'
     where d.path = 'config/staff'
     order by a.is_owner desc, e.n;
end $$;
revoke execute on function public.login_staff_roles(text) from public;
grant execute on function public.login_staff_roles(text) to anon, authenticated;

-- 코드 없이 이름을 주던 예전 함수는 로그인한 직원만
revoke execute on function public.login_staff() from public, anon;
revoke execute on function public.login_staff_roles() from public, anon;

-- 사장님: 가게 코드 보기·바꾸기
create or replace function public.shop_code() returns text
language sql stable security definer set search_path = '' as $$
  select case when private.is_owner() then (select value from private.settings where key = 'shop_code') end
$$;
revoke execute on function public.shop_code() from public, anon;
grant execute on function public.shop_code() to authenticated;

create or replace function public.set_shop_code(p_code text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_owner() then raise exception 'owner_only' using errcode = '42501'; end if;
  if p_code !~ '^[0-9]{6}$' then raise exception 'bad_code' using errcode = '22023'; end if;
  update private.settings set value = p_code where key = 'shop_code';
end $$;
revoke execute on function public.set_shop_code(text) from public, anon;
grant execute on function public.set_shop_code(text) to authenticated;

-- ---------------- 7. 서버 깨우기: 무료 서버가 7일 쉬면 일시정지되므로 매일 GitHub이 이 함수를 부름 ----------------
-- 실제 표를 한 번 읽어 데이터베이스 활동으로 남김(내용은 돌려주지 않음)
create or replace function public.keepalive() returns boolean
language sql security definer set search_path = '' as $$
  select (select count(*) from public.docs) >= 0
$$;
revoke execute on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
