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
  {id: 'cue',      name: '큐',   icon: '🌀', color: 'cue',  role: '일정 전담 · 리서처', duty: '레이 님 일정 관리 전담 · 최신 정보 리서치·팩트체크', quota: true},
  {id: 'cue2',     name: '큐투', icon: '🌀', color: 'cue',  role: '리서처 · 부계정',   duty: '큐의 부계정 — 리서치·팩트체크 보조', quota: true},
  {id: 'vooy',     name: '부이', icon: '🫛', color: 'vooy', role: '정리 담당',         duty: '후보 비교·체크리스트·채용 리서치·PDF/HWP 문서 읽기', quota: true},
  {id: 'vooy2',    name: '뷔투', icon: '🫛', color: 'vooy', role: '정리 담당 · 부계정', duty: '부이의 부계정 — 비교·정리 보조', quota: true},
  {id: 'keyring',  name: '키링', icon: '🔑', color: 'key',  role: '생활 예약',         duty: '전화·KTX/예약·대전 밥집/쇼핑커넥트 발굴', quota: true},
  {id: 'keyring2', name: '키투', icon: '🔑', color: 'key',  role: '생활 예약 · 부계정', duty: '키링의 부계정 — 예약·전화 보조', quota: true}
];
/** 입력바 빠른 멘션 칩 — 사용자 확정 순서 그대로 */
const ROOM_CHIPS = ['@전체', '@피원', '@피투', '@노트북', '@큐', '@큐투', '@부이', '@뷔투', '@키링', '@키투'];
/* 옛 부름·영문 id·줄인 이름도 같은 사람으로 (2026-11-26 사용자 확정 — 한 비서를 여러 이름으로 부른다)
 *  · 포털 화면(index.html)의 AGENT_ALIASES 와 같은 목록을 유지합니다. 다른 쪽만 고치면 이름이 갈라집니다.
 *  · '레이'·'포털'처럼 나를 부르는 이름은 'portal' — 대상으로는 잡지 않습니다(roomTargetFromText). */
const ROOM_ALIASES = {
  '피원': 'pi1', '피클1': 'pi1', '레이의피클': 'pi1', 'pickle1': 'pi1', 'pickle-pi1': 'pi1', 'pickle': 'pi1', 'pk': 'pi1', 'pi1': 'pi1',
  '피투': 'pi2', '피클2': 'pi2', 'pickle2': 'pi2', 'pickle-pi2': 'pi2', 'pi2': 'pi2',
  '큐': 'cue', 'cue': 'cue',
  '큐투': 'cue2', '큐2': 'cue2', 'cue2': 'cue2',
  '부이': 'vooy', 'vooy': 'vooy',
  '뷔투': 'vooy2', '부이2': 'vooy2', '부이투': 'vooy2', 'vooy2': 'vooy2',
  '키링': 'keyring', 'keyring': 'keyring',
  '키투': 'keyring2', '키링2': 'keyring2', '키링투': 'keyring2', 'keyring2': 'keyring2',
  '레이': 'portal', '포털': 'portal', 'portal': 'portal', 'me': 'portal',
  '집노트북': 'notebook', '노트북': 'notebook', 'notebook': 'notebook', 'hub-agent': 'notebook', 'nb': 'notebook'
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
const ROOM_ME = {id: 'portal', name: '레이 님', icon: '🌐', color: 'me', duty: '나 (포털)'};

function roomPad(n){ return String(n).padStart(2, '0'); }
function roomNum(v){ return (typeof v === 'number' && isFinite(v)) ? v : null; }
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
}
/* ── 🎨 비서 마크 (2026-11-26) — 아이콘만으로 9명이 안 구분돼서 (포털 index.html 과 같은 규칙)
 *  계열 = 글리프 + 색(피클 오이·초록 / 큐 손·슬레이트 / 부이 V·보라 / 키링 열쇠·앰버 / 노트북 모니터·블루)
 *   호기 = 1호기 채움 / 2호기 밝은 바탕 + 계열 테두리 + 숫자 배지 — 작은 폰 화면에서도 모양으로 읽힌다. */
