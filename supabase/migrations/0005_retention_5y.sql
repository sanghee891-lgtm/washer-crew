-- 작업한 예약의 고객 정보(이름·연락처·주소·요청사항) 보관 기간을 1년 → 5년으로(사장님 결정).
-- 금액·결제·기기·직원 같은 결산 기록은 기간과 상관없이 계속 남습니다.
create or replace function private.purge_personal_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
  n_req int; n_res int; n_rem int;
begin
  delete from public.booking_requests
   where (status <> 'accepted' and created_at < now() - interval '30 days')
      or created_at < now() - interval '1 year';
  get diagnostics n_req = row_count;

  update public.docs
     set data = data
       || jsonb_build_object('customer', jsonb_build_object('name', '', 'phone', '', 'address', ''),
                             'phoneDigits', '', 'note', '', 'anonymized', true)
       || jsonb_build_object('moveTo', coalesce(data -> 'moveTo', '{}'::jsonb) || jsonb_build_object('address', ''))
       || jsonb_build_object('site', coalesce(data -> 'site', '{}'::jsonb) || jsonb_build_object('memo', '')),
         updated_at = now()
   where coll = 'reservations'
     and coalesce(data ->> 'anonymized', '') <> 'true'
     and ((data ->> 'status' = 'canceled' and data ->> 'date' < (today - 30)::text)
          or data ->> 'date' < (today - interval '5 years')::date::text);
  get diagnostics n_res = row_count;

  delete from public.docs where coll = 'reminders' and data ->> 'date' < (today - 30)::text;
  get diagnostics n_rem = row_count;

  return jsonb_build_object('requests_deleted', n_req, 'reservations_anonymized', n_res, 'reminders_deleted', n_rem);
end $$;
revoke execute on function private.purge_personal_data() from public, anon, authenticated;
