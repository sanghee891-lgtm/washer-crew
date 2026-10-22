-- 세탁기 크루: 문서형 저장소(docs) · 직원 계정 · 고객 예약 요청 · 푸시 구독 · 사진 보관함
-- 직원만 장부를 읽고 쓰고, 고객은 submit_booking() 함수로 요청 넣기만 할 수 있습니다.

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- ---------------- 직원 계정 ----------------
-- 로그인 계정(auth.users)과 장부의 직원 번호(config/staff 의 id)를 잇습니다.
create table public.staff_accounts (
  uid uuid primary key references auth.users (id) on delete cascade,
  staff_id text not null unique,
  is_owner boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.staff_accounts enable row level security;

create function private.my_staff_id() returns text
language sql stable security definer set search_path = '' as $$
  select staff_id from public.staff_accounts where uid = auth.uid()
$$;
create function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff_accounts where uid = auth.uid())
$$;
create function private.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select is_owner from public.staff_accounts where uid = auth.uid()), false)
$$;

create policy staff_accounts_read on public.staff_accounts for select to authenticated
  using ((select private.is_staff()));

-- ---------------- 문서형 저장소 ----------------
-- path 예: reservations/abc, config/staff, data/users/<uid>/me, reminders/<예약id>
create table public.docs (
  path text primary key
    check (path ~ '^[A-Za-z0-9_.~:@+-]+(/[A-Za-z0-9_.~:@+-]+)*$'
       and array_length(string_to_array(path, '/'), 1) % 2 = 0),
  coll text generated always as (regexp_replace(path, '/[^/]+$', '')) stored,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);
create index docs_coll_idx on public.docs (coll);
create index docs_res_date_idx on public.docs ((data ->> 'date')) where coll = 'reservations';
create index docs_res_phone_idx on public.docs ((data ->> 'phoneDigits')) where coll = 'reservations';
alter table public.docs enable row level security;

-- data/users/<uid>/... 는 본인만, config/... 쓰기는 사장님만
create function private.can_read(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_staff()
     and (p not like 'data/users/%' or split_part(p, '/', 3) = auth.uid()::text)
$$;
create function private.can_write(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_read(p) and (p not like 'config/%' or private.is_owner())
$$;

create policy docs_read on public.docs for select to authenticated using (private.can_read(path));
create policy docs_insert on public.docs for insert to authenticated with check (private.can_write(path));
create policy docs_update on public.docs for update to authenticated
  using (private.can_write(path)) with check (private.can_write(path));
-- 예약 삭제는 넣은 사람과 사장님만
create policy docs_delete on public.docs for delete to authenticated using (
  private.can_write(path)
  and (coll <> 'reservations' or private.is_owner() or data ->> 'createdBy' = private.my_staff_id())
);

-- 재귀 병합: 객체끼리는 키별로 합치고, 그 밖의 값(배열 포함)은 통째로 교체
create function private.jsonb_merge(a jsonb, b jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; out jsonb;
begin
  if jsonb_typeof(a) is distinct from 'object' or jsonb_typeof(b) is distinct from 'object' then
    return b;
  end if;
  out := a;
  for k, v in select * from jsonb_each(b) loop
    if jsonb_typeof(out -> k) = 'object' and jsonb_typeof(v) = 'object' then
      out := jsonb_set(out, array[k], private.jsonb_merge(out -> k, v));
    else
      out := jsonb_set(out, array[k], v);
    end if;
  end loop;
  return out;
end $$;
grant execute on function private.jsonb_merge(jsonb, jsonb) to authenticated;

-- 문서 일부 수정(중첩 병합). 행 잠금으로 동시에 누른 참여 체크가 서로 덮어쓰지 않음
create function public.docs_merge(p_path text, p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare r jsonb;
begin
  update public.docs set data = private.jsonb_merge(data, p_patch), updated_at = now()
   where path = p_path returning data into r;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return r;
end $$;
revoke execute on function public.docs_merge(text, jsonb) from public, anon;
grant execute on function public.docs_merge(text, jsonb) to authenticated;

-- 로그인 화면의 이름 목록(계정이 있는 직원만)
create function public.login_staff() returns table (id text, name text)
language sql stable security definer set search_path = '' as $$
  select s ->> 'id', s ->> 'name'
    from public.docs d, jsonb_array_elements(d.data -> 'list') with ordinality as e(s, n)
   where d.path = 'config/staff'
     and exists (select 1 from public.staff_accounts a where a.staff_id = s ->> 'id')
   order by e.n
$$;
grant execute on function public.login_staff() to anon, authenticated;

-- ---------------- 고객 예약 요청 ----------------
create table public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'accepted', 'rejected')),
  name text not null check (char_length(name) between 1 and 40),
  phone text not null check (char_length(phone) between 9 and 20),
  phone_digits text not null check (phone_digits ~ '^[0-9]{9,11}$'),
  address text not null check (char_length(address) between 1 and 200),
  move_to text not null default '' check (char_length(move_to) <= 200),
  want_date date not null,
  time_slot text not null default '' check (char_length(time_slot) <= 20),
  items jsonb not null default '[]' check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 5),
  note text not null default '' check (char_length(note) <= 1000),
  handled_by text,
  handled_at timestamptz,
  reservation_id text
);
create index booking_requests_status_idx on public.booking_requests (status, created_at);
create index booking_requests_phone_idx on public.booking_requests (phone_digits, created_at);
alter table public.booking_requests enable row level security;
create policy booking_read on public.booking_requests for select to authenticated using ((select private.is_staff()));
create policy booking_update on public.booking_requests for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

