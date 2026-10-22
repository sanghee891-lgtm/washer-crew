-- 권한 규칙 점검: 실제 DB에서 역할을 바꿔 가며 시험하고, 결과를 오류 메시지로 돌려준 뒤 모두 되돌립니다.
-- 실행: Supabase SQL 편집기(또는 MCP execute_sql)에 붙여넣기. 마지막 줄의 "RESULT {...}" 를 확인합니다.
do $$
declare
  r jsonb := '{}';
  staff uuid; owner uuid; n int;
  claims text;
begin
  select uid into staff from public.staff_accounts where staff_id = 'smvivcjg01';
  select uid into owner from public.staff_accounts where staff_id = 'smvivcjg03';
  insert into public.docs(path, data) values
    ('reservations/rls_mine', '{"createdBy":"smvivcjg01","date":"2099-01-01"}'),
    ('reservations/rls_other', '{"createdBy":"smvivcjg04","date":"2099-01-01"}'),
    ('data/users/' || owner || '/me', '{"staffId":"smvivcjg03"}')
  on conflict (path) do update set data = excluded.data;

  -- 고객(로그인 안 함)
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  select count(*) into n from public.docs; r := r || jsonb_build_object('anon_docs_rows', n);
  begin insert into public.docs(path, data) values ('reservations/x', '{}'); r := r || '{"anon_docs_insert":"ALLOWED"}';
  exception when others then r := r || jsonb_build_object('anon_docs_insert', 'blocked ' || sqlstate); end;
  begin select count(*) into n from public.booking_requests; r := r || jsonb_build_object('anon_booking_rows', n);
  exception when others then r := r || jsonb_build_object('anon_booking_rows', 'blocked ' || sqlstate); end;
  begin select count(*) into n from public.push_subscriptions; r := r || jsonb_build_object('anon_push_rows', n);
  exception when others then r := r || jsonb_build_object('anon_push_rows', 'blocked ' || sqlstate); end;
  begin perform public.docs_merge('config/staff', '{"x":1}'); r := r || '{"anon_merge":"ALLOWED"}';
  exception when others then r := r || jsonb_build_object('anon_merge', 'blocked ' || sqlstate); end;
  begin perform public.push_config(); r := r || '{"anon_push_config":"ALLOWED"}';
  exception when others then r := r || jsonb_build_object('anon_push_config', 'blocked ' || sqlstate); end;
  select count(*) into n from storage.objects where bucket_id = 'photos'; r := r || jsonb_build_object('anon_photo_rows', n);
  select count(*) into n from public.login_staff(); r := r || jsonb_build_object('anon_login_names', n);
  begin perform public.submit_booking('{"name":"점검","phone":"010-0000-0000","address":"서울","date":"2099-01-01"}');
    r := r || '{"anon_far_date":"ALLOWED"}';
  exception when others then r := r || jsonb_build_object('anon_far_date', 'blocked ' || sqlerrm); end;
  perform public.submit_booking(jsonb_build_object('name', '점검', 'phone', '010-0000-0000', 'address', '서울',
    'date', ((now() at time zone 'Asia/Seoul')::date + 1)::text));
  r := r || '{"anon_submit":"ok"}';
  begin perform public.submit_booking(jsonb_build_object('name', '점검', 'phone', '010-0000-0000', 'address', '서울',
    'date', ((now() at time zone 'Asia/Seoul')::date + 1)::text)); r := r || '{"anon_submit_again":"ALLOWED"}';
  exception when others then r := r || jsonb_build_object('anon_submit_again', 'blocked ' || sqlerrm); end;
  reset role;

  -- 일반 직원(박상연)
  claims := json_build_object('sub', staff, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', claims, true);
  set local role authenticated;
  select count(*) into n from public.docs where coll = 'reservations'; r := r || jsonb_build_object('staff_res_rows', n);
  select count(*) into n from public.docs where path like 'data/users/%'; r := r || jsonb_build_object('staff_sees_others_private', n);
  select count(*) into n from public.booking_requests; r := r || jsonb_build_object('staff_booking_rows', n);
  perform public.docs_merge('reservations/rls_other', '{"workers":{"smvivcjg01":true}}');
  perform public.docs_merge('reservations/rls_other', '{"workers":{"smvivcjg02":"maybe"}}');
  select (data -> 'workers')::text into claims from public.docs where path = 'reservations/rls_other';
  r := r || jsonb_build_object('staff_merge_result', claims);
  begin perform public.docs_merge('config/staff', '{"x":1}'); r := r || '{"staff_edit_config":"ALLOWED"}';
  exception when others then r := r || jsonb_build_object('staff_edit_config', 'blocked ' || sqlstate); end;
  delete from public.docs where path = 'reservations/rls_other'; get diagnostics n = row_count;
  r := r || jsonb_build_object('staff_delete_others_res', n);
  delete from public.docs where path = 'reservations/rls_mine'; get diagnostics n = row_count;
  r := r || jsonb_build_object('staff_delete_own_res', n);
  begin perform public.push_config(); r := r || '{"staff_push_config":"ALLOWED"}';
  exception when others then r := r || jsonb_build_object('staff_push_config', 'blocked ' || sqlstate); end;
  reset role;

  -- 사장님(신창민)
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.docs where path = 'reservations/rls_other'; get diagnostics n = row_count;
  r := r || jsonb_build_object('owner_delete_others_res', n);
  select count(*) into n from public.docs where path like 'data/users/%'; r := r || jsonb_build_object('owner_sees_own_private', n);
  reset role;

  raise exception 'RESULT %', r;
end $$;
