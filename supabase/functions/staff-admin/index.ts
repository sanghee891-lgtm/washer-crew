// 직원 로그인 계정 관리(사장님만): 비밀번호(숫자 6자리) 만들기·바꾸기, 계정 지우기
// 로그인 아이디는 "<직원번호>@washer-crew.local" 가짜 주소이고 메일은 보내지 않습니다.
// 처음 사장님 계정은 DB에서 x-hook-secret 과 함께 불러 만듭니다(owner: true).
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function loginEmail(staffId: string) {
  return `${staffId.toLowerCase()}@washer-crew.local`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const input = await req.json().catch(() => ({}));
    const { data: cfg } = await sb.rpc("push_config");
    const fromHook = !!cfg && req.headers.get("x-hook-secret") === cfg.push_hook_secret;
    let callerUid: string | null = null;
    if (!fromHook) {
      const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: u } = await sb.auth.getUser(token);
      if (!u?.user) return json({ error: "unauthorized" }, 401);
      const { data: me } = await sb.from("staff_accounts").select("is_owner").eq("uid", u.user.id).maybeSingle();
      if (!me?.is_owner) return json({ error: "forbidden" }, 403);
      callerUid = u.user.id;
    }

    const staffId = String(input.staffId || "");
    const { data: staffDoc } = await sb.from("docs").select("data").eq("path", "config/staff").maybeSingle();
    const listed = ((staffDoc?.data?.list as Array<{ id: string }>) || []).some((p) => p.id === staffId);
    if (!/^[A-Za-z0-9]{2,40}$/.test(staffId) || !listed) return json({ error: "no_staff" }, 400);
    const { data: acct } = await sb.from("staff_accounts").select("uid, is_owner").eq("staff_id", staffId).maybeSingle();

    if (input.action === "set_pin") {
      const pin = String(input.pin || "");
      if (!/^\d{6}$/.test(pin)) return json({ error: "bad_pin" }, 400);
      if (acct) {
        const { error } = await sb.auth.admin.updateUserById(acct.uid, { password: pin });
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true, created: false });
      }
      const { data: made, error } = await sb.auth.admin.createUser({
        email: loginEmail(staffId), password: pin, email_confirm: true, app_metadata: { staff_id: staffId },
      });
      if (error || !made.user) return json({ error: error?.message || "create_failed" }, 400);
      const uid = made.user.id;
      const { error: e2 } = await sb.from("staff_accounts").insert({ uid, staff_id: staffId, is_owner: fromHook && input.owner === true });
      if (e2) { await sb.auth.admin.deleteUser(uid); return json({ error: e2.message }, 400); }
      await sb.from("docs").upsert({ path: `data/users/${uid}/me`, data: { staffId } });
      return json({ ok: true, created: true });
    }

    if (input.action === "remove") {
      if (!acct) return json({ ok: true });
      if (acct.uid === callerUid || acct.is_owner) return json({ error: "cannot_remove_owner" }, 400);
      const { error } = await sb.auth.admin.deleteUser(acct.uid);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    return json({ error: "bad_action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