-- 고객 폼 제출(로그인 없이). 숨은 칸(website)에 값이 있으면 저장하지 않고 성공처럼 응답
create function public.submit_booking(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  digits text := regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g');
  d date;
  today date := (now() at time zone 'Asia/Seoul')::date;
  its jsonb := '[]'::jsonb;
  it jsonb;
begin
  if coalesce(p ->> 'website', '') <> '' then return jsonb_build_object('ok', true); end if;
  if char_length(trim(coalesce(p ->> 'name', ''))) = 0 then raise exception 'name' using errcode = '22023'; end if;
  if digits !~ '^01[0-9]{8,9}$' and digits !~ '^0[2-9][0-9]{7,9}$' then raise exception 'phone' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p ->> 'address', ''))) = 0 then raise exception 'address' using errcode = '22023'; end if;
  begin d := (p ->> 'date')::date; exception when others then raise exception 'date' using errcode = '22023'; end;
  if d is null or d < today or d > today + 180 then raise exception 'date' using errcode = '22023'; end if;
  -- 같은 번호는 1분에 1번, 전체는 1분에 20건까지
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
          left(trim(coalesce(p ->> 'moveTo', '')), 200), d, left(coalesce(p ->> 'timeSlot', ''), 20), its,
          left(trim(coalesce(p ->> 'note', '')), 1000));
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.submit_booking(jsonb) from public;
grant execute on function public.submit_booking(jsonb) to anon, authenticated;

-- ---------------- 푸시 구독 ----------------
create table public.push_subscriptions (
  endpoint text primary key,
  uid uuid not null references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security; -- 정책 없음: 아래 함수와 서버만 접근

create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.push_subscriptions (endpoint, uid, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set uid = excluded.uid, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
end $$;
create function public.delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and uid = auth.uid()
$$;
revoke execute on function public.save_push_subscription(text, text, text) from public, anon;
revoke execute on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- ---------------- 사진 보관함 ----------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 20971520, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy photos_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (select private.is_staff()));
create policy photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (select private.is_staff()));
-- 지우기는 올린 사람과 사장님만
create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (select private.is_staff())
         and (owner_id = auth.uid()::text or (select private.is_owner())));

create function public.photo_usage() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when private.is_staff() then jsonb_build_object(
    'files', count(*),
    'bytes', coalesce(sum((metadata ->> 'size')::bigint), 0))
  end
  from storage.objects where bucket_id = 'photos'
$$;
revoke execute on function public.photo_usage() from public, anon;
grant execute on function public.photo_usage() to authenticated;

-- ---------------- 실시간 반영 ----------------
alter publication supabase_realtime add table public.docs, public.booking_requests;
