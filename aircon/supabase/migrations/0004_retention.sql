-- 개인정보 보관 기간(web/privacy.html 과 같은 내용)을 매일 새벽 3시 10분(KST)에 자동으로 지킵니다.
-- - 확정되지 않은 예약 요청: 접수 30일 뒤 삭제 (확정된 요청도 1년 뒤 삭제 — 내용은 예약에 옮겨져 있음)
-- - 취소된 예약: 예약일 30일 뒤 이름·연락처·주소·요청사항 삭제
-- - 작업한 예약: 작업일 1년 뒤 이름·연락처·주소·요청사항 삭제(금액 등 매출 기록은 남김)
-- - 지난 확인 문자 기록: 30일 뒤 삭제
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
          or data ->> 'date' < (today - 365)::text);
  get diagnostics n_res = row_count;

  delete from public.docs where coll = 'reminders' and data ->> 'date' < (today - 30)::text;
  get diagnostics n_rem = row_count;

  return jsonb_build_object('requests_deleted', n_req, 'reservations_anonymized', n_res, 'reminders_deleted', n_rem);
end $$;
revoke execute on function private.purge_personal_data() from public, anon, authenticated;

-- 매일 18:10 UTC = 03:10 KST
select cron.schedule('purge-personal-data', '10 18 * * *', $$ select private.purge_personal_data() $$);
