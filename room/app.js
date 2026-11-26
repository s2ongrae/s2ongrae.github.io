/* ═══════════════════════════════════════════════════════════
   💬 AI 비서 회의실 — 전용 PWA (room/app.js)
   · 포털 회의실과 **같은 큐**(Apps Script Command_Queue)를 카톡처럼 씁니다.
   · 읽기: queue_list · usage_get · queue_status / 쓰기: queue_enqueue(kind:'chat')
   · 인증: 포털과 같은 localStorage 키 (portal_server_url · portal_server_key)
   · 이 파일의 <ROOM_CORE> 구간은 순수 함수예요 — tests/room.test.js 가 뽑아 검증합니다.
   ═══════════════════════════════════════════════════════════ */
'use strict';

/* ─────────────────────────────────────────────────────────
   순수 로직 (DOM 없음) — 표시를 지우면 테스트가 못 찾아요
   ───────────────────────────────────────────────────────── */
// <ROOM_CORE>
/** 편대 9명 — 순서는 사용자 확정(머리말·서랍·멘션 칩이 같은 순서) */
const ROOM_AGENTS = [
  {id: 'pi1',      name: '피원', icon: '🍋', color: 'pi1',  role: '총괄 비서',        duty: '총괄 조율·스케줄·블로그/콘텐츠/보험툴/포털 지휘', quota: true},
  {id: 'pi2',      name: '피투', icon: '🤖', color: 'pi2',  role: '부계정 비서',       duty: 'GitHub PR/이슈·분산 실행·SNS·커머스 보조', quota: true},
  {id: 'notebook', name: '노트북', icon: '🖥️', color: 'nb',  role: '실행 엔진',        duty: '24시간 즉답·코드 실행·숏폼 무토큰 렌더', quota: false},
  {id: 'cue',      name: '큐',   icon: '🌀', color: 'cue',  role: '리서처',           duty: '최신 정보 리서치·근거 확인·결과 교차검증(팩트체크)', quota: true},
  {id: 'cue2',     name: '큐투', icon: '🌀', color: 'cue',  role: '리서처 · 부계정',   duty: '큐의 부계정 — 리서치·팩트체크 보조', quota: true},
  {id: 'vooy',     name: '부이', icon: '🫛', color: 'vooy', role: '정리 담당',         duty: '후보 비교·체크리스트·채용 리서치·PDF/HWP 문서 읽기', quota: true},
  {id: 'vooy2',    name: '뷔투', icon: '🫛', color: 'vooy', role: '정리 담당 · 부계정', duty: '부이의 부계정 — 비교·정리 보조', quota: true},
  {id: 'keyring',  name: '키링', icon: '🔑', color: 'key',  role: '생활 예약',         duty: '전화·KTX/예약·대전 밥집/쇼핑커넥트 발굴', quota: true},
  {id: 'keyring2', name: '키투', icon: '🔑', color: 'key',  role: '생활 예약 · 부계정', duty: '키링의 부계정 — 예약·전화 보조', quota: true}
];
/** 입력바 빠른 멘션 칩 — 사용자 확정 순서 그대로 */
const ROOM_CHIPS = ['@전체', '@피원', '@피투', '@노트북', '@큐', '@큐투', '@부이', '@뷔투', '@키링', '@키투'];
/** 옛 부름·영문 id 도 같은 사람으로 (명부 이름이 먼저 이깁니다) */
const ROOM_ALIASES = {
  '큐2': 'cue2', '큐투': 'cue2', 'cue2': 'cue2',
  '부이2': 'vooy2', '부이투': 'vooy2', '뷔투': 'vooy2', 'vooy2': 'vooy2',
  '키링2': 'keyring2', '키링투': 'keyring2', '키투': 'keyring2', 'keyring2': 'keyring2',
  '집노트북': 'notebook', '노트북': 'notebook', 'notebook': 'notebook', 'hub-agent': 'notebook'
};
const ROOM_STATUS = {
  PENDING:           {t: '대기',      c: ''},
  WAITING_APPROVAL:  {t: '승인 대기',  c: 'wait'},
  RUNNING:           {t: '실행 중',    c: 'run'},
  DONE:              {t: '완료',      c: 'ok'},
  FAILED:            {t: '실패',      c: 'bad'},
  REJECTED:          {t: '거절',      c: 'sys'},
  EXPIRED:           {t: '만료',      c: 'sys'},
  REVIEW_NEEDED:     {t: '검토 필요',  c: 'wait'},
  TIMEOUT_REVIEW:    {t: '확인 필요',  c: 'bad'}
};
const ROOM_ANSWERED = {RUNNING: 1, DONE: 1, FAILED: 1, REVIEW_NEEDED: 1, TIMEOUT_REVIEW: 1};
const ROOM_ME = {id: 'portal', name: '성래 님', icon: '🌐', color: 'me', duty: '나 (포털)'};

