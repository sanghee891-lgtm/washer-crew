// 직원 휴대폰으로 웹 푸시 알림을 보냅니다.
// - DB 트리거·예약 작업(pg_net)이 x-hook-secret 과 함께 부릅니다: reservation(새 예약), booking(새 고객 요청), daily(내일 예약 확인)
// - 앱의 [알림 시험] 버튼은 로그인 토큰으로 부르고, 본인 기기에만 test 알림을 보냅니다.
// 나중에 유료 문자 API(솔라피 등)로 고객에게 자동 발송하려면 sendCustomerSms() 한 곳만 채우면 됩니다.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const WD = ["일", "월", "화", "수", "목", "금", "토"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function kstDate(addDays = 0) {
  return new Date(Date.now() + 9 * 3600e3 + addDays * 86400e3).toISOString().slice(0, 10);
}
function dayLabel(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return `${m}/${d}(${WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}
function itemsSummary(items: Array<{ type?: string; qty?: number }> = []) {
  const acc: Record<string, number> = {};
  items.forEach((it) => { if (it && it.type) acc[it.type] = (acc[it.type] || 0) + (Number(it.qty) || 1); });
  return Object.keys(acc).map((t) => `${t} ${acc[t]}대`).join(" · ");
}
async function staffNames(): Promise<Record<string, string>> {
  const { data } = await sb.from("docs").select("data").eq("path", "config/staff").maybeSingle();
  const out: Record<string, string> = {};
  ((data?.data?.list as Array<{ id: string; name: string }>) || []).forEach((p) => { out[p.id] = p.name; });
  return out;
}

type Msg = { title: string; body: string; url: string; tag: string };

async function buildMessage(type: string, input: Record<string, unknown>): Promise<{ msg: Msg; excludeStaff?: string } | null> {
  if (type === "reservation") {
    const { data } = await sb.from("docs").select("data").eq("path", String(input.path)).maybeSingle();
    const r = data?.data;
    if (!r) return null;
    // 데이터 옮기기처럼 예전 예약을 한꺼번에 넣을 때는 알리지 않음
    if (r.createdAt && Date.now() - Date.parse(r.createdAt) > 10 * 60e3) return null;
    const names = await staffNames();
    const who = r.customer?.name || itemsSummary(r.items) || "";
    const by = names[r.createdBy] ? ` · ${names[r.createdBy]}님 등록` : "";
    const id = String(input.path).split("/").pop();
    return {
      msg: { title: "새 예약", body: `${dayLabel(r.date)} ${r.time} · ${who}${by}`, url: `/?open=${id}`, tag: `res-${id}` },
      excludeStaff: r.createdBy || undefined,
    };
  }
  if (type === "booking") {
    const { data: b } = await sb.from("booking_requests").select("*").eq("id", String(input.id)).maybeSingle();
    if (!b) return null;
    const what = itemsSummary(b.items);
    return {
      msg: {
        title: "고객 예약 요청",
        body: `${b.name} · ${dayLabel(b.want_date)} ${b.time_slot || ""}${what ? " · " + what : ""}`.replace(/\s+/g, " "),
        url: "/?requests=1",
        tag: `req-${b.id}`,
      },
    };
  }
  if (type === "daily") {
    const tomorrow = kstDate(1);
    const { data } = await sb.from("docs").select("path, data").eq("coll", "reservations").eq("data->>date", tomorrow);
    const list = (data || []).filter((d) => d.data?.status === "scheduled");
    await sendCustomerSms(list.map((d) => d.data));
    if (!list.length) return null;
    return {
      msg: {
        title: "내일 예약 확인 문자",
        body: `내일 ${dayLabel(tomorrow)} 예약 ${list.length}건이에요. 눌러서 고객에게 확인 문자를 보내 주세요.`,
        url: "/?reminders=1",
        tag: `daily-${tomorrow}`,
      },
    };
  }
  if (type === "test") {
    return { msg: { title: "세탁기 크루", body: "알림이 잘 와요!", url: "/", tag: "test" } };
  }
  return null;
}

// 유료 문자 자동 발송 자리(지금은 사용 안 함). 직원이 앱에서 문구가 채워진 문자 화면으로 보냅니다.
async function sendCustomerSms(_reservations: unknown[]) {
  if (!Deno.env.get("SMS_PROVIDER")) return;
}

async function send(msg: Msg, opt: { excludeStaff?: string; onlyUid?: string }, cfg: Record<string, string>) {
  webpush.setVapidDetails("https://washer-crew.pages.dev", cfg.vapid_public, cfg.vapid_private);
  const [{ data: subs }, { data: accts }] = await Promise.all([
    sb.from("push_subscriptions").select("endpoint, uid, p256dh, auth"),
    sb.from("staff_accounts").select("uid, staff_id"),
  ]);
  const staffOf: Record<string, string> = {};
  (accts || []).forEach((a) => { staffOf[a.uid] = a.staff_id; });
  const targets = (subs || []).filter((s) =>
    (!opt.onlyUid || s.uid === opt.onlyUid) && (!opt.excludeStaff || staffOf[s.uid] !== opt.excludeStaff));
  const payload = JSON.stringify(msg);
  let sent = 0;
  const errors: string[] = [];
  await Promise.all(targets.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 12 * 3600, urgency: "high" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      else errors.push(String(code || (e as Error).message));
    }
  }));
  return { targets: targets.length, sent, errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { data: cfg, error } = await sb.rpc("push_config");
    if (error || !cfg) return json({ error: "config" }, 500);
    const input = await req.json().catch(() => ({}));
    const fromHook = req.headers.get("x-hook-secret") === cfg.push_hook_secret;
    let onlyUid: string | undefined;
    if (!fromHook) {
      // 로그인한 직원은 본인 기기 시험 알림만
      const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: u } = await sb.auth.getUser(token);
      if (!u?.user) return json({ error: "unauthorized" }, 401);
      const { data: acct } = await sb.from("staff_accounts").select("uid").eq("uid", u.user.id).maybeSingle();
      if (!acct || input.type !== "test") return json({ error: "forbidden" }, 403);
      onlyUid = u.user.id;
    }
    const built = await buildMessage(String(input.type), input);
    if (!built) return json({ skipped: true });
    const res = await send(built.msg, { excludeStaff: built.excludeStaff, onlyUid }, cfg);
    console.log(JSON.stringify({ type: input.type, ...res }));
    return json(res);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
