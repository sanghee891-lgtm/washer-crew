// 고객 예약 페이지(book.html)에서 고객이 세탁기 앞면 사진 1장을 올립니다.
// - 로그인 없이 부르므로: 이미지(JPEG·PNG·WEBP)만, 3MB까지, 같은 곳(IP)에서 1시간에 10장까지
// - 비공개 보관함(photos)에 넣고 id만 돌려줌. 고객은 사진을 다시 볼 수 없고, 직원만 장부에서 봄
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX = 3 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
// 파일 앞부분으로 진짜 이미지인지 확인
function sniff(b: Uint8Array): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  try {
    const buf = new Uint8Array(await req.arrayBuffer());
    if (!buf.length) return json({ error: "empty" }, 400);
    if (buf.length > MAX) return json({ error: "too_large" }, 413);
    const type = sniff(buf);
    if (!type) return json({ error: "not_image" }, 415);
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const { data: ok, error: gateErr } = await sb.rpc("booking_photo_gate", { p_ip: ip });
    if (gateErr) return json({ error: "gate" }, 500);
    if (!ok) return json({ error: "too_many" }, 429);
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16))).map((x) => x.toString(16).padStart(2, "0")).join("");
    const { error } = await sb.storage.from("photos").upload(id, buf, { contentType: type, cacheControl: "31536000", upsert: false });
    if (error) return json({ error: "store" }, 500);
    return json({ id });
  } catch (e) {
    console.error(e);
    return json({ error: "server" }, 500);
  }
});
