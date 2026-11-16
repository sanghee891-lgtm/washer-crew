// 공개해도 되는 접속 정보(장부 권한은 DB 규칙이 지킵니다)
// 굿디클린 전용 Supabase 프로젝트를 만든 뒤 url·key·vapidPublic 을 채웁니다.
// (세탁기 크루 서버와 섞이지 않게 비워 둠)
window.WC_CONFIG = {
  url: "",
  key: "",
  vapidPublic: "",
  emailDomain: "goodclean-aircon.local"
};