function roomPad(n){ return String(n).padStart(2, '0'); }
function roomNum(v){ return (typeof v === 'number' && isFinite(v)) ? v : null; }
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
}
function roomAgentById(id){
  const k = String(id == null ? '' : id).toLowerCase().trim();
  if(!k) return null;
  if(k === 'portal' || k === 'me' || k === 'phone' || k === 'telegram') return ROOM_ME;
  for(let i = 0; i < ROOM_AGENTS.length; i++) if(ROOM_AGENTS[i].id === k) return ROOM_AGENTS[i];
  const al = ROOM_ALIASES[k];
  if(al) for(let i = 0; i < ROOM_AGENTS.length; i++) if(ROOM_AGENTS[i].id === al) return ROOM_AGENTS[i];
  return null;
}
/** @이름 → id 표 (명부 이름이 먼저, 빈 부름말만 옛 이름으로 채움) */
function roomMentionMap(){
  const map = {'@전체': 'all'};
  ROOM_AGENTS.forEach(a => { map['@' + a.name] = a.id; map['@' + a.id] = a.id; });
  Object.keys(ROOM_ALIASES).forEach(k => { if(!map['@' + k]) map['@' + k] = ROOM_ALIASES[k]; });
  return map;
}
/** 이름 뒤에 글자가 붙으면(@피원님 은 되고 @피원2 는 다른 사람) 멘션 경계 판정 */
function roomMentionBoundary(txt, at){
  const next = txt.charAt(at);
  if(!next) return true;
  if(!/[A-Za-z0-9_-]/.test(next)) return true;
  return /^\d{1,2}(?![A-Za-z0-9_-])/.test(txt.substr(at, 3));
}
/** 본문에 적힌 @이름 → 대상 id. 없으면 '' (긴 이름부터 찾아 @큐투 가 @큐 로 새지 않게) */
function roomTargetFromText(text){
  const s = String(text == null ? '' : text);
  if(s.indexOf('@') < 0) return '';
  const map = roomMentionMap();
  const labels = Object.keys(map).sort((a, b) => b.length - a.length);
  for(let i = 0; i < s.length; i++){
    if(s.charAt(i) !== '@') continue;
    for(let j = 0; j < labels.length; j++){
      const l = labels[j];
      if(s.substr(i, l.length) !== l) continue;
      if(!roomMentionBoundary(s, i + l.length)) continue;
      return map[l];
    }
  }
  return '';
}
/** 시트 source → 발신자 키 */
function roomSenderKey(it){
  const s = String((it && it.source) || '').toLowerCase().trim();
  if(s === 'pi1' || s === 'pickle-pi1' || s === 'pickle' || s === 'pk') return 'pi1';
  if(s === 'pi2' || s === 'pickle-pi2') return 'pi2';
  if(s === 'notebook' || s === 'hub-agent' || s === 'nb') return 'notebook';
  if(s === 'telegram' || s === 'tg') return 'telegram';
  if(s === 'phone' || s === 'mobile') return 'phone';
  if(s && s !== 'portal' && roomAgentById(s)) return roomAgentById(s).id;
  return 'portal';
}
/** 나(성래 님)가 보낸 말인가 — 포털·폰·텔레그램은 오른쪽 */
function roomIsMine(it){ const k = roomSenderKey(it); return k === 'portal' || k === 'phone' || k === 'telegram'; }
function roomIsChat(it){ return String((it && it.kind) || '').toLowerCase() === 'chat'; }
/** 대상 — all · 비서 id · portal */
function roomTargetKey(it){
  const t = String((it && it.target) || '').toLowerCase().trim();
  if(t === 'all') return 'all';
  if(t === 'portal' || t === 'phone' || t === 'telegram') return 'portal';
  const a = t ? roomAgentById(t) : null;
  if(a && a.id !== 'portal') return a.id;
  return 'notebook';
}
function roomTargetLabel(k){
  if(k === 'all') return {id: 'all', label: '@전체', name: '전체 비서', icon: '👥'};
  if(k === 'portal') return {id: 'portal', label: '@성래', name: '성래 님', icon: '🌐'};
  const a = roomAgentById(k) || roomAgentById('notebook');
  return {id: a.id, label: '@' + a.name, name: a.name, icon: a.icon};
}
/** 답장 말풍선의 주인 — 실제로 답한 비서(replied_by·claimed_by) */
function roomReplyKey(it){
  const st = String((it && it.status) || '').toUpperCase();
  const by = String((it && (it.replied_by || it.claimed_by)) || '').trim();
  const key = by ? roomSenderKey({source: by}) : '';
  if(ROOM_ANSWERED[st] && key && key !== 'portal' && roomAgentById(key)) return key;
  return roomSenderKey(it);
}
function roomReplyWhoKey(it){
  const st = String((it && it.status) || '').toUpperCase();
  if(ROOM_ANSWERED[st]){
    const k = roomReplyKey(it);
    if(k !== 'portal') return k;            // 실제로 답한 비서
    // 답한 사람 기록이 없는 오래된 줄은 "나"가 아니라 **시킨 상대**가 답한 것으로 그린다
    const tg = roomTargetKey(it);
    return tg === 'portal' ? k : (tg === 'all' ? 'notebook' : tg);
  }
  const tg = roomTargetKey(it);
  return (tg === 'all' || tg === 'portal') ? roomSenderKey(it) : tg;
}
/** 이 말을 집어 답할 사람이 있는가 (노트북은 실행 오더면 notebook·all, 대화면 notebook 일 때만 — 2026-11-26) */
function roomNeedsWorker(it){
  if(!it) return false;
  const tg = roomTargetKey(it);
  if(tg === 'notebook') return true;
  if(tg === 'all') return !roomIsChat(it);     // @전체 대화는 노트북 몫이 아니다(토큰 절약)
  if(!roomIsChat(it)) return true;
  return roomIsMine(it);
}
/** 비서가 남긴 순수 답장 — 그 말 자체가 내용이라 대기·진행 뱃지를 붙이지 않는다 */
function roomIsPlainReply(it){ return roomIsChat(it) && !roomIsMine(it) && !roomNeedsWorker(it); }
function roomShowReply(it){
  // 나(portal)에게 온 오더를 내가 답한 것처럼 그리지 않는다 — 답한 주체를 모를 때의 자리표시
  if(roomIsMine(it) && roomReplyWhoKey(it) === 'portal') return false;
  if(!roomIsPlainReply(it)) return true;
  if(String((it && it.status) || '').toUpperCase() === 'PENDING') return false;
  const t = String((it && (it.result || it.error)) || '').trim();
  return !!t && t !== roomMsgText(it);
}
const ROOM_NOTE_RE = /\s*\[워커 규칙\][\s\S]*$/;
function roomStripNote(s){ return String(s == null ? '' : s).replace(ROOM_NOTE_RE, '').trim(); }
function roomSumLine(it){ return roomStripNote(it && it.summary).replace(/^(?:클로드|프롬프트):\s*/, ''); }
/** 말풍선 본문 — 큐가 붙인 머리말·규칙 문구를 덜어낸다 */
function roomMsgText(it){
  let s = roomSumLine(it);
  if(roomIsChat(it)) return s;
  // 꼬리표는 순서가 바뀌어 와도(“… (파일 수정) · 엔진 claude”) 둘 다 떼어낸다
  s = s.replace(/[ \t]*·[ \t]*엔진[ \t]+[A-Za-z]+[ \t]*$/, '');
  s = s.replace(/[ \t]*\(파일 수정\)[ \t]*$/, '');
  s = s.replace(/[ \t]*·[ \t]*엔진[ \t]+[A-Za-z]+[ \t]*$/, '');
  return s.trim();
}
function roomStatus(it){
  const st = String((it && it.status) || '').toUpperCase();
  return ROOM_STATUS[st] || {t: st || '—', c: 'sys'};
}
function roomReplyAt(it){
  const st = String((it && it.status) || '').toUpperCase();
  if(st === 'DONE' || st === 'FAILED' || st === 'REJECTED' || st === 'EXPIRED' || st === 'REVIEW_NEEDED' || st === 'TIMEOUT_REVIEW')
    return it.finished_at || it.started_at || it.claimed_at || it.created_at || '';
  return it.beat_at || it.started_at || it.claimed_at || it.created_at || '';
}
function roomSameDay(a, b){ return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
/** 시각 — 오늘이면 20:46, 아니면 11/24 20:46 */
function roomWhen(iso, now){
  const t = Date.parse(String(iso || ''));
  if(!isFinite(t)) return '';
  const d = new Date(t), n = new Date(isFinite(now) ? now : Date.now());
  const hm = roomPad(d.getHours()) + ':' + roomPad(d.getMinutes());
  return roomSameDay(d, n) ? hm : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
}
function roomClock(iso){ return roomWhen(iso); }
/** 날짜 구분선 — 오늘 · 어제 · 11월 24일 */
function roomDay(iso, now){
  const t = Date.parse(String(iso || ''));
  if(!isFinite(t)) return '';
  const d = new Date(t), n = new Date(isFinite(now) ? now : Date.now());
  if(roomSameDay(d, n)) return '오늘';
  const y = new Date(n.getTime() - 86400000);
  if(roomSameDay(d, y)) return '어제';
  return (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
}
function roomAgo(min){
  const n = roomNum(min);
  if(n === null) return '';
  if(n < 1) return '방금';
  if(n < 60) return Math.round(n) + '분 전';
  const h = Math.floor(n / 60), m = Math.round(n % 60);
  if(h < 24) return m ? h + '시간 ' + m + '분 전' : h + '시간 전';
  return Math.floor(h / 24) + '일 전';
}
/** 받침에 맞는 조사 — '부이'→가, '노트북'→이, 모르는 글자(영문)는 '이(가)' */
function roomJosa(word, withBatchim, noBatchim){
  const s = String(word || '').trim();
  const last = s.charCodeAt(s.length - 1);
  if(last >= 0xAC00 && last <= 0xD7A3) return ((last - 0xAC00) % 28) ? (withBatchim || '이') : (noBatchim || '가');
  return (withBatchim || '이') + '(' + (noBatchim || '가') + ')';
}
/** 잔여 % → 상태 (포털과 같은 기준: 위험 <10 · 임박 <30) */
function roomUseState(pct){
  const n = roomNum(pct);
  if(n === null) return 'unknown';
  if(n < 10) return 'danger';
  if(n < 30) return 'soon';
  return 'ok';
}
const ROOM_WS_LABEL = {'gaegyebu': '가계부', 'content-hub': '콘텐츠 허브', 'insurance-manager': '보험관리툴', 'smartstore-hub': '스마트스토어', 's2ongrae.github.io': '포털', 'hub-agent': '허브 에이전트 (노트북)'};
function roomWsName(w){ return ROOM_WS_LABEL[w] || String(w || '기본'); }
/** 보낼 작업 위치 — 저장값이 허용 목록에 있으면 그것, 없으면 hub-agent, 그것도 없으면 첫 번째 */
function roomWsPick(list, saved){
  const arr = (Array.isArray(list) ? list : []).map(String).filter(Boolean);
  const s = String(saved || '');
  if(s && arr.indexOf(s) >= 0) return s;
  if(arr.indexOf('hub-agent') >= 0) return 'hub-agent';
  return arr[0] || '';
}
/* ─────────────────────────────────────────────────────────
   📊 사용량 표시 — 포털 PR #4(비서 사용량 자동 연동)와 같은 규칙
   · 카드 하나의 상태 = ① 이번 주기에 들어온 숫자 → ② 가동 신호 → ③ 미확인
   · 04:00(일일) · 월요일 09:00(주간) 리셋이 지나면 지난 %는 화면이 스스로 내린다
     (어제 숫자가 오늘 것처럼 남지 않게).
   · 숫자를 안 내는 계정(피클 무료 등)은 살아 있다는 신호만으로 '가동 중 · 잔여 비공개'.
   · 숫자를 지어내지 않는다 — %는 비서의 usage_report 또는 사람의 '잔여 입력'만 채운다.
   ───────────────────────────────────────────────────────── */
const ROOM_USE_TXT = {danger: '위험', soon: '임박', ok: '정상', na: '비공개', unknown: '미확인'};
const ROOM_USE_ALIVE_MIN = 24 * 60;   // 하루 넘게 신호가 없으면 '가동 중'이라 말하지 않는다
/** 리셋 주기 — 피클 크레딧은 매일 04:00, 회사 PC 주간 한도만 월요일 09:00 */
function roomResetOf(id){ return String(id) === 'pc' ? 'weekly' : 'daily04'; }
/** 이번 주기의 시작(ms) — 일일 04:00 · 주간 월요일 09:00 (포털 useCycleStart 와 같은 셈) */
function roomCycleStart(id, now){
  const t = new Date(roomNum(now) === null ? Date.now() : roomNum(now));
  if(roomResetOf(id) === 'weekly'){
    const at = new Date(t.getTime());
    at.setHours(9, 0, 0, 0);
    let back = (at.getDay() - 1 + 7) % 7;                  // 이번 주 월요일까지 거슬러
    if(back === 0 && t.getTime() < at.getTime()) back = 7; // 월요일 09:00 전이면 지난 월요일
    at.setDate(at.getDate() - back);
    return at.getTime();
  }
  const at = new Date(t.getTime());
  at.setHours(4, 0, 0, 0);
  if(at.getTime() > t.getTime()) at.setDate(at.getDate() - 1);
  return at.getTime();
}
/** 이번 주기에 들어온 보고인가 — 리셋 전에 받은 %는 이미 무효라 '지난 값'으로 본다 */
function roomUseFresh(id, x, now){
  if(!x || roomNum(x.pct) === null) return false;
  const at = Date.parse(String(x.at || ''));
  if(!isFinite(at)) return false;                        // 시각 없는 옛 기록은 믿지 않는다
  return at >= roomCycleStart(id, now);
}
/** 다음 리셋 시각(ms) — 일일 04:00 · 주간 월요일 09:00 */
function roomResetAt(id, now){
  const t = new Date(roomNum(now) === null ? Date.now() : roomNum(now));
  if(roomResetOf(id) === 'weekly'){
    const at = new Date(t.getTime());
    at.setHours(9, 0, 0, 0);
    let add = (1 - at.getDay() + 7) % 7;                    // 1 = 월요일
    if(add === 0 && t.getTime() >= at.getTime()) add = 7;
    at.setDate(at.getDate() + add);
    return at.getTime();
  }
  const at = new Date(t.getTime());
  at.setHours(4, 0, 0, 0);
  if(at.getTime() <= t.getTime()) at.setDate(at.getDate() + 1);
  return at.getTime();
}
/** '리셋 5시간 31분 후' */
function roomResetText(id, now){
  const t = roomNum(now) === null ? Date.now() : roomNum(now);
  const left = roomResetAt(id, t) - t;
  if(!(left > 0)) return '곧 리셋';
  const m = Math.ceil(left / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if(d > 0) return '리셋 ' + d + '일 ' + (h % 24) + '시간 후';
  if(h > 0) return '리셋 ' + h + '시간 ' + (m % 60) + '분 후';
  return '리셋 ' + Math.max(1, m) + '분 후';
}
/**
 * 상태 파일/서버 응답 → 비서 신호 {at, state} (없으면 null).
 *  · 서버 agent_status: {agent, updated_at} · {pi2:{agent,updated_at}} · {pc:{state,updated_at}}
 *  · 저장소 status/agent.json 도 같은 모양이라 그대로 읽힌다.
 */
function roomSignalOf(d, id){
  if(!d || !id) return null;
  const of = (o, at) => {
    if(!o || !at) return null;
    return {at: String(at), state: String(o.state || (o.agent && o.agent.state) || '')};
  };
  if(id === 'pi1') return of(d.agent, d.updated_at);
  if(id === 'pi2'){
    if(d.pi2 && d.pi2.agent) return of(d.pi2.agent, d.pi2.updated_at);  // 저장소 파일 모양
    if(d.pi2 && d.pi2.updated_at) return {at: String(d.pi2.updated_at), state: String(d.pi2.state || '')};  // agent_beat 모양
    return null;
  }
  if(id === 'pc') return (d.pc && d.pc.updated_at) ? {at: String(d.pc.updated_at), state: String(d.pc.state || '')} : null;
  if(id === 'notebook') return (d.direct && d.direct.updated_at) ? {at: String(d.direct.updated_at), state: String(d.direct.state || '')} : null;
  return null;
}
/** 상태 파일 하나에서 id 별 신호를 뽑는다 — 파일마다 모양이 달라서(as) 여기서 맞춘다 */
function roomSignalsFrom(d, as){
  const out = {};
  if(!d) return out;
  if(as === 'pi2'){                       // status/pi2.json 은 {agent, updated_at} 한 사람 모양
    if(d.agent && d.updated_at) out.pi2 = {at: String(d.updated_at), state: String(d.agent.state || '')};
    return out;
  }
  ['pi1', 'pi2', 'pc', 'notebook'].forEach(id => {
    const sig = roomSignalOf(d, id);
    if(sig) out[id] = sig;
  });
  return out;
}
/** 신호가 몇 분 전인가 (모르면 null) */
function roomSignalMin(sig, now){
  const t = Date.parse(String((sig && sig.at) || ''));
  if(!isFinite(t)) return null;
  const n = roomNum(now) === null ? Date.now() : roomNum(now);
  return Math.max(0, Math.round((n - t) / 60000));
}
/** 하루 넘게 소식이 없으면 살아 있다고 말하지 않는다(쉬는 중일 수도, 한도가 끝났을 수도) */
function roomSignalLive(sig, now){
  const m = roomSignalMin(sig, now);
  return m !== null && m <= ROOM_USE_ALIVE_MIN;
}
/** 카드 하나의 상태 — 이번 주기 숫자 → 가동 신호 → 미확인 순으로 본다 */
function roomStateOf(id, x, sig, now){
  if(roomUseFresh(id, x, now)) return roomUseState(x.pct);
  if(roomSignalLive(sig, now)) return 'na';
  return 'unknown';
}
/**
 * 한 줄에 그릴 것 — 상태·숫자·설명. 숫자는 지어내지 않고, 지난 값은 지웠다고 말한다.
 *  · 잔여 N%      (이번 주기 보고)          · 보고 11분 전
 *  · 잔여 비공개  (가동 신호만 있을 때)     · 가동 중 · 신호 3시간 전
 *  · — 새 보고 대기 (리셋 지난 값)          · 리셋 지남 · 지난 값 85%는 지웠어요
 *  · — 미확인     (아무 신호도 없음)
 */
function roomUseView(id, x, sig, now){
  const t = roomNum(now) === null ? Date.now() : roomNum(now);
  const st = roomStateOf(id, x, sig, t);
  const fresh = roomUseFresh(id, x, t);
  const pct = fresh ? Math.max(0, Math.min(100, Number(x.pct))) : null;
  const m = roomSignalMin(sig, t);
  let label, note = '';
  if(pct !== null){
    label = '잔여 ' + (Math.round(pct * 10) / 10) + '%';
    const at = Date.parse(String(x.at || ''));
    if(isFinite(at)) note = '보고 ' + roomAgo(Math.max(0, (t - at) / 60000));
    if(x && x.note) note += (note ? ' · ' : '') + String(x.note);
  } else if(st === 'na'){
    label = '잔여 비공개';
    note = (String((sig && sig.state) || '').toLowerCase() === 'working' ? '작업 중' : '가동 중') +
      (m !== null ? ' · 신호 ' + roomAgo(m) : '');
    if(x && roomNum(x.pct) !== null) note += ' · 지난 값 ' + (Math.round(Number(x.pct) * 10) / 10) + '% 지움';
  } else if(x){
    label = '— 새 보고 대기';
    note = '리셋 지남 · 지난 값 ' + (Math.round(Number(x.pct) * 10) / 10) + '%는 지웠어요';
  } else {
    label = '— 미확인';
  }
  return {state: st, pct: pct, label: label, note: note, stale: !fresh && !!x && roomNum(x.pct) !== null};
}
/** 요약 알약 — 위험·임박·정상·비공개·미확인 (포털 사용량판과 같은 다섯 칸) */
function roomUseSummary(ids, usage, sigs, now){
  const c = {danger: 0, soon: 0, ok: 0, na: 0, unknown: 0};
  (Array.isArray(ids) ? ids : []).forEach(id => {
    c[roomStateOf(id, usage && usage[id], sigs && sigs[id], now)]++;
  });
  return c;
}

/** 본문 속 @이름 → 칩 (이미 esc() 한 문자열에만 적용) */
function roomMentionHtml(s){
  const txt = String(s == null ? '' : s);
  const map = roomMentionMap();
  const labels = Object.keys(map).sort((a, b) => b.length - a.length);
  if(!labels.length) return txt;
  let out = '', i = 0;
  while(i < txt.length){
    if(txt.charAt(i) === '@'){
      let hit = '';
      for(let j = 0; j < labels.length; j++){
        const l = labels[j];
        if(txt.substr(i, l.length) !== l) continue;
        if(!roomMentionBoundary(txt, i + l.length)) continue;
        hit = l; break;
      }
      if(hit){
        const id = map[hit];
        const a = id === 'all' ? null : roomAgentById(id);
        out += `<b class="mt w-${esc(a ? a.color : 'all')}">${hit}</b>`;
        i += hit.length;
        continue;
      }
    }
    out += txt.charAt(i);
    i++;
  }
  return out;
}
/** 링크 — [이름](주소) 과 맨 주소를 둘 다 <a> 로. 두 번 감싸지 않게 자리표시자를 거친다 */
function roomLinks(s){
  const links = [];
  let h = String(s).replace(/\[([^\]\n]{1,80})\]\((https?:\/\/[^\s)]+)\)/g, (m, label, url) => {
    links.push('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>');
    return '\u0001' + (links.length - 1) + '\u0001';
  });
  h = h.replace(/https?:\/\/[^\s<]+/g, (m) => {
    const clean = m.replace(/[),.!?]+$/, '');          // 문장 끝 구두점은 링크 밖으로
    const tail = m.slice(clean.length);
    links.push('<a href="' + clean + '" target="_blank" rel="noopener noreferrer">' + clean + '</a>');
    return '\u0001' + (links.length - 1) + '\u0001' + tail;
  });
  return h.replace(/\u0001(\d+)\u0001/g, (m, i) => links[Number(i)] || '');
}
function roomMdInline(t){
  return String(t).split('\n').map(line => {
    let h = line;
    h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/^#{1,3}\s+(.*)$/, '<b class="h3">$1</b>');
    const li = /^([ \t]*)[-*•]\s+(.*)$/.exec(h);
    if(li) h = li[1] + '<span class="li">•</span> ' + li[2];
    h = roomLinks(h);
    return roomMentionHtml(h);
  }).join('\n');
}
/** 아주 작은 마크다운 — 먼저 전부 escape 하고, 코드블록·굵게·목록·링크·멘션만 */
function roomMd(raw){
  const s = esc(String(raw == null ? '' : raw)).replace(/\r\n?/g, '\n');
  const parts = s.split('```');
  let out = '';
  for(let i = 0; i < parts.length; i++){
    if(i % 2 === 1){
      out += '<pre class="code">' + parts[i].replace(/^\n/, '').replace(/\n$/, '') + '</pre>';
      continue;
    }
    out += roomMdInline(parts[i]);
  }
  return out;
}
/** 최근 활동 지도 — id → 몇 분 전 (말한 사람 · 실제로 답한 비서만) */
function roomLastActivity(items, now){
  const at = isFinite(now) ? now : Date.now();
  const out = {};
  (Array.isArray(items) ? items : []).forEach(it => {
    if(!it) return;
    const keys = [roomSenderKey(it)];
    const st = String(it.status || '').toUpperCase();
    // 대상을 활동으로 세지 않는다 — "@큐 앞에 남긴 말"은 큐가 말한 게 아니다
    if(ROOM_ANSWERED[st] && (it.replied_by || it.claimed_by)) keys.push(roomReplyKey(it));
    const t = Date.parse(String(it.created_at || '')) || 0;
    const rt = Date.parse(String(roomReplyAt(it) || '')) || 0;
    keys.forEach(k => {
      if(!k || k === 'portal') return;
      const best = Math.max(t, rt);
      if(!best) return;
      const prev = out[k];
      const cur = Math.max(0, (at - best) / 60000);
      if(prev === undefined || cur < prev) out[k] = cur;
    });
  });
  return out;
}
/** 머리말 온라인 수 — 노트북은 하트비트 10분, 비서는 최근 30분 활동 */
function roomOnlineCount(items, hb, now){
  const act = roomLastActivity(items, now);
  let n = 0;
  ROOM_AGENTS.forEach(a => {
    if(a.id === 'notebook') return;
    const m = act[a.id];
    if(m !== undefined && m <= 30) n++;
  });
  const h = hb && hb.heartbeat;
  if(h && roomNum(h.min) !== null && h.min < 10 && h.state && h.state !== 'unknown') n++;
  return n;
}
// </ROOM_CORE>