const ROOM_MARKS = {
  pi1:      {c: 'mk-pi1',   g: 'pi',   n: 1},
  pi2:      {c: 'mk-pi2',   g: 'pi',   n: 2},
  cue:      {c: 'mk-cue',   g: 'cue',  n: 1},
  cue2:     {c: 'mk-cue2',  g: 'cue',  n: 2},
  vooy:     {c: 'mk-vooy',  g: 'vooy', n: 1},
  vooy2:    {c: 'mk-vooy2', g: 'vooy', n: 2},
  keyring:  {c: 'mk-key',   g: 'key',  n: 1},
  keyring2: {c: 'mk-key2',  g: 'key',  n: 2},
  notebook: {c: 'mk-nb',    g: 'nb',   n: 0},
  portal:   {c: 'mk-me',    g: 'me',   n: 0},
  all:      {c: 'mk-all',   g: 'all',  n: 0}
};
const ROOM_MARK_BASE = {pi: 'pi', cue: 'cue', vooy: 'vooy', buy: 'vooy', key: 'key', keyring: 'key', nb: 'nb', notebook: 'nb', portal: 'me'};
const ROOM_GLYPH = {
  pi: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor">' +
    '<path d="M12 4.1c1.5 0 2.5.8 3.1 2 1.4.3 2.3 1.4 2.5 2.7 1 .6 1.6 1.7 1.6 2.9 0 .9-.4 1.8-1 2.4.5.6.8 1.3.8 2.1 0 1.7-1.3 3-3 3-.6 0-1.2-.2-1.6-.5-.6.6-1.5 1-2.4 1s-1.8-.4-2.4-1c-.5.3-1 .5-1.6.5-1.7 0-3-1.3-3-3 0-.8.3-1.5.8-2.1-.6-.6-1-1.5-1-2.4 0-1.2.6-2.3 1.6-2.9.2-1.3 1.1-2.4 2.5-2.7C9.5 4.9 10.5 4.1 12 4.1z"/>' +
    '<path d="M12.4 4.4c-.1-1.1.3-1.9 1.2-2.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>' +
    '</g></svg>',
  cue: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor">' +
    '<rect x="7.4" y="10.2" width="9.4" height="9" rx="3.4"/>' +
    '<rect x="8.2" y="5.8" width="2.4" height="6.6" rx="1.2"/>' +
    '<rect x="10.9" y="4.2" width="2.4" height="8.2" rx="1.2"/>' +
    '<rect x="13.6" y="6.2" width="2.4" height="6.2" rx="1.2"/>' +
    '<rect x="4.6" y="11.8" width="2.4" height="5.4" rx="1.2" transform="rotate(-20 5.8 14.5)"/>' +
    '</g></svg>',
  vooy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.2 8 12 17.8l5.8-9.8" fill="none" stroke="currentColor" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="5.2" r="1.7" fill="currentColor"/></svg>',
  key: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="8.2" cy="8.8" r="3.9" stroke-width="2.9"/>' +
    '<path d="M10.9 11.6 19.4 20.1M16.2 16.9l2.2-2.2M18.6 19.3l2-2" stroke-width="2.7"/>' +
    '</g></svg>',
  nb: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="4.4" y="5.4" width="15.2" height="9.8" rx="1.9" stroke-width="2.6"/>' +
    '<path d="M2.6 18.8h18.8" stroke-width="2.6"/></g></svg>',
  me: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.8" fill="currentColor"/></svg>',
  all: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor">' +
    '<circle cx="12" cy="8.6" r="2.6"/><circle cx="6.2" cy="13.4" r="2"/><circle cx="17.8" cy="13.4" r="2"/>' +
    '<path d="M7.6 20c0-2.4 2-4.4 4.4-4.4s4.4 2 4.4 4.4z"/></g></svg>'
};
/** id → {c: 색 클래스, g: 글리프, n: 호기} — 모르는 id 는 별명표를 거쳐 같은 계열로 */
function roomMarkInfo(id){
  const k = String(id == null ? '' : id).toLowerCase().trim();
  const al = ROOM_ALIASES[k];
  const key = al || k;
  if(ROOM_MARKS[key]) return ROOM_MARKS[key];
  const m = /^([a-z][a-z_]*?)_?(\d{1,2})$/.exec(key);
  const base = m ? m[1] : key;
  const no = m ? Number(m[2]) : 0;
  const fam = ROOM_MARK_BASE[base];
  if(!fam) return {c: 'mk-me', g: 'me', n: 0};
  const unit = ROOM_MARKS[fam + (no === 2 ? '2' : '')] || ROOM_MARKS[fam + '1'] || ROOM_MARKS.portal;
  return {c: unit.c, g: unit.g, n: no};
}
/** 비서 마크 HTML — 타임라인 아바타·이름·빠른 멘션 칩·지금 작업 중·편대 서람이 같이 쓴다 */
function roomMark(id, opt){
  const o = opt || {};
  const k = String(id == null ? '' : id).toLowerCase().trim();
  const info = roomMarkInfo(k);
  const badge = (!o.mini && info.n) ? '<span class="mk-b">' + info.n + '</span>' : '';
  return '<span class="mk ' + info.c + (info.n >= 2 ? ' v2' : '') + (o.mini ? ' mini' : '') + '"' +
    ' data-mark="' + esc(k) + '"' + (o.title ? ' title="' + esc(o.title) + '"' : '') + ' aria-hidden="true">' +
    (ROOM_GLYPH[info.g] || ROOM_GLYPH.me) + badge + '</span>';
}
function roomAgentById(id){
  const k = String(id == null ? '' : id).toLowerCase().trim();
  if(!k) return null;
  if(k === 'portal' || k === 'me' || k === 'phone' || k === 'telegram') return ROOM_ME;
  for(let i = 0; i < ROOM_AGENTS.length; i++) if(ROOM_AGENTS[i].id === k) return ROOM_AGENTS[i];
  const al = ROOM_ALIASES[k];
  if(al === 'portal') return ROOM_ME;
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
      // 나를 부르는 말(@레이)은 '나'로 읽고 대상은 그대로 둡니다 — 비서 앞으로 보내지 않습니다
      return map[l] === 'portal' ? '' : map[l];
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
/** 나(레이 님)가 보낸 말인가 — 포털·폰·텔레그램은 오른쪽 */
function roomIsMine(it){ const k = roomSenderKey(it); return k === 'portal' || k === 'phone' || k === 'telegram'; }
function roomIsChat(it){ const k = String((it && it.kind) || '').toLowerCase(); return k === 'chat' || k === 'approval'; }
/** 🔔 승인 요청 표시 — 결정 대기 / ✅ 승인됨 / ⏸ 보류 / 🚫 거절됨 (포털 ordApprovalChip 과 같은 말) */
function roomApprovalChip(it){
  const a = it && it.approval;
  const isReq = String((it && it.kind) || '').toLowerCase() === 'approval';
  if(!isReq && !(a && a.decision)) return null;
  const d = a && a.decision;
  if(d === 'approve') return {t: '✅ 승인됨', c: 'ok'};
  if(d === 'reject') return {t: '🚫 거절됨', c: 'bad'};
  if(d === 'hold') return {t: '⏸ 보류', c: ''};
  return {t: '🔔 승인 요청 · 결정 대기', c: 'warn'};
}
/** 머리 아래 배너 — 승인 대기 N건 + 위 3건 제목. 결정은 포털 승인함에서(앱은 대화 전용) */
function roomApprovalBanner(d){
  const items = d && Array.isArray(d.items) ? d.items.filter(x => x && !x.held) : [];
  const n = d && typeof d.count === 'number' ? d.count : items.length;
  if(!n) return '';
  const top = items.slice(0, 3).map(x => {
    const src = String(x.source || '').toLowerCase();
    const a = roomAgentById(src);
    const who = x.approval_kind === 'order' ? '실행 승인' : (a ? a.name : src || '비서');
    const t = (x.approval && x.approval.title) || String(x.summary || '').split('\n')[0];
    return '<li>' + esc(who + ' · ' + roomShort(t, 46)) + '</li>';
  }).join('');
  return '<b>🔔 승인 대기 ' + n + '건</b><span class="apprb-go">포털 승인함에서 결정 ↗</span>' + (top ? '<ul>' + top + '</ul>' : '');
}
/** 대상 — all · 비서 id · portal */
function roomTargetKey(it){
  const t = String((it && it.target) || '').toLowerCase().trim();
  if(t === 'all') return 'all';
  if(t === 'portal' || t === 'phone' || t === 'telegram') return 'portal';
  const a = t ? roomAgentById(t) : null;
  if(a) return a.id;
  return 'notebook';
}
function roomTargetLabel(k){
  if(k === 'all') return {id: 'all', label: '@전체', name: '전체 비서', icon: '👥'};
  if(k === 'portal') return {id: 'portal', label: '@레이', name: '레이 님', icon: '🌐'};
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

/** 보고서 '협업 필요' 줄 — @ 없이 적은 이름도 칩으로(2026-11-26, 포털·서버와 같은 규칙) */
const ROOM_COLLAB_HEAD_RE = /^[ \t]*(?:[-*•·][ \t]*)?[*_]{0,2}(?:\[?\d{1,2}\]?[.)]?[ \t]*)?[*_]{0,2}협업[ \t]*필요[*_]{0,2}[ \t]*[:：][*_]{0,2}[ \t]*/;
const ROOM_COLLAB_STOP_RE = /^[ \t]*[*_]{0,2}(?:\d{1,2}[.)][ \t]*\S|#{1,6}[ \t]*\S)/;
const ROOM_COLLAB_NONE_RE = /^(?:[-–—·]|없음|없슴|없어|없어요|없다|없습니다|해당\s*없음|none|n\/a|n\.a\.?)$/i;
const ROOM_JOSA = ['에서','에게','한테','으로','부터','까지','처럼','보다','만큼','조차','마저','님','이','가','은','는','을','를','의','에','께','도','만','과','와','랑','로'];
function roomCollabHit(s, i, len){
  if(i > 0 && /[가-힣A-Za-z0-9_@-]/.test(s.charAt(i - 1))) return false;
  const j = i + len;
  if(j >= s.length) return true;
  const c = s.charAt(j);
  if(/[A-Za-z0-9_-]/.test(c)) return false;
  if(!/[가-힣]/.test(c)) return true;
  for(let k = 0; k < ROOM_JOSA.length; k++){
    const jo = ROOM_JOSA[k];
    if(s.substr(j, jo.length) !== jo) continue;
    const n = j + jo.length;
    if(n >= s.length) return true;
    if(!/[가-힣A-Za-z0-9_-]/.test(s.charAt(n))) return true;
  }
  return false;
}
/** 본문 속 @이름 → 칩 (이미 esc() 한 문자열에만 적용) */
function roomMentionHtml(s){
  const txt = String(s == null ? '' : s);
  const map = roomMentionMap();
  const labels = Object.keys(map).sort((a, b) => b.length - a.length);
  if(!labels.length) return txt;
  const bare = {};
  const bareLabels = [];
  labels.forEach(l => { if(l.charAt(0) !== '@') return; const nm = l.slice(1); if(!nm || map[l] === 'all') return; bare[nm] = map[l]; bareLabels.push(nm); });
  bareLabels.sort((a, b) => b.length - a.length);
  const chip = (hit, id) => {
    const a = id === 'all' ? null : roomAgentById(id);
    return '<b class="mt w-' + esc(a ? a.color : 'all') + '" title="협업 줄에서 알아본 이름">' + hit + '</b>';
  };
  const lines = txt.split('\n');
  let collab = false;
  return lines.map(line => {
    const head = ROOM_COLLAB_HEAD_RE.exec(line);
    if(head) collab = true;
    else if(!line.trim()) collab = false;
    else if(collab && ROOM_COLLAB_STOP_RE.test(line)) collab = false;
    const skipBare = !collab || (head && ROOM_COLLAB_NONE_RE.test(line.slice(head[0].length).trim()));
    let out = '', i = 0;
    while(i < line.length){
      if(line.charAt(i) === '@'){
        let hit = '';
        for(let j = 0; j < labels.length; j++){
          const l = labels[j];
          if(line.substr(i, l.length) !== l) continue;
          if(!roomMentionBoundary(line, i + l.length)) continue;
          hit = l; break;
        }
        if(hit){
          const id = map[hit];
          const a = id === 'all' ? null : roomAgentById(id);
          out += '<b class="mt w-' + esc(a ? a.color : 'all') + '">' + hit + '</b>';
          i += hit.length;
          continue;
        }
      }
      if(!skipBare && bareLabels.length){
        const b = bareLabels.filter(l => line.substr(i, l.length) === l)[0];
        if(b && roomCollabHit(line, i, b.length)){
          out += chip(b, bare[b]);
          i += b.length;
          continue;
        }
      }
      out += line.charAt(i);
      i++;
    }
    return out;
  }).join('\n');
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

/* ─────────────────────────────────────────────────────────
   🔴 지금 작업 중 · 누가 일하는지 (2026-11-26)
   · "작업중인 리스트" = 처리할 사람이 있는 오더(대기·실행·승인·검토).
     순수 답장은 일이 아니므로 뺀다(포털 ordLiveList 와 같은 규칙).
   · “누가 일하나” = ① 그 일을 잡고 있나 → ② 한도 0 인가 → ③ 최근 30분 신호/활동
     → ④ 하루 안 신호(쉬는 중) → ⑤ 하루 넘음(응답 없음) → ⑥ 신호 없음(미확인)
   · 숫자·상태를 지어내지 않는다. 근거가 없으면 '미확인'으로 남긴다.
   ───────────────────────────────────────────────────────── */
const ROOM_LIVE_ST = {RUNNING: '실행 중', WAITING_APPROVAL: '승인 대기', REVIEW_NEEDED: '검토 필요', PENDING: '차례 대기'};
const ROOM_LIVE_CLS = {RUNNING: 'run', WAITING_APPROVAL: 'wait', REVIEW_NEEDED: 'wait', PENDING: 'pend'};
const ROOM_LIVE_RANK = {RUNNING: 0, WAITING_APPROVAL: 1, REVIEW_NEEDED: 2, PENDING: 3};
const ROOM_ACT_TXT = {work: '작업 중', limit: '한도 소진', wait: '대기', idle: '쉬는 중', out: '응답 없음', unknown: '미확인'};
const ROOM_ACT_WAIT_MIN = 30;      // 30분 안에 신호·말이 있으면 곁에 있는 것(=대기)
const ROOM_LIVE_MAX = 3;           // 판에 보이는 작업 줄은 3개까지 — 나머지는 타임라인에서

/** 이 오더를 지금 누가 하고 있나 — 실행 중이면 잡은 사람(claimed_by), 아니면 받을 사람. @전체는 주인 없음 */
function roomLiveOwner(it){
  const st = String((it && it.status) || '').toUpperCase();
  if(!ROOM_LIVE_ST[st]) return '';
  if(st === 'RUNNING' && it.claimed_by) return roomSenderKey({source: it.claimed_by});
  const k = roomTargetKey(it);
  if(k === 'all') return '';
  if(!String((it && it.target) || '').trim()){          // 대상 칸이 빈 옛 줄 — 본문 @이름으로 한 번 더
    const m = roomTargetFromText(roomMsgText(it));
    if(m && m !== 'all') return m;
  }
  return k;
}
/** 지금 도는 일 — 실행 중 → 승인·검토 → 차례 대기 순, 같은 상태면 먼저 접수된 것부터 */
function roomLiveItems(items){
  const out = [];
  (Array.isArray(items) ? items : []).forEach(it => {
    const st = String((it && it.status) || '').toUpperCase();
    // 🔔 승인 요청은 레이 님 결정 대기 — 작업 리스트가 아니라 승인 배너로(2026-11-27)
    if(!it || !ROOM_LIVE_ST[st] || roomIsPlainReply(it) || String(it.kind || '').toLowerCase() === 'approval') return;
    out.push({it: it, state: st, owner: roomLiveOwner(it)});
  });
  out.sort((a, b) => (ROOM_LIVE_RANK[a.state] - ROOM_LIVE_RANK[b.state]) ||
    (String(a.it.created_at || '') < String(b.it.created_at || '') ? -1 : 1));
  return out;
}
/** 실행은 시작 시각부터, 대기는 접수 시각부터 잰다 */
function roomLiveSince(it){
  const st = String((it && it.status) || '').toUpperCase();
  if(st === 'RUNNING'){
    const t = Date.parse(String((it && (it.started_at || it.claimed_at)) || ''));
    if(isFinite(t)) return t;
  }
  const c = Date.parse(String((it && it.created_at) || ''));
  return isFinite(c) ? c : 0;
}
/** 카드에 쓸 한 줄 — 워커 규칙 문구·'클로드:' 머리말을 뗄 본문(포털과 같은 규칙) */
function roomLiveWhat(it){
  const s = String(roomMsgText(it) || '').replace(/\s+/g, ' ').trim();
  return s.length > 70 ? s.slice(0, 70) + '…' : s;
}
/** 경과를 짧게 — 12초 · 3분 · 1시간 5분 */
function roomDur(ms){
  const n = roomNum(ms);
  if(n === null || n < 0) return '';
  const s = Math.max(0, Math.round(n / 1000));
  if(s < 60) return s + '초';
  const m = Math.floor(s / 60);
  if(m < 60) return m + '분';
  const h = Math.floor(m / 60);
  return h + '시간' + (m % 60 ? ' ' + (m % 60) + '분' : '');
}
/** 비서 한 명의 지금 — 작업 중 → 한도 소진 → 대기 → 쉬는 중 → 응답 없음/미확인 */
function roomAgentAct(id, items, sigs, usage, hb, now){
  const k = String(id || '');
  const t = roomNum(now) === null ? Date.now() : now;
  if(!k) return {state: 'unknown', n: 0, min: null};
  const live = roomLiveItems(items).filter(x => x.owner === k);
  if(live.length) return {state: 'work', n: live.length, min: null};
  let min = roomSignalMin(sigs && sigs[k], t);
  const act = roomLastActivity(items, t)[k];
  if(act !== undefined && (min === null || act < min)) min = act;
  if(k === 'notebook'){                            // 노트북은 하트비트가 살아 있는 신호
    const h = hb && hb.heartbeat;
    const hm = (h && h.state && h.state !== 'unknown') ? roomNum(h.min) : null;
    if(hm !== null && (min === null || hm < min)) min = hm;
  }
  const x = usage && usage[k];
  if(roomUseFresh(k, x, t) && roomNum(x.pct) !== null && Number(x.pct) <= 0) return {state: 'limit', n: 0, min: min};
  if(min === null) return {state: 'unknown', n: 0, min: null};
  if(min <= ROOM_ACT_WAIT_MIN) return {state: 'wait', n: 0, min: min};
  if(min <= ROOM_USE_ALIVE_MIN) return {state: 'idle', n: 0, min: min};
  return {state: 'out', n: 0, min: min};
}
/** 작업 중/한도/대기/쉬는 중/응답 없음/미확인 몇 명인가 */
function roomActCounts(ids, items, sigs, usage, hb, now){
  const c = {work: 0, limit: 0, wait: 0, idle: 0, out: 0, unknown: 0};
  (Array.isArray(ids) ? ids : []).forEach(id => { c[roomAgentAct(id, items, sigs, usage, hb, now).state]++; });
  return c;
}

/* ── ✅ 완료 보고 · 지연(15분+) · 💬 스레드 · 🔎 검색 (2026-11-26) — 포털 index.html 과 같은 규칙 ──
 *  · 보고 = 끝난 오더에 달린 후속 말(reply_to = 그 오더) 또는 결과 글(result).
 *  · 보고누락 = 끝났는데 후속 말도 결과 글도 없는 경우 — 화면에 경고 카드로 남긴다.
 *  · 끝나지 않은 말이 15분을 넘으면 '지연(15분+)' — 답장만 남기고 queue_done 을 안 찍은 줄이 여기서 보인다.
 */
const ROOM_FIN_ST = {DONE: 1, FAILED: 1, TIMEOUT_REVIEW: 1, REVIEW_NEEDED: 1};
const ROOM_REP = {
  ok:   {t: '완료·보고됨',   c: 'ok'},
  auto: {t: '완료·보고됨',   c: 'ok'},
  miss: {t: '완료·보고누락', c: 'bad'},
  late: {t: '지연(15분+)',   c: 'wait'}
};
const ROOM_LATE_MIN = 15;      // 차례·실행이 이만큼 지나면 지연
const ROOM_REPORT_MIN = 12;    // 결과 글이 이보다 짧으면('완료'·'Done') 보고로 보지 않는다
function roomReplyToId(it){ return String((it && it.reply_to) || '').trim(); }
function roomFinished(it){ return !!ROOM_FIN_ST[String((it && it.status) || '').toUpperCase()]; }
function roomWantsReport(it){
  if(!it || !it.id) return false;
  if(String(it.type || '') !== 'claude_prompt') return false;   // git_pull·toss_sync 는 결과 카드가 곧 보고
  return !roomReplyToId(it);
}
function roomChildren(items, id){
  const k = String(id || '');
  if(!k) return [];
  return (Array.isArray(items) ? items : []).filter(x => x && x.id && roomReplyToId(x) === k);
}
function roomReportOf(it, items){
  if(!it || !it.id) return null;
  const by = String(it.answer_by || '').trim();
  if(by) return {by: roomSenderKey({source: by}), at: String(it.answered_at || '')};
  const kids = roomChildren(items, it.id);
  if(kids.length){
    const k = kids[kids.length - 1];
    return {by: roomReplyKey(k), at: String(k.created_at || '')};
  }
  return null;
}
function roomHasResult(it){
  return String(roomStripNote(it && (it.result || it.error))).replace(/\s+/g, ' ').trim().length >= ROOM_REPORT_MIN;
}
/** 'ok' 보고 있음 · 'auto' 결과 글로 대신 · 'miss' 보고누락 · '' 해당 없음 */
function roomReportState(it, items){
  if(!it || !it.id) return '';
  if(!roomFinished(it) || !roomWantsReport(it) || roomIsPlainReply(it)) return '';
  if(roomReportOf(it, items)) return 'ok';
  return roomHasResult(it) ? 'auto' : 'miss';
}
function roomLateMin(it, now){
  const st = String((it && it.status) || '').toUpperCase();
  if(st !== 'PENDING' && st !== 'RUNNING') return 0;
  const t = Date.parse(String((it && (it.claimed_at || it.created_at)) || ''));
  if(!isFinite(t)) return 0;
  const n = roomNum(now) === null ? Date.now() : now;
  return Math.floor(Math.max(0, n - t) / 60000);
}
function roomReportChip(it, items, now){
  if(roomIsPlainReply(it)) return null;      // 순수 답장은 아무도 집지 않는다 — '지연'이 아니다
  const st = String((it && it.status) || '').toUpperCase();
  if(st === 'PENDING' || st === 'RUNNING') return roomLateMin(it, now) >= ROOM_LATE_MIN ? ROOM_REP.late : null;
  const r = roomReportState(it, items);
  return r ? ROOM_REP[r] : null;
}
/** 💬 스레드 — reply_to 사슬을 거슬러 첫 말을 찾고, 거기 이어진 답장을 오래된 순으로 */
function roomThreadRoot(items, id){
  const byId = {};
  (Array.isArray(items) ? items : []).forEach(x => { if(x && x.id) byId[x.id] = x; });
  let cur = String(id || '').trim(), guard = 0;
  const seen = {};
  while(cur && !seen[cur] && guard++ < 40){
    seen[cur] = 1;
    const it = byId[cur];
    const p = it ? roomReplyToId(it) : '';
    if(!p || p === cur || !byId[p]) break;
    cur = p;
  }
  return cur;
}
function roomThreadItems(items, id){
  const list = Array.isArray(items) ? items : [];
  const root = roomThreadRoot(list, id);
  if(!root) return [];
  const byId = {}, kids = {};
  list.forEach(x => { if(x && x.id) byId[x.id] = x; });
  list.forEach(x => {
    const p = x && roomReplyToId(x);
    if(!p || !byId[p]) return;
    (kids[p] = kids[p] || []).push(x);
  });
  const out = [], seen = {}, queue = [byId[root] || {id: root}];
  while(queue.length){
    const x = queue.shift();
    if(!x || !x.id || seen[x.id]) continue;
    seen[x.id] = 1; out.push(x);
    (kids[x.id] || []).slice()
      .sort((a, b) => String(a.created_at || '') < String(b.created_at || '') ? -1 : 1)
      .forEach(k => queue.push(k));
  }
  return out;
}
function roomThreadCount(items, id){ return roomThreadItems(items, id).length; }
/** 인용 박스에 보일 원문 한 줄·이름 */
function roomQuoteText(it){
  if(!it) return '';
  return roomSumLine(it) || String(it.result || it.error || '') || String(it.id || '');
}
function roomShort(t, n){
  const s = String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s;
}
function roomQuoteAuthor(it){
  const a = roomAgentById(roomSenderKey(it)) || ROOM_ME;
  return (a.icon || '🤖') + ' ' + a.name;
}
/** 🔎 키워드 검색 — 말·결과·오더 id·대상(공백으로 여러 낱말을 모두 만족해야 함) */
function roomSearchHit(it, q){
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if(!words.length) return true;
  const s = [roomMsgText(it), it && it.summary, it && it.result, it && it.error, it && it.id,
    it && it.source, it && it.claimed_by, it && it.replied_by, it && it.answer_by,
    roomTargetLabel(roomTargetKey(it)).label]
    .map(x => String(x == null ? '' : x).toLowerCase()).join(' ');
  return words.every(w => s.indexOf(w) >= 0);
}
/** 이 말이 그 비서와 얽혔는가 — 보냄·받음·처리·답장·멘션 (명시된 대상만) */
function roomAgentHit(it, key){
  const k = String(key || 'all');
  if(k === 'all') return true;
  if(!it) return false;
  if(roomSenderKey(it) === k) return true;
  if(k !== 'portal' && ['claimed_by', 'replied_by', 'answer_by'].some(f => roomSenderKey({source: it[f]}) === k)) return true;
  const t = String((it && it.target) || '').trim().toLowerCase();
  if(k !== 'portal' && t && roomTargetKey(it) === k) return true;
  const m = Array.isArray(it.mentions) ? it.mentions : [];
  return m.indexOf(k) >= 0;
}
/** 필터 한 벌 — {who, st, q}. st: all|live|miss|wait|done */
function roomVisible(it, f, items, now){
  if(!it || !it.id) return false;
  const st = String(it.status || '').toUpperCase();
  const x = f || {};
  if(x.st === 'live' && !((st === 'PENDING' || st === 'RUNNING') && !roomIsPlainReply(it))) return false;
  if(x.st === 'miss' && roomReportState(it, items) !== 'miss') return false;
  if(x.st === 'wait' && st !== 'WAITING_APPROVAL') return false;
  if(x.st === 'done' && !roomFinished(it)) return false;
  if(!roomAgentHit(it, x.who || 'all')) return false;
  if(x.q && !roomSearchHit(it, x.q)) return false;
  return true;
}
/* ── 👀 이모지 반응 (2026-11-26) — 포털 ordReactTop/ordReactHtml 와 같은 규칙 ──
 *  ✓ 전달됨(서버가 자동 — 비서가 가져간 순간) · 👀 접수 · 🔧 진행 중 · ✅ 완료 · 🙅 내 일 아님.
 *  '읽음'이라고 쓰지 않는다 — 가져간 것만 확실하고 이해했는지는 서버가 모른다. */
const ROOM_RX_RANK = {'✅': 5, '🙅': 4, '🔧': 3, '👀': 2, '✓': 1};
const ROOM_RX_TXT = {'✓': '전달됨', '👀': '접수', '🔧': '진행 중', '✅': '완료', '🙅': '내 일 아님'};
const ROOM_RX_CLS = {'✓': 'dv', '👀': 'sn', '🔧': 'wk', '✅': 'dn', '🙅': 'na'};
function roomReactTop(it){
  const best = {};
  (Array.isArray(it && it.reactions) ? it.reactions : []).forEach(x => {
    if(!x || !x.by || !ROOM_RX_RANK[x.e]) return;
    const k = String(x.by).toLowerCase();
    if(!best[k] || ROOM_RX_RANK[x.e] > ROOM_RX_RANK[best[k].e]) best[k] = {by: k, e: x.e, at: x.at};
  });
  return Object.keys(best).sort().map(k => best[k]);
}
function roomReactHtml(it){
  const list = roomReactTop(it);
  if(!list.length) return '';
  return '<div class="rx" aria-label="비서 반응">' + list.map(x => {
    const a = roomAgentById(x.by);
    const nm = a ? a.name : x.by;
    return '<span class="rxc rx-' + ROOM_RX_CLS[x.e] + '" title="' + esc(nm + ' · ' + ROOM_RX_TXT[x.e]) + '">' + esc(x.e) + '<i>' + esc(nm) + '</i></span>';
  }).join('') + '</div>';
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
  /* 🔎 히스토리 필터 · ↩ 답장 · 💬 스레드 (2026-11-26) */
  const F = {who: 'all', st: 'all', q: ''};     // 비서 · 상태 · 키워드
  let REPLY = null;                              // {id, text, who} — 지금 답장 중인 원문
  let THREAD = '';                               // 펼친 스레드의 첫 말 id
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
    renderLive();                                    // 🔴 지금 작업 중도 같이 산다(설정 전엔 스스로 숨김)
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
      '<p>아래에 말을 걸면 등록된 비서들이 다음 확인 때 답하고,<br>@노트북 을 부르면 집 노트북이 바로 실행해요.</p>' +
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
  /** ↩ 인용 박스 — 이 말이 답장이면 원 작성자·원문을 보여주고, 누르면 그 말로 간다 */
  function quoteBox(it){
    const rid = roomReplyToId(it);
    if(!rid || rid === String((it && it.id) || '')) return '';
    const orig = (S.items || []).filter(x => x && x.id === rid)[0];
    if(!orig){
      return '<button type="button" class="q miss" data-go="' + esc(rid) + '" title="원문이 지금 목록에 없어요">' +
        '<span class="q-w">↩ 원문 · 지금 목록에 없어요</span><span class="q-t">' + esc(rid) + '</span></button>';
    }
    return '<button type="button" class="q" data-go="' + esc(rid) + '" title="누르면 원문으로 이동해요">' +
      '<span class="q-w">' + esc(roomQuoteAuthor(orig)) + '</span>' +
      '<span class="q-t">' + esc(roomShort(roomQuoteText(orig), 90)) + '</span></button>';
  }
  /** 말풍선 버튼 — ↩ 답장 · 💬 스레드 N (버튼은 data-속성만 두고 app.js 가 붙인다) */
  function bubbleActs(it){
    const id = String((it && it.id) || '');
    if(!id) return '';
    const n = roomThreadCount(S.items, id);
    return '<div class="acts">' +
      '<button type="button" class="act" data-rep="' + esc(id) + '" title="이 말에 답장하며 원문을 인용해요">↩ 답장</button>' +
      (n >= 2 ? '<button type="button" class="act" data-th="' + esc(id) + '" title="원문과 거기 이어진 답장·보고만 모아 보기">💬 스레드 ' + n + '</button>' : '') +
      '</div>';
  }
  function bubbleMsg(it){
    const mine = roomIsMine(it);
    const key = roomSenderKey(it);
    const who = roomAgentById(key) || ROOM_ME;
    const st = roomStatus(it);
    const tg = roomTargetLabel(roomTargetKey(it));
    const body = roomMsgText(it) || (mine ? '' : String((it && (it.result || it.error)) || '').trim()) || '(내용 없음)';
    const plain = roomIsPlainReply(it);
    const rep = roomReportChip(it, S.items, Date.now());
    const meta = [
      '<span class="nm">' + (mine ? '레이 님' : roomMark(key, {mini: true}) + esc(who.name)) + '</span>',
      (mine && tg.id === 'portal') ? '' : '<span class="to">→ ' + esc(tg.label) + '</span>',
      plain ? '' : '<span class="chip ' + st.c + '">' + esc(st.t) + '</span>',
      rep ? '<span class="chip ' + rep.c + '">' + esc(rep.t) + '</span>' : '',
      (function(){ const ac = roomApprovalChip(it); return ac ? '<span class="chip ' + ac.c + '">' + esc(ac.t) + '</span>' : ''; })(),
      it.auto_approved ? '<span class="chip">자동(위임)</span>' : '',
      '<span class="tm">' + esc(roomWhen(it.created_at)) + '</span>'
    ].join('');
    const av = mine ? '' : '<div class="av" role="img" aria-label="' + esc(who.name) + '">' + roomMark(key, {title: who.name}) + '</div>';
    const aid = String((it && it.id) || '');
    return '<div class="msg ' + (mine ? 'me' : 'them') + '"' + (aid ? ' id="m-' + esc(aid) + '"' : '') + '>' + av +
      '<div class="bwrap ' + agentCls(key) + '"><div class="meta">' + meta + '</div>' +
      '<div class="bub">' + quoteBox(it) + '<div class="txt">' + roomMd(body) + '</div></div>' +
      roomReactHtml(it) + bubbleActs(it) + '</div></div>';
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
      if(roomReportState(it, S.items) === 'miss'){
        cls = 'err';
        inner = '⚠️ 끝났다고만 남기고 회의실에 결과 보고가 없어요 — 무엇을 했고 결과가 어떤지 물어볼까요?';
      } else {
        inner = chat ? roomMd(String(it.result || '네, 알겠습니다.'))
          : roomMd('✅ ' + String(it.result || '완료'));
      }
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
    const rep = roomReportChip(it, S.items, Date.now());
    const av = '<div class="av" role="img" aria-label="' + esc((who && who.name) || '노트북') + '">' + roomMark(key, {title: (who && who.name) || '노트북'}) + '</div>';
    const aid = String((it && it.id) || '');
    return '<div class="msg them"' + (aid ? ' id="r-' + esc(aid) + '"' : '') + '>' + av +
      '<div class="bwrap ' + agentCls(key) + '">' +
      '<div class="meta"><span class="nm">' + roomMark(key, {mini: true}) + esc((who && who.name) || '노트북') + '</span>' +
      (badge || '') + (rep ? '<span class="chip ' + rep.c + '">' + esc(rep.t) + '</span>' : '') +
      '<span class="tm">' + esc(roomWhen(bot)) + '</span></div>' +
      '<div class="bub ' + cls + '">' + quoteBox(it) + '<div class="txt">' + inner + '</div></div>' +
      bubbleActs(it) + '</div></div>';
  }
  function sigOf(){
    return S.items.map(i => [i.id, i.status, String(i.result || '').length, i.replied_by || '', i.beat_at || '',
      i.answer_by || '', i.finished_at || '',
      (Array.isArray(i.reactions) ? i.reactions.map(x => x.by + x.e).join(',') : '')].join('~')).join('|') +
      '#' + F.who + '/' + F.st + '/' + F.q;
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
    const list = S.items.filter(it => roomVisible(it, F, S.items, Date.now()));
    if(!list.length){
      box.innerHTML = '<div class="empty"><div class="big">🔎</div><h3>이 갈래에는 말이 없어요</h3>' +
        '<p>위 필터를 풀거나 다른 키워드로 찾아보세요.</p></div>';
      bindFeedButtons(); jumpOff(); return;
    }
    let html = '', day = '';
    list.slice().reverse().forEach(it => {
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
  function renderFilters(){
    const box = $('fchips');
    const cnt = $('fcnt');
    if(!box) return;
    const stC = [['all', '전체'], ['live', '진행'], ['miss', '보고누락'], ['wait', '승인'], ['done', '끝남']];
    const who = [{id: 'all', name: '모두'}].concat([ROOM_ME].concat(ROOM_AGENTS));
    const btn = (k, v, on, inner) => '<button type="button" class="fchip' + (on ? ' on' : '') + '" data-fk="' + k + '" data-fv="' + esc(v) + '">' + inner + '</button>';
    box.innerHTML =
      '<span class="fh">상태</span>' + stC.map(x => btn('st', x[0], F.st === x[0], esc(x[1]))).join('') +
      '<span class="fbr" aria-hidden="true"></span><span class="fh">비서</span>' + who.map(a => btn('who', a.id, F.who === a.id, roomMark(a.id, {mini: true}) + esc(a.name))).join('');
    if(cnt){
      const shown = S.items.filter(it => roomVisible(it, F, S.items, Date.now())).length;
      const miss = S.items.filter(it => roomReportState(it, S.items) === 'miss').length;
      cnt.textContent = shown + '/' + S.items.length + '건' + (miss ? ' · 보고누락 ' + miss : '') + (F.q ? ' · "' + F.q + '"' : '');
    }
  }
  function setFilter(k, v){
    if(k === 'st') F.st = ['all', 'live', 'miss', 'wait', 'done'].indexOf(v) >= 0 ? v : 'all';
    else if(k === 'who') F.who = (v === 'all' || whoList().some(a => a.id === v)) ? v : 'all';
    renderFilters(); renderFeed(true);
  }
  function whoList(){ return [ROOM_ME].concat(ROOM_AGENTS); }
  function onSearch(){
    const el = $('srch');
    F.q = String((el && el.value) || '').trim();
    renderFilters(); renderFeed(true);
  }
  /* ── ↩ 답장 · 💬 스레드 (2026-11-26) ── */
  function setReply(id){
    const it = S.items.filter(x => x && x.id === String(id || ''))[0];
    if(!it) return;
    REPLY = {id: it.id, who: roomQuoteAuthor(it), text: roomShort(roomQuoteText(it), 60)};
    const box = $('rep');
    if(box){
      box.hidden = false;
      $('rep-who').textContent = REPLY.who + '에게 답장';
      $('rep-txt').textContent = REPLY.text;
    }
    const inp = $('inp');
    try { inp.focus(); } catch(e) {}
    toast('답장을 적어보세요 — 보내면 원문을 인용해요');
  }
  function clearReply(){
    REPLY = null;
    const box = $('rep');
    if(box) box.hidden = true;
  }
  function openThread(id){
    const rid = roomThreadRoot(S.items, id);
    if(!rid) return;
    THREAD = rid;
    const items = roomThreadItems(S.items, rid);
    const box = $('thread'), list = $('thread-list'), n = $('thread-n');
    if(!box || !list) return;
    if(n) n.textContent = items.length + '개 말';
    list.innerHTML = items.map(thRow).join('') || '<div class="th-empty">이어진 말이 없어요</div>';
    box.classList.add('on');
  }
  function closeThread(){
    THREAD = '';
    const box = $('thread');
    if(box) box.classList.remove('on');
  }
  function thRow(it){
    const mine = roomIsMine(it);
    const key = mine ? roomSenderKey(it) : roomReplyWhoKey(it);
    const who = roomAgentById(key) || ROOM_AGENTS[2];
    const st = roomStatus(it);
    const rep = roomReportChip(it, S.items, Date.now());
    const body = roomMsgText(it) || String((it && (it.result || it.error)) || '');
    const res = String((it && it.result) || '').trim();
    return '<div class="th-row ' + (mine ? 'out' : 'in') + '">' +
      '<div class="th-m">' + roomMark(key, {mini: true}) + '<b>' + esc(who.name) + '</b>' +
      '<span class="chip ' + st.c + '">' + esc(st.t) + '</span>' +
      (rep ? '<span class="chip ' + rep.c + '">' + esc(rep.t) + '</span>' : '') +
      '<span class="th-tm">' + esc(roomWhen(it.created_at)) + '</span></div>' +
      '<div class="th-txt">' + roomMd(body) + '</div>' +
      (res && res !== body ? '<div class="th-res">' + roomMd(res) + '</div>' : '') +
      '<div class="acts"><button type="button" class="act" data-go="' + esc(it.id) + '">↗ 타임라인에서</button>' +
      '<button type="button" class="act" data-rep="' + esc(it.id) + '">↩ 답장</button></div></div>';
  }
  function bindFeedButtons(){
    const box = $('feed');
    box.querySelectorAll('button[data-act="settings"]').forEach(b => { b.onclick = openSheet; });
    box.querySelectorAll('button[data-fill]').forEach(b => {
      b.onclick = () => { const i = $('inp'); i.value = b.dataset.fill || ''; i.focus(); onInput(); };
    });
  }

  /* ── 🔴 지금 작업 중 — 누가 무슨 일을 하는지(작업 리스트 · 가동 상태) ── */
  function liveWho(id){
    const k = String(id || '');
    if(!k) return {icon: '👥', name: '전체 (먼저 잡는 비서)'};
    const a = roomAgentById(k);
    return a ? {icon: a.icon || '🤖', name: a.name} : {icon: '🤖', name: k};
  }
  function liveWork(x){
    const who = liveWho(x.owner);
    const since = roomLiveSince(x.it);
    const dur = since ? '<span class="li-el" data-since="' + since + '">' + esc(roomDur(Date.now() - since)) + '</span>' : '';
    let tail = dur;
    if(x.state === 'RUNNING') tail += '째';
    else if(x.state === 'PENDING') tail += ' 기다리는 중';
    else if(x.state === 'WAITING_APPROVAL') tail += ' · 포털에서 승인';
    const id = String((x.it && x.it.id) || '');
    return '<button type="button" class="live-w ' + (ROOM_LIVE_CLS[x.state] || '') + '" data-go="' + esc(id) + '"' +
      ' title="' + esc(roomMsgText(x.it)) + '">' +
      '<span class="lw-who">' + roomMark(x.owner || 'all', {mini: true}) + esc(who.name) + '</span>' +
      '<span class="lw-what">' + esc(roomLiveWhat(x.it)) + '</span>' +
      '<span class="lw-tail"><span class="lw-chip ' + (ROOM_LIVE_CLS[x.state] || '') + '">' + esc(ROOM_LIVE_ST[x.state]) + '</span>' +
        '<span class="lw-el">' + tail + '</span></span></button>';
  }
  function liveAg(a, act){
    const when = act.state === 'work' ? '실행 ' + act.n + '건'
      : (act.min === null ? (act.state === 'unknown' ? '신호 없음' : '기록 없음') : roomAgo(act.min));
    return '<span class="live-a ' + act.state + '" title="' + esc(a.name + ' — ' + ROOM_ACT_TXT[act.state] + ' · ' + when) + '">' +
      '<span class="la-n">' + roomMark(a.id, {mini: true}) + esc(a.name) + '</span>' +
      '<span class="la-s">' + esc(ROOM_ACT_TXT[act.state]) + '</span>' +
      (act.state === 'work' ? '' : '<span class="la-w">' + esc(when) + '</span>') + '</span>';
  }
  function renderLive(){
    const box = $('live');
    if(!box) return;
    if(!configured()){ box.innerHTML = ''; box.hidden = true; return; }
    const now = Date.now();
    const live = roomLiveItems(S.items);
    const ids = ROOM_AGENTS.map(a => a.id);
    const c = roomActCounts(ids, S.items, S.sigs, S.usage, S.hb, now);
    const sum = ['work', 'wait', 'idle', 'limit', 'out', 'unknown'].filter(k => c[k])
      .map(k => '<span class="k ' + k + '"><b>' + c[k] + '</b>명 ' + esc(ROOM_ACT_TXT[k]) + '</span>').join('');
    box.hidden = false;
    box.className = 'live' + (live.length ? '' : ' quiet');
    const known = c.work + c.limit + c.wait + c.idle + c.out;   // 신호가 없으면 칩 줄은 접는다
    box.innerHTML =
      '<div class="live-h"><span class="live-t"><i class="ldot' + (live.length ? ' on' : '') + '"></i>지금 작업 중 <b>' + live.length + '</b></span>' +
        '<span class="live-s">' + (sum || '아직 가동 신호가 없어요') + '</span></div>' +
      (live.length ? '<div class="live-ws">' + live.slice(0, ROOM_LIVE_MAX).map(liveWork).join('') +
        (live.length > ROOM_LIVE_MAX ? '<div class="live-more">+ ' + (live.length - ROOM_LIVE_MAX) + '건 더 — 타임라인에서</div>' : '') + '</div>'
        : '<div class="live-none">지금 도는 일은 없어요 — 말을 걸면 여기에 담당·경과가 떠요</div>') +
      (known ? '<div class="live-as">' + ROOM_AGENTS.map(a => liveAg(a, roomAgentAct(a.id, S.items, S.sigs, S.usage, S.hb, now))).join('') + '</div>' : '');
  }
  /** 일 칩을 누르면 그 말로 이동 — 없으면(@전체 대기 등) 아무 일도 안 함 */
  function jumpToMsg(id){
    const rid = String(id || '');
    if(!rid) return;
    const el = $('m-' + rid) || $('r-' + rid);
    if(!el || !el.scrollIntoView) return;
    try { el.scrollIntoView({behavior: 'smooth', block: 'center'}); } catch(e) {}
    if(el.classList){ el.classList.add('flash'); setTimeout(() => { try { el.classList.remove('flash'); } catch(e) {} }, 1500); }
  }
  /** 1초마다 경과 글자만 고친다(목록은 다시 안 그린다) */
  function tickLive(){
    const box = $('live');
    if(!box || !box.querySelectorAll) return;
    box.querySelectorAll('[data-since]').forEach(el => {
      const since = Number(el.getAttribute('data-since'));
      if(!since) return;
      el.textContent = roomDur(Date.now() - since);
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
    return '<div class="ag"><div class="av" role="img" aria-label="' + esc(a.name) + '">' + roomMark(a.id, {title: a.name}) + '</div>' +
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
    const map = roomMentionMap();
    $('chips').innerHTML = ROOM_CHIPS.map(l => {
      const id = map[l] || (l === '@전체' ? 'all' : '');
      return '<button type="button" class="mchip' + (l === '@전체' ? ' all' : '') + '" data-m="' + esc(l) + '">' +
        roomMark(id || 'all', {mini: true}) + esc(l) + '</button>';
    }).join('');
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
    $('to').innerHTML = '→ ' + roomMark(t.id, {mini: true}) + '<b>' + esc(t.label) + '</b>';
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
      // 답장이면 어느 말에 대한 답장인지 함께 보낸다 — 서버가 오더를 이어 붙이고 화면이 인용 박스를 그린다(2026-11-26)
      if(REPLY && REPLY.id && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,59}$/.test(REPLY.id)) payload.reply_to = REPLY.id;
      const ws = roomWsPick(S.wss, S.ws) || 'hub-agent';
      const d = await api('queue_enqueue', {type: 'claude_prompt', workspace: ws, payload: payload, source: 'portal', client_id: 'portal'});
      if(!d || d.ok !== true){ toast('접수 실패 — ' + ((d && (d.error || d.code)) || '서버 확인')); return; }
      inp.value = '';
      clearReply();
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

  /* ── 🔔 승인 대기 배너 (2026-11-27) — 1분에 한 번만 읽는다. 예전 서버면 조용히 숨긴다 ── */
  async function loadApprovals(){
    const el = $('apprb');
    if(!el || S.apprBusy) return;
    if(S.apprAt && Date.now() - S.apprAt < 60000) return;
    S.apprBusy = true;
    try{
      const d = await api('approval_list', {});
      S.apprAt = Date.now();
      const html = (d && d.ok === true) ? roomApprovalBanner(d) : '';
      el.innerHTML = html;
      el.hidden = !html;
    } catch(e){ el.hidden = true; }
    finally { S.apprBusy = false; }
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
        loadApprovals();
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
    renderFilters();
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
        renderDrawer(); renderLive();
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
      renderDrawer(); renderLive();
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
    const liveBox = $('live');
    if(liveBox && liveBox.addEventListener){
      liveBox.addEventListener('click', e => {
        const t = e && e.target;
        const b = (t && t.closest) ? t.closest('[data-go]') : null;
        if(b) jumpToMsg(b.getAttribute('data-go'));
      });
    }
    $('inp').addEventListener('input', onInput);
    $('inp').addEventListener('keydown', e => {
      if(e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      send();
    });
    $('feed').addEventListener('click', e => {
      const t = e && e.target;
      const b = (t && t.closest) ? t.closest('[data-rep],[data-th],[data-go]') : null;
      if(!b) return;
      const id = b.getAttribute('data-rep') || b.getAttribute('data-th') || b.getAttribute('data-go');
      if(b.hasAttribute('data-rep')) setReply(id);
      else if(b.hasAttribute('data-th')) openThread(id);
      else jumpToMsg(id);
    });
    const fb = $('fchips');
    if(fb && fb.addEventListener){
      fb.addEventListener('click', e => {
        const t = e && e.target;
        const b = (t && t.closest) ? t.closest('[data-fk]') : null;
        if(b) setFilter(b.getAttribute('data-fk'), b.getAttribute('data-fv'));
      });
    }
    if($('srch')) $('srch').addEventListener('input', onSearch);
    if($('rep-x')) $('rep-x').onclick = clearReply;
    if($('thread-bg')) $('thread-bg').onclick = closeThread;
    if($('thread-x')) $('thread-x').onclick = closeThread;
    const tl = $('thread-list');
    if(tl && tl.addEventListener){
      tl.addEventListener('click', e => {
        const t = e && e.target;
        const b = (t && t.closest) ? t.closest('[data-rep],[data-go]') : null;
        if(!b) return;
        const id = b.getAttribute('data-rep') || b.getAttribute('data-go');
        if(b.hasAttribute('data-rep')){ closeThread(); setReply(id); }
        else { closeThread(); jumpToMsg(id); }
      });
    }
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
      else if($('thread').classList.contains('on')) closeThread();
      else if($('drawer').classList.contains('on')) drawerClose();
    });
    document.addEventListener('visibilitychange', () => {
      if(document.hidden) return;
      if(Date.now() - S.lastFetch > 8000) load('quiet');
    });
    window.addEventListener('focus', () => { if(Date.now() - S.lastFetch > 8000) load('quiet'); });
    window.addEventListener('online', () => { if(Date.now() - S.lastFetch > 3000) load('quiet'); });
    setInterval(() => { if(document.hidden) return; if(Date.now() - S.lastFetch < 12000) return; load('quiet'); }, POLL_MS);
    setInterval(() => { if(document.hidden) return; tickLive(); }, 1000);   // 경과 글자만 1초마다
  }

  function init(){
    renderChips();
    bind();
    onInput();
    loadLocalUsage();
    loadLocalSignals();
    renderHead();
    renderFilters();
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
