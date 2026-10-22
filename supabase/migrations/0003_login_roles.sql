-- 로그인 화면에 "사장님 / 직원"을 표시하려고, 사장님을 맨 위에 두고 is_owner 를 함께 주는 이름 목록.
-- 예전 login_staff() 는 이미 열려 있는 화면을 위해 남겨 둡니다.
create or replace function public.login_staff_roles() returns table (id text, name text, is_owner boolean)
language sql stable security definer set search_path = '' as $$
  select s ->> 'id', s ->> 'name', a.is_owner
    from public.docs d, jsonb_array_elements(d.data -> 'list') with ordinality as e(s, n)
    join public.staff_accounts a on a.staff_id = s ->> 'id'
   where d.path = 'config/staff'
   order by a.is_owner desc, e.n
$$;
grant execute on function public.login_staff_roles() to anon, authenticated;