/* ─────────────────────────────────────────────────────────
   화면 (DOM)
   ───────────────────────────────────────────────────────── */
(function(){
  const $ = id => document.getElementById(id);
  const POLL_MS = 20000;
  const STATUS_EVERY = 4 * 60000;
  const S = {
    items: [], at: '', sum: {}, hb: null, usage: {}, sigs: {},
    busy: false, sending: false, err: '', sig: '', painted: false,
    lastFetch: 0, statusAt: 0, usageAt: 0, sigAt: 0, chatOk: null,
    wss: [], ws: lsGet('room_ws')
  };
  let pinned = true, toastTimer = null;
  const SEND_ICON = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 20V5M12 5l-6.6 6.6M12 5l6.6 6.6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ── 저장소 ── */
  function lsGet(k){ try { return localStorage.getItem(k) || ''; } catch(e) { return ''; } }
  function lsSet(k, v){ try { localStorage.setItem(k, v); } catch(e) {} }
  function serverUrl(){ return lsGet('portal_server_url').trim(); }
  function serverKey(){ return lsGet('portal_server_key').trim(); }
  function configured(){ return !!(serverUrl() && serverKey()); }

  /* ── 서버 ── */
  async function apiRaw(url, key, action, body){
    const r = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'text/plain'},
      body: JSON.stringify(Object.assign({}, body || {}, {action: action, key: key}))
    });
    let d;
    try { d = await r.json(); } catch(_) { throw new Error('서버 응답을 읽을 수 없어요'); }
    if(d && d.error === 'unauthorized'){ const e = new Error('비밀 키가 맞지 않아요'); e.code = 'unauthorized'; throw e; }
    return d;
  }
  function api(action, body){
    const url = serverUrl(), key = serverKey();
    if(!url || !key){ const e = new Error('서버 설정이 없어요'); e.code = 'noconfig'; return Promise.reject(e); }
    return apiRaw(url, key, action, body);
  }

  /* ── 토스트 ── */
  function toast(msg){
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 3200);
  }

  /* ── 머리말 ── */
  function renderHead(){
    const sub = $('hd-s'), ppl = $('ppl'), pt = $('ppl-t');
    const online = roomOnlineCount(S.items, S.hb, Date.now());
    pt.textContent = '👥 ' + ROOM_AGENTS.length + '명' + (online ? ' · 🟢 ' + online : '');
    ppl.dataset.on = online ? '1' : '0';
    ppl.title = '편대 ' + ROOM_AGENTS.length + '명 · 최근 30분 활동 ' + online + '명 — 눌러서 사용량·역할 보기';
    sub.textContent = '';
    if(!configured()){ sub.textContent = '⚙️ 서버 연결 전 — 눌러서 설정'; return; }
    if(S.err){ sub.textContent = '⚠️ ' + S.err; return; }
    const hb = S.hb && S.hb.heartbeat;
    const parts = [];
    if(hb && roomNum(hb.min) !== null) parts.push('노트북 ' + roomAgo(hb.min));
    else parts.push('노트북 신호 없음');
    const c = S.sum || {};
    if(c.waiting) parts.push('승인 ' + c.waiting);
    if(c.pending) parts.push('대기 ' + c.pending);
    if(c.running) parts.push('실행 ' + c.running);
    if(S.at) parts.push(roomClock(S.at) + ' 확인');
    sub.textContent = parts.join(' · ');
  }
  function showStrip(msg, bad){
    const el = $('strip');
    $('strip-t').textContent = msg;
    el.classList.toggle('bad', !!bad);
    el.classList.add('on');
  }
  function hideStrip(){ $('strip').classList.remove('on'); }

  /* ── 피드 ── */
  function nearBottom(){
    const b = $('feed');
    return b.scrollHeight - b.scrollTop - b.clientHeight < 90;
  }
  function jumpOn(){ $('jump').classList.add('on'); }
  function jumpOff(){ $('jump').classList.remove('on'); }

  function emptySetup(){
    return '<div class="empty"><div class="big">🔑</div><h3>서버를 연결하면 대화가 열려요</h3>' +
      '<p>포털과 같은 Apps Script 주소·비밀 키를 씁니다.<br>이 기기에서 포털에 이미 넣었다면 자동으로 인식돼요.</p>' +
      '<div class="eg"><button type="button" data-act="settings">⚙️ 서버 설정 열기<i>주소와 키는 이 기기에만 저장돼요</i></button></div></div>';
  }
  function emptyChat(){
    return '<div class="empty"><div class="big">💬</div><h3>AI 비서 9명이 기다리고 있어요</h3>' +
      '<p>아래에 말을 걸면 노트북이 바로 답하고,<br>@이름 으로 부르면 그 비서 몫으로 남아요.</p>' +
      '<div class="eg">' +
      '<button type="button" data-fill="@노트북 지금 큐에 밀린 것 3줄로 알려줘"><b>지금 상황 3줄로</b><i>@노트북 · 바로 답해요</i></button>' +
      '<button type="button" data-fill="@큐 이번 주 대전 로컬 맛집 후보 3곳만 근거랑 같이"><b>맛집 후보 3곳</b><i>@큐 · 리서치</i></button>' +
      '<button type="button" data-fill="@전체 오늘 할 일 우선순위만 정해줘 — 돈 되는 것부터"><b>오늘 우선순위</b><i>@전체 · 모두에게</i></button>' +
      '</div></div>';
  }
  function agentCls(key){
    const a = roomAgentById(key);
    return 'w-' + ((a && a.color) || 'me');
  }
  function bubbleMsg(it){
    const mine = roomIsMine(it);
    const key = roomSenderKey(it);
    const who = roomAgentById(key) || ROOM_ME;
    const st = roomStatus(it);
    const tg = roomTargetLabel(roomTargetKey(it));
    const body = roomMsgText(it) || (mine ? '' : String((it && (it.result || it.error)) || '').trim()) || '(내용 없음)';
    const plain = roomIsPlainReply(it);
    const meta = [
      '<span class="nm">' + esc(who.icon + ' ' + (mine ? '성래 님' : who.name)) + '</span>',
      (mine && tg.id === 'portal') ? '' : '<span class="to">→ ' + esc(tg.label) + '</span>',
      plain ? '' : '<span class="chip ' + st.c + '">' + esc(st.t) + '</span>',
      it.auto_approved ? '<span class="chip">자동(위임)</span>' : '',
      '<span class="tm">' + esc(roomWhen(it.created_at)) + '</span>'
    ].join('');
    const av = mine ? '' : '<div class="av" aria-hidden="true">' + esc(who.icon || '🤖') + '</div>';
    return '<div class="msg ' + (mine ? 'me' : 'them') + '">' + av +
      '<div class="bwrap ' + agentCls(key) + '"><div class="meta">' + meta + '</div>' +
      '<div class="bub"><div class="txt">' + roomMd(body) + '</div></div></div></div>';
  }
  function bubbleReply(it){
    const st = String((it && it.status) || '').toUpperCase();
    const s = roomStatus(it);
    const key = roomReplyWhoKey(it);
    const who = roomAgentById(key) || roomAgentById('notebook');
    const bot = roomReplyAt(it);
    const chat = roomIsChat(it);
    let cls = '', inner = '';
    if(st === 'PENDING'){
      cls = 'sys';
      const tg = roomTargetKey(it);
      const tl = roomTargetLabel(tg);
      const wait = (tg === 'notebook')
        ? '노트북이 60초마다 확인해요'
        : (chat && tg === 'all') ? '등록된 비서들이 다음 확인 때 읽어요'
        : tl.label + roomJosa(tl.name, '이', '가') + ' 다음 확인 때 읽어요';
      inner = '<span class="typing"><i></i><i></i><i></i></span>차례를 기다려요 — ' + esc(wait);
    } else if(st === 'WAITING_APPROVAL'){
      inner = (chat ? '이건 실행이 필요해 보여요. ' : '') + '승인은 포털 회의실에서 해주세요 (15분 안에).';
    } else if(st === 'RUNNING'){
      inner = chat ? '답장 쓰는 중이에요…' : '실행 중이에요…';
    } else if(st === 'DONE'){
      inner = chat ? roomMd(String(it.result || '네, 알겠습니다.'))
        : roomMd('✅ ' + String(it.result || '완료'));
    } else if(st === 'FAILED' || st === 'TIMEOUT_REVIEW'){
      cls = 'err';
      inner = esc(it.error ? '⚠️ ' + it.error : '⚠️ 답장을 만들지 못했어요');
    } else if(st === 'REVIEW_NEEDED'){
      inner = esc(it.block_reason || it.error || '검토가 필요해요');
    } else if(st === 'REJECTED'){
      cls = 'sys'; inner = '승인되지 않았어요';
    } else if(st === 'EXPIRED'){
      cls = 'sys'; inner = '승인 시간이 지나 실행하지 않았어요';
    } else {
      inner = roomMd(String(it.result || it.error || roomMsgText(it)));
    }
    const badge = (st !== 'RUNNING' && st !== 'PENDING') &&
      ''.concat('<span class="chip rep">답장</span><span class="chip ' + s.c + '">' + esc(s.t) + '</span>');
    const av = '<div class="av" aria-hidden="true">' + esc((who && who.icon) || '🖥️') + '</div>';
    return '<div class="msg them">' + av +
      '<div class="bwrap ' + agentCls(key) + '">' +
      '<div class="meta"><span class="nm">' + esc((who && who.icon) + ' ' + ((who && who.name) || '노트북')) + '</span>' +
      (badge || '') + '<span class="tm">' + esc(roomWhen(bot)) + '</span></div>' +
      '<div class="bub ' + cls + '"><div class="txt">' + inner + '</div></div></div></div>';
  }
  function sigOf(){
    return S.items.map(i => [i.id, i.status, String(i.result || '').length, i.replied_by || '', i.beat_at || ''].join('~')).join('|');
  }
  function renderFeed(force){
    const box = $('feed');
    if(!configured()){ box.innerHTML = emptySetup(); S.sig = ''; bindFeedButtons(); return; }
    if(S.err && !S.items.length){
      box.innerHTML = '<div class="empty"><div class="big">📡</div><h3>' + esc(S.err) + '</h3>' +
        '<p>잠시 뒤 ⟳ 로 다시 확인해 주세요.<br>계속 그러면 서버 설정의 주소·키를 확인해 주세요.</p></div>';
      S.sig = ''; return;
    }
    if(!S.items.length){ box.innerHTML = emptyChat(); S.sig = ''; bindFeedButtons(); return; }
    const sig = sigOf();
    if(!force && sig === S.sig) return;
    S.sig = sig;
    const near = nearBottom(), keep = box.scrollTop;
    let html = '', day = '';
    S.items.slice().reverse().forEach(it => {
      const d = roomDay(it.created_at);
      if(d && d !== day){ html += '<div class="day"><span>' + esc(d) + '</span></div>'; day = d; }
      html += bubbleMsg(it);
      if(roomShowReply(it)) html += bubbleReply(it);
    });
    html += '<div style="height:6px"></div>';
    box.innerHTML = html;
    if(!S.painted || near){ box.scrollTop = box.scrollHeight; S.painted = true; jumpOff(); }
    else { box.scrollTop = keep; jumpOn(); }
  }
  function bindFeedButtons(){
    const box = $('feed');
    box.querySelectorAll('button[data-act="settings"]').forEach(b => { b.onclick = openSheet; });
    box.querySelectorAll('button[data-fill]').forEach(b => {
      b.onclick = () => { const i = $('inp'); i.value = b.dataset.fill || ''; i.focus(); onInput(); };
    });
  }

  /* ── 편대 서랍 ── */
  function usageOf(id){
    const u = S.usage && S.usage[id];
    return (u && roomNum(u.pct) !== null) ? u : null;
  }
  function signalOf(id){ return (S.sigs && S.sigs[id]) || null; }
  function summaryPills(){
    const ids = ROOM_AGENTS.filter(a => a.quota !== false).map(a => a.id);
    const c = roomUseSummary(ids, S.usage, S.sigs, Date.now());
    return ['danger', 'soon', 'ok', 'na', 'unknown'].map(k =>
      '<span class="pill ' + k + '"><i></i>' + ROOM_USE_TXT[k] + ' <b>' + c[k] + '</b></span>').join('');
  }
  function agentRow(a, act){
    // 사용량 칸이 없는 비서(노트북 = 실행 엔진)는 % 대신 활동만 — 숫자를 안 내는 계정과 섞지 않게
    const v = a.quota === false ? null : roomUseView(a.id, usageOf(a.id), signalOf(a.id), Date.now());
    const hb = S.hb && S.hb.heartbeat;
    const min = (a.id === 'notebook' && hb) ? roomNum(hb.min) : act[a.id];
    let when = '기록 없음', cls = '';
    if(min !== null && min !== undefined){ when = (a.id === 'notebook' ? '응답 ' : '활동 ') + roomAgo(min); if(min <= 30) cls = 'on'; else if(min <= 180) cls = ''; else cls = 'away'; }
    let bar = '';
    if(v && v.pct !== null){
      bar = '<div class="bar"><span class="track" aria-hidden="true"><i class="fill ' + v.state + '" style="width:' + v.pct + '%"></i></span>' +
        '<span class="pct">' + esc(v.label) + '</span></div>';
    } else if(v && v.state === 'na'){
      bar = '<div class="bar"><span class="track" aria-hidden="true"><i class="fill na"></i></span>' +
        '<span class="pct na">' + esc(v.label) + '</span></div>';
    } else if(v){
      bar = '<div class="bar"><span class="pct solo ' + (v.stale ? 'stale' : 'none') + '">' + esc(v.label) + '</span></div>';
    }
    return '<div class="ag"><div class="av" aria-hidden="true">' + esc(a.icon) + '</div>' +
      '<div class="ag-b"><div class="ag-n">' + esc(a.name) + '<span class="id">' + esc(a.id) + '</span>' +
      '<span class="st ' + cls + '">' + esc(when) + '</span></div>' +
      '<div class="ag-d">' + esc(a.duty) + '</div>' + bar +
      (v && v.note ? '<div class="ag-m">' + esc(v.note) + '</div>' : '') + '</div></div>';
  }
  function enginesHtml(){
    const defs = [
      {id: 'claude', name: '노트북 · Claude', icon: '⚡'},
      {id: 'agy', name: '노트북 · 제미나이', icon: '✨'},
      {id: 'freellmapi', name: '노트북 · FreeLLMAPI', icon: '🆓'},
      {id: 'pc', name: '회사 PC · Claude Code', icon: '💻'}
    ];
    // 보고가 있거나(지난 값 포함) 살아 있는 신호가 있는 엔진만 — 없으면 줄을 만들지 않는다
    const rows = defs.filter(d => usageOf(d.id) || signalOf(d.id));
    if(!rows.length) return '';
    return '<div style="padding:14px 10px 4px;font-size:11.5px;font-weight:800;color:var(--hint)">엔진 사용량</div>' +
      rows.map(d => agentRow({id: d.id, name: d.name, icon: d.icon, duty: '남은 %'}, {})).join('');
  }
  function renderDrawer(){
    const act = roomLastActivity(S.items, Date.now());
    $('dsum').innerHTML = summaryPills();
    $('dlist').innerHTML = ROOM_AGENTS.map(a => agentRow(a, act)).join('') + enginesHtml();
    const hb = S.hb && S.hb.heartbeat;
    const c = S.sum || {};
    const lines = [];
    lines.push('서버 <b>' + (configured() ? (S.err ? '오류 — ' + esc(S.err) : '연결됨') : '설정 전') + '</b>' +
      (S.at ? ' · 마지막 확인 <b>' + esc(roomClock(S.at)) + '</b>' : ''));
    lines.push('노트북 <b>' + (hb && roomNum(hb.min) !== null ? roomAgo(hb.min) : '신호 없음') + '</b>' +
      ' · 대기 <b>' + (c.pending || 0) + '</b> · 승인 <b>' + (c.waiting || 0) + '</b> · 실행 <b>' + (c.running || 0) + '</b>');
    lines.push('잔여 %는 포털·비서가 기록한 값이에요 — ' + roomResetText('pi1') +
      ' · 리셋이 지나면 지난 값은 지우고 새 보고를 기다려요(회사 PC는 월요일 09:00)');
    lines.push('숫자를 안 내는 계정(피클 무료 등)은 가동 신호로만 「비공개」 · 위험 &lt;10% · 임박 &lt;30%');
    const cur = roomWsPick(S.wss, S.ws);
    const wsOpts = (S.wss.length ? S.wss : ['hub-agent']).map(w =>
      '<option value="' + esc(w) + '"' + (w === cur ? ' selected' : '') + '>' + esc(roomWsName(w)) + '</option>').join('');
    $('dfoot').innerHTML = lines.map(l => '<div>' + l + '</div>').join('') +
      '<div class="wsrow"><label for="d-ws">보내는 곳</label><select id="d-ws">' + wsOpts + '</select></div>';
    const sel = $('d-ws');
    if(sel) sel.onchange = () => { S.ws = sel.value; lsSet('room_ws', S.ws); toast('보내는 곳 — ' + roomWsName(S.ws)); };
  }
  function drawerOpen(){
    $('scrim').classList.add('on');
    $('drawer').classList.add('on');
    $('drawer').setAttribute('aria-hidden', 'false');
    renderDrawer();
    if(configured() && Date.now() - S.usageAt > 60000) fetchUsage();
    if(configured() && Date.now() - S.statusAt > 60000) fetchStatus();
    if(Date.now() - S.sigAt > 5 * 60000) fetchSignals();   // 신호는 5분에 한 번이면 충분해요
  }
  function drawerClose(){
    $('scrim').classList.remove('on');
    $('drawer').classList.remove('on');
    $('drawer').setAttribute('aria-hidden', 'true');
  }

  /* ── 입력바 ── */
  function renderChips(){
    $('chips').innerHTML = ROOM_CHIPS.map(l =>
      '<button type="button" class="mchip' + (l === '@전체' ? ' all' : '') + '" data-m="' + esc(l) + '">' + esc(l) + '</button>'
    ).join('');
    $('chips').querySelectorAll('button').forEach(b => { b.onclick = () => insertMention(b.dataset.m); });
  }
  function insertMention(label){
    const inp = $('inp');
    const s = String(inp.value || '');
    const a = typeof inp.selectionStart === 'number' ? inp.selectionStart : s.length;
    const b = typeof inp.selectionEnd === 'number' ? inp.selectionEnd : a;
    const before = s.slice(0, a), after = s.slice(b);
    const sp = (before && !/\s$/.test(before)) ? ' ' : '';
    const ins = sp + label + ' ';
    inp.value = before + ins + after;
    const pos = (before + ins).length;
    try { inp.focus(); inp.setSelectionRange(pos, pos); } catch(e) {}
    onInput();
  }
  function autoGrow(){
    const inp = $('inp');
    inp.style.height = 'auto';
    inp.style.height = Math.min(132, Math.max(42, inp.scrollHeight)) + 'px';
  }
  function currentTarget(){
    return roomTargetFromText($('inp').value) || 'all';
  }
  function onInput(){
    autoGrow();
    const text = $('inp').value;
    const t = roomTargetLabel(currentTarget());
    $('to').innerHTML = '→ <b>' + esc(t.label) + '</b>';
    $('to').querySelector('b').className = '';
    const n = text.length;
    $('cnt').textContent = n + '/2000';
    $('cnt').classList.toggle('warn', n > 1900);
    const cur = roomTargetFromText(text);
    const map = roomMentionMap();
    $('chips').querySelectorAll('button').forEach(b => {
      b.dataset.on = (cur && map[b.dataset.m] === cur) ? '1' : '0';
    });
  }
  async function send(){
    if(S.sending) return;
    const inp = $('inp');
    const text = String(inp.value || '').trim();
    if(!configured()){ openSheet(); return; }
    if(!text){ toast('보낼 말을 적어주세요'); return; }
    if(text.length > 2000){ toast('2,000자 안으로 줄여주세요'); return; }
    S.sending = true;
    const btn = $('send');
    btn.disabled = true;
    btn.textContent = '…';
    try{
      const target = roomTargetFromText(text) || 'all';
      const payload = {prompt: text, mode: 'ask', kind: 'chat', target: target};
      const ws = roomWsPick(S.wss, S.ws) || 'hub-agent';
      const d = await api('queue_enqueue', {type: 'claude_prompt', workspace: ws, payload: payload, source: 'portal', client_id: 'portal'});
      if(!d || d.ok !== true){ toast('접수 실패 — ' + ((d && (d.error || d.code)) || '서버 확인')); return; }
      inp.value = '';
      onInput();
      pinned = true;
      toast(d.duplicate ? '같은 말이 이미 대기 중이에요' : roomTargetLabel(target).label + ' 앞으로 보냈어요');
      await load('full');
    } catch(e){
      toast(e && e.code === 'unauthorized' ? '비밀 키가 맞지 않아요 (⚙️ 서버 설정)' : '보내지 못했어요 — 연결을 확인해 주세요');
    } finally {
      S.sending = false;
      btn.disabled = false;
      btn.innerHTML = SEND_ICON;
    }
  }

  /* ── 설정 시트 ── */
  function openSheet(){
    const u = $('s-url'), k = $('s-key');
    u.value = serverUrl();
    k.value = '';
    k.placeholder = serverKey() ? '(저장돼 있어요 — 바꿀 때만 입력)' : '포털 시크릿 키 (32자 이상)';
    $('s-msg').textContent = '';
    $('sheet').classList.add('on');
    setTimeout(() => { try { (serverUrl() ? k : u).focus(); } catch(e) {} }, 60);
  }
  function closeSheet(){ $('sheet').classList.remove('on'); }
  async function saveSheet(){
    const msg = $('s-msg');
    const url = $('s-url').value.trim();
    let key = $('s-key').value.trim();
    if(!key) key = serverKey();
    const say = (t, bad) => { msg.textContent = t; msg.style.color = bad ? 'var(--bad)' : 'var(--sub)'; };
    if(!/^https:\/\/script\.google\.com\/(?:a\/[^\/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)){
      say('웹 앱 주소 형식이 아니에요 (https://script.google.com/macros/s/…/exec)', true); return;
    }
    if(key.length < 32){ say('비밀 키는 32자 이상이에요', true); return; }
    say('연결 테스트 중…');
    try{
      const r = await apiRaw(url, key, 'ping', {});
      if(!r || r.ok !== true) throw new Error((r && r.error) || '연결 실패');
      lsSet('portal_server_url', url);
      lsSet('portal_server_key', key);
      closeSheet();
      S.err = '';
      hideStrip();
      toast('연결됐어요 ✓');
      S.painted = false;
      await load('full');
    } catch(e){
      say('연결 테스트 실패 — ' + (e.message || '주소·키를 확인해 주세요'), true);
    }
  }

  /* ── 불러오기 ── */
  async function load(kind){
    if(S.busy) return;
    if(!configured()){ S.err = ''; renderHead(); renderFeed(true); return; }
    S.busy = true;
    $('refresh').classList.add('spin');
    try{
      const d = await api('queue_list', {limit: 20});
      if(d && d.ok === true && Array.isArray(d.items)){
        S.items = d.items;
        S.at = d.at || '';
        S.sum = {
          pending: Number(d.pending) || 0, running: Number(d.running) || 0, waiting: Number(d.waiting) || 0,
          timeout: Number(d.timeout) || 0, done: Number(d.done) || 0, failed: Number(d.failed) || 0
        };
        S.chatOk = (typeof d.chat === 'boolean') ? d.chat : null;
        if(Array.isArray(d.workspaces) && d.workspaces.length) S.wss = d.workspaces.map(String).slice(0, 20);
        S.err = '';
        hideStrip();
      } else {
        const code = d && d.code;
        S.err = code === 'unauthorized' ? '비밀 키 오류'
          : code === 'schema' ? '시트 형식 오류'
          : (d && /알 수 없는 요청/.test(String(d.error || ''))) ? '서버가 오더함을 모르는 배포예요'
          : '오더 목록을 못 읽었어요';
        showStrip(S.err + ' — 설정을 확인해 주세요', true);
      }
    } catch(e){
      S.err = (e && e.code === 'unauthorized') ? '비밀 키 오류'
        : (e && e.code === 'noconfig') ? '서버 설정 필요'
        : '연결 실패';
      if(S.err === '서버 설정 필요'){ renderFeed(true); renderHead(); return; }
      showStrip(S.err + ' — 잠시 뒤 ⟳ 로 다시 확인', true);
    } finally {
      S.busy = false;
      $('refresh').classList.remove('spin');
    }
    S.lastFetch = Date.now();
    renderHead();
    renderFeed();
    renderDrawer();
    if(kind === 'full'){ fetchUsage(); fetchStatus(); fetchSignals(); }
    else if(Date.now() - S.statusAt > STATUS_EVERY) fetchStatus();
  }
  async function fetchUsage(){
    if(!configured()) return;
    try{
      const d = await api('usage_get');
      if(d && d.ok === true && Array.isArray(d.items)){
        d.items.forEach(x => {
          if(!x || !x.id || roomNum(x.pct) === null) return;
          const at = String(x.at || '');
          const cur = S.usage[x.id];
          if(cur && Date.parse(cur.at || '') > (Date.parse(at) || 0)) return;
          S.usage[x.id] = {pct: Number(x.pct), at: at, note: String(x.note || '')};
        });
        S.usageAt = Date.now();
        lsSet('room_usage_cache', JSON.stringify({at: new Date().toISOString(), items: S.usage}));
        renderDrawer();
      }
    } catch(e){ /* 사용량은 없어도 대화는 돼요 */ }
  }
  async function fetchStatus(){
    if(!configured()) return;
    try{
      const d = await api('queue_status');
      if(d && d.ok){ S.hb = d; S.statusAt = Date.now(); renderHead(); renderDrawer(); }
    } catch(e){ /* 상태는 없어도 대화는 돼요 */ }
  }
  /* ── 가동 신호 — 숫자를 안 내는 계정도 '가동 중 · 잔여 비공개'로 정직하게 ── */
  const SIG_FILES = [
    {path: '../status/agent.json'},                        // 피원(pi1)
    {path: '../status/pi2.json', as: 'pi2'}                 // 피투(pi2) — 한 사람 모양
  ];
  function mergeSignals(out){
    let got = false;
    Object.keys(out || {}).forEach(id => {
      const sig = out[id];
      if(!sig || !sig.at) return;
      const cur = S.sigs[id];
      if(cur && (Date.parse(cur.at) || 0) >= (Date.parse(sig.at) || 0)) return;
      S.sigs[id] = sig; got = true;
    });
    return got;
  }
  async function fetchSignals(){
    let got = false;
    if(configured()){
      try{ const d = await api('agent_status'); if(d && d.ok) got = mergeSignals(roomSignalsFrom(d, 'server')) || got; }
      catch(e){ /* 신호는 없어도 사용량판은 그려요 */ }
    }
    if(typeof fetch === 'function'){
      for(const f of SIG_FILES){
        try{
          const r = await fetch(f.path + '?t=' + Math.floor(Date.now() / 600000), {cache: 'no-store'});
          if(r && r.ok) got = mergeSignals(roomSignalsFrom(await r.json(), f.as)) || got;
        } catch(e){ /* 파일이 아직 없을 수도 있어요 */ }
      }
    }
    if(got){
      S.sigAt = Date.now();
      lsSet('room_sig_cache', JSON.stringify({at: new Date().toISOString(), items: S.sigs}));
      renderDrawer();
    }
  }
  function loadLocalSignals(){
    try{
      const c = JSON.parse(lsGet('room_sig_cache') || '{}');
      mergeSignals(c && c.items);
    } catch(e) {}
  }
  function loadLocalUsage(){
    try{
      const o = JSON.parse(lsGet('portal_use_v1') || '{}');
      Object.keys(o || {}).forEach(id => {
        const x = o[id];
        if(x && roomNum(x.pct) !== null) S.usage[id] = {pct: Number(x.pct), at: String(x.at || ''), note: String(x.note || '')};
      });
    } catch(e) {}
    try{
      const c = JSON.parse(lsGet('room_usage_cache') || '{}');
      Object.keys((c && c.items) || {}).forEach(id => {
        const x = c.items[id];
        if(!x || roomNum(x.pct) === null) return;
        const cur = S.usage[id];
        if(cur && Date.parse(cur.at || '') >= (Date.parse(x.at || '') || 0)) return;
        S.usage[id] = {pct: Number(x.pct), at: String(x.at || ''), note: String(x.note || '')};
      });
    } catch(e) {}
  }

  /* ── 이벤트 ── */
  function bind(){
    $('refresh').onclick = () => load('full');
    $('ppl').onclick = drawerOpen;
    $('drawer-x').onclick = drawerClose;
    $('scrim').onclick = drawerClose;
    $('d-refresh').onclick = () => { load('full'); toast('새로고침 중…'); };
    $('d-settings').onclick = () => { drawerClose(); openSheet(); };
    $('strip-b').onclick = () => { if(!configured()) openSheet(); else load('full'); };
    $('send').onclick = send;
    $('inp').addEventListener('input', onInput);
    $('inp').addEventListener('keydown', e => {
      if(e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      send();
    });
    $('feed').addEventListener('scroll', () => {
      pinned = nearBottom();
      if(pinned) jumpOff();
    });
    $('jump').onclick = () => { pinned = true; const b = $('feed'); b.scrollTop = b.scrollHeight; jumpOff(); };
    $('sheet-bg').onclick = closeSheet;
    $('s-cancel').onclick = closeSheet;
    $('s-save').onclick = saveSheet;
    $('s-key').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); saveSheet(); } });
    document.addEventListener('keydown', e => {
      if(e.key !== 'Escape') return;
      if($('sheet').classList.contains('on')) closeSheet();
      else if($('drawer').classList.contains('on')) drawerClose();
    });
    document.addEventListener('visibilitychange', () => {
      if(document.hidden) return;
      if(Date.now() - S.lastFetch > 8000) load('quiet');
    });
    window.addEventListener('focus', () => { if(Date.now() - S.lastFetch > 8000) load('quiet'); });
    window.addEventListener('online', () => { if(Date.now() - S.lastFetch > 3000) load('quiet'); });
    setInterval(() => { if(document.hidden) return; if(Date.now() - S.lastFetch < 12000) return; load('quiet'); }, POLL_MS);
  }

  function init(){
    renderChips();
    bind();
    onInput();
    loadLocalUsage();
    loadLocalSignals();
    renderHead();
    renderFeed(true);
    renderDrawer();
    fetchSignals();          // 신호는 서버 없이도 저장소 파일에서 읽어요
    if(!configured()){
      showStrip('서버를 한 번만 연결하면 대화가 열려요', false);
      setTimeout(openSheet, 450);
      return;
    }
    load('full');
  }

  /* Service Worker — 홈 화면 앱 설치용. 네트워크 우선이라 예전 화면이 남지 않아요. */
  if('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')){
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', {scope: './'}).catch(() => {});
    });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
