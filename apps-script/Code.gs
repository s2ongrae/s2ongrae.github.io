// ═══════════════════════════════════════════════════════════════
// 김성래 포털 — Google Apps Script 서버 (보안 강화판)
//
//  · 모든 요청은 비밀 키(SECRET_KEY)가 있어야 함 (POST 본문으로 전달)
//  · doGet 은 데이터를 주지 않음 (안내 문구만)
//  · 캘린더·Tasks·메모 모두 키 없이는 읽기/쓰기/삭제 불가
//  · 메모 저장은 개정번호(rev) 확인 + 잠금 + 줄어듦 방지 + 하루 1회 자동 백업
//
//  처음 설정:  createSecretKey() 를 한 번 실행 → 실행 로그의 키를 복사
//  키가 새면:  rotateSecretKey() 로 교체 (모든 기기에서 새 키 재입력)
//  ※ 서비스(+) 에서 Tasks API 가 추가돼 있어야 해요 (식별자: Tasks)
// ═══════════════════════════════════════════════════════════════

const PORTAL_FOLDER = '김성래포털';
const MEMO_FILE     = '포털_메모.json';
const BACKUP_SUB    = '백업';
const KEEP_DAYS     = 14;                    // 백업 보관 일수
const MAX_JSON_LEN  = 5 * 1024 * 1024;
const MAX_MEMOS     = 2000;
const MAX_TOMBS     = 5000;
const TZ            = 'Asia/Seoul';
const MEMO_COLORS   = ['mc-yellow', 'mc-blue', 'mc-green', 'mc-pink', 'mc-purple', 'mc-white'];

// ── 진입점 ─────────────────────────────────────────
//  · POST: 모든 액션(쓰기 포함). 본문에 key.
//  · GET : **읽기 전용 몇 개만**(2026-11-25 v27 — 큐·키링처럼 가볍게 훑는 비서용).
//          `?action=queue_list&target=keyring&limit=5&key=…` 처럼 쓴다.
//          쓰기 액션은 GET 으로 절대 받지 않는다(링크 미리보기·로그에 키가 남는 위험을 줄이기 위해
//          읽기만 열고, 키는 여전히 64자 전체 비교다).
//          `?action=queue_head` 는 **최신 1건의 id·시각·대상만** 돌려주는 초경량 확인용이다.
const GET_ACTIONS = ['ping', 'queue_status', 'queue_list', 'queue_head', 'queue_brief', 'queue_inbox', 'approval_list', 'usage_get', 'agents_get', 'webhook_last', 'auth_link'];
// 2026-11-26 — 지금 깔린 배포가 어느 코드인지 화면·비서가 알 수 있게. 배포할 때마다 올린다(날짜-순번).
//  "재배포가 필요해요"가 많은데 배포 여부를 확인할 길이 없었다 — ping 이 이 값을 돌려준다.
const SERVER_VERSION = '2026-11-27.brief11';
function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = String(p.action || '').trim();
  if (!action) return out({ ok: false, error: 'POST로만 사용할 수 있어요.' });
  if (GET_ACTIONS.indexOf(action) < 0) {
    return out({ ok: false, code: 'read_only', error: 'GET 으로는 읽기만 할 수 있어요: ' + GET_ACTIONS.join(' · ') });
  }
  if (!checkKey(p.key)) {
    Utilities.sleep(300);
    return out({ ok: false, error: 'unauthorized' });
  }
  try {
    switch (action) {
      case 'ping':         return out({ ok: true, at: new Date().toISOString(), version: SERVER_VERSION });
      case 'queue_status': return out(queueStatus());
      case 'queue_list':   return out(queueList({ target: p.target, limit: p.limit }));
      case 'queue_head':   return out(queueHead({ target: p.target }));
      case 'queue_brief':  return out(queueBrief({}));
      case 'approval_list': return out(approvalList({}));
      case 'queue_inbox':  return out(queueInbox({ as: p.as || p.target, since: p.since }));
      case 'usage_get':    return out(usageGet());
      case 'agents_get':   return out(agentListGet());
      case 'webhook_last': return out(queueWebhookLast());
      case 'auth_link':    return out(queueAuthLink());
      default:             return out({ ok: false, error: '알 수 없는 요청이에요.' });
    }
  } catch (err) {
    const res = { ok: false, error: String((err && err.message) || err) };
    if (err && err.code) res.code = String(err.code);
    return out(res);
  }
}

function doPost(e) {
  let body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || ''); }
  catch (_) { return out({ ok: false, error: '잘못된 요청이에요.' }); }
  if (!isObj(body) || typeof body.action !== 'string') {
    return out({ ok: false, error: '잘못된 요청이에요.' });
  }
  if (!checkKey(body.key)) {
    Utilities.sleep(300);
    return out({ ok: false, error: 'unauthorized' });
  }
  try {
    switch (body.action) {
      case 'ping':              return out({ ok: true, version: SERVER_VERSION });
      case 'getTaskLists':      return out(getTaskLists());
      case 'getTasks':          return out(getTasks(body.listId));
      case 'addTask':           return out(addTask(body.listId, body.title, body.notes));
      case 'completeTask':      return out(completeTask(body.listId, body.taskId));
      case 'deleteTask':        return out(deleteTask(body.listId, body.taskId));
      case 'getCalendarEvents': return out(getCalendarEvents(body.ym));
      case 'createEvent':       return out(createEvent(body));
      case 'deleteEvent':       return out(deleteCalEvent(body.eventId));
      case 'cal_list':          return out(calList(body));          // 🗓️ 비서용 일정 조회(큐 전담 — 2026-11-26)
      case 'cal_create':        return out(calCreate(body));        // 🗓️ 비서용 일정 등록
      case 'cal_update':        return out(calUpdate(body));        // 🗓️ 비서용 일정 수정(삭제는 없다)
      case 'loadMemos':         return out(loadMemos());
      case 'saveMemos':         return out(saveMemos(body));
      case 'queue_status':      return out(queueStatus());   // 포털 상단 상태등(읽기 전용)
      case 'agent_status':      return out(agentStatus());        // 🤖 피클이 남긴 작업 상태(읽기 전용)
      case 'queue_list':        return out(queueList(body));      // 🤖 오더함 — 최근 오더
      case 'queue_brief':       return out(queueBrief(body));     // 📋 오늘 브리핑 — 비서별 받은 일·처리·밀림(읽기 전용)
      case 'queue_inbox':       return out(queueInbox(body));     // 📥 내 받은편지함 — 지금 처리할 말만(주기 확인형 비서용)
      case 'queue_react':       return out(queueReact(body));     // 👀 이모지 반응 — 확인 답장 대신(접수·진행 중·완료·내 일 아님)
      case 'queue_sweep':       return out(queueSweep(body));     // 🧹 묵은 대화 정리 — 기본은 미리보기(apply:true 일 때만 닫는다)
      case 'approval_list':     return out(approvalList(body));   // 🔔 승인함 — 레이 님이 결정할 것만(읽기)
      case 'approval_decide':   return out(approvalDecide(body)); // 🔔 승인·보류·거절 → 요청한 비서에게 답장
      case 'webhook_last':      return out(queueWebhookLast());   // 🔔 웹훅 발사 결과(읽기 전용 — 주소 없음)
      case 'queue_enqueue':     return out(queueEnqueue(body));   // 🤖 오더함 — 오더 접수
      case 'webhook_set':       return out(queueWebhookSet(body)); // 🔔 외부 비서 웹훅 주소 등록(ScriptProperties)
      case 'queue_decide':      return out(queueDecide(body));    // 🤖 오더함 — 승인/거절
      case 'queue_claim':       return out(queueClaim(body));     // 🤖 외부 비서가 자기 앞 오더를 집어 감
      case 'queue_done':        return out(queueDone(body));      // 🤖 집어 간 오더의 결과를 남김
      case 'agent_beat':        return out(agentBeat_(body));      // ⌨️ 노트북 직접작업 상태
      case 'usage_get':         return out(usageGet());           // 📊 비서 사용량(읽기)
      case 'usage_set':         return out(usageSet_(body));      // 📊 비서 사용량(남은 % 기록)
      case 'usage_report':      return out(usageSet_(body));      // 📊 외부 비서의 자기 보고(usage_set 과 같은 곳)
      case 'agents_get':        return out(agentListGet());       // 👥 참여 비서 명부(읽기)
      case 'agent_save':        return out(agentSave_(body));     // 👥 참여 비서 명부(추가·이름 변경·제거)
      case 'file_upload':       return out(queueFileUpload_(body)); // 📎 파일·이미지 공유 — Drive 에 올리고 id 만 받는다
      case 'file_get':          return out(queueFileGet_(body));    // 📎 공유한 파일 다시 받기(화면이 blob 으로 그린다)
      default:                  return out({ ok: false, error: '알 수 없는 요청이에요.' });
    }
  } catch (err) {
    const res = { ok: false, error: String((err && err.message) || err) };
    if (err && err.code) res.code = String(err.code);      // 화면이 안내 문구를 고를 때만 씀(비밀값 아님)
    return out(res);
  }
}

// ── 비밀 키 ────────────────────────────────────────
function secretKey() {
  return PropertiesService.getScriptProperties().getProperty('SECRET_KEY') || '';
}
function safeEqual(a, b) {                       // 길이 확인 후 끝까지 비교
  a = String(a == null ? '' : a);
  b = String(b == null ? '' : b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function checkKey(k) {
  const s = secretKey();
  if (!s || s.length < 32) return false;         // 미설정이면 전부 거절
  return safeEqual(k, s);
}
function newKey() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');   // 64자
}
function createSecretKey() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SECRET_KEY')) {
    Logger.log('이미 비밀 키가 있어요. 바꾸려면 rotateSecretKey() 를 실행하세요.');
    return;
  }
  const key = newKey();
  props.setProperty('SECRET_KEY', key);
  Logger.log('비밀 키 (포털의 ⚙️ 서버 설정에 입력, 다른 곳에 공유 금지):\n' + key);
}
function rotateSecretKey() {
  const key = newKey();
  PropertiesService.getScriptProperties().setProperty('SECRET_KEY', key);
  Logger.log('새 비밀 키 (모든 기기에서 다시 입력해야 해요):\n' + key);
}

// ── 입력 검사 도우미 ────────────────────────────────
function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function clip(v, max) { return String(v == null ? '' : v).slice(0, max); }
function validYm(s) { return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s); }
function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const p = s.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2];
}
function validTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
function listIdOf(v) {
  if (v == null || v === '') return '@default';
  const s = String(v);
  if (s.length > 200) throw new Error('목록 ID가 올바르지 않아요.');
  return s;
}
function idOf(v, label) {
  const s = String(v == null ? '' : v);
  if (!s || s.length > 300) throw new Error(label + ' ID가 올바르지 않아요.');
  return s;
}

// ── 캘린더 ─────────────────────────────────────────
function getCalendarEvents(ym) {
  if (!validYm(ym)) return { ok: false, error: '월 형식이 올바르지 않아요.' };
  const parts = ym.split('-').map(Number);
  const start = new Date(parts[0], parts[1] - 1, 1);
  const end   = new Date(parts[0], parts[1], 1);
  const events = CalendarApp.getDefaultCalendar().getEvents(start, end);
  const tz = Session.getScriptTimeZone();
  const byDate = {};
  events.forEach(function (ev) {
    const allDay = ev.isAllDayEvent();
    const s = ev.getStartTime();
    let cursor = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    let eEnd = ev.getEndTime();
    // 시간 일정이 자정(0시 정각)에 끝나면 그 전날까지만 (23:00~24:00 일정이 다음 날 칸에도 보였어요)
    if (!allDay && eEnd > s && eEnd.getHours() === 0 && eEnd.getMinutes() === 0 && eEnd.getSeconds() === 0) eEnd = new Date(eEnd.getTime() - 1);
    const endDay = new Date(eEnd.getFullYear(), eEnd.getMonth(), eEnd.getDate());
    if (allDay) endDay.setDate(endDay.getDate() - 1);
    while (cursor <= endDay) {
      const key = Utilities.formatDate(cursor, tz, 'yyyy-MM-dd');
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push({
        id: ev.getId(),
        title: ev.getTitle(),
        allDay: allDay,
        color: ev.getColor() || '',
        time: allDay ? '' : Utilities.formatDate(s, tz, 'HH:mm'),
        desc: ev.getDescription() || ''
      });
      cursor.setDate(cursor.getDate() + 1);
    }
  });
  return { ok: true, events: byDate };
}

function createEvent(body) {
  if (!validDate(body.date)) return { ok: false, error: '날짜 형식이 올바르지 않아요.' };
  const title = clip(body.title, 500).trim();
  if (!title) return { ok: false, error: '제목이 비어 있어요.' };
  const desc = clip(body.desc, 8000);
  const cal = CalendarApp.getDefaultCalendar();
  const p = body.date.split('-').map(Number);
  let ev;
  if (body.allDay === true || !validTime(body.startTime)) {
    ev = cal.createAllDayEvent(title, new Date(p[0], p[1] - 1, p[2]));
  } else {
    const sh = body.startTime.split(':').map(Number);
    const start = new Date(p[0], p[1] - 1, p[2], sh[0], sh[1]);
    let end = new Date(start.getTime() + 60 * 60000);            // 종료 시간이 없으면 1시간
    if (validTime(body.endTime)) {
      const eh = body.endTime.split(':').map(Number);
      const e2 = new Date(p[0], p[1] - 1, p[2], eh[0], eh[1]);
      if (e2 > start) end = e2;
    }
    ev = cal.createEvent(title, start, end);
  }
  if (desc) ev.setDescription(desc);
  return { ok: true, eventId: ev.getId() };
}

function deleteCalEvent(eventId) {
  const id = idOf(eventId, '일정');
  const ev = CalendarApp.getDefaultCalendar().getEventById(id);
  if (ev) ev.deleteEvent();
  return { ok: true };
}

// ── 캘린더 — 비서(큐)가 쓰는 조회·등록·수정 (2026-11-26) ──────────
//  레이 님 지시로 일정 관리는 큐(cue)가 전담한다. 비서가 직접 부르는 세 갈래만 둔다.
//    cal_list(조회) · cal_create(등록) · cal_update(수정) — **삭제는 넣지 않는다.**
//    지우는 일은 되돌릴 수 없어서 사람이 포털 화면(deleteEvent)에서만 한다.
//  · 날짜·시각: 'YYYY-MM-DD'(종일) 또는 'YYYY-MM-DDTHH:mm'·'YYYY-MM-DD HH:mm'.
//    시간대를 안 붙이면 스크립트 시간대(Asia/Seoul)로 읽는다. 'Z'·'+09:00'을 붙이면 그 순간 그대로다.
//  · **종일 일정의 end 는 마지막 날(포함)** — cal_list 가 준 값을 그대로 cal_update 에 넣어도 하루 밀리지 않는다.
//    (구글 캘린더 내부는 끝나는 날을 빼고 세므로, 넣고 뺄 때 하루씩 옮겨 준다.)
const CAL_MAX_DAYS = 62;          // 한 번에 훑는 기간 상한(실수로 10년치를 읽지 않게)
const CAL_LIST_MAX = 200;         // 한 번에 돌려주는 일정 수 상한
function calTz() { return Session.getScriptTimeZone() || TZ; }
function ymdOf(d) { return Utilities.formatDate(d, calTz(), 'yyyy-MM-dd'); }
function midnightOf(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function calFmt(d, allDay) {
  return Utilities.formatDate(d, calTz(), allDay ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm");
}
/** 날짜 문자열 → { d: Date, dateOnly: bool }. 잘못된 값은 bad_request 로 거절한다. */
function calParse(v, label) {
  const s = String(v == null ? '' : v).trim();
  if (!s) throw qqErr_('bad_request', label + ' 날짜가 비어 있어요.');
  if (s.length > 40) throw qqErr_('bad_request', label + ' 날짜가 너무 길어요.');
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const y = +m[1], mo = +m[2], da = +m[3];
    const d = new Date(y, mo - 1, da);
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) {
      throw qqErr_('bad_request', label + ' 날짜가 달력에 없어요: ' + s);
    }
    return { d: d, dateOnly: true };
  }
  m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (!m) throw qqErr_('bad_request', label + ' 날짜 형식이 올바르지 않아요(YYYY-MM-DD 또는 YYYY-MM-DDTHH:mm).');
  if (m[7]) {                                   // 시간대를 붙였으면 그 순간 그대로 쓴다
    const ms = Date.parse(s.replace(' ', 'T'));
    if (!isFinite(ms)) throw qqErr_('bad_request', label + ' 날짜를 읽지 못했어요: ' + s);
    return { d: new Date(ms), dateOnly: false };
  }
  const y = +m[1], mo = +m[2], da = +m[3], hh = +m[4], mi = +m[5], ss = +(m[6] || 0);
  if (hh > 23 || mi > 59 || ss > 59) throw qqErr_('bad_request', label + ' 시각이 올바르지 않아요: ' + s);
  const d = new Date(y, mo - 1, da, hh, mi, ss);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) {
    throw qqErr_('bad_request', label + ' 날짜가 달력에 없어요: ' + s);
  }
  return { d: d, dateOnly: false };
}
/** CalendarEvent → 비서가 읽기 좋은 모양(종일은 end 가 마지막 날) */
function calOut(ev) {
  const allDay = ev.isAllDayEvent();
  const s = ev.getStartTime(), e = ev.getEndTime();
  const endIn = allDay ? addDays(midnightOf(e), -1) : e;
  return {
    id: ev.getId(), title: ev.getTitle(), allDay: allDay,
    start: calFmt(s, allDay), end: calFmt(endIn, allDay),
    location: ev.getLocation() || '', description: ev.getDescription() || '',
    dayUrl: 'https://calendar.google.com/calendar/r/day/' + ymdOf(s).replace(/-/g, '/')
  };
}
/** 같은 제목·같은 시작 시각의 일정이 이미 있나(두 번 등록 누르기 방지) */
function calDup(cal, title, startD, endD, allDay) {
  const t = String(title).trim();
  const hits = cal.getEvents(midnightOf(startD), endD).filter(function (ev) {
    return String(ev.getTitle()).trim() === t && ev.isAllDayEvent() === allDay &&
      Math.abs(ev.getStartTime().getTime() - startD.getTime()) < 60000;
  });
  return hits.length ? hits[0] : null;
}
/**
 * cal_list — start·end 범위의 일정(기본: 오늘부터 7일).
 *   { start?, end?(포함), q?(제목·장소·설명 검색), limit? }
 */
function calList(body) {
  const b = isObj(body) ? body : {};
  const sp = calParse(b.start !== undefined && b.start !== null && b.start !== '' ? b.start : ymdOf(new Date()), '시작');
  const start = midnightOf(sp.d);
  let end;                                      // end 는 **포함하지 않는** 경계
  if (b.end !== undefined && b.end !== null && b.end !== '') {
    const ep = calParse(b.end, '끝');
    end = ep.dateOnly ? addDays(midnightOf(ep.d), 1) : ep.d;
  } else {
    end = addDays(start, 8);                    // 오늘부터 7일(8일째 0시 전까지)
  }
  if (!(end > start)) throw qqErr_('bad_request', '끝이 시작보다 앞서요.');
  if (end.getTime() - start.getTime() > CAL_MAX_DAYS * 86400000) {
    throw qqErr_('range_too_long', '한 번에 ' + CAL_MAX_DAYS + '일까지만 볼 수 있어요. 기간을 나눠 주세요.');
  }
  const q = clip(b.q, 100).trim().toLowerCase();
  let items = CalendarApp.getDefaultCalendar().getEvents(start, end).map(calOut);
  if (q) {
    items = items.filter(function (x) {
      return (x.title + ' ' + x.location + ' ' + x.description).toLowerCase().indexOf(q) >= 0;
    });
  }
  items.sort(function (a, b2) {                 // 시작이 빠른 것부터, 같으면 종일 먼저
    if (a.start !== b2.start) return a.start < b2.start ? -1 : 1;
    return (b2.allDay ? 1 : 0) - (a.allDay ? 1 : 0);
  });
  const total = items.length;
  const limit = qqInt_(b.limit, 1, CAL_LIST_MAX, 50);
  return {
    ok: true, calendar: '기본 캘린더', tz: calTz(),
    start: sp.dateOnly ? ymdOf(start) : calFmt(start, false),
    end: calFmt(addDays(end, -1), true), total: total, count: Math.min(total, limit),
    items: items.slice(0, limit)
  };
}
/**
 * cal_create — 일정 등록. { title, start, end?, allDay?, location?, description?, allowDuplicate? }
 *   같은 제목·같은 시작이 이미 있으면 만들지 않고 그 일정을 돌려준다(duplicate:true).
 *   정말 두 개가 필요하면 allowDuplicate:true.
 */
function calCreate(body) {
  const b = isObj(body) ? body : {};
  const title = clip(b.title, 500).trim();
  if (!title) throw qqErr_('bad_request', '제목이 비어 있어요.');
  if (b.start === undefined || b.start === null || b.start === '') {
    throw qqErr_('bad_request', 'start 가 필요해요(YYYY-MM-DD 또는 YYYY-MM-DDTHH:mm).');
  }
  const sp = calParse(b.start, '시작');
  const allDay = b.allDay === true || (b.allDay !== false && sp.dateOnly);
  const cal = CalendarApp.getDefaultCalendar();
  let startD, endD;
  if (allDay) {
    startD = midnightOf(sp.d);
    if (b.end !== undefined && b.end !== null && b.end !== '') {
      endD = addDays(midnightOf(calParse(b.end, '끝').d), 1);     // 마지막 날(포함) → 내부 경계
    } else {
      endD = addDays(startD, 1);
    }
  } else {
    startD = sp.d;
    if (b.end !== undefined && b.end !== null && b.end !== '') endD = calParse(b.end, '끝').d;
    else endD = new Date(startD.getTime() + 3600000);             // 끝이 없으면 1시간
  }
  if (!(endD > startD)) throw qqErr_('bad_request', '끝이 시작보다 앞서요.');
  if (b.allowDuplicate !== true) {
    const dup = calDup(cal, title, startD, endD, allDay);
    if (dup) {
      const o = calOut(dup); o.ok = true; o.duplicate = true; o.created = false;
      o.note = '같은 일정이 이미 있어요. 새로 만들지 않았어요.'; return o;
    }
  }
  const ev = allDay ? cal.createAllDayEvent(title, startD, endD) : cal.createEvent(title, startD, endD);
  if (b.location !== undefined) ev.setLocation(clip(b.location, 500));
  const desc = b.description !== undefined ? b.description : b.desc;
  if (desc !== undefined) ev.setDescription(clip(desc, 8000));
  const o = calOut(ev); o.ok = true; o.duplicate = false; o.created = true;
  o.note = '등록했어요.'; return o;
}
/**
 * cal_update — id 로 일정의 제목·시간·장소·설명을 고친다(안 보낸 값은 그대로 둔다).
 *   { id, title?, start?, end?, allDay?, location?, description? }
 */
function calUpdate(body) {
  const b = isObj(body) ? body : {};
  const id = clip(b.id, 300).trim();
  if (!id) throw qqErr_('bad_request', '일정 id 가 필요해요.');
  const cal = CalendarApp.getDefaultCalendar();
  const ev = cal.getEventById(id);
  if (!ev) {
    return { ok: false, code: 'event_not_found', error: '그 일정을 찾지 못했어요(이미 지워졌거나 다른 캘린더에 있어요).' };
  }
  // 값은 **먼저 다 검사한 뒤**에 손댄다 — 중간에 실패해 일정이 반쯤 바뀌는 일을 막는다.
  const wantTitle = b.title === undefined ? '' : clip(b.title, 500).trim();
  if (b.title !== undefined && !wantTitle) throw qqErr_('bad_request', '제목이 비어 있어요.');
  const allDay = b.allDay === undefined ? ev.isAllDayEvent() : b.allDay === true;
  const curS = ev.getStartTime(), curE = ev.getEndTime();
  let startD = null, endD = null;
  if (b.start !== undefined && b.start !== null && b.start !== '') {
    const sp = calParse(b.start, '시작');
    startD = allDay ? midnightOf(sp.d) : sp.d;
  }
  if (b.end !== undefined && b.end !== null && b.end !== '') {
    const ep = calParse(b.end, '끝');
    endD = allDay ? addDays(midnightOf(ep.d), 1) : ep.d;
  } else if (startD) {                                 // 시각만 옮기면 길이는 그대로
    if (allDay) endD = addDays(startD, Math.max(1, Math.round((curE.getTime() - curS.getTime()) / 86400000)));
    else endD = new Date(startD.getTime() + Math.max(60000, curE.getTime() - curS.getTime()));
  }
  if (startD && !(endD > startD)) {
    if (allDay) endD = addDays(startD, 1);             // 종일은 하루짜리로
    else throw qqErr_('bad_request', '끝이 시작보다 앞서요.');
  }
  // 종일만 시간 일정으로 바꾸면 몇 시인지 알 수 없다 — 시각을 같이 달라고 먼저 확인한다.
  if (allDay === false && ev.isAllDayEvent() && !startD) {
    throw qqErr_('bad_request', '종일 일정을 시간 일정으로 바꿀 때는 start(시각)도 함께 주세요.');
  }
  if (wantTitle) ev.setTitle(wantTitle);
  if (b.location !== undefined) ev.setLocation(clip(b.location, 500));
  if (b.description !== undefined) ev.setDescription(clip(b.description, 8000));
  if (startD) {
    if (allDay) ev.setAllDayDates(startD, endD);       // 종일(끝 경계는 하루 뒤)
    else ev.setTime(startD, endD);
  } else if (allDay && !ev.isAllDayEvent()) {           // 시간 일정 → 종일(그 날 하루)
    ev.setAllDayDates(midnightOf(curS), addDays(midnightOf(curS), 1));
  }
  const o = calOut(ev); o.ok = true; o.updated = true;
  o.note = '고쳤어요.'; return o;
}

// ── Google Tasks ───────────────────────────────────
function getTaskLists() {
  const res = Tasks.Tasklists.list({ maxResults: 20 });
  return { ok: true, lists: (res.items || []).map(function (l) { return { id: l.id, title: l.title }; }) };
}
function getTasks(listId) {
  const res = Tasks.Tasks.list(listIdOf(listId), { maxResults: 100, showCompleted: true });
  return { ok: true, tasks: (res.items || []).map(function (t) {
    return { id: t.id, title: t.title, notes: t.notes || '', done: t.status === 'completed', due: t.due || '' };
  }) };
}
function addTask(listId, title, notes) {
  const t = clip(title, 1024).trim();
  if (!t) return { ok: false, error: '제목이 비어 있어요.' };
  const task = Tasks.Tasks.insert({ title: t, notes: clip(notes, 8000) }, listIdOf(listId));
  return { ok: true, taskId: task.id };
}
function completeTask(listId, taskId) {
  const lid = listIdOf(listId), tid = idOf(taskId, '할 일');
  const t = Tasks.Tasks.get(lid, tid);
  t.status = t.status === 'completed' ? 'needsAction' : 'completed';
  if (t.status === 'needsAction') delete t.completed;
  Tasks.Tasks.update(t, lid, tid);
  return { ok: true, done: t.status === 'completed' };
}
function deleteTask(listId, taskId) {
  Tasks.Tasks.remove(listIdOf(listId), idOf(taskId, '할 일'));
  return { ok: true };
}

// ── 메모 (개정번호 + 잠금 + 줄어듦 방지 + 백업) ──────────
function cleanMemo(m) {
  if (!isObj(m)) return null;
  const id = clip(m.id, 64).trim();
  if (!id) return null;
  return {
    id: id,
    title: clip(m.title, 200),
    body: clip(m.body, 20000),
    color: MEMO_COLORS.indexOf(m.color) >= 0 ? m.color : 'mc-yellow',
    pinned: m.pinned === true,
    updatedAt: clip(m.updatedAt, 40)
  };
}
function cleanTombs(t) {
  const o = {};
  if (!isObj(t)) return o;
  let n = 0;
  Object.keys(t).forEach(function (k) {
    if (n >= MAX_TOMBS || k === '__proto__' || k.length > 64 || typeof t[k] !== 'string') return;
    o[k] = clip(t[k], 40); n++;
  });
  return o;
}

function readMemoData(file) {
  const txt = file.getBlob().getDataAsString();
  let d;
  try { d = JSON.parse(txt); }
  catch (_) {
    // 비어 있는 새 파일이 아니라면 손상으로 보고 중단 (빈 데이터로 덮어쓰지 않도록)
    if (txt && txt.trim().length > 2) {
      throw new Error('메모 파일을 읽을 수 없어요. 드라이브의 백업 폴더를 확인해주세요.');
    }
    d = {};
  }
  if (!isObj(d)) d = {};
  d.memos      = Array.isArray(d.memos) ? d.memos : [];     // 옛 형식(id 없음)은 그대로 돌려줌
  d.tombstones = isObj(d.tombstones) ? d.tombstones : {};
  d.rev        = Number(d.rev) || 0;
  return d;
}

function loadMemos() {
  const d = readMemoData(getMemoFile());
  return { ok: true, rev: d.rev, memos: d.memos, tombstones: d.tombstones, savedAt: d.savedAt || '' };
}

function saveMemos(body) {
  if (!Array.isArray(body.memos) || body.memos.length > MAX_MEMOS) {
    return { ok: false, error: '메모 목록이 올바르지 않아요.' };
  }
  const memos = [], ids = {};
  for (let i = 0; i < body.memos.length; i++) {
    const c = cleanMemo(body.memos[i]);
    if (!c || Object.prototype.hasOwnProperty.call(ids, c.id)) {
      return { ok: false, error: '메모 형식이 올바르지 않아요.' };
    }
    ids[c.id] = true; memos.push(c);
  }
  const tombs = cleanTombs(body.tombstones);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: '다른 저장이 진행 중이에요. 잠시 후 다시 시도해주세요.' };
  try {
    const file = getMemoFile();
    const cur = readMemoData(file);
    const force = body.force === true;
    if (!force && Number(body.baseRev) !== cur.rev) {
      return { ok: false, conflict: true, rev: cur.rev, memos: cur.memos, tombstones: cur.tombstones };
    }
    if (!force && cur.memos.length >= 4 && memos.length < cur.memos.length / 2) {
      return { ok: false, error: 'shrink', rev: cur.rev };
    }
    const next = { memos: memos, tombstones: tombs, version: 3, rev: cur.rev + 1, savedAt: new Date().toISOString() };
    const text = JSON.stringify(next);
    if (text.length > MAX_JSON_LEN) return { ok: false, error: '메모가 너무 커요.' };
    backupBefore(file, force);
    file.setContent(text);
    return { ok: true, rev: next.rev, savedAt: next.savedAt };
  } finally {
    lock.releaseLock();
  }
}

// ── 백업 (하루 1회, 14일 보관 / 복원 저장 직전엔 항상) ─
function backupBefore(file, force) {
  const folder = getFolder(BACKUP_SUB, getRoot());
  const now = new Date();
  const day = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  let name;
  if (force) {
    name = '포털_메모_' + day + '_' + Utilities.formatDate(now, TZ, 'HHmmss') + '_복원전.json';
  } else {
    name = '포털_메모_' + day + '.json';
    if (folder.getFilesByName(name).hasNext()) { pruneBackups(folder); return; }
  }
  file.makeCopy(name, folder);
  pruneBackups(folder);
}
function pruneBackups(folder) {
  const limit = Date.now() - KEEP_DAYS * 86400000;
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getDateCreated().getTime() < limit) f.setTrashed(true);
  }
}

// ── 드라이브 유틸 ───────────────────────────────────
function getRoot() { return getFolder(PORTAL_FOLDER, null); }
function getFolder(name, parent) {
  const it = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}
function getMemoFile() {
  const root = getRoot();
  const files = root.getFilesByName(MEMO_FILE);
  if (files.hasNext()) return files.next();
  return root.createFile(MEMO_FILE,
    JSON.stringify({ memos: [], tombstones: {}, version: 3, rev: 0 }), MimeType.PLAIN_TEXT);
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════════════════════════════════
// 관제 상태등 (읽기 전용) — 포털 상단의 배지 3개가 이걸 부른다
//
//   ① 노트북 응답   : HEARTBEAT_FILE_ID 가 있으면 그 파일의 updated_at.
//                     없으면 '알 수 없음(unknown)' — 시트 활동 시각은 '오더를 넣었다'는
//                     흔적일 뿐 노트북이 살아 있다는 뜻이 아니라서 초록불로 쓰지 않는다
//                     (2026-11-18 실전점검: 피클이 오더만 넣어도 '방금' 초록이 되던 거짓 안심 제거)
//   ② 밀린 명령     : Command_Queue 의 PENDING · WAITING_APPROVAL · TIMEOUT_REVIEW 수
//   ③ 토스 동기화   : 드라이브 가계부/가계부_주식스냅샷.json 의 최신 날짜
//
//  · 시트 ID · 파일 ID 는 스크립트 속성에만 둔다(이 저장소는 공개다) — 코드·문서·테스트에 넣지 않는다.
//    QUEUE_SHEET_ID     : Command_Queue 시트가 있는 스프레드시트 ID (필수)
//    HEARTBEAT_FILE_ID  : (선택) heartbeat.json 을 드라이브에 올려 둔 경우 그 파일 ID
//  · 무엇을 못 읽어도 예외를 던지지 않는다 — 화면은 state:'unknown' → '미연결 (세팅 대기)'.
//  · 돌려주는 값에 시트·파일 ID 는 없다(상태와 숫자뿐).
//  · 쓰기가 없다: 시트·드라이브를 읽기만 한다. 5분 캐시는 화면(localStorage)이 담당.
// ═══════════════════════════════════════════════════════════════
const QS_PROP_SHEET = 'QUEUE_SHEET_ID';
const QS_PROP_HEARTBEAT = 'HEARTBEAT_FILE_ID';
const QS_TAB = 'Command_Queue';
const QS_TOSS_FOLDER = '가계부';
const QS_TOSS_FILE = '가계부_주식스냅샷.json';
const AS_FILE = '포털_에이전트상태.json';      // 🤖 피클이 직접 덮어쓰는 상태 파일(드라이브 김성래포털)
const AS_MAX_TASKS = 12;
const AS_MAX_TEXT = 160;
const QS_HB_OK_MIN = 5;                  // 5분 이내 = 초록
const QS_HB_WARN_MIN = 60;               // 5분~1시간 = 노랑, 그 뒤는 빨강
const QS_PENDING_LATE_MIN = 15;           // 15분 넘게 PENDING 이면 빨강
const QS_TOSS_OK_DAYS = 1;               // 하루 이내 = 초록
const QS_TOSS_WARN_DAYS = 3;             // 2~3일(주말 감안) = 노랑, 4일+ = 빨강
const QS_MAX_ROWS = 3000;                // 아주 긴 시트는 아래(최근)부터 이만큼만

function queueStatus() {
  const props = PropertiesService.getScriptProperties();
  const res = {
    ok: true, connected: false, at: new Date().toISOString(),
    config: { queue: false, heartbeat: false, toss: false },
    heartbeat: { state: 'unknown' }, queue: { state: 'unknown' }, toss: { state: 'unknown' }
  };
  const sheetId = clip(props.getProperty(QS_PROP_SHEET), 200).trim();
  const hbFileId = clip(props.getProperty(QS_PROP_HEARTBEAT), 200).trim();
  let lastQueueAt = '';

  if (sheetId) {
    res.config.queue = true;
    try {
      const q = queueSheetStatus_(sheetId);
      res.queue = q.summary; lastQueueAt = q.lastActivityAt || '';
    } catch (err) {
      Logger.log('queue_status: 시트를 읽지 못했어요 — ' + String((err && err.message) || err));
      res.queue = { state: 'unknown', error: '시트를 읽지 못했어요' };
    }
  }

  if (hbFileId) {
    res.config.heartbeat = true;
    try { res.heartbeat = heartbeatStatus_(hbFileId); }
    catch (err) {
      Logger.log('queue_status: 하트비트 파일을 읽지 못했어요 — ' + String((err && err.message) || err));
      res.heartbeat = { state: 'unknown', error: '하트비트 파일을 읽지 못했어요' };
    }
  } else {
    // ① 노트북이 폴링 때 남기는 Agent_Status 1행 — 2026-11-19부터 이게 1순위다.
    //    파일을 따로 올릴 필요도, 노트북에 드라이브 권한도 필요 없다(폴링 자체가 생존 신호).
    let nb = null;
    if (sheetId) { try { nb = notebookBeat_(sheetId); } catch (err) { nb = null; } }
    if (nb && isFinite(nb.min)) {
      const st = heartAge_(nb.at, 'agent_status');
      res.heartbeat = {
        state: st.state, source: 'agent_status', approx: false, min: nb.min, at: nb.at,
        agent: nb.agent, busy: nb.busy, order_id: nb.order_id, version: nb.version
      };
    } else {
      // ② 그것도 없으면 '알 수 없다'고 정직하게 답한다.
      //    시트 활동 시각은 참고값(min·at)으로만 실어 보내고 state 는 unknown 으로 둔다.
      const h = lastQueueAt ? heartAge_(lastQueueAt, 'sheet') : null;
      res.heartbeat = { state: 'unknown', source: 'sheet', approx: true, reason: 'no_heartbeat' };
      if (h && isFinite(h.min)) { res.heartbeat.min = h.min; res.heartbeat.at = h.at; }
    }
  }

  try {
    res.toss = tossSyncStatus_();
    if (res.toss.state !== 'unknown') res.config.toss = true;
  } catch (err) {
    Logger.log('queue_status: 토스 스냅샷을 읽지 못했어요 — ' + String((err && err.message) || err));
    res.toss = { state: 'unknown', error: '토스 스냅샷을 읽지 못했어요' };
  }

  res.connected = !!(res.config.queue || res.config.heartbeat || res.config.toss);
  return res;
}

/** 시트의 숫자/날짜 칸 → ms (Date 칸·문자열 둘 다) */
function qsCellMs_(v) {
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(String(v == null ? '' : v));
  return isFinite(t) ? t : 0;
}

function queueSheetStatus_(sheetId) {
  const ss = SpreadsheetApp.openById(sheetId);
  const sh = ss.getSheetByName(QS_TAB);
  if (!sh) return { summary: { state: 'unknown', error: 'Command_Queue 탭이 없어요' }, lastActivityAt: '' };
  const values = sh.getDataRange().getValues();
  const empty = { state: 'ok', pending: 0, waiting: 0, timeout: 0, oldest_min: null };
  if (!values || values.length < 2) return { summary: empty, lastActivityAt: '' };
  const head = values[0].map(function (v) { return String(v == null ? '' : v).trim(); });
  const at = function (name) { return head.indexOf(name); };
  const iStatus = at('status'), iCreated = at('created_at'), iClaimed = at('claimed_at'), iFinished = at('finished_at');
  const iBeat = at('beat_at'), iStarted = at('started_at'), iPayload = at('payload');
  if (iStatus < 0) return { summary: { state: 'unknown', error: 'status 칸을 찾지 못했어요' }, lastActivityAt: '' };

  let pending = 0, waiting = 0, timeout = 0, review = 0, oldest = 0, last = 0;
  const start = Math.max(1, values.length - QS_MAX_ROWS);
  for (let r = start; r < values.length; r++) {
    const row = values[r];
    if (!row) continue;
    const st = String(row[iStatus] == null ? '' : row[iStatus]).trim().toUpperCase();
    if (!st) continue;
    const created = iCreated >= 0 ? qsCellMs_(row[iCreated]) : 0;
    if (st === 'PENDING') {
      // 포털(사람) 앞 대화는 아무도 실행하지 않는다 — 대기 건수·가장 오래된 대기에서 뺀다(2026-11-25)
      if (iPayload >= 0 && qqPortalChatRaw_(row[iPayload])) continue;
      pending++;
      if (created && (!oldest || created < oldest)) oldest = created;
    } else if (st === 'WAITING_APPROVAL') waiting++;
    else if (st === 'TIMEOUT_REVIEW') timeout++;
    else if (st === 'REVIEW_NEEDED') review++;
    last = Math.max(last,
      created,
      iClaimed >= 0 ? qsCellMs_(row[iClaimed]) : 0,
      iStarted >= 0 ? qsCellMs_(row[iStarted]) : 0,
      iBeat >= 0 ? qsCellMs_(row[iBeat]) : 0,
      iFinished >= 0 ? qsCellMs_(row[iFinished]) : 0);
  }

  const oldestMin = oldest ? Math.max(0, Math.round((Date.now() - oldest) / 60000)) : null;
  let state = 'ok';
  if (timeout >= 1) state = 'bad';
  else if (oldestMin !== null && oldestMin >= QS_PENDING_LATE_MIN) state = 'bad';
  else if (pending >= 2 || waiting >= 1) state = 'warn';
  return {
    summary: { state: state, pending: pending, waiting: waiting, timeout: timeout, review: review, oldest_min: oldestMin },
    lastActivityAt: last ? new Date(last).toISOString() : ''
  };
}

/** 마지막 응답 시각 → 신호등(드라이브 하트비트 파일 전용). 시트 시각은 위 queueStatus 가 unknown 으로 처리한다. */
function heartAge_(iso, source) {
  const t = Date.parse(String(iso || ''));
  if (!isFinite(t)) return { state: 'unknown', source: source };
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  let state = 'bad';
  if (min <= QS_HB_OK_MIN) state = 'ok';
  else if (min <= QS_HB_WARN_MIN) state = 'warn';
  if (source === 'sheet' && state === 'bad') state = 'warn';   // 시트 시각은 '마지막 작업'일 뿐이에요
  return { state: state, at: new Date(t).toISOString(), min: min, source: source, approx: source === 'sheet' };
}

/**
 * 노트북 생존 신호 — Command_Queue 와 같은 스프레드시트의 `Agent_Status` 탭 1행.
 *  (updated_at, agent, state, order_id, script_version) — CommandQueue.gs 가 poll 응답 때 제자리 갱신한다.
 *  없거나 깨졌으면 null. 읽기만 한다.
 */
function notebookBeat_(sheetId) {
  const ss = SpreadsheetApp.openById(sheetId);
  const sh = ss.getSheetByName('Agent_Status');
  if (!sh || sh.getLastRow() < 2) return null;
  const v = sh.getRange(2, 1, 1, 5).getValues()[0] || [];
  const at = String(v[0] || '');
  const t = Date.parse(at);
  if (!isFinite(t)) return null;
  return {
    at: new Date(t).toISOString(),
    min: Math.max(0, Math.round((Date.now() - t) / 60000)),
    agent: clip(v[1], 24), state: clip(v[2], 12), busy: String(v[2] || '') === 'busy',
    order_id: clip(v[3], 40), version: clip(v[4], 40)
  };
}

function heartbeatStatus_(fileId) {
  const f = DriveApp.getFileById(fileId);
  let d;
  try { d = JSON.parse(f.getBlob().getDataAsString()); }
  catch (_) { return { state: 'unknown', source: 'drive', error: '하트비트 파일을 읽을 수 없어요' }; }
  const res = heartAge_((d && (d.updated_at || d.last_poll_at)) || '', 'drive');
  // 노트북 데몬이 "지금 무엇을 돌리는지"를 하트비트에 실어 보냅니다(SSH 없이도 보이게).
  // 값이 없거나 예전 형식이면 그 칸만 비워요(상태·신호등은 그대로).
  try {
    const cur = d && d.current;
    res.current = clip(typeof cur === 'string' ? cur : (cur && cur.id) || '', 40);
    res.current_type = clip(d && d.current_type, 20);
    res.daemon = clip(d && d.state, 16);
    res.processed = qqInt_(d && d.processed, 0, 1000000, 0);
    res.polls = qqInt_(d && d.polls, 0, 100000000, 0);
    res.started_at = clip(d && d.started_at, 40);
    res.version = clip(d && d.version, 20);
  } catch (_) { /* 넘겨주는 칸이 없어도 신호등은 살립니다 */ }
  return res;
}

/** 가계부 폴더의 토스 스냅샷 파일에서 마지막 동기화 날짜를 읽는다 (없으면 unknown) */
function tossSyncStatus_() {
  const folders = DriveApp.getFoldersByName(QS_TOSS_FOLDER);
  if (!folders.hasNext()) return { state: 'unknown' };
  const files = folders.next().getFilesByName(QS_TOSS_FILE);
  if (!files.hasNext()) return { state: 'unknown' };
  const file = files.next();
  let d = null;
  try { d = JSON.parse(file.getBlob().getDataAsString()); } catch (_) {}
  const latest = (d && isObj(d.latest)) ? d.latest : null;
  let date = clip(latest && latest.date, 10).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const stamp = file.getLastUpdated ? file.getLastUpdated() : null;   // 날짜가 없으면 파일 수정 시각
    date = stamp ? Utilities.formatDate(stamp, TZ, 'yyyy-MM-dd') : '';
  }
  if (!date) return { state: 'unknown' };
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const days = Math.max(0, Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(date + 'T00:00:00Z')) / 86400000));
  let state = 'bad';
  if (days <= QS_TOSS_OK_DAYS) state = 'ok';
  else if (days <= QS_TOSS_WARN_DAYS) state = 'warn';
  return { state: state, date: date, days: days, at: clip(latest && latest.at, 40) };
}

// ═══════════════════════════════════════════════════════════════
// 🤖 피클(총괄 AI) 작업 상태 — 드라이브 김성래포털/포털_에이전트상태.json
//
//  피클은 일을 시작할 때·끝낼 때 이 파일을 통째로 덮어씁니다(가벼운 JSON 한 장).
//  포털은 그걸 읽어서 "피클이 지금 무엇을 하는지 · 무엇을 했는지"를 보여줍니다.
//
//   { "version": 1, "updated_at": "2026-11-17T10:40:00+09:00",
//     "agent": { "state": "working|idle", "task": "...", "project": "portal", "started_at": "...", "id": "..." },
//     "tasks": [ { "id":"...", "project":"portal", "title":"...", "state":"working|done|failed",
//               "started_at":"...", "ended_at":"...", "result":"..." } ] }
//
//  · 읽기 전용 — 폴더·파일을 만들지 않는다(없으면 안내만).
//  · 이름·전화·주민번호·키 모양은 내보내기 직전에 가립니다(qqMask_).
//  · 30분 넘게 갱신이 없으면 state 를 stale 로 알려 화면이 "응답 없음"을 보여준다.
// ═══════════════════════════════════════════════════════════════
const AS_STALE_MIN = 30;
function agentStatus() {
  const res = { ok: true, at: new Date().toISOString(), connected: false, updated_at: '', agent: null, tasks: [], note: '' };
  let f = null;
  try {
    const folders = DriveApp.getFoldersByName(PORTAL_FOLDER);
    if (!folders.hasNext()) { res.note = '포털 폴더가 아직 없어요'; return res; }
    const files = folders.next().getFilesByName(AS_FILE);
    if (!files.hasNext()) { res.note = '아직 피클 기록이 없어요'; return res; }
    f = files.next();
    let d = null;
    try { d = JSON.parse(f.getBlob().getDataAsString()); } catch (_) { d = null; }
    if (!isObj(d)) { res.note = '상태 파일을 읽을 수 없어요'; return res; }
    res.connected = true;
    res.updated_at = clip(d.updated_at, 40);
    const upMs = Date.parse(res.updated_at);
    res.min = isFinite(upMs) ? Math.max(0, Math.round((Date.now() - upMs) / 60000)) : null;
    res.stale = res.min !== null && res.min >= AS_STALE_MIN;
    const a = d.agent;
    if (isObj(a)) {
      res.agent = {
        state: clip(a.state, 16), task: qqMask_(a.task, AS_MAX_TEXT), project: clip(a.project, 24),
        started_at: clip(a.started_at, 40), id: clip(a.id, 40),
        // 진행 중인데 30분 넘게 소식이 없으면 멈춘 것 같다고 알려줘요
        stale: res.stale && String(a.state || '').toLowerCase() === 'working'
      };
    }
    const list = Array.isArray(d.tasks) ? d.tasks.slice(0, AS_MAX_TASKS) : [];
    res.tasks = list.map(function (t) {
      const o = isObj(t) ? t : {};
      return {
        id: clip(o.id, 40), project: clip(o.project, 24),
        title: qqMask_(o.title, AS_MAX_TEXT), state: clip(o.state, 12),
        started_at: clip(o.started_at, 40), ended_at: clip(o.ended_at, 40),
        result: qqMask_(o.result, AS_MAX_TEXT)
      };
    });
    res.tasks = res.tasks.slice(0, 40);
    // ⌨️ 기기 상태 비트 — 노트북 '직접(free)'·회사 PC. 있으면 블록으로 함께 준다(없거나 깨져도 예외 없이)
    const bDirect = agentBeatRead_('direct'); if (bDirect) res.direct = bDirect;
    const bPc = agentBeatRead_('pc'); if (bPc) res.pc = bPc;
    const bPi1 = agentBeatRead_('pi1'); if (bPi1) res.pi1 = bPi1;
    const bPi2 = agentBeatRead_('pi2'); if (bPi2) res.pi2 = bPi2;
    res.beat_targets = AB_TARGETS.slice(0);      // 예전 배포와 구분(화면이 재배포 안내를 고를 때 씀)
  } catch (err) {
    Logger.log('agent_status: ' + String((err && err.message) || err));
    res.note = '상태 파일을 읽지 못했어요';
  }
  return res;
}

// ═══════════════════════════════════════════════════════════════
// 📊 비서 사용량 (2026-11-25) — 남은 % 를 적어 두는 작은 장부
//
//  · 화면은 이 기기(localStorage)에 먼저 저장하고, 서버가 알면 여기에도 남긴다(토큰 0원).
//  · 파일: 드라이브 김성래포털/포털_비서사용량.json = {v, updated_at, items:{pi1:{pct,at}, …}}
//  · 칸은 정해진 비서만(US_IDS). pct 는 0~100, at 은 그 값이 사실이던 시각(ISO).
//    같은 비서를 여러 기기에서 넣으면 at 이 더 최근인 쪽이 이긴다(merge).
//  · 비밀번호·고객정보 같은 건 여기에 들어오지 않는다(숫자·시각·짧은 메모뿐).
//  · 2026-11-25(v27): 외부 비서가 **자기 줄만** 보고할 수 있게 열었다.
//    `{action:'usage_report', key, id:'cue', pct:42, note:'리서치 대기'}` 한 번이면 cue 줄만 바뀐다(부분 갱신).
//    `pct` 대신 `remain`(+`total`)도 받는다. `note`·`status` 는 보낸 칸만 바꾸고, 빈 문자열이면 지운다.
// ═══════════════════════════════════════════════════════════════
const US_FILE = '포털_비서사용량.json';
const US_IDS = ['pi1', 'pi2', 'cue', 'vooy', 'keyring', 'claude', 'agy', 'freellmapi', 'pc'];
// 화면에서 추가한 비서(부이·큐 등)도 같은 규칙이면 저장한다 — GAS 재배포 없이 늘어난다.
const US_ID_RE = /^[a-z0-9][a-z0-9_-]{0,11}$/;
function usIdOk_(id) { return US_IDS.indexOf(id) >= 0 || US_ID_RE.test(id); }
const US_MAX = 24;                       // 부계정 비서까지 늘어나도 담기게
const US_NOTE_MAX = 40;

/** 파일을 읽어 {items:{id:{pct,at,note?,status?}}} 로. 없거나 깨졌으면 빈 장부. */
function usageRead_() {
  const out = { v: 1, updated_at: '', items: {} };
  try {
    const fo = DriveApp.getFoldersByName(PORTAL_FOLDER);
    if (!fo.hasNext()) return out;
    const it = fo.next().getFilesByName(US_FILE);
    if (!it.hasNext()) return out;
    const d = JSON.parse(it.next().getBlob().getDataAsString());
    if (!isObj(d)) return out;
    out.updated_at = clip(d.updated_at, 40);
    const items = isObj(d.items) ? d.items : {};
    Object.keys(items).forEach(function (k) {
      if (!usIdOk_(k) || !isObj(items[k])) return;
      const pct = Number(items[k].pct);
      if (!isFinite(pct) || pct < 0 || pct > 100) return;
      const rec = { pct: Math.round(pct * 10) / 10, at: clip(items[k].at, 40) };
      const note = clip(items[k].note, US_NOTE_MAX);
      if (note) rec.note = note;
      const st = clip(items[k].status, 12);
      if (st) rec.status = st;
      out.items[k] = rec;
    });
  } catch (err) {
    Logger.log('usage_get: ' + String((err && err.message) || err));
  }
  return out;
}

/** 저장 모양 → 화면 모양(빈 note·status 는 넣지 않는다) */
function usPublic_(items) {
  return Object.keys(items).map(function (id) {
    const x = items[id];
    const o = { id: id, pct: x.pct, at: x.at };
    if (x.note) o.note = x.note;
    if (x.status) o.status = x.status;
    return o;
  });
}

/** 화면이 쓰는 모양 — {items:[{id,pct,at,note?,status?}], at, reported} */
function usageGet() {
  const d = usageRead_();
  const items = usPublic_(d.items);
  return { ok: true, at: d.updated_at || '', items: items, reported: items.length, ids: qqWithRoster_(US_IDS), duties: agentDuties_() };
}

/**
 * 들어온 한 칸을 검사해 저장 모양으로. note·status 는 **보내지 않으면 null**(이전 값 유지).
 *  · pct 가 없고 remain 이 있으면 그걸 남은 %로 본다(remain+total 이면 비율로 환산).
 */
function usItemOf_(x, now) {
  if (!isObj(x)) return null;
  const id = String(x.id || '').trim().toLowerCase();
  if (!usIdOk_(id)) throw qqErr_('bad_request', '모르는 비서예요: ' + clip(id, 20));
  let pct = Number(x.pct);
  if ((!isFinite(pct) || x.pct === undefined || x.pct === null || x.pct === '') &&
      x.remain !== undefined && x.remain !== null && x.remain !== '') {
    const remain = Number(x.remain);
    const total = Number(x.total);
    pct = (isFinite(total) && total > 0) ? (remain / total) * 100 : remain;
  }
  if (!isFinite(pct) || pct < 0 || pct > 100) throw qqErr_('bad_request', 'pct 는 0~100 사이 숫자여야 해요.');
  const at = String(x.at || '').trim();
  const out = {
    id: id, pct: Math.round(pct * 10) / 10,
    at: isFinite(Date.parse(at)) ? clip(at, 40) : now,
    note: null, status: null
  };
  if (x.note !== undefined && x.note !== null) out.note = clip(String(x.note).replace(/\s+/g, ' ').trim(), US_NOTE_MAX);
  if (x.status !== undefined && x.status !== null) out.status = clip(String(x.status).trim().toLowerCase(), 12);
  return out;
}

/** 남은 % 를 기록한다 — 같은 비서는 at 이 더 최근인 값만 덮어쓴다(다른 비서 줄은 그대로). */
function usageSet_(body) {
  const b = isObj(body) ? body : {};
  // items[] 로 여러 비서를 한 번에(화면), 또는 id 하나만(외부 비서의 자기 보고)
  const list = Array.isArray(b.items) ? b.items : (b.id ? [b] : []);
  if (!list.length) throw qqErr_('bad_request', 'items 가 필요해요.');
  const now = new Date().toISOString();
  const incoming = {};
  list.slice(0, US_MAX).forEach(function (x) {
    const it = usItemOf_(x, now);
    if (it) incoming[it.id] = it;
  });
  if (!Object.keys(incoming).length) throw qqErr_('bad_request', 'items 가 필요해요.');
  return qqLock_(function () {
    const cur = usageRead_();
    let saved = 0;
    Object.keys(incoming).forEach(function (id) {
      const old = cur.items[id];
      const oldAt = old ? (Date.parse(old.at) || 0) : 0;
      const newAt = Date.parse(incoming[id].at) || 0;
      if (old && newAt < oldAt) return;          // 더 오래된 보고는 무시
      const rec = { pct: incoming[id].pct, at: incoming[id].at };
      const note = incoming[id].note === null ? ((old && old.note) || '') : incoming[id].note;
      const st = incoming[id].status === null ? ((old && old.status) || '') : incoming[id].status;
      if (note) rec.note = note;
      if (st) rec.status = st;
      cur.items[id] = rec; saved++;
    });
    const fo = DriveApp.getFoldersByName(PORTAL_FOLDER);
    const folder = fo.hasNext() ? fo.next() : DriveApp.createFolder(PORTAL_FOLDER);
    const js = JSON.stringify({ v: 1, updated_at: now, items: cur.items });
    const it = folder.getFilesByName(US_FILE);
    if (it.hasNext()) it.next().setContent(js); else folder.createFile(US_FILE, js, 'application/json');
    return { ok: true, at: now, saved: saved, ids: US_IDS.slice(), items: usPublic_(cur.items) };
  });
}

// ═══════════════════════════════════════════════════════════════
// 👥 비서 참여자 명부 (2026-11-25) — 어느 폰·PC 에서 열어도 같은 @멘션·말풍선
//
//  · 기본 참여자(피원·피투·노트북·큐·부이·키링)는 화면(AGENT_SEED)이 이미 갖고 있다.
//    여기에는 **화면에서 ＋추가한 비서**와 **큐에 처음 말을 건 비서**(자동 합류)만 쌓인다.
//  · 파일: 드라이브 김성래포털/포털_비서목록.json = {v, updated_at, items:{id:{name,icon,group,at,auto}}}
//  · id 규칙은 시트 한 칸에 안전한 값(영소문자·숫자·_·- 12자). 예약 id(AG_RESERVED)는 저장하지 않는다.
//  · 이름 길이 16자·최대 24명. 같은 id 는 at 이 더 최근인 이름이 이긴다(두 기기가 서로 덮지 않게).
// ═══════════════════════════════════════════════════════════════
const AG_FILE = '포털_비서목록.json';
const AG_ID_RE = /^[a-z0-9][a-z0-9_-]{0,11}$/;
const AG_MAX = 24;
const AG_NAME_MAX = 16;
const AG_DUTY_MAX = 60;
const AG_RESERVED = ['all', 'portal', 'phone', 'telegram', 'notebook', 'pi1', 'pi2', 'cue', 'vooy', 'keyring'];
// 기본 참여자와 담당 한 줄(2026-11-25 v28, 레이 님 지시) — API(agents_get·usage_get·queue_list)로도 보인다.
//  화면(AGENT_SEED.duty)과 같은 글이다. 바뀌면 양쪽을 같이 고친다.
const AG_BUILTINS = [
  { id: 'pi1', name: '피원', icon: '🍋', group: '일일', duty: '총괄 조율·스케줄·블로그/콘텐츠/보험툴/포털 지휘' },
  { id: 'pi2', name: '피투', icon: '🤖', group: '일일', duty: 'GitHub PR/이슈·분산 실행·SNS/커머스 보조' },
  { id: 'cue', name: '큐', icon: '🌀', group: '일일', duty: '레이 님 일정 관리 전담 · 최신 정보 리서치·팩트체크' },
  { id: 'vooy', name: '부이', icon: '🫛', group: '일일', duty: '후보 비교/체크리스트·채용/면접 리서치·PDF/HWP 문서 읽기' },
  { id: 'keyring', name: '키링', icon: '🔑', group: '일일', duty: '전화 발신 검증·KTX/예약·대전 밥집/쇼핑커넥트 발굴' },
  { id: 'notebook', name: '집 노트북', icon: '🖥️', group: '일일', duty: '24시간 즉답·코드 실행·숏폼 무토큰 렌더' }
];
let AG_ROSTER_CACHE = { at: 0, items: null };

/** 명부 파일을 읽어 {items, removed} 로. 없거나 깨졌으면 빈 명부. */
function agentRead_() {
  const out = { v: 1, updated_at: '', items: {}, removed: {} };
  try {
    const fo = DriveApp.getFoldersByName(PORTAL_FOLDER);
    if (!fo.hasNext()) return out;
    const it = fo.next().getFilesByName(AG_FILE);
    if (!it.hasNext()) return out;
    const d = JSON.parse(it.next().getBlob().getDataAsString());
    if (!isObj(d)) return out;
    out.updated_at = clip(d.updated_at, 40);
    const items = isObj(d.items) ? d.items : {};
    Object.keys(items).forEach(function (k) {
      const id = String(k || '').toLowerCase();
      if (!AG_ID_RE.test(id) || AG_RESERVED.indexOf(id) >= 0 || !isObj(items[k])) return;
      const name = clip(items[k].name, AG_NAME_MAX).trim();
      if (!name) return;
      out.items[id] = {
        name: name, icon: clip(items[k].icon || '🤖', 2),
        group: items[k].group === '주간' ? '주간' : '일일',
        at: clip(items[k].at, 40), auto: !!items[k].auto,
        duty: clip(items[k].duty, AG_DUTY_MAX)
      };
    });
    // 뺀 기록(30일) — 다른 기기도 "내가 뺀 비서"를 다시 그리지 않게
    const rm = isObj(d.removed) ? d.removed : {};
    Object.keys(rm).forEach(function (k) {
      const id = String(k || '').toLowerCase();
      const at = clip(rm[k], 40);
      if (!AG_ID_RE.test(id) || !isFinite(Date.parse(at))) return;
      out.removed[id] = at;
    });
  } catch (err) {
    Logger.log('agents_get: ' + String((err && err.message) || err));
  }
  return out;
}

/** 명부 → 화면 모양 [{id,name,icon,group,at,auto?,duty?}] */
function agentPublic_(items) {
  return Object.keys(items).map(function (id) {
    const x = items[id];
    const o = { id: id, name: x.name, icon: x.icon, group: x.group, at: x.at };
    if (x.auto) o.auto = true;
    if (x.duty) o.duty = x.duty;
    return o;
  });
}

/**
 * 참여자 전체 명부(기본 + 화면에서 추가한 비서) — 60초 캐시.
 *  · 담당 역할(duty)을 API 로 바로 볼 수 있게 하는 자리다: agents_get.items,
 *    usage_get.duties, queue_list.duties 가 모두 이걸 쓴다.
 */
function agentRoster_() {
  const now = Date.now();
  if (AG_ROSTER_CACHE.items && now - AG_ROSTER_CACHE.at < 60000) return AG_ROSTER_CACHE.items;
  const list = AG_BUILTINS.map(function (b) {
    return { id: b.id, name: b.name, icon: b.icon, group: b.group, duty: b.duty, builtin: true };
  });
  const cur = agentRead_();
  Object.keys(cur.items).forEach(function (id) {
    const x = cur.items[id];
    list.push({ id: id, name: x.name, icon: x.icon, group: x.group, duty: x.duty || '', at: x.at, auto: !!x.auto });
  });
  AG_ROSTER_CACHE = { at: now, items: list };
  return list;
}
/** id → 담당 한 줄 (읽기 응답에 싣는 작은 표) */
function agentDuties_() {
  const m = {};
  agentRoster_().forEach(function (x) { if (x.duty) m[x.id] = x.duty; });
  return m;
}
/** 기본 목록 + 화면에서 추가한 비서 id (targets·sources·usage ids 응답용) */
function qqWithRoster_(base) {
  const list = base.slice();
  try {
    agentRoster_().forEach(function (a) {
      if (a.builtin) return;
      if (list.indexOf(a.id) < 0) list.push(a.id);
    });
  } catch (err) { /* 명부를 못 읽으면 기본 목록만 */ }
  return list;
}

function agentListGet() {
  const d = agentRead_();
  const items = agentRoster_();
  const removed = Object.keys(d.removed).map(function (id) { return { id: id, at: d.removed[id] }; });
  return { ok: true, at: d.updated_at || '', items: items, removed: removed, count: items.length, max: AG_MAX };
}

  /**
 * 참여 비서를 더하거나 뺀다.
 *  · items[] 또는 id 하나(=이름 붙여 추가), removed[](id 문자열 또는 {id,at}) 로 뺀다.
 *  · 예약 id(기본 참여자)는 저장하지 않고 조용히 건너뛴다 — 화면이 이미 안다.
 */
function agentSave_(body) {
  const b = isObj(body) ? body : {};
  const list = Array.isArray(b.items) ? b.items : (b.id ? [b] : []);
  const removed = Array.isArray(b.removed) ? b.removed.slice(0, AG_MAX) : [];
  if (!list.length && !removed.length) throw qqErr_('bad_request', 'items 또는 removed 가 필요해요.');
  const now = new Date().toISOString();
  const incoming = {};
  list.slice(0, AG_MAX).forEach(function (x) {
    if (!isObj(x)) return;
    const id = String(x.id || '').trim().toLowerCase();
    if (AG_RESERVED.indexOf(id) >= 0) return;
    if (!AG_ID_RE.test(id)) throw qqErr_('bad_request', '비서 id 규칙에 안 맞아요: ' + clip(id, 20));
    const name = clip(x.name, AG_NAME_MAX).trim() || id;
    const at = String(x.at || '').trim();
    incoming[id] = {
      name: name, icon: clip(x.icon || '🤖', 2),
      group: x.group === '주간' ? '주간' : '일일',
      at: isFinite(Date.parse(at)) ? clip(at, 40) : now, auto: !!x.auto,
      duty: (x.duty === undefined || x.duty === null) ? null : clip(x.duty, AG_DUTY_MAX)
    };
  });
  const drop = [];
  removed.forEach(function (v) {
    const id = String((isObj(v) ? v.id : v) || '').trim().toLowerCase();
    if (!AG_ID_RE.test(id) || AG_RESERVED.indexOf(id) >= 0) return;
    const at = String((isObj(v) && v.at) || '').trim();
    drop.push({ id: id, at: isFinite(Date.parse(at)) ? clip(at, 40) : now });
  });
  return qqLock_(function () {
    const cur = agentRead_();
    let saved = 0;
    Object.keys(incoming).forEach(function (id) {
      const old = cur.items[id];
      const oldAt = old ? (Date.parse(old.at) || 0) : 0;
      const newAt = Date.parse(incoming[id].at) || 0;
      if (!old || newAt >= oldAt) {
        const next = Object.assign({}, incoming[id]);
        // 담당을 안 보냈으면 지금 값을 지우지 않는다(이름만 바꿔도 역할은 남는다)
        if (next.duty === null) next.duty = (old && old.duty) || '';
        cur.items[id] = next; saved++;
      }
    });
    drop.forEach(function (x) {
      delete cur.items[x.id];
      cur.removed[x.id] = x.at;                     // 다른 기기에서도 다시 그리지 않게 기록(최근 50건)
    });
    // 뺀 기록이 너무 많아지면 지난 것부터 지운다
    const rmIds = Object.keys(cur.removed);
    if (rmIds.length > 50) {
      rmIds.sort(function (a, b2) { return (Date.parse(cur.removed[b2]) || 0) - (Date.parse(cur.removed[a]) || 0); });
      rmIds.slice(50).forEach(function (id) { delete cur.removed[id]; });
    }
    // 너무 많으면 최근에 이름이 붙은 것부터 남긴다
    const keys = Object.keys(cur.items);
    if (keys.length > AG_MAX) {
      keys.sort(function (a, b2) { return (Date.parse(cur.items[b2].at) || 0) - (Date.parse(cur.items[a].at) || 0); });
      keys.slice(AG_MAX).forEach(function (id) { delete cur.items[id]; });
    }
    const fo = DriveApp.getFoldersByName(PORTAL_FOLDER);
    const folder = fo.hasNext() ? fo.next() : DriveApp.createFolder(PORTAL_FOLDER);
    const js = JSON.stringify({ v: 1, updated_at: now, items: cur.items, removed: cur.removed });
    const it = folder.getFilesByName(AG_FILE);
    if (it.hasNext()) it.next().setContent(js); else folder.createFile(AG_FILE, js, 'application/json');
    const items = (function () { AG_ROSTER_CACHE = { at: 0, items: null }; return agentRoster_(); })();
    const removedOut = Object.keys(cur.removed).map(function (id) { return { id: id, at: cur.removed[id] }; });
    return { ok: true, at: now, saved: saved, removed: drop.length, items: items, removed_items: removedOut, count: items.length };
  });
}

// ═══════════════════════════════════════════════════════════════
// 🤖 노트북 오더함 — Command_Queue 읽기·접수·승인/거절
//
//  포털에서 "메모처럼" 오더를 적어 두면 노트북(hub-agent 워커)이 집어 가 실행하고,
//  결과가 같은 목록에 쌓인다. 텔레그램 봇 없이 포털 하나로 끝내는 창구.
//
//  · 규격은 work/hub-agent/gas/CommandQueue.gs 와 100% 같다 —
//    같은 시트·같은 22칸·같은 상태값·같은 payload 해시(canonical JSON 의 SHA-256).
//    그래서 노트북은 이 오더를 텔레그램에서 넣은 오더와 구분 없이 집어 간다.
//  · 위험 작업(claude_prompt mode=edit)은 절대 바로 실행하지 않는다 → WAITING_APPROVAL.
//    15분 안에 포털에서 [✅ 승인]을 눌러야 PENDING 으로 내려가 실행된다. 지나면 EXPIRED.
//  · 승인은 payload 해시에 묶는다 — 승인 뒤 내용이 바뀐 채 실행되는 일을 막는다.
//  · 시트 ID 는 스크립트 속성(QUEUE_SHEET_ID)에만. 응답에 ID·키·payload 원문은 넣지 않는다
//    (목록에는 주민·전화를 가린 한 줄 요약만).
//  · 쓰기는 스크립트 잠금 안에서만(포털 쪽 동시 접수 방지). 잠금을 못 잡으면 'busy'.
// ═══════════════════════════════════════════════════════════════
const QQ_TAB = 'Command_Queue';
const QQ_AUDIT_TAB = 'Audit_Log';
// CommandQueue.gs 의 CQ_COLS 와 같은 순서·같은 이름 (앞 16칸 뒤에 승인 6칸)
const QQ_COLS = [
  'id', 'created_at', 'source', 'type', 'workspace', 'payload', 'status', 'attempts',
  'claimed_at', 'claimed_by', 'finished_at', 'duration_ms', 'exit_code', 'result', 'error', 'detail',
  'risk_level', 'approval_expires_at', 'approval_by', 'approval_at', 'approval_note', 'approval_hash',
  // 2026-11-18 사후 자동 게이트 — 앞 22칸은 그대로 두고 뒤에만 붙인다(구버전과 섞여도 밀리지 않게)
  'branch', 'block_reason', 'diff_summary', 'changed_files'
];
const QQ_AUDIT_COLS = [
  'at', 'command_id', 'type', 'workspace', 'risk_level', 'decision', 'by', 'channel', 'note', 'payload_hash', 'source'
];
// 이 칸들이 없으면 예전 시트다 → 쓰지 않고 안내만 (setupCommandQueue() 재실행 안내)
const QQ_NEED_COLS = [
  'id', 'created_at', 'source', 'type', 'workspace', 'payload', 'status', 'attempts', 'finished_at',
  'risk_level', 'approval_expires_at', 'approval_by', 'approval_at', 'approval_hash'
];
// 포털에서 접수할 수 있는 오더만 (워커 화이트리스트 중에서도 이 셋만)
const QQ_TYPES = {
  git_pull:      { label: '코드 최신화', needsWorkspace: true,  idempotent: true },
  toss_sync:     { label: '토스 동기화', needsWorkspace: false, idempotent: false },
  claude_prompt: { label: '클로드 지시', needsWorkspace: true,  idempotent: false },
  // 2026-11-20 — 콘텐츠 허브 제작 스텝퍼의 영상 렌더. 항상 승인 필요(HIGH). hub-agent CQ_TYPES·lib/render.js 와 같은 규칙.
  content_render: { label: '영상 렌더', needsWorkspace: false, idempotent: true }
};
const QQ_PROP_WS = 'QUEUE_WORKSPACES';            // (선택) 허용 워크스페이스 덮어쓰기
// AI 엔진 — 노트북 lib/engines.js 의 ENGINE_IDS 와 같아야 한다.
//   auto 는 claude → agy → freellmapi 순으로 넘어간다(워커가 판단).
const QQ_ENGINES = ['auto', 'claude', 'agy', 'freellmapi'];
const QQ_WS_DEFAULT = 'gaegyebu,content-hub,insurance-manager,smartstore-hub,s2ongrae.github.io';
// 오더를 낸 곳(source) — 이 화면은 portal, 피원은 pi1, 피투는 pi2.
//  부이(vooy)·큐(cue) 처럼 나중에 붙는 비서도 **GAS 재배포 없이** 이름을 쓸 수 있게 규칙으로 검사한다.
//  (영소문자·숫자·_·- 12자 — 시트 한 칸에 안전한 값)
const QQ_SOURCES = ['portal', 'pi1', 'pi2', 'cue', 'vooy', 'keyring'];   // 2026-11-25 큐·부이·키링 합류
// 사람이 아닌 별칭(피원이 쓰던 이름) — 자동 합류 후보에서 뺀다.
const QQ_SRC_ALIAS = ['pickle', 'pk', 'hub-agent', 'nb', 'telegram', 'tg', 'phone', 'mobile'];
const QQ_AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,11}$/;
// 2026-11-25 — 외부 에이전트 인바운드 웹훅(실시간 깨우기).
//  URL 은 코드·저장소·시트·로그 어디에도 두지 않는다 — ScriptProperties 한 곳에만.
//   {"cue":"https://…","cue2":"https://…"}  ← 에이전트 id 키만 늘리면 새 비서도 바로 깨어진다.
const QQ_WEBHOOK_PROP = 'WEBHOOK_TRIGGERS_JSON';
// 웹훅 mentions 상한은 QQ_MENTION_MAX(9 — @멘션 + 협업 줄 이름)를 그대로 쓴다(2026-11-26).
// 발사 결과(응답 코드)만 6시간 캐시에 남긴다 — 주소는 절대 남기지 않는다. GET `webhook_last` 로 확인.
const QQ_WEBHOOK_LOG_KEY = 'webhook_last';
// 대상(target, @멘션) — 누구에게 시키는가. all=전체, notebook=집 노트북(기본 실행자).
const QQ_TARGETS = ['all', 'pi1', 'pi2', 'notebook', 'cue', 'vooy', 'keyring'];
// @이름 → 대상 id. 본문에만 @큐 처럼 적어도 그 비서 앞으로 가게 한다(화면 칩과 같은 규칙).
const QQ_TARGET_NAMES = { '전체': 'all', '피원': 'pi1', '피투': 'pi2', '노트북': 'notebook', '큐': 'cue', '부이': 'vooy', '키링': 'keyring' };
// 2026-11-25 사용자 확정 — 부계정 호칭. 명부에 오르기 전에도 @멘션이 그 비서 앞으로 간다.
//  · 큐투(cue2) · 뷔투(vooy2) · 키투(keyring2) — 옛 부름(@큐2·@부이2·@키링2)도 같은 사람.
const QQ_SECONDARY = {
  cue2:     ['큐투', '큐2', 'cue2'],
  vooy2:    ['뷔투', '부이2', '부이투', 'vooy2'],
  keyring2: ['키투', '키링2', '키링투', 'keyring2']
};
/** source 값 → 시트에 남길 이름. 규칙에 맞으면 그대로, 아니면 portal. */
function qqSourceOf_(v) {
  const t = String(v == null ? '' : v).trim().toLowerCase();
  if (QQ_SOURCES.indexOf(t) >= 0) return t;
  return QQ_AGENT_ID_RE.test(t) ? t : 'portal';
}
/** target 값 → 규칙에 맞으면 그대로(없으면 빈 문자열 = 노트북) */
function qqTargetOf_(p) {
  const t = String((isObj(p) && p.target) || '').trim().toLowerCase();
  if (t === 'all' || QQ_TARGETS.indexOf(t) >= 0) return t;
  return QQ_AGENT_ID_RE.test(t) ? t : '';
}
/**
 * @이름 → id 표. 기본 이름 + 명부(포털_비서목록.json).
 *  · queue_list 는 아이템 20건에 각각 붙으므로 한 번 만든 표를 60초 쓴다(드라이브 읽기 월 1회꼼).
 *  · 오더를 넣는 순간(qqPayloadOf_)은 fresh=true — 방금 추가한 비서 이름도 바로 알아본다.
 */
let QQM_CACHE = { at: 0, map: null };
function qqMentionMap_(fresh) {
  const now = Date.now();
  if (!fresh && QQM_CACHE.map && now - QQM_CACHE.at < 60000) return QQM_CACHE.map;
  const map = {};
  Object.keys(QQ_TARGET_NAMES).forEach(function (nm) { map['@' + nm] = QQ_TARGET_NAMES[nm]; });
  QQ_TARGETS.forEach(function (id) { if (id !== 'all') map['@' + id] = id; });
  // 2026-11-25 — 숫자 부계정(@피원2·@큐3 …)은 명부에 오르기 전에도 베이스 비서 앞으로.
  //  사용자 확정 호칭(큐투·뷔투·키투)은 그 뒤에 넣어 "@큐2" 가 cue2 로 잡히게 한다.
  Object.keys(map).forEach(function (l) {
    var id = map[l];
    if (id === 'all') return;
    for (var n = 2; n <= 9; n++) { if (!map[l + n]) map[l + n] = id; }
  });
  // 사용자 확정 부계정 호칭 — 명부에 같은 이름이 있으면 아래 루프가 덮어쓴다
  Object.keys(QQ_SECONDARY).forEach(function (id) {
    map['@' + id] = id;
    QQ_SECONDARY[id].forEach(function (nm) { map['@' + nm] = id; });
  });
  try {
    agentRoster_().forEach(function (a) { map['@' + a.name] = a.id; map['@' + a.id] = a.id; });
  } catch (err) { /* 명부를 못 읽어도 기본 이름으로 충분 */ }
  QQM_CACHE = { at: now, map: map };
  return map;
}
/**
 * 본문에서 멘션 하나하나를 뽑는다(나온 순서·중복 제거, 최대 max 개).
 *  · 뒤에 영숫자가 붙으면 멘션이 아니다(@피원님이 → 허용, @피원a → 아님).
 */
function qqMentionAll_(text, max, fresh) {
  const s = String(text == null ? '' : text);
  const out = [];
  if (s.indexOf('@') < 0) return out;
  const map = qqMentionMap_(fresh);
  const labels = Object.keys(map).sort(function (a, b) { return b.length - a.length; });
  for (let i = 0; i < s.length; i++) {
    if (s.charAt(i) !== '@') continue;
    for (let j = 0; j < labels.length; j++) {
      const l = labels[j];
      if (s.substr(i, l.length) !== l) continue;
      if (/[A-Za-z0-9_-]/.test(s.charAt(i + l.length))) continue;
      const id = map[l];
      if (out.indexOf(id) < 0) out.push(id);
      i += l.length - 1;
      break;
    }
    if (out.length >= (max || 6)) break;
  }
  return out;
}
/**
 * 본문의 @이름만 적혀 있어도 대상 하나를 고른다("@큐 이거 봐줘") — 화면의 @멘션 칩과 같은 규칙.
 *  · 이름은 QQ_TARGET_NAMES(기본 참여자) + 명부(포털_비서목록.json)의 이름/ID. 긴 이름부터 본다.
 *  · 명부를 읽다 실패해도 오더는 그대로 간다(빈 결과).
 */
function qqMentionOf_(text) {
  const all = qqMentionAll_(text, 1, true);
  return all.length ? all[0] : '';
}
// ── 보고서 '협업 필요' 줄의 이름도 멘션으로 (2026-11-26, 사용자 지시) ──────────
//  "협업 필요한데 그 애들 태그를 해야지 그냥 pi2 노트북 이러고만 해두잖아"
//  · 4항목 보고서는 `4. 협업 필요: 노트북(구현), pi2(PR 머지)` 처럼 @ 없이 이름만 적는 일이 많다.
//    그러면 mentions 에 빠져 그 비서의 웹훅도 안 깨어나고, 아무도 이어받지 않는다.
//  · 그래서 **협업 필요 줄 안에서만** @ 없는 이름을 비서 id 로 읽는다(@멘션 규칙은 그대로).
//  · 자기 자신(source)은 빼고, "없음" 같은 부정 표현은 무시하고, 중복은 하나로.
const QQ_MENTION_MAX = 9;                      // @멘션 6 + 협업 줄에서 더 붙는 이름
const QQ_COLLAB_HEAD_RE = /^[ \t]*(?:[-*•·][ \t]*)?[*_]{0,2}(?:\[?\d{1,2}\]?[.)]?[ \t]*)?[*_]{0,2}협업[ \t]*필요[*_]{0,2}[ \t]*[:：][*_]{0,2}[ \t]*/;
// 다음 항목(번호·제목)이 시작하면 협업 줄은 끝난다 — 빈 줄도 끝.
const QQ_COLLAB_STOP_RE = /^[ \t]*[*_]{0,2}(?:\d{1,2}[.)][ \t]*\S|#{1,6}[ \t]*\S)/;
// '없음'만 적힌 줄은 멘션이 아니다.
const QQ_COLLAB_NONE_RE = /^(?:[-–—·]|없음|없슴|없어|없어요|없다|없습니다|해당\s*없음|none|n\/a|n\.a\.?)$/i;
// 이름 뒤에 붙어도 되는 한글 조사(노트북이·피투에게) — 긴 것부터 본다.
const QQ_COLLAB_JOSA = ['에서', '에게', '한테', '으로', '부터', '까지', '처럼', '보다', '만큼', '조차', '마저',
  '님', '이', '가', '은', '는', '을', '를', '의', '에', '께', '도', '만', '과', '와', '랑', '로'];
/**
 * 본문에서 '협업 필요:' 줄의 내용만 모은다(줄 머리부터 빈 줄·다음 번호 항목 전까지).
 *  · 줄바꿈 뒤에 이어 쓴 목록(`- 노트북(구현)`)은 같은 줄 내용으로 본다.
 */
function qqCollabSegments_(text) {
  const s = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  const out = [];
  if (s.indexOf('협업') < 0) return out;
  const lines = s.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const head = QQ_COLLAB_HEAD_RE.exec(lines[i]);
    if (!head) continue;
    const buf = [lines[i].slice(head[0].length)];
    for (let j = i + 1; j < lines.length; j++) {
      const ln = lines[j];
      if (!String(ln).trim()) break;
      if (QQ_COLLAB_STOP_RE.test(ln)) break;
      buf.push(String(ln).replace(/^[ \t]*[-*•·][ \t]*/, ''));
    }
    out.push(buf.join(' '));
  }
  return out;
}
/** @을 뗀 이름 표 — 멘션 표(기본+명부)에서 '@'만 뗀다. 'all' 은 사람이 아니다. */
function qqBareNameMap_(fresh) {
  const m = qqMentionMap_(fresh);
  const out = {};
  Object.keys(m).forEach(function (k) {
    if (k.charAt(0) !== '@') return;
    const nm = k.slice(1);
    if (!nm || m[k] === 'all') return;
    out[nm] = m[k];
  });
  return out;
}
/** 협업 줄에서 이름 앞뒤 경계 — '큐레이션' 의 '큐', 'pi2x' 를 이름으로 오해하지 않게. */
function qqCollabHit_(s, i, len) {
  if (i > 0 && /[가-힣A-Za-z0-9_@-]/.test(s.charAt(i - 1))) return false;
  const j = i + len;
  if (j >= s.length) return true;
  const c = s.charAt(j);
  if (/[A-Za-z0-9_-]/.test(c)) return false;
  if (!/[가-힣]/.test(c)) return true;                     // 공백·괄호·쉼표·콜론
  for (let k = 0; k < QQ_COLLAB_JOSA.length; k++) {
    const jo = QQ_COLLAB_JOSA[k];
    if (s.substr(j, jo.length) !== jo) continue;
    const n = j + jo.length;
    if (n >= s.length) return true;
    if (!/[가-힣A-Za-z0-9_-]/.test(s.charAt(n))) return true;
  }
  return false;
}
/** '협업 필요' 줄에서 @ 없이 적힌 비서 이름을 ids 로 (나온 순서·중복 제거). */
function qqCollabMentions_(text, fresh) {
  const segs = qqCollabSegments_(text);
  const out = [];
  if (!segs.length) return out;
  const map = qqBareNameMap_(fresh);
  const labels = Object.keys(map).sort(function (a, b) { return b.length - a.length; });
  if (!labels.length) return out;
  segs.forEach(function (seg) {
    const s = String(seg);
    if (!s.trim() || QQ_COLLAB_NONE_RE.test(s.trim())) return;
    for (let i = 0; i < s.length; i++) {
      let hit = '';
      for (let j = 0; j < labels.length; j++) {
        const l = labels[j];
        if (s.substr(i, l.length) !== l) continue;
        if (!qqCollabHit_(s, i, l.length)) continue;
        hit = l; break;
      }
      if (!hit) continue;
      const id = map[hit];
      if (out.indexOf(id) < 0) out.push(id);
      i += hit.length - 1;
    }
  });
  return out;
}
/**
 * 이 오더의 멘션 id 목록 — ①본문 @이름 ②'협업 필요' 줄의 @ 없는 이름.
 *  · source(낸 사람)는 자기 자신을 멘션하지 않는다 — 자기 웹훅이 자기 글에 깨어나지 않게.
 */
function qqMentionIds_(text, source, fresh) {
  const out = qqMentionAll_(text, QQ_MENTION_MAX, fresh);
  qqCollabMentions_(text, fresh).forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); });
  const self = String(source == null ? '' : source).trim().toLowerCase();
  if (self && self !== 'portal' && self !== 'all') {
    for (let i = out.length - 1; i >= 0; i--) if (out[i] === self) out.splice(i, 1);
  }
  return out.slice(0, QQ_MENTION_MAX);
}
/** 비서 id 인가(portal·all 은 사람/전체라 뺀다). */
function qqIsAiId_(v) {
  const t = String(v == null ? '' : v).trim().toLowerCase();
  return !!t && t !== 'portal' && t !== 'all' && QQ_AGENT_ID_RE.test(t);
}
const QQ_LIST_DEFAULT = 15;
const QQ_LIST_MAX = 20;
const QQ_SCAN_ROWS = 400;                          // 목록·중복 확인용으로 아래에서 읽는 줄 수
const QQ_DEDUPE_MS = 5 * 60000;                    // 같은 비멱등 오더 재접수 방지 창
const QQ_APPROVAL_TTL_MS = 15 * 60000;             // 승인 대기 15분 (워커와 같은 값)
const QQ_MAX_PAYLOAD = 4000;                       // CommandQueue 와 같은 payload 상한(자)
const QQ_MAX_PROMPT = 2000;                        // 오더 글 길이 상한(입력)
// 2026-11-26 — 화면에 보이는 대화·답장은 자르지 않는다. 시트 셀 한도(50,000자)만 방어선으로 둔다.
const QQ_CELL_MAX = 50000;
const QQ_FINAL = { DONE: true, FAILED: true, REJECTED: true, EXPIRED: true, REVIEW_NEEDED: true };
// 사후 게이트가 main 반영을 보류하고 auto-review 브랜치에 보존한 상태(사람이 병합)
const QQ_REVIEW = 'REVIEW_NEEDED';

// ── 자동 승인(위임) — 2026-11-18 ───────────────────────────────
// 사용자가 채팅에서 이미 시킨 "일반 코드 작업"은 승인 버튼 없이 바로 PENDING 으로 내려 실행한다.
//  · 자동 대상: 가계부·콘텐츠허브·보험툴·스마트스토어 4개 저장소의 파일 수정 오더
//  · 계속 수동: 포털(s2ongrae.github.io) — 오더를 내는 제어면이라 스스로 고치게 두지 않는다
//  · 되돌릴 수 없거나 비밀값·배포를 건드리는 지시는 프롬프트에 있으면 수동
//  · 같은 조건표가 노트북(hub-agent lib/approval.js)·게이트웨이(CommandQueue.gs)에도 있어
//    실행 직전에 한 번 더 검증한다(제로 트러스트).
const QQ_AUTO_WS = ['gaegyebu', 'content-hub', 'insurance-manager', 'smartstore-hub'];
const QQ_AUTO_DENY = [
  [/\brm\s+-[a-z]*[rf][a-z]*\b/i, 'rm -rf'],
  [/\bgit\s+reset\s+--hard\b/i, 'git reset --hard'],
  [/\bgit\s+push\b/i, 'git push'],
  [/\bgit\s+clean\s+-[a-z]*[dfx]/i, 'git clean -fd'],
  [/\bgit\s+checkout\s+--\s+\./i, 'git checkout -- .'],
  [/(^|[^A-Za-z0-9_.])\.env(?!\.example|\.sample|\.template)\b/i, '.env'],
  [/\.github[\/\\]workflows/i, '.github/workflows'],
  [/\bdrop\s+table\b/i, 'DROP TABLE'],
  [/\.\.[\/\\]/, '상위 경로(..)'],
  [/(?:secret|api[_-]?key|password|token)\s*[:=]\s*\S+/i, '비밀값 쓰기']
];

/** 프롬프트에 걸리는 금지 지시 이름(없으면 빈 문자열). */
function qqForbidden_(text) {
  const s = String(text == null ? '' : text);
  for (let i = 0; i < QQ_AUTO_DENY.length; i++) {
    if (QQ_AUTO_DENY[i][0].test(s)) return QQ_AUTO_DENY[i][1];
  }
  return '';
}

/** 이 오더를 승인 없이 실행해도 되는가. { auto: true|false, reason: '…' } */
function qqAutoDelegation_(type, payload, workspace) {
  const p = isObj(payload) ? payload : {};
  const ws = String(workspace || '').trim();
  if (type !== 'claude_prompt') return { auto: false, reason: '자동 위임은 파일 수정 오더(claude_prompt)에만 적용됩니다.' };
  const mode = String(p.mode || p.risk || '').toLowerCase();
  if (mode !== 'edit' && mode !== 'write' && mode !== 'high') return { auto: false, reason: '파일을 고치지 않는 오더입니다.' };
  if (!ws) return { auto: false, reason: '작업 위치가 없습니다.' };
  if (QQ_AUTO_WS.indexOf(ws) < 0) return { auto: false, reason: '자동 승인 대상이 아닌 작업 위치입니다: ' + ws };
  const hit = qqForbidden_(p.prompt);
  if (hit) return { auto: false, reason: '사람이 승인해야 하는 지시가 들어 있습니다: ' + hit };
  return { auto: true, reason: '위임된 일반 코드 작업(' + ws + ')' };
}

function qqErr_(code, msg) { const e = new Error(msg); e.code = code; return e; }
function qqProp_(name) { return clip(PropertiesService.getScriptProperties().getProperty(name), 200).trim(); }
function qqInt_(v, min, max, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  const n = Math.floor(Number(v));
  if (!isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
function qqTwo_(n, w) { let s = String(n); while (s.length < (w || 2)) s = '0' + s; return s; }

/** 밀리초 epoch → CommandQueue 와 같은 표기 '2026-11-15T20:15:13+09:00' (Asia/Seoul 고정) */
function qqIso_(ms) {
  const d = new Date(Number(ms) + 9 * 3600000);
  return qqTwo_(d.getUTCFullYear(), 4) + '-' + qqTwo_(d.getUTCMonth() + 1) + '-' + qqTwo_(d.getUTCDate()) +
    'T' + qqTwo_(d.getUTCHours()) + ':' + qqTwo_(d.getUTCMinutes()) + ':' + qqTwo_(d.getUTCSeconds()) + '+09:00';
}
function qqNow_() { return qqIso_(Date.now()); }
function qqMakeId_(ms) {
  const d = new Date(Number(ms) + 9 * 3600000);
  return 'Q-' + qqTwo_(d.getUTCFullYear(), 4) + qqTwo_(d.getUTCMonth() + 1) + qqTwo_(d.getUTCDate()) +
    '-' + qqTwo_(d.getUTCHours()) + qqTwo_(d.getUTCMinutes()) + qqTwo_(d.getUTCSeconds()) +
    '-' + Math.random().toString(36).slice(2, 6);
}

// ── 시트 열기·읽기·쓰기 ─────────────────────────────
/** 시트를 열고 머리글을 이름→위치로 읽는다. ID 는 응답에 넣지 않는다. */
function qqOpen_() {
  const id = qqProp_(QS_PROP_SHEET);
  if (!id) throw qqErr_('noconfig', '오더함이 아직 시트에 연결되지 않았어요.');
  let ss;
  try { ss = SpreadsheetApp.openById(id); }
  catch (_) { throw qqErr_('unreachable', 'Command_Queue 시트를 열지 못했어요.'); }
  const sh = ss.getSheetByName(QQ_TAB);
  if (!sh) throw qqErr_('schema', 'Command_Queue 탭이 없어요.');
  const width = Number(sh.getLastColumn()) || 0;
  if (!width) throw qqErr_('schema', 'Command_Queue 탭이 비어 있어요.');
  const head = sh.getRange(1, 1, 1, width).getValues()[0].map(function (v) {
    return String(v == null ? '' : v).trim();
  });
  for (let i = 0; i < QQ_NEED_COLS.length; i++) {
    if (head.indexOf(QQ_NEED_COLS[i]) < 0) {
      throw qqErr_('schema', 'Command_Queue 칸이 예전 형식이에요(' + QQ_NEED_COLS[i] + ' 칸 없음).');
    }
  }
  return { ss: ss, sh: sh, head: head, width: width };
}

/** 아래(최근)부터 max 줄. max 가 0 이면 전부. 머리글 이름으로 값을 담아 준다. */
function qqRows_(ctx, max) {
  const last = Number(ctx.sh.getLastRow()) || 0;
  if (last < 2) return [];
  const from = max ? Math.max(2, last - max + 1) : 2;
  const vals = ctx.sh.getRange(from, 1, last - from + 1, ctx.width).getValues();
  const out = [];
  for (let i = 0; i < vals.length; i++) {
    const row = vals[i] || [];
    const o = { __row: from + i };
    for (let j = 0; j < ctx.head.length; j++) {
      const k = ctx.head[j];
      if (!k) continue;
      o[k] = row[j] === undefined ? '' : row[j];
    }
    if (String(o.id == null ? '' : o.id).trim()) out.push(o);
  }
  return out;
}

/** 머리글 순서대로 한 줄 덧붙인다(모르는 칸은 빈 값). */
function qqAppend_(ctx, obj) {
  ctx.sh.appendRow(ctx.head.map(function (name) { return obj[name] === undefined ? '' : obj[name]; }));
}

/** 그 줄을 읽어 넘긴 칸만 바꿔 다시 쓴다(모르는 칸은 그대로 보존). */
function qqUpdateRow_(ctx, rowNumber, patch) {
  const row = ctx.sh.getRange(rowNumber, 1, 1, ctx.width).getValues()[0];
  for (let j = 0; j < ctx.head.length; j++) {
    const k = ctx.head[j];
    if (k && Object.prototype.hasOwnProperty.call(patch, k)) row[j] = patch[k];
  }
  ctx.sh.getRange(rowNumber, 1, 1, ctx.width).setValues([row]);
}

function qqLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1500)) throw qqErr_('busy', '다른 저장이 진행 중이에요. 잠시 뒤 다시 시도해주세요.');
  try { return fn(); } finally { lock.releaseLock(); }
}

// ── 해시·가림 (CommandQueue.gs 와 같은 규칙) ─────────────
/** 키 순서에 흔들리지 않는 JSON — hub-agent lib/approval.js 의 canonicalJson 과 같은 규칙. */
function qqCanonical_(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v !== 'object') return JSON.stringify(v);
  if (Object.prototype.toString.call(v) === '[object Array]') {
    const arr = [];
    for (let i = 0; i < v.length; i++) arr.push(qqCanonical_(v[i]));
    return '[' + arr.join(',') + ']';
  }
  const keys = [];
  for (const k in v) { if (Object.prototype.hasOwnProperty.call(v, k) && v[k] !== undefined) keys.push(k); }
  keys.sort();
  const parts = [];
  for (let i = 0; i < keys.length; i++) parts.push(JSON.stringify(keys[i]) + ':' + qqCanonical_(v[keys[i]]));
  return '{' + parts.join(',') + '}';
}
function qqHash_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s == null ? '' : s), Utilities.Charset.UTF_8);
  let o = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = (bytes[i] + 256) % 256;
    o += (b < 16 ? '0' : '') + b.toString(16);
  }
  return o;
}
/** payload(시트의 JSON 문자열)의 승인 해시 = canonical JSON 의 SHA-256(hex). */
function qqHashPayload_(payload) {
  let obj = {};
  try { obj = JSON.parse(String(payload || '{}')); } catch (_) { obj = {}; }
  return qqHash_(qqCanonical_(isObj(obj) ? obj : {}));
}

/** 화면·기록에 내보내기 전 가림: 비밀 키·토큰 모양·주민/전화번호 → [REDACTED]
 *  max 를 주지 않으면(또는 0 이하) 시트 셀 한도(QQ_CELL_MAX)만 적용한다 — 대화 본문·답장은 자르지 않는다(2026-11-26). */
function qqMask_(s, max) {
  let t = String(s == null ? '' : s);
  const sk = secretKey();
  if (sk && sk.length >= 8) t = t.split(sk).join('[REDACTED]');
  t = t.replace(/(auth_token|token|password|pwd|secret|client_secret|api_?key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
  t = t.replace(/\b\d{6}[-– ]?[1-4]\d{6}\b/g, '[REDACTED]')
       .replace(/\b01[016789][-– ]?\d{3,4}[-– ]?\d{4}\b/g, '[REDACTED]')
       .replace(/\b0(?:2|3[1-9]|[4-6]\d|70)[-– ]?\d{3,4}[-– ]?\d{4}\b/g, '[REDACTED]');
  const lim = (max === undefined || max === null || Number(max) <= 0) ? QQ_CELL_MAX : Math.min(Number(max), QQ_CELL_MAX);
  return t.length > lim ? t.slice(0, Math.max(0, lim - 1)) + '…' : t;
}

function qqParse_(s) {
  if (!s) return {};
  if (isObj(s)) return s;
  try { const o = JSON.parse(String(s)); return isObj(o) ? o : {}; } catch (_) { return {}; }
}

// payload 안의 "target" 만 문자열에서 바로 꺼내는 정규식 (2026-11-25 — 목록 필터의 사전 거르기)
const QQ_TARGET_JSON_RE = /"target"\s*:\s*(?:"([^"]{0,32})"|([^",}\s]{1,32}))/;
// 답장 추적용 — 행마다 JSON 을 풀지 않고 reply_to 문자열만 싸게 본다(2026-11-25 v27).
const QQ_REPLY_JSON_RE = /"reply_to"\s*:\s*"([A-Za-z0-9._:-]{1,60})"/;
/**
 * 목록 필터용 target — **qqItem_ 을 만들지 않고** 시트 한 줄에서 싸게 읽는다.
 *  v25 는 target 필터에서도 행마다 qqItem_(payload 파싱 + 가림 정규식 + 속성 읽기 4~5회)을 돌려
 *  400행이면 50초를 넘겼다(2026-11-25 실측). 값의 최종 판정은 여전히 qqItem_ 이 하고,
 *  여기서는 무거운 일을 할 행을 고르는 데만 쓴다. 없으면 'notebook'(qqItem_ 의 기본값과 같다).
 */
function qqRowTarget_(r) {
  const raw = r && r.payload;
  if (isObj(raw)) {
    const t = String(raw.target == null ? '' : raw.target).trim().toLowerCase();
    return t ? clip(t, 12) : 'notebook';
  }
  if (!raw) return 'notebook';
  const m = QQ_TARGET_JSON_RE.exec(String(raw));
  if (!m) return 'notebook';
  const t = String(m[1] != null ? m[1] : m[2]).trim().toLowerCase();
  return t ? clip(t, 12) : 'notebook';
}

/** 목록에 보일 한 줄 요약 — 긴 프롬프트는 줄이고 가린다. payload 원문은 내보내지 않는다.
 *  · 대화(kind='chat')는 요약이 아니라 **말풍선 본문 그 자체**다 — 줄바꿈을 살리고 자르지 않는다(2026-11-26).
 *  · 웹훅으로 받는 비서도 이 값을 그대로 읽으므로, 여기서 자르면 요청을 못 읽는다. */
function qqSummary_(type, p) {
  let s = '';
  if (type === 'git_pull') s = '코드 최신화 (git pull --ff-only)';
  else if (type === 'toss_sync') s = '토스증권 → 가계부 동기화';
  else if (type === 'claude_prompt') {
    const eng = String(p.engine || '').toLowerCase();
    const kind = String(p.kind || '').toLowerCase();
    // 큐가 붙인 [워커 규칙] 은 실행 규칙이지 사람이 읽을 내용이 아니다 — 요약에서는 뗀다(2026-11-25).
    const raw = qqStripWorkerNote_(p.prompt);
    if (kind === 'chat' || kind === 'approval') {
      // 대화는 '클로드: ' 접두사도, 160자 컷도, 공백 뭉개기도 없다. 원문 그대로(줄바꿈 보존).
      return qqMask_(raw.replace(/\r\n?/g, '\n'), QQ_CELL_MAX);
    }
    // 2026-11-26 — '클로드: ' 접두사와 160자 컷을 없앴다. kind 가 한 번이라도 빠지면
    //  (다른 창구가 바깥에 kind 를 적어 보낸 경우) 대화가 잘린 '오더 요약'으로 저장돼 보였다.
    //  이제 오더 요약도 본문 그대로다(줄바꿈만 한 줄로). 자르는 기준은 시트 셀 한도 하나뿐.
    const body = raw.replace(/\s+/g, ' ');
    s = body +
      (String(p.mode || '').toLowerCase() === 'edit' ? ' (파일 수정)' : '') +
      (eng && eng !== 'auto' ? ' · 엔진 ' + eng : '');
  } else if (type === 'git_push') s = '깃 푸시 → ' + String(p.branch || '(브랜치 없음)');
  else if (type === 'smartstore_api_relay') s = '스마트스토어 API ' + String(p.op || '');
  else s = Object.keys(p).length ? Object.keys(p).join(', ') : '(내용 없음)';
  return qqMask_(s, QQ_CELL_MAX);
}

/** 시트 한 줄 → 화면용 항목 */
function qqItem_(r) {
  const st = String(r.status == null ? '' : r.status).trim().toUpperCase();
  const type = String(r.type == null ? '' : r.type).trim();
  const p = qqParse_(r.payload);
  const expMs = Date.parse(String(r.approval_expires_at || ''));
  return {
    id: clip(r.id, 40),
    type: type,
    workspace: clip(r.workspace, 40),
    status: st,
    risk_level: clip(r.risk_level, 10).toUpperCase() || 'LOW',
    created_at: clip(r.created_at, 40),
    // 누가·언제 집어 갔는지 — 포털이 '실행 중 경과 시간'을 접수 시각이 아니라 실제 시작 시각으로 셉니다.
    claimed_at: clip(r.claimed_at, 40),
    // 2026-11-18 야간 무인 — started_at(첫 점유)과 beat_at(마지막 신호)을 따로 읽는다.
    //   claimed_at 은 이제 touch 로 움직이지 않으므로 경과 시간이 맞게 흐르고,
    //   beat_at 이 20분 넘게 끊길 때만 '정체'로 본다(노트북이 살아서 도는 중인 것과 구분).
    started_at: clip(r.started_at, 40),
    beat_at: clip(r.beat_at, 40),
    claimed_by: clip(r.claimed_by, 20),
    finished_at: clip(r.finished_at, 40),
    duration_ms: r.duration_ms === '' || r.duration_ms == null ? null : Number(r.duration_ms),
    exit_code: r.exit_code === '' || r.exit_code == null ? null : Number(r.exit_code),
    attempts: Number(r.attempts || 0),
    // 누가 낸 오더인가(portal · pi1 · pi2) — 회의실 말풍선 색·필터가 이 값을 쓴다.
    source: clip(String(r.source == null ? '' : r.source).trim().toLowerCase(), 20),
    // 대화 답장·실행 결과는 자르지 않는다 — 시트 셀 한도까지만(2026-11-26).
    result: qqMask_(r.result, QQ_CELL_MAX),
    error: qqMask_(r.error, QQ_CELL_MAX),
    approval_by: clip(r.approval_by, 20),
    branch: clip(r.branch, 120),
    block_reason: qqMask_(r.block_reason, 400),
    diff_summary: clip(r.diff_summary, 200),
    changed_files: qqMask_(r.changed_files, 400),
    approval_at: clip(r.approval_at, 40),
    auto_approved: String(r.approval_by == null ? '' : r.approval_by).trim().toLowerCase() === 'auto',
    approval_expires_at: clip(r.approval_expires_at, 40),
    expires_in_ms: st === 'WAITING_APPROVAL' && isFinite(expMs) ? Math.max(0, expMs - Date.now()) : null,
    // 대화(kind='chat')와 @멘션(target) — 예전 줄에는 없으니 빈 값으로 내려간다.
    kind: clip(String(p.kind == null ? '' : p.kind).toLowerCase(), 12),
    target: clip(String(p.target == null ? '' : p.target).toLowerCase(), 12),
    // 본문에서 알아본 멘션 id 배열(2026-11-25 v27) — 비서가 이름 문자열 검색으로 놓치지 않게.
    //  target 도 함께 넣는다(누구 앞으로 왔는지 배열 하나로 보이게). 'all' 은 사람이 아니라 뺀다.
    mentions: (function () {
      // 2026-11-26 — '협업 필요' 줄에 @ 없이 적은 이름도 여기 들어온다(자기 자신은 뺀다).
      const list = qqMentionIds_(p.prompt, r.source, false);
      const tgt = String(p.target == null ? '' : p.target).trim().toLowerCase();
      if (tgt && tgt !== 'all' && tgt !== 'portal' && QQ_AGENT_ID_RE.test(tgt) && list.indexOf(tgt) < 0) list.push(tgt);
      return list;
    })(),
    // 답장 추적(2026-11-25 v27) — 이 오더가 답장이면 원본 id, 끝난 오더면 누가 처리했는지.
    //  오더 id 는 대소문자를 가리므로(Q-2026…) reply_to 는 그대로 둔다.
    reply_to: clip(String(p.reply_to == null ? '' : p.reply_to).trim(), 60),
    // 2026-11-25 — 처리한 비서(claimed_by)가 버어진 옛 줄·다른 비서가 reply_to 로 마감한 줄도
    //  답장자를 걺지 않게 발신자(source)로 채운다(화면이 '포털이 답한 것'처럼 보이던 문제).
    replied_by: (function () {
      if (st !== 'DONE' && st !== 'FAILED' && st !== 'REVIEW_NEEDED' && st !== 'TIMEOUT_REVIEW') return '';
      var by = String(r.claimed_by == null ? '' : r.claimed_by).trim().toLowerCase();
      if (!by) by = String(r.source == null ? '' : r.source).trim().toLowerCase();
      return clip(by, 20);
    })(),
    summary: qqSummary_(type, p),
    // 📎 첨부(2026-11-27) — 화면이 말풍선에 사진·파일 칩을 그린다. 본체는 Drive 에 있다(file_get).
    files: qqFileVec_(p.files, false),
    // 🔔 레이 님이 결정해야 하는가 — 실행 승인 대기 + 아직 결정 안 한 승인 요청(2026-11-27)
    needs_decision: st === 'WAITING_APPROVAL' ||
      (String(p.kind || '').toLowerCase() === 'approval' && st === 'PENDING'),
    approval: (function () {
      const isReq = String(p.kind || '').toLowerCase() === 'approval';
      const note = String(r.approval_note == null ? '' : r.approval_note);
      const dec = qqDecisionOf_(r);
      if (!isReq && !dec) return null;
      return { request: isReq, title: clip(String(p.title == null ? '' : p.title), QQ_APPROVAL_TITLE_MAX),
        risk: clip(String(p.risk == null ? '' : p.risk), 20), ref: clip(String(p.ref == null ? '' : p.ref), 60),
        due: clip(String(p.due == null ? '' : p.due), 40), decision: dec,
        decided_at: clip(r.approval_at, 40), note: qqMask_(note.replace(/^[✅⏸🚫]\S*\s*(승인|보류|거절)\s*(—\s*)?/, ''), 300) };
    })()
  };
}

// ── 워크스페이스 ────────────────────────────────────
function qqWorkspaces_() {
  const raw = qqProp_(QQ_PROP_WS) || QQ_WS_DEFAULT;
  return String(raw).split(',').map(function (s) { return s.trim(); }).filter(function (s) { return !!s; }).slice(0, 20);
}
function qqCheckWorkspace_(name) {
  const ws = String(name);
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(ws) || ws === '.' || ws === '..') {
    throw qqErr_('workspace', '작업 위치 이름이 올바르지 않아요.');
  }
  if (qqWorkspaces_().indexOf(ws) < 0) throw qqErr_('workspace', '허용되지 않은 작업 위치예요: ' + clip(ws, 40));
}

// ── 오더 접수 payload ────────────────────────────────
/** 워커가 읽는 payload 모양으로 만든다(JSON 문자열). git_pull·toss_sync 는 빈 객체. */
function qqPayloadOf_(type, p) {
  if (type === 'content_render') return qqRenderPayloadOf_(p);
  if (type !== 'claude_prompt') return '{}';
  const raw = isObj(p) ? String(p.prompt == null ? '' : p.prompt) : String(p == null ? '' : p);
  if (raw.length > QQ_MAX_PROMPT) throw qqErr_('too_long', '오더가 너무 길어요(' + QQ_MAX_PROMPT + '자 이내로 적어주세요).');
  const prompt = raw.trim();
  if (!prompt) throw qqErr_('bad_request', '오더 내용을 적어주세요.');
  const edit = isObj(p) && String(p.mode || '').toLowerCase() === 'edit';
  const out = { prompt: prompt, mode: edit ? 'edit' : 'ask' };
  // AI 엔진(auto · claude · agy · freellmapi) — auto 는 굳이 싣지 않는다(워커 기본값과 같은 뜻).
  const engine = qqEngineOf_(p);
  if (engine !== 'auto') out.engine = engine;
  // 2026-11-25 통합 회의실 — kind='chat' 이면 노트북이 코드가 아니라 '답장'을 만든다(같은 claude_prompt 큐).
  // target 은 @멘션(누구에게). 둘 다 노트북 lib/chat.js 가 읽는다. 모르는 값은 싣지 않는다.
  if (isObj(p) && String(p.kind || '').toLowerCase() === 'chat') out.kind = 'chat';
  // 2026-11-27 — 📣 알림(답장 불필요): 접수 순간 닫히고 받는 비서 받은편지함에 한 번 간다. 결정 알림·공지용.
  if (isObj(p) && p.notice === true && out.kind === 'chat') out.notice = true;
  // 2026-11-27 — 🔔 승인 요청. 레이 님(포털) 앞으로만 가고, 레이 님이 결정할 때까지 PENDING 으로 남는다(승인함에 모인다).
  //  실행 오더가 아니므로 mode 는 늘 ask, 대상은 늘 portal. 제목·위험 종류·관련 오더·기한은 선택.
  const isApproval = isObj(p) && String(p.kind || '').toLowerCase() === 'approval';
  if (isApproval) {
    out.mode = 'ask';
    out.kind = 'approval';
    out.target = 'portal';
    const firstLine = prompt.split(/\r?\n/)[0].replace(/\s+/g, ' ').trim();
    out.title = clip((String(p.title == null ? '' : p.title).replace(/\s+/g, ' ').trim() || firstLine).replace(/^(\s*@\S+)+\s*/, '').trim(), QQ_APPROVAL_TITLE_MAX);
    const risk = String(p.risk == null ? '' : p.risk).replace(/\s+/g, ' ').trim();
    if (risk) out.risk = clip(risk, 20);
    const ref = String(p.ref == null ? '' : p.ref).trim();
    if (ref && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,59}$/.test(ref)) out.ref = ref;
    const due = String(p.due == null ? '' : p.due).trim();
    if (due) out.due = clip(due, 40);
  }
  // 📎 첨부(2026-11-27) — 사진·서류는 Drive 에 있고 여기에는 {id,n,s,m} 만 싣는다.
  //  payload 상한(4,000자)이 있어 본체를 실을 수 없다. 대화·오더 어느 쪽에도 붙일 수 있다.
  if (isObj(p) && p.files) {
    const fl = qqFileVec_(p.files, true);
    if (fl.length) {
      if (JSON.stringify(fl).length > QQ_FILE_FILES_CHARS) {
        throw qqErr_('too_long', '첨부 이름이 너무 길어요 — 이름을 짧게 바꾸거나 파일 수를 줄여주세요.');
      }
      out.files = fl;
    }
  }
  // 2026-11-27 — 'notebook' 도 그대로 싣는다(예전에는 기본값이라며 지웠다).
  //  노트북은 kind='chat' 이면 target==='notebook' 인 줄만 집어 가므로(hub-agent CommandQueue.gs
  //  cqForNotebook_ · lib/targets.js), 여기서 지우면 @노트북 대화·🌿어사이드가 점유되지 않고
  //  PENDING 으로 남는다. 비-chat 오더는 target 이 비어 있어 동작이 같다. (승인 요청은 늘 portal)
  const target = isApproval ? 'portal' : (qqTargetOf_(p) || qqMentionOf_(prompt));
  if (target) out.target = target;
  // 답장 추적(2026-11-25 v27) — 어느 오더에 대한 답장인지(선택). 비서끼리 중복 답장을 막는다.
  const replyTo = String((isObj(p) && p.reply_to) || '').trim();
  if (replyTo) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,59}$/.test(replyTo)) {
      throw qqErr_('bad_request', 'reply_to 는 오더 id 형식이어야 해요(예: Q-20261125-180306-29rx).');
    }
    out.reply_to = replyTo;
  }
  return JSON.stringify(out);
}
/**
 * 영상 렌더(content_render) payload 검증 — 노트북 lib/render.js validate() 와 같은 규칙.
 * 경로는 받지 않는다: content_id 와 파일 '이름'만(위치는 노트북 .env 가 정한다).
 * 2026-11-27 — mode:'mv'(뮤직비디오)는 계약이 달라서 앞에서 따로 맡긴다(qqRenderMvPayloadOf_).
 */
const QQ_RENDER_BRANDS = ['daejeon_youth', 'ppiyak_kimmary'];
const QQ_RENDER_PROFILES = ['captions', 'bgm'];
const QQ_RENDER_MODE_MV = 'mv';
function qqRenderPayloadOf_(p) {
  const o = isObj(p) ? p : {};
  const contentId = String(o.content_id == null ? '' : o.content_id).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(contentId)) throw qqErr_('bad_request', 'content_id 는 영숫자·_·- 만, 40자 이내여야 해요.');
  const brand = String(o.brand == null ? '' : o.brand).trim();
  if (QQ_RENDER_BRANDS.indexOf(brand) < 0) throw qqErr_('bad_request', '트랙(brand)이 올바르지 않아요.');
  // 뮤직비디오 모드(2026-11-27) — 허브 gas/Orders.gs hubRenderPayload_ 와 같은 순서로(단계보다 먼저) 갈래를 탄다.
  //  모르는 mode 는 조용히 버리지 않고 거절한다 — 버리면 아래 MV 칸(mode·images·mv)이 사라진 채로
  //  'inputs 1~8 필수'에 걸려 엉뚱한 이유로 막히거나, 사진만 남은 오더가 렌더로 새어 나간다.
  const mode = String(o.mode == null ? '' : o.mode).trim().toLowerCase();
  if (mode) {
    if (mode !== QQ_RENDER_MODE_MV) throw qqErr_('bad_request', 'mode 는 mv 하나예요(일반 영상은 비워 두세요).');
    return qqRenderMvPayloadOf_(o, contentId, brand);
  }
  // 2·3단계(2026-11-20): 자막 초안(transcribe) · 마무리(finish)는 클린 마스터를 이어받으므로 원본 이름이 없다.
  // 이 함수가 payload 를 고정 키로 다시 만들기 때문에 여기서 싣지 않으면 옵션이 조용히 사라진다(컷이 그랬다).
  const stage = o.stage == null || o.stage === '' ? '' : String(o.stage);
  if (stage) return qqRenderStagePayloadOf_(o, contentId, brand, stage);
  const inputs = Array.isArray(o.inputs) ? o.inputs.map(function (s) { return String(s); }) : [];
  if (inputs.length < 1 || inputs.length > 8) throw qqErr_('bad_request', '원본 영상 파일 이름은 1~8개여야 해요.');
  const seen = {};
  inputs.forEach(function (n) {
    if (!/^[A-Za-z0-9가-힣][A-Za-z0-9가-힣._ -]{0,79}\.(mp4|mov|m4v)$/i.test(n) || n.indexOf('..') >= 0) {
      throw qqErr_('bad_request', '쓸 수 없는 파일 이름이 있어요(영상 mp4·mov·m4v 이름만, 폴더·경로 금지).');
    }
    const k = n.toLowerCase();
    if (seen[k]) throw qqErr_('bad_request', '같은 파일이 두 번 들어 있어요.');
    seen[k] = true;
  });
  const profile = o.profile == null || o.profile === '' ? 'captions' : String(o.profile);
  if (QQ_RENDER_PROFILES.indexOf(profile) < 0) throw qqErr_('bad_request', '음량 종류(profile)가 올바르지 않아요.');
  const out = { content_id: contentId, brand: brand, inputs: inputs, profile: profile };
  if (o.crop_x !== undefined && o.crop_x !== null && o.crop_x !== '') {
    const cx = Number(o.crop_x);
    if (!isFinite(cx) || cx < 0 || cx > 1) throw qqErr_('bad_request', 'crop_x 는 0~1 사이 숫자여야 해요.');
    out.crop_x = cx;
  }
  // 잘라낼 구간(초) — 2026-11-20. 이 함수가 payload 를 고정 키로 다시 만들기 때문에 여기서 싣지 않으면 컷이 조용히 사라진다.
  const cuts = qqRenderCutsOf_(o.cuts, inputs.length);
  if (cuts.length) out.cuts = cuts;
  qqRenderFinalOptionsOf_(o, out);
  qqRenderVoiceOf_(o, out);
  qqRenderTemplateOptionsOf_(o, out);
  qqRenderFrameLockOf_(o, out);
  qqRenderMotionOf_(o, out);
  qqRenderPaceOf_(o, out);
  return JSON.stringify(out);
}
/* ── 🎵 뮤직비디오 모드 payload (2026-11-27) ─────────────────────────────────────────
 * 계약은 허브 content-hub PR #28 의 gas/Orders.gs hubRenderMvPayload_ · 노트북 lib/render.js validateMv 와 같다.
 *  일반 영상과 달리 사진(images)과 영상 컷(inputs 0~8)을 함께 받고, mv{음원·박자·가사·효과}를 보존한다.
 *  이 큐가 payload 를 고정 키로 다시 만들기 때문에 여기서 갈래를 만들지 않으면 MV 오더는
 *  'inputs 1~8 필수'에서 거절되거나 mode·images·mv 가 조용히 사라진다(mode 만 남으면 노트북이 사진 0장으로 거절).
 *  · 사진만이면 3장 이상 · 영상 컷이 1~8개 있으면 사진 0장부터 · 둘 다 없으면 거절.
 *  · 곡 파일 자체는 큐로 오지 않는다 — 허브 _bgm 보관함의 '이름'만 실린다.
 */
const QQ_RENDER_MAX_IMAGES = 25;
const QQ_RENDER_MV_MIN_IMAGES = 3;
const QQ_RENDER_IMAGE_RE = /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣._ -]{0,79}\.(jpe?g|png|webp)$/i;
const QQ_RENDER_MV_DENSITIES = ['fast_2beat', 'normal_4beat', 'slow_1bar'];
const QQ_RENDER_MV_EFFECTS = ['pulse', 'none'];
const QQ_RENDER_MV_MOODS = ['pop', 'ballad', 'comic', 'rock'];
const QQ_RENDER_MV_LYRIC_MODES = ['mine', 'none'];
const QQ_RENDER_MV_MAX_LYRICS = 8000;      // 허브·노트북과 같은 가사 상한
const QQ_RENDER_MV_INLINE_LYRICS = 2000;   // 큐에 실어 보내는 가사 상한 — 넘으면 payload_source:'drive'
const QQ_RENDER_MV_PAYLOAD_CHARS = 3500;   // 큐 한도 4,000자 — 넘으면 가사를 빼고 노트북이 카드에서 읽는다
const QQ_RENDER_MV_AUDIO_RE = /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣._ -]{0,79}\.(mp3|m4a|wav)$/i;
/**
 * MV 사진·영상 컷 이름 목록 검사 — 허브 hubRenderImages_·hubRenderInputs_ · 노트북 validateMv 와 같은 규칙.
 * 이름만(폴더·경로 금지) · 정해진 확장자 · 개수 상한 · 같은 이름 두 번은 거절(대소문자 무시 — 노트북도 그렇게 막는다).
 */
function qqRenderMvNamesOf_(raw, label, re, max, hint) {
  if (raw === undefined || raw === null || raw === '') return [];
  if (!Array.isArray(raw)) throw qqErr_('bad_request', label + ' 는 파일 이름 목록(배열)이어야 해요.');
  if (raw.length > max) throw qqErr_('bad_request', label + ' 는 ' + max + '개까지예요(지금 ' + raw.length + '개).');
  const out = [];
  raw.forEach(function (v) {
    const n = String(v == null ? '' : v);
    if (!re.test(n) || n.indexOf('..') >= 0 || n.charAt(0) === '.') {
      throw qqErr_('bad_request', label + ' 에는 ' + hint + '만 넣을 수 있어요(폴더·경로 금지): ' + clip(n, 40));
    }
    const k = n.toLowerCase();
    if (out.some(function (x) { return x.toLowerCase() === k; })) throw qqErr_('bad_request', label + ' 에 같은 파일이 두 번 들어 있어요: ' + clip(n, 40));
    out.push(n);
  });
  return out;
}
function qqRenderMvPayloadOf_(o, contentId, brand) {
  const images = qqRenderMvNamesOf_(o.images, '사진(images)', QQ_RENDER_IMAGE_RE, QQ_RENDER_MAX_IMAGES, '사진 파일 이름(jpg·jpeg·png·webp)');
  const inputs = qqRenderMvNamesOf_(o.inputs, '영상 컷(inputs)', /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣._ -]{0,79}\.(mp4|mov|m4v)$/i, 8, '영상 파일 이름(mp4·mov·m4v)');
  // 같은 이름이 사진·영상 양쪽에 오면 거절 — 서로 다른 파일이 같은 자리를 차지하는 것 방지(허브·노트북과 같은 규칙).
  images.forEach(function (n) {
    const k = n.toLowerCase();
    if (inputs.some(function (v) { return v.toLowerCase() === k; })) throw qqErr_('bad_request', '같은 파일이 사진·영상 양쪽에 있어요: ' + clip(n, 40));
  });
  if (!inputs.length && images.length < QQ_RENDER_MV_MIN_IMAGES) {
    throw qqErr_('bad_request', '뮤직비디오는 사진 ' + QQ_RENDER_MV_MIN_IMAGES + '장 이상 또는 영상 컷 1개 이상이 필요해요(지금 사진 ' + images.length + '장·영상 ' + inputs.length + '개).');
  }
  const mvIn = isObj(o.mv) ? o.mv : {};
  const audio = String(mvIn.audio == null ? '' : mvIn.audio).trim();
  if (!audio) throw qqErr_('bad_request', '뮤직비디오에는 음원(mv.audio) 이름이 있어야 해요(허브 _bgm 보관함 파일 이름).');
  if (!QQ_RENDER_MV_AUDIO_RE.test(audio) || audio.indexOf('..') >= 0) {
    throw qqErr_('bad_request', '뮤직비디오 음원(mv.audio)은 보관함의 파일 이름(mp3·m4a·wav, 폴더·경로 금지)이어야 해요.');
  }
  const pick = function (v, list, dflt, label) {
    const s = v === undefined || v === null || v === '' ? dflt : String(v).trim().toLowerCase();
    if (list.indexOf(s) < 0) throw qqErr_('bad_request', label + ' 는 ' + list.join(' · ') + ' 중 하나여야 해요.');
    return s;
  };
  const density = pick(mvIn.density, QQ_RENDER_MV_DENSITIES, 'normal_4beat', 'mv.density');
  const effects = pick(mvIn.effects, QQ_RENDER_MV_EFFECTS, 'pulse', 'mv.effects');
  const mood = pick(mvIn.mood, QQ_RENDER_MV_MOODS, 'pop', 'mv.mood');
  const lyricMode = pick(mvIn.lyric_mode, QQ_RENDER_MV_LYRIC_MODES, 'mine', 'mv.lyric_mode');
  let bpmHint = 0;
  if (mvIn.bpm_hint !== undefined && mvIn.bpm_hint !== null && mvIn.bpm_hint !== '') {
    bpmHint = Number(mvIn.bpm_hint);
    if (!isFinite(bpmHint) || bpmHint < 0 || bpmHint > 300) throw qqErr_('bad_request', '박자 힌트(mv.bpm_hint)는 0~300 사이 숫자여야 해요(0=자동).');
    bpmHint = Math.round(bpmHint * 10) / 10;
  }
  let lengthSec = 0;
  if (mvIn.length_sec !== undefined && mvIn.length_sec !== null && mvIn.length_sec !== '') {
    lengthSec = Number(mvIn.length_sec);
    if (!isFinite(lengthSec) || lengthSec < 0 || lengthSec > 600) throw qqErr_('bad_request', '길이(mv.length_sec)는 0~600초여야 해요(0=곡 끝까지).');
    lengthSec = Math.round(lengthSec);
  }
  let lyrics = String(mvIn.lyrics == null ? '' : mvIn.lyrics).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  if (lyricMode === 'none') lyrics = '';
  if (lyrics.length > QQ_RENDER_MV_MAX_LYRICS) throw qqErr_('bad_request', '가사가 너무 길어요(' + QQ_RENDER_MV_MAX_LYRICS + '자까지).');
  const mv = { audio: audio, density: density, bpm_hint: bpmHint, effects: effects, mood: mood,
    length_sec: lengthSec, lyric_mode: lyricMode,
    lines: lyrics ? lyrics.split('\n').filter(function (s) { return s.trim(); }).length : 0 };
  if (lyrics.length <= QQ_RENDER_MV_INLINE_LYRICS) mv.lyrics = lyrics;
  // 허브 MV 계약 그대로 — 곡 파일 자체는 오지 않고 profile 은 늘 captions(노래가 목소리다).
  const out = { content_id: contentId, brand: brand, profile: 'captions', mode: QQ_RENDER_MODE_MV, images: images, mv: mv };
  if (inputs.length) out.inputs = inputs;
  if (o.payload_source !== undefined && o.payload_source !== null && o.payload_source !== '') {
    const ps = String(o.payload_source).trim().toLowerCase();
    if (['inline', 'drive'].indexOf(ps) < 0) throw qqErr_('bad_request', 'payload_source 는 inline · drive 중 하나여야 해요.');
    if (ps === 'drive') out.payload_source = 'drive';
  }
  // 가사가 길면 큐 4,000자 한도에 걸린다 — 그때만 가사를 빼고 payload_source:'drive' 로 노트북이 카드에서 읽게 한다(허브와 같은 규칙).
  //  가사를 뺐으면 반드시 drive 를 함께 실어야 한다 — 표시 없이 빼면 노트북은 가사가 없는 곡으로 굽는다.
  if (lyrics.length > QQ_RENDER_MV_INLINE_LYRICS) out.payload_source = 'drive';
  if (JSON.stringify(out).length > QQ_RENDER_MV_PAYLOAD_CHARS) {
    delete out.mv.lyrics;
    out.payload_source = 'drive';
  }
  return JSON.stringify(out);
}
/**
 * 채널 템플릿 옵션(2026-11-21) — template · title · badge · hook · hook_sub · outro · hook_pos · hook_hold.
 * 이 큐가 payload 를 고정 키로 다시 만들기 때문에 여기서 싣지 않으면 허브가 보낸 템플릿이 조용히 사라진다(컷이 그랬다).
 * 규칙은 허브 gas/Orders.gs 의 RENDER_TEMPLATES·RENDER_TEMPLATE_TEXT, 노트북 lib/render.js validate() 와 같은 값이다.
 * 훅이 없는 템플릿(none · ppiyak_kimmary)이면 hook_pos·hook_hold 는 버린다 — 노트북도 그 경우 무시한다.
 * hook_sub(무음 보조 글자 6자)·outro(아웃트로 24자)는 템플릿과 무관하게 그대로 싣는다(허브 계약 그대로).
 */
const QQ_RENDER_TEMPLATES = ['auto', 'none', 'daejeon_youth', 'ppiyak_kimmary'];
const QQ_RENDER_TEMPLATE_TEXT = { title: 40, badge: 14, hook: 16, hook_sub: 6, outro: 24 };
function qqRenderTemplateOptionsOf_(o, out) {
  if (o.template !== undefined && o.template !== null && o.template !== '') {
    const tm = String(o.template).trim().toLowerCase();
    if (QQ_RENDER_TEMPLATES.indexOf(tm) < 0) throw qqErr_('bad_request', 'template 은 ' + QQ_RENDER_TEMPLATES.join(' · ') + ' 중 하나여야 해요.');
    out.template = tm;
  }
  const hookOff = out.template === 'none' || out.template === 'ppiyak_kimmary';
  Object.keys(QQ_RENDER_TEMPLATE_TEXT).forEach(function (k) {
    const v = o[k];
    if (v === undefined || v === null || v === '') return;
    if (typeof v !== 'string') throw qqErr_('bad_request', k + ' 는 문자열이어야 해요.');
    const t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, QQ_RENDER_TEMPLATE_TEXT[k]);
    if (t) out[k] = t;
  });
  if (o.hook_pos !== undefined && o.hook_pos !== null && o.hook_pos !== '') {
    const hp = String(o.hook_pos).trim().toLowerCase();
    if (hp !== 'center' && hp !== 'top') throw qqErr_('bad_request', 'hook_pos 는 center · top 중 하나여야 해요.');
    if (!hookOff) out.hook_pos = hp;
  }
  if (o.hook_hold !== undefined && o.hook_hold !== null && o.hook_hold !== '') {
    const hh = Number(o.hook_hold);
    if (!isFinite(hh) || hh < 1.0 || hh > 4.0) throw qqErr_('bad_request', 'hook_hold 는 1.0~4.0초 사이 숫자여야 해요.');
    if (!hookOff) out.hook_hold = Math.round(hh * 10) / 10;
  }
}
/**
 * 첫 프레임 잠금(2026-11-21) — frame_lock · frame_lock_image · frame_lock_seconds.
 * 기준 사진을 0.0초 첫 프레임으로, 앞 클립 마지막 프레임을 다음 클립 첫 프레임으로 맞춘다.
 * 이 큐가 payload 를 고정 키로 다시 만들기 때문에 여기서 싣지 않으면 허브가 보낸 잠금 설정이 조용히 사라진다(컷이 그랬다).
 * 규칙은 허브 gas/Orders.gs·노트북 lib/framelock.js 와 같은 값이다 — 끔(false)이면 사진·길이를 조용히 버린다(숨은 동작 없음).
 */
const QQ_RENDER_FRAME_LOCK_IMAGE_RE = /\.(jpe?g|png|webp)$/i;
function qqRenderFrameLockOf_(o, out) {
  const fl = o.frame_lock;
  if (fl === undefined || fl === null || fl === '') return;
  if (typeof fl !== 'boolean') throw qqErr_('bad_request', 'frame_lock 은 true·false 여야 해요.');
  if (fl !== true) return;
  out.frame_lock = true;
  if (o.frame_lock_image !== undefined && o.frame_lock_image !== null && o.frame_lock_image !== '') {
    const n = String(o.frame_lock_image);
    if (!QQ_RENDER_FRAME_LOCK_IMAGE_RE.test(n) || n.indexOf('..') !== -1 || n.indexOf('/') !== -1 || n.indexOf('\\') !== -1) {
      throw qqErr_('bad_request', 'frame_lock_image 는 사진 파일 이름이어야 해요(jpg·jpeg·png·webp, 폴더·경로 금지).');
    }
    out.frame_lock_image = n;
  }
  if (o.frame_lock_seconds !== undefined && o.frame_lock_seconds !== null && o.frame_lock_seconds !== '') {
    const v = Number(o.frame_lock_seconds);
    if (!isFinite(v) || v < 0.02 || v > 0.5) throw qqErr_('bad_request', 'frame_lock_seconds 는 0.02~0.5초 사이 숫자여야 해요.');
    out.frame_lock_seconds = Math.round(v * 100) / 100;
  }
}
/**
 * 자동 줌·모션(2026-11-21) — motion · motion_quality.
 * 이 큐가 payload 를 고정 키로 다시 만들기 때문에 여기서 싣지 않으면 허브가 보낸 모션 설정이 조용히 사라진다(컷이 그랬다).
 * 규칙은 허브 gas/Orders.gs 의 RENDER_MOTIONS·RENDER_MOTION_QUALITY, 노트북 lib/motion.js 와 같은 값이다.
 * motion 은 'auto'(기본) · dynamic · calm · none — none 이면 노트북이 예전과 똑같이 자르기만 한다.
 */
const QQ_RENDER_MOTIONS = ['auto', 'dynamic', 'calm', 'none'];
const QQ_RENDER_MOTION_QUALITY = ['standard', 'high'];
function qqRenderMotionOf_(o, out) {
  if (o.motion !== undefined && o.motion !== null && o.motion !== '') {
    const mo = String(o.motion).trim().toLowerCase();
    if (QQ_RENDER_MOTIONS.indexOf(mo) < 0) throw qqErr_('bad_request', 'motion 은 ' + QQ_RENDER_MOTIONS.join(' · ') + ' 중 하나여야 해요.');
    out.motion = mo;
  }
  if (o.motion_quality !== undefined && o.motion_quality !== null && o.motion_quality !== '') {
    const mq = String(o.motion_quality).trim().toLowerCase();
    if (QQ_RENDER_MOTION_QUALITY.indexOf(mq) < 0) throw qqErr_('bad_request', 'motion_quality 는 ' + QQ_RENDER_MOTION_QUALITY.join(' · ') + ' 중 하나여야 해요.');
    out.motion_quality = mq;
  }
}
/** 템포(2026-11-23) — pace·blur_darken·blur_radius. standard 는 기본값이라 싣지 않는다. */
function qqRenderPaceOf_(o, out) {
  if (o.pace !== undefined && o.pace !== null && o.pace !== '') {
    const pc = String(o.pace).trim().toLowerCase();
    if (QQ_RENDER_PACES.indexOf(pc) < 0) throw qqErr_('bad_request', 'pace 는 ' + QQ_RENDER_PACES.join(' · ') + ' 중 하나여야 해요.');
    if (pc !== 'standard') out.pace = pc;
  }
  if (o.blur_darken !== undefined && o.blur_darken !== null && o.blur_darken !== '') {
    const v = Number(o.blur_darken);
    if (!isFinite(v) || v < -0.4 || v > 0) throw qqErr_('bad_request', 'blur_darken 은 -0.4~0 사이 숫자여야 해요.');
    out.blur_darken = Math.round(v * 100) / 100;
  }
  if (o.blur_radius !== undefined && o.blur_radius !== null && o.blur_radius !== '') {
    const v = Number(o.blur_radius);
    if (!isFinite(v) || v < 2 || v > 40) throw qqErr_('bad_request', 'blur_radius 는 2~40 사이 숫자여야 해요.');
    out.blur_radius = Math.round(v);
  }
}
/**
 * 완제품 옵션(2026-11-20) — fit(프레이밍) · captions(자막 큐) · narration(내레이션 큐) · narrate · burn_subtitles · sub_style · payload_source · voice.
 * 이 큐가 payload 를 고정 키로 다시 만들기 때문에 여기서 싣지 않으면 허브가 보낸 옵션이 조용히 사라진다(컷이 그랬다).
 * 허브(GAS)가 이미 한 번 검사하고 큐를 [start,end,text(,tone)] 로 줄여 보낸다 — 여기서도 같은 규칙으로 한 번 더 막는다(노트북 lib/render.js 가 마지막으로 검사).
 */
const QQ_RENDER_FITS = ['crop', 'blur', 'pad'];
const QQ_RENDER_SUB_STYLES = ['auto', 'shorts', 'long'];
/* 템포 프리셋(2026-11-23) — 노트북 lib/pace.js · 허브 js/produceLogic.js PACE_IDS 와 같은 값.
   fast: 컷 1~1.8초 · 자막 0.6초부터 · 모션 dynamic · 가로 원본 blur 여백 덜 어둡게. */
const QQ_RENDER_PACES = ['calm', 'standard', 'fast'];
/* 자막 배열 4번째 = 스토리 비트(2026-11-23) — 노트북 lib/story.js 와 같은 값. */
const QQ_RENDER_BEATS = ['hook', 'info', 'build', 'climax', 'payoff'];
const QQ_RENDER_VOICE_RE = /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/;
const QQ_RENDER_MAX_CUES = 80;
function qqRenderCuesOf_(raw, label, withTone) {
  if (raw === undefined || raw === null || raw === '') return [];
  if (!Array.isArray(raw)) throw qqErr_('bad_request', label + ' 는 큐 목록이어야 해요.');
  if (raw.length > QQ_RENDER_MAX_CUES) throw qqErr_('bad_request', label + ' 는 ' + QQ_RENDER_MAX_CUES + '큐까지예요(긴 영상은 카드에서 읽게 payload_source 를 drive 로).');
  const r2 = function (n) { return Math.round(n * 100) / 100; };
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    let start, end, text, tone = null;
    if (Array.isArray(c)) { start = Number(c[0]); end = Number(c[1]); text = String(c[2] == null ? '' : c[2]); tone = c[3] == null ? null : String(c[3]); }
    else if (isObj(c)) { start = Number(c.start); end = Number(c.end); text = String(c.text == null ? '' : c.text); tone = c.tone == null ? null : String(c.tone); }
    else throw qqErr_('bad_request', label + ' ' + (i + 1) + '번 모양이 올바르지 않아요.');
    if (!isFinite(start) || !isFinite(end) || start < 0 || end <= start) throw qqErr_('bad_request', label + ' ' + (i + 1) + '번 시작·끝(초)이 올바르지 않아요.');
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t) throw qqErr_('bad_request', label + ' ' + (i + 1) + '번 문장이 비어 있어요.');
    if (t.length > 200) throw qqErr_('bad_request', label + ' ' + (i + 1) + '번 문장이 너무 길어요(200자까지).');
    if (withTone) {
      if (tone !== null && tone !== '' && ['hype', 'calm'].indexOf(tone) === -1) throw qqErr_('bad_request', label + ' ' + (i + 1) + '번 톤은 hype · calm 중 하나예요.');
      out.push([r2(start), r2(end), t].concat(tone ? [tone] : []));
    } else {
      // 자막 4번째는 스토리 비트 — 모르는 값은 버리고 문장만 보낸다(구버전 허브 호환).
      const beat = tone !== null && tone !== '' && QQ_RENDER_BEATS.indexOf(String(tone)) >= 0 ? String(tone) : '';
      out.push([r2(start), r2(end), t].concat(beat ? [beat] : []));
    }
  }
  return out;
}
function qqRenderFinalOptionsOf_(o, out) {
  if (o.fit !== undefined && o.fit !== null && o.fit !== '') {
    const fit = String(o.fit).trim().toLowerCase();
    if (QQ_RENDER_FITS.indexOf(fit) < 0) throw qqErr_('bad_request', 'fit 은 crop · blur · pad 중 하나여야 해요.');
    out.fit = fit;
  }
  const captions = qqRenderCuesOf_(o.captions, '자막', false);
  const narration = qqRenderCuesOf_(o.narration, '내레이션', true);
  if (captions.length) out.captions = captions;
  if (narration.length) out.narration = narration;
  if (o.narrate !== undefined && o.narrate !== null && o.narrate !== '' && typeof o.narrate !== 'boolean') throw qqErr_('bad_request', 'narrate 는 true·false 여야 해요.');
  if (o.narrate === true) out.narrate = true;
  if (o.burn_subtitles !== undefined && o.burn_subtitles !== null && o.burn_subtitles !== '' && typeof o.burn_subtitles !== 'boolean') throw qqErr_('bad_request', 'burn_subtitles 는 true·false 여야 해요.');
  if (o.burn_subtitles === false) out.burn_subtitles = false;
  if (o.sub_style !== undefined && o.sub_style !== null && o.sub_style !== '') {
    const ss = String(o.sub_style).trim().toLowerCase();
    if (QQ_RENDER_SUB_STYLES.indexOf(ss) < 0) throw qqErr_('bad_request', 'sub_style 은 ' + QQ_RENDER_SUB_STYLES.join(' · ') + ' 중 하나여야 해요.');
    if (ss !== 'auto') out.sub_style = ss;
  }
  if (o.payload_source !== undefined && o.payload_source !== null && o.payload_source !== '') {
    const ps = String(o.payload_source).trim().toLowerCase();
    if (['inline', 'drive'].indexOf(ps) < 0) throw qqErr_('bad_request', 'payload_source 는 inline · drive 중 하나여야 해요.');
    if (ps === 'drive') out.payload_source = 'drive';
  }
  if (o.voice !== undefined && o.voice !== null && o.voice !== '') {
    if (!QQ_RENDER_VOICE_RE.test(String(o.voice))) throw qqErr_('bad_request', 'voice 는 edge-tts 보이스 이름(예: ko-KR-SunHiNeural)이어야 해요.');
    out.voice = String(o.voice);
  }
}
const QQ_RENDER_BGM_RE = /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣._ -]{0,79}\.(mp3|wav|m4a|aac)$/i;
/**
 * 내 육성 녹음(2026-11-23) — voice_mode · voice_file · voice_offset_ms · voice_fallback_tts.
 * 이 큐가 payload 를 고정 키로 다시 만들기 때문에 여기서 싣지 않으면 허브가 보낸 선택이 조용히 사라진다(컷이 그랬다).
 * 규칙은 허브 gas/Orders.gs RENDER_VOICE_* · 노트북 lib/render.js voiceParamsOf 와 같은 값이다.
 * 값이 없으면 아무 키도 넣지 않는다 — 구버전 오더는 지금과 100% 동일(TTS 경로).
 */
const QQ_RENDER_VOICE_MODES = ['tts', 'human'];
const QQ_RENDER_VOICE_FILE_RE = /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣._ -]{0,79}\.(mp3|m4a|wav)$/i;
const QQ_RENDER_VOICE_OFFSET_MS = 3000;
function qqRenderVoiceOf_(o, out) {
  const raw = o.voice_mode;
  if (raw === undefined || raw === null || raw === '') return;
  const vm = String(raw).trim().toLowerCase();
  if (QQ_RENDER_VOICE_MODES.indexOf(vm) < 0) throw qqErr_('bad_request', '음성 방식(voice_mode)은 tts · human 중 하나여야 해요.');
  out.voice_mode = vm;
  if (vm !== 'human') return;
  const vf = String(o.voice_file === undefined || o.voice_file === null ? '' : o.voice_file).trim();
  if (!QQ_RENDER_VOICE_FILE_RE.test(vf) || vf.indexOf('..') >= 0 || vf.indexOf('/') >= 0 || vf.indexOf('\\') >= 0) {
    throw qqErr_('bad_request', '녹음 파일 이름(mp3·m4a·wav, 폴더·경로 금지)만 넣을 수 있어요.');
  }
  out.voice_file = vf;
  if (o.voice_offset_ms !== undefined && o.voice_offset_ms !== null && o.voice_offset_ms !== '') {
    const vo = Number(o.voice_offset_ms);
    if (!isFinite(vo) || Math.round(vo) !== vo || Math.abs(vo) > QQ_RENDER_VOICE_OFFSET_MS) {
      throw qqErr_('bad_request', '녹음 앞 자를 길이(voice_offset_ms)는 -' + QQ_RENDER_VOICE_OFFSET_MS + '~' + QQ_RENDER_VOICE_OFFSET_MS + ' 사이 정수(ms)여야 해요.');
    }
    if (vo) out.voice_offset_ms = vo;
  }
  if (o.voice_fallback_tts !== undefined && o.voice_fallback_tts !== null && o.voice_fallback_tts !== '') {
    if (typeof o.voice_fallback_tts !== 'boolean') throw qqErr_('bad_request', '실패 시 TTS 대체(voice_fallback_tts)는 true·false 여야 해요.');
    if (o.voice_fallback_tts === true) out.voice_fallback_tts = true;
  }
}
/** 영상 렌더 2·3단계 payload — 노트북 lib/render_stages.js validateStage 와 같은 규칙(옵션만 통과, 모르는 필드는 버린다). */
function qqRenderStagePayloadOf_(o, contentId, brand, stage) {
  if (stage !== 'transcribe' && stage !== 'finish') throw qqErr_('bad_request', 'stage 는 transcribe 또는 finish 여야 해요.');
  const out = { content_id: contentId, brand: brand, stage: stage };
  if (stage === 'transcribe') return JSON.stringify(out);
  out.burn = o.burn === undefined ? true : o.burn === true;
  out.ai_notice = o.ai_notice === true;
  if (o.bgm !== undefined && o.bgm !== null && o.bgm !== '') {
    const b = isObj(o.bgm) ? o.bgm : {};
    const name = String(b.name == null ? '' : b.name);
    if (!QQ_RENDER_BGM_RE.test(name) || name.indexOf('..') >= 0) throw qqErr_('bad_request', 'BGM 파일 이름(mp3·wav·m4a·aac, 폴더·경로 금지)만 넣을 수 있어요.');
    out.bgm = { name: name };
    if (b.volume_db !== undefined && b.volume_db !== null && b.volume_db !== '') {
      const v = Number(b.volume_db);
      if (!isFinite(v) || v < -40 || v > 0) throw qqErr_('bad_request', 'BGM 볼륨(volume_db)은 -40~0 사이 숫자여야 해요.');
      out.bgm.volume_db = v;
    }
  }
  if (o.cover !== undefined && o.cover !== null && o.cover !== '') {
    const t = Number(isObj(o.cover) ? o.cover.t : NaN);
    if (!isFinite(t) || t < 0 || t > 3600) throw qqErr_('bad_request', '커버 시각(cover.t)은 0~3600 사이 초여야 해요.');
    out.cover = { t: Math.round(t * 100) / 100 };
  }
  return JSON.stringify(out);
}
/**
 * 영상 렌더 컷 목록 검증 — 노트북 lib/render.js normalizeCuts 와 같은 규칙.
 * 모양은 [from,to] 또는 [from,to,파일번호](초, 150개까지 — 큐 payload 4000자 한도). 영상이 둘 이상이면 파일번호가 꼭 필요하다.
 */
const QQ_RENDER_MAX_CUTS = 150;
const QQ_RENDER_MAX_CUT_SPAN_S = 3600;
function qqRenderCutsOf_(raw, inputCount) {
  if (raw === undefined || raw === null || raw === '') return [];
  if (!Array.isArray(raw)) throw qqErr_('bad_request', 'cuts 는 구간 목록이어야 해요.');
  if (raw.length > QQ_RENDER_MAX_CUTS) throw qqErr_('bad_request', '컷은 ' + QQ_RENDER_MAX_CUTS + '곳까지예요(지금 ' + raw.length + '곳).');
  const r2 = function (n) { return Math.round(n * 100) / 100; };
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (!Array.isArray(c) || c.length < 2 || c.length > 3) throw qqErr_('bad_request', '컷 ' + (i + 1) + '번 모양이 올바르지 않아요.');
    const from = Number(c[0]), to = Number(c[1]);
    if (!isFinite(from) || !isFinite(to) || from < 0 || to <= from) throw qqErr_('bad_request', '컷 ' + (i + 1) + '번은 0 이상이고 끝이 시작보다 커야 해요(초).');
    if (to - from > QQ_RENDER_MAX_CUT_SPAN_S) throw qqErr_('bad_request', '컷 ' + (i + 1) + '번 구간이 너무 길어요(최대 1시간).');
    let file = null;
    if (c.length === 3 && c[2] !== null && c[2] !== undefined) {
      file = Number(c[2]);
      if (Math.floor(file) !== file || file < 0 || file >= inputCount) throw qqErr_('bad_request', '컷 ' + (i + 1) + '번 파일 번호가 범위를 벗어났어요.');
    } else if (inputCount !== 1) {
      throw qqErr_('bad_request', '컷 ' + (i + 1) + '번에 어느 영상인지(파일 번호)가 필요해요. 영상이 여러 개예요.');
    }
    const a = r2(from), b = r2(to);
    if (b <= a) throw qqErr_('bad_request', '컷 ' + (i + 1) + '번 구간이 반올림 뒤 0초가 돼요.');
    out.push(file === null ? [a, b] : [a, b, file]);
  }
  return out;
}
/** payload.engine 를 허용 목록으로 검증한다. 모르는 값이면 거절(조용히 auto 로 바꾸지 않는다). */
function qqEngineOf_(p) {
  const raw = isObj(p) && p.engine != null ? String(p.engine).trim().toLowerCase() : '';
  if (!raw) return 'auto';
  if (QQ_ENGINES.indexOf(raw) < 0) {
    throw qqErr_('bad_request', 'AI 엔진은 auto·claude·agy·freellmapi 중 하나여야 해요.');
  }
  return raw;
}
function qqModeOf_(payload) { return String(qqParse_(payload).mode || '').toLowerCase(); }

/** 같은 비멱등 오더가 아직 대기·진행·승인대기 중이면 그 줄을 돌려준다(연타·재전송 방지). */
function qqFindInflight_(ctx, type, workspace, payload, nowMs) {
  const rows = qqRows_(ctx, QQ_SCAN_ROWS);
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (String(r.type || '') !== String(type)) continue;
    if (String(r.workspace || '') !== String(workspace || '')) continue;
    const st = String(r.status || '').toUpperCase();
    if (st !== 'PENDING' && st !== 'RUNNING' && st !== 'WAITING_APPROVAL') continue;
    if (String(r.payload || '') !== String(payload || '')) continue;
    const t = Date.parse(String(r.created_at || ''));
    if (isFinite(t) && nowMs - t > QQ_DEDUPE_MS) continue;
    return r;
  }
  return null;
}

function qqFindRow_(ctx, id) {
  let rows = qqRows_(ctx, QQ_SCAN_ROWS);
  for (let i = rows.length - 1; i >= 0; i--) if (String(rows[i].id) === id) return rows[i];
  rows = qqRows_(ctx, 0);
  for (let i = rows.length - 1; i >= 0; i--) if (String(rows[i].id) === id) return rows[i];
  return null;
}

/** 승인·거절·만료를 Audit_Log 에 남긴다. 기록이 실패해도 이미 내린 판단은 되돌리지 않는다. */
function qqAudit_(ctx, e) {
  try {
    let sh = ctx.ss.getSheetByName(QQ_AUDIT_TAB);
    if (!sh) {
      sh = ctx.ss.insertSheet(QQ_AUDIT_TAB);
      sh.getRange(1, 1, 1, QQ_AUDIT_COLS.length).setValues([QQ_AUDIT_COLS.slice()]);
    }
    let width = Number(sh.getLastColumn()) || 0;
    let head = [];
    if (width) {
      head = sh.getRange(1, 1, 1, width).getValues()[0].map(function (v) { return String(v == null ? '' : v).trim(); });
    }
    if (!head.length || !head[0]) {
      width = QQ_AUDIT_COLS.length;
      head = QQ_AUDIT_COLS.slice();
      sh.getRange(1, 1, 1, width).setValues([head]);
    }
    const row = {
      at: qqNow_(), command_id: clip(e.id, 40), type: clip(e.type, 40), workspace: clip(e.workspace, 40),
      risk_level: clip(e.risk, 10), decision: clip(e.decision, 12), by: clip(e.by, 40), channel: clip(e.channel, 20),
      note: qqMask_(e.note, 300), payload_hash: clip(e.payloadHash, 64), source: clip(e.source, 20)
    };
    sh.appendRow(head.map(function (name) { return row[name] === undefined ? '' : row[name]; }));
  } catch (err) {
    Logger.log('오더함: 승인 기록을 남기지 못했어요 — ' + String((err && err.message) || err));
  }
}

// ── 액션 ────────────────────────────────────────────
/**
 * payload 문자열만으로 '사람(포털) 앞 대화'인지 싸게 보기 — 건수 셀 때 400행을 JSON 파싱하지 않으려고.
 *  아무도 실행하지 않는 줄이라 '대기' 건수에서는 빠진다(2026-11-25).
 */
function qqPortalChatRaw_(raw) {
  if (!raw) return false;
  const s = String(raw);
  if (s.indexOf('"chat"') < 0 || s.indexOf('"portal"') < 0) return false;
  return /"kind"\s*:\s*"chat"/.test(s) && /"target"\s*:\s*"portal"/.test(s);
}
/** 최근 오더 목록 + 건수 + 고를 수 있는 작업 위치. payload 는 요약만 나간다. */
function queueList(body) {
  const ctx = qqOpen_();
  const limit = qqInt_(body && body.limit, 1, QQ_LIST_MAX, QQ_LIST_DEFAULT);
  const rows = qqRows_(ctx, QQ_SCAN_ROWS);
  const c = { pending: 0, waiting: 0, running: 0, timeout: 0, review: 0, done: 0, failed: 0 };
  for (let i = 0; i < rows.length; i++) {
    const st = String(rows[i].status == null ? '' : rows[i].status).trim().toUpperCase();
    if (st === 'PENDING') {
      if (qqPortalChatRaw_(rows[i].payload)) continue;   // 포털 앞 대화는 아무도 실행하지 않는다
      c.pending++;
    }
    else if (st === 'WAITING_APPROVAL') c.waiting++;
    else if (st === 'RUNNING') c.running++;
    else if (st === 'TIMEOUT_REVIEW') c.timeout++;
    else if (st === 'REVIEW_NEEDED') c.review++;
    else if (st === 'DONE') c.done++;
    else if (st === 'FAILED') c.failed++;
  }
  // target=pi1|pi2 로 부르면 "내 앞으로 온 말"만 — 피원·피투가 자기 멘션을 찾을 때 쓴다.
  const wantTarget = String((body && body.target) || '').trim().toLowerCase();
  const targetFilter = !!wantTarget && wantTarget !== 'notebook' && wantTarget !== 'all' &&
    (QQ_TARGETS.indexOf(wantTarget) >= 0 || QQ_AGENT_ID_RE.test(wantTarget));
  if (targetFilter) qqCheckMark_(wantTarget);           // 비서가 자기 앞 목록을 읽었다 = 확인 신호
  // 답장이 달린 오더 표시(2026-11-25 v27) — 원본 오더 id → 답장한 비서·시각. 비서끼리 중복 답장 방지.
  //  목록을 그리기 전에 만들어야 한다(아래 items 루프가 이걸 본다).
  const replied = {};
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i].payload;
    if (!raw) continue;
    const m = QQ_REPLY_JSON_RE.exec(String(raw));
    if (!m) continue;
    const key = String(m[1]);                       // 오더 id 는 대소문자를 가린다(Q-2026…)
    const st = String(rows[i].status == null ? '' : rows[i].status).trim().toUpperCase();
    const by = String(rows[i].source == null ? '' : rows[i].source).trim().toLowerCase();
    const prev = replied[key];
    if (!prev || (prev.status !== 'DONE' && st === 'DONE')) {
      replied[key] = { by: by, at: clip(rows[i].created_at, 40), status: st };
    }
  }
  const rmap = qqReactRead_(ctx);                       // 👀 이모지 반응(Reactions 탭 — 없으면 빈 표)
  const items = [];
  for (let i = rows.length - 1; i >= 0 && items.length < limit; i--) {
    // 2026-11-25: 무거운 qqItem_ 을 만들기 전에 payload 문자열에서 target 만 싸게 본다.
    //   (매칭이 드문 타겟이면 400행 전부를 파싱하다 30초 타임아웃이 났음 — v25 실측 57초)
    if (targetFilter) {
      const cheap = qqRowTarget_(rows[i]);
      if (cheap !== wantTarget && cheap !== 'all') continue;
    }
    const it = qqItem_(rows[i]);
    if (targetFilter) {
      const tg = it.target || 'notebook';          // 최종 판정은 늘 qqItem_ 값으로
      if (tg !== wantTarget && tg !== 'all') continue;
    }
    // 이 오더에 답장이 달려 있으면 누가 달았는지 붙인다(끝난 오더의 claimed_by 와는 다른 정보)
    const rp = replied[it.id];
    it.reactions = rmap[it.id] || [];                   // [{by, e, at}] — ✓ 전달됨 · 👀 접수 · 🔧 진행 중 · ✅ 완료 · 🙅 내 일 아님
    // 2026-11-26 — 「완료·보고됨 / 완료·보고누락」의 근거. 화면은 이 한 칸(또는 목록의 reply_to)으로 판단하고,
    //  보고가 없으면 결과로 만든 완료 카드를 대신 그린다(실제 보고가 오면 카드가 저절로 사라진다 — 중복 없음).
    it.answered = !!rp;
    if (rp) {
      // 2026-11-25 — 원글이 이미 DONE 이라 replied_by(처리한 비서)가 차 있어도
      //  답장한 비서를 걺지 않게 따로 남긴다(answer_by). 비어 있으면 replied_by 도 채운다.
      it.answer_by = rp.by; it.answered_at = rp.at;
      if (!it.replied_by) { it.replied_by = rp.by; it.replied_at = rp.at; }
    }
    items.push(it);
  }
  // 2026-11-26 — 비서가 `target=내id` 로 자기 앞 목록을 읽으면 가져간 PENDING 말에 「전달됨 ✓」을 자동으로 남긴다
  //   (지금 비서들이 쓰는 읽기 방식 그대로 효과가 난다 — 비서 수정 없음). 내 앞(target=나)인 말만, 한 비서·한 말에 한 번.
  //   포털·폰 앱은 target 을 쓰지 않으므로 사람이 화면을 연다고 '전달됨'이 찍히지 않는다. 이 한 줄 말고는 아무것도 쓰지 않는다.
  if (targetFilter && qqIsAiId_(wantTarget)) {
    const mineIds = items.filter(function (x) { return x.status === 'PENDING' && x.target === wantTarget; })
      .map(function (x) { return x.id; });
    qqDeliverMark_(ctx, wantTarget, mineIds, rmap);
    items.forEach(function (x) { if (mineIds.indexOf(x.id) >= 0) x.reactions = rmap[x.id] || []; });
  }
  // 2026-11-25(v27): 큐에 한 번이라도 말을 건 비서는 화면이 자동으로 참여자 명부에 합류시킨다.
  //   서버는 읽기만 하고(명부 쓰기는 agent_save), 여기서는 "누가 말했는지"만 알려 준다.
  //   피원이 쓰는 별칭(pickle·pk…)은 사람이 아이라 뺀다(화면이 이미 pi1 로 읽는다).
  const srcSeen = [];
  for (let i = rows.length - 1; i >= 0 && srcSeen.length < 12; i--) {
    const s = String(rows[i].source == null ? '' : rows[i].source).trim().toLowerCase();
    if (!QQ_AGENT_ID_RE.test(s) || s === 'portal' || srcSeen.indexOf(s) >= 0) continue;
    if (QQ_SRC_ALIAS.indexOf(s) >= 0) continue;
    srcSeen.push(s);
  }
  return {
    ok: true, at: qqNow_(), items: items, count: items.length,
    pending: c.pending, waiting: c.waiting, running: c.running, timeout: c.timeout,
    review: c.review, done: c.done, failed: c.failed,
    workspaces: qqWorkspaces_(), types: Object.keys(QQ_TYPES), engines: QQ_ENGINES.slice(),
    chat: true, targets: qqWithRoster_(QQ_TARGETS), sources: qqWithRoster_(QQ_SOURCES), sources_seen: srcSeen,
    // 2026-11-26 — 이 배포가 발신자를 payload.source·replied_by 에서도 읽는다는 표시(배포 확인용).
    source_fallback: true,
    // 2026-11-26 — 이 배포가 '협업 필요' 줄의 @ 없는 이름도 mentions 로 읽는다는 표시.
    mention_auto: true,
    duties: agentDuties_(),
    approval_ttl_min: Math.round(QQ_APPROVAL_TTL_MS / 60000)
  };
}

/**
 * 초경량 머리 확인 — 최신 1건의 id·시각·대상·상태만 돌려준다(2026-11-25 v27).
 *  · 외부 비서가 "방에 새 말이 있나"만 싸게 볼 때 쓴다(payload·요약은 만들지 않는다).
 *  · target 을 주면 그 비서 앞으로 온(또는 @전체) 최신 한 건을 찾는다.
 */
function queueHead(body) {
  const want = String((body && body.target) || '').trim().toLowerCase();
  const filter = !!want && want !== 'notebook' && want !== 'all' && QQ_AGENT_ID_RE.test(want);
  if (filter) qqCheckMark_(want);                        // 주기 확인형 비서의 '마지막 확인' 기록
  const ctx = qqOpen_();
  const rows = qqRows_(ctx, QQ_SCAN_ROWS);
  const res = { ok: true, at: qqNow_(), empty: !rows.length, item: null };
  if (!rows.length) return res;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (filter) {
      const t = qqRowTarget_(rows[i]);
      if (t !== want && t !== 'all') continue;
    }
    const it = qqItem_(rows[i]);
    res.item = {
      id: it.id, created_at: it.created_at, status: it.status, source: it.source,
      target: it.target || 'notebook', kind: it.kind, type: it.type,
      // 2026-11-25 — 답장 주체·원글 추적도 같이 준다(기다리는 쪽이 누가 답했는지 알게)
      claimed_by: it.claimed_by, replied_by: it.replied_by, reply_to: it.reply_to, finished_at: it.finished_at
    };
    return res;
  }
  return res;
}

/** 오더 한 건 접수. 위험(파일 수정)이면 WAITING_APPROVAL 로 세워 승인을 기다린다. */
/**
 * 오더 프롬프트에 "셸은 없다"를 코드로 붙인다 (2026-11-19).
 *  AI 엔진은 Bash 권한이 없어 테스트·빌드 명령을 못 돌린다. 그런데 오더에 "npm test 로 확인해라"가
 *  들어가면 엔진이 그걸 시도하다 턴을 버리고 "테스트를 못 돌렸다"로 끝난다(11/19 실측: 스마트스토어 12건).
 *  포털은 시트에 직접 쓰므로 CommandQueue.gs 를 거치지 않는다 — 여기에도 같은 문구를 붙인다.
 *  · claude_prompt 에만, 이미 있으면 다시 붙이지 않는다(멱등). 해시는 이 문구 뒤 payload 로 계산된다.
 *  · 대화(kind='chat')에는 붙이지 않는다 — 코드 실행이 아니라 답장이라 셸 규칙이 필요 없고,
 *    붙으면 말풍선·요약에 규칙 문구가 그대로 보여 시인성이 떨어진다(2026-11-25).
 */
var QQ_WORKER_NOTE = '\n\n[워커 규칙] 셸(Bash)은 차단되어 있다. 테스트·문법 검증은 네가 저장한 뒤 워커가 직접 돌린다. ' +
  'npm test·node --test 같은 실행 명령을 시도하지 말고, 바꾼 파일과 완료 조건만 보고해라.';
// 2026-11-25 — 예전에 붙어 저장된 오더·대화도 화면·요약에서는 안 보이게 뗀다(멱등).
var QQ_WORKER_NOTE_RE = /\s*\[워커 규칙\][\s\S]*$/;
// 2026-11-26 — "처리했으면 했다고 결과보고를 남겨라"(사용자 지시).
//  queue_done 만 찍고 회의실 보고를 빼먹으면 화면에 「완료·보고누락」으로 남는다.
//  비서가 오더를 집거나(claim) 끝낼 때(done) 이 문구를 응답에 함께 실어 준다 — 스스로 읽고 지키게.
var QQ_REPORT_RULE = '끝나면 회의실에 한 줄 보고를 남겨 주세요 — queue_enqueue {type:"claude_prompt", ' +
  'payload:{kind:"chat", target:"portal", reply_to:"<이 오더 id>", prompt:"<무엇을 했고 결과가 어떤지>"}} ' +
  '또는 queue_done 의 result 에 결과를 적으세요. 보고가 없으면 화면에 「완료·보고누락」으로 보입니다. ' +
  // 2026-11-26 — 운영 규칙(docs/AGENT_PROTOCOL.md) 핵심 3줄을 응답마다 함께 실어 준다(비서가 읽고 지키게).
  '[운영 규칙] ①reply_to 를 달아 답하면 그 원글이 자동으로 닫혀요(@전체 말 제외) — 일을 끝낸 뒤 한 번만 답하세요. ' +
  '②"확인했어요·수신 완료"처럼 내용 없는 답장은 보내지 마세요(이미 닫힌 말에 감사·확인 답장도 금지 — 비서끼리 무한 왕복). 확인만 하고 싶으면 이모지로: POST queue_react {as,id,emoji:"👀"} (👀 접수 · 🔧 진행 중 · ✅ 완료 · 🙅 내 일 아님 — ✅·🙅 은 내 앞 말을 닫아요). ' +
  '③주기 확인 비서는 매 주기 GET queue_inbox?as=<내 id> 한 번만 읽고, count 가 0 이면 아무 말도 하지 마세요("확인했습니다·변경 없음" 같은 현황 글도 보내지 마세요 — 침묵이 정답). ' +
  '④오래 걸리는 일은 queue_claim 으로 집지 마세요 — 20분 넘게 신호가 없으면 노트북 워커가 "응답 없음"으로 격리해요. 🔧 반응만 남기고, 끝나면 reply_to 로 답하세요. ' +
  '⑥답장이 필요 없는 알림은 payload.notice:true 로 보내세요(접수 순간 닫히고 받는 비서에게 한 번 갑니다). @전체 공지도 접수 순간 닫혀요. 보고서 협업 필요 줄에 이름을 쓰면 그 비서 앞으로 협업 요청이 자동으로 만들어져요 — 받으면 👀 후 진행, 아니면 🙅. ' +
  '⑤레이 님 승인이 필요한 일(돈·결제·외부 발행·계정·로그인·삭제·개인정보·배포)은 회의실에만 queue_enqueue {type:"claude_prompt", payload:{kind:"approval", title:"<한 줄>", prompt:"<무엇을·왜·안 하면 어떻게>", risk:"<돈|외부 발행|…>"}} 로 요청하세요 — 텔레그램·슬랙·카톡 등 다른 앱으로 보내지 마세요. 결정(✅ 승인·⏸ 보류·🚫 거절)은 reply_to 답장으로 가고, 승인 전에는 실행하지 마세요.';
function qqStripWorkerNote_(s) {
  return String(s == null ? '' : s).replace(QQ_WORKER_NOTE_RE, '').trim();
}
function qqWithWorkerNote_(type, payload) {
  if (type !== 'claude_prompt') return payload;
  var p;
  try { p = qqParse_(payload); } catch (err) { return payload; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return payload;
  if (String(p.kind || '').toLowerCase() === 'chat' || String(p.kind || '').toLowerCase() === 'approval') return payload;
  var prompt = String(p.prompt || '');
  if (!prompt || prompt.indexOf('[워커 규칙]') !== -1) return payload;
  if (prompt.length + QQ_WORKER_NOTE.length > QQ_MAX_PAYLOAD) return payload;
  p.prompt = prompt + QQ_WORKER_NOTE;
  p.worker_note = 'auto';
  return JSON.stringify(p);
}

/**
 * 2026-11-26 — 보고 규칙은 **저장되는 프롬프트에 붙이지 않는다**.
 *  붙이면 승인 해시·중복 판정·다른 화면(회의실 PWA)의 본문이 다 바뀌고 토큰도 늘어난다.
 *  대신 queue_enqueue·queue_claim·queue_done 의 **응답**과 웹훅 본문(report_rule)에 실어 준다.
 */

/**
 * 대화(kind='chat')가 '포털'(사람) 앞으로 온 것인가 — 아무도 실행하지 않는 순수 전달이다(2026-11-25).
 *  · 노트북도 다른 비서도 portal 앞 오더는 집지 않는다. 그런데 PENDING 으로 저장되면 화면에
 *    '차례를 기다려요' 대기 말풍선·'대기' 배지가 영원히 남고, 오더 큐 건수에도 섞인다.
 *  · 그래서 접수 순간에 DONE 으로 닫는다(말은 payload·summary 그대로 남아 말풍선이 된다).
 */
function qqDeliveredOnly_(type, payload) {
  if (type !== 'claude_prompt') return false;
  const p = qqParse_(payload);
  if (!isObj(p)) return false;
  if (String(p.kind || '').toLowerCase() !== 'chat') return false;
  const t = String(p.target || '').toLowerCase();
  // 2026-11-27 — 사람 앞 말에 더해 @전체 공지·알림(notice:true)도 '전달 완료'로 닫는다.
  //  예전엔 @전체 공지 8건·결정 알림·규칙 공지가 영원히 대기로 남아 브리핑 숫자를 부풀렸다(실측).
  //  비서는 받은편지함에서 '한 번' 받는다(queue_inbox 의 cast 갈래 — DONE 이어도 마지막 확인 뒤 온 것만).
  return t === 'portal' || t === 'all' || p.notice === true;
}

// ── 외부 에이전트 인바운드 웹훅 (2026-11-25) ───────────────────
/**
 * 등록된 웹훅 맵 {에이전트 id: https URL}. 형식이 틀린 줄은 조용히 버린다.
 *  · 읽는 곳은 여기 하나 — URL 이 화면·응답·로그로 새지 않게 목록(id)만 밖으로 낸다.
 */
function qqWebhookMap_() {
  let raw = '';
  try { raw = String(PropertiesService.getScriptProperties().getProperty(QQ_WEBHOOK_PROP) || ''); } catch (err) { return {}; }
  raw = raw.trim();
  if (!raw) return {};
  let m;
  try { m = JSON.parse(raw); } catch (err) { return {}; }
  if (!isObj(m)) return {};
  const out = {};
  Object.keys(m).forEach(function (k) {
    const id = String(k == null ? '' : k).trim().toLowerCase();
    const url = String(m[k] == null ? '' : m[k]).trim();
    if (!QQ_AGENT_ID_RE.test(id)) return;
    if (!/^https:\/\/[^\s]+$/.test(url)) return;      // https 만 — 오더 내용이 평문으로 새지 않게
    out[id] = url;
  });
  return out;
}
/**
 * 웹훅 본문 — 큐투 요구 규격 { id, target, mentions, summary, created_at } 에
 *  잘리지 않은 원문 `prompt` 를 더한다(2026-11-26 · 기존 키는 그대로라 호환).
 *  · target === 'all' 이어도 이 비서 이름이 mentions 에 반드시 들어간다.
 *  · 원본 mentions 배열은 건드리지 않고 **복사본**에만 붙인다.
 */
function qqWebhookBody_(row, p, agentId) {
  const target = String((p && p.target) == null ? '' : p.target).trim().toLowerCase();
  const mentions = qqMentionIds_(p && p.prompt, row && row.source, false);
  if (target && target !== 'all' && QQ_AGENT_ID_RE.test(target) && mentions.indexOf(target) < 0) mentions.push(target);
  const list = mentions.slice();
  if (list.indexOf(agentId) < 0) list.push(agentId);
  const kind = String((p && p.kind) == null ? '' : p.kind).toLowerCase();
  const rawPrompt = String((p && p.prompt) == null ? '' : p.prompt).replace(/\r\n?/g, '\n');
  return {
    id: String((row && row.id) || ''),
    target: target,
    mentions: list,
    summary: qqSummary_(row && row.type, p || {}),
    // 원문 전체 — 대화는 줄바꿈 그대로, 실행 오더는 큐가 붙인 규칙까지 그대로(가림만).
    prompt: qqMask_(kind === 'chat' ? qqStripWorkerNote_(rawPrompt) : rawPrompt, QQ_CELL_MAX),
    // 📎 첨부 — 깨운 비서도 같은 파일을 볼 수 있게 id·이름·크기·종류를 같이 보낸다(2026-11-27).
    files: qqFileVec_(p && p.files, false),
    created_at: String((row && row.created_at) || ''),
    // 2026-11-26 — 깨어난 비서가 바로 읽는 자리에 완료 보고 규칙을 둔다(사용자: "처리했으면 했다고 보고를 남겨라").
    report_rule: QQ_REPORT_RULE
  };
}
/** 웹훅 발사 결과(상태 코드)를 6시간 캐시에 남긴다 — 주소는 안 남긴다. 실패해도 조용히 넘긴다. */
function qqWebhookLog_(agentId, code, err) {
  try {
    const cache = CacheService.getScriptCache();
    let cur = qqWebhookLogAll_();
    cur[agentId] = { at: qqIso_(Date.now()), code: code === null || code === undefined ? null : Number(code), error: String(err || '').slice(0, 80) };
    cache.put(QQ_WEBHOOK_LOG_KEY, JSON.stringify(cur), 21600);
  } catch (e) { /* 진단용 기록이 실패해도 발사·접수에는 영향 없다 */ }
}
function qqWebhookLogAll_() {
  try {
    const raw = CacheService.getScriptCache().get(QQ_WEBHOOK_LOG_KEY) || '{}';
    const m = JSON.parse(raw);
    return isObj(m) ? m : {};
  } catch (e) { return {}; }
}
/**
 * 이 배포에 빠진 권한이 있으면 승인 링크를 준다(읽기 전용). 계정(소유자)만 열 수 있는 주소다.
 *  · UrlFetchApp 같은 바깥 요청 권한이 나중에 붙으면, 스크립트 소유자가 한 번 승인해야 한다.
 */
function queueAuthLink() {
  try {
    const info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
    const status = String(info.getAuthorizationStatus());
    return { ok: true, status: status, url: status === 'REQUIRED' ? String(info.getAuthorizationUrl() || '') : '',
      note: status === 'REQUIRED' ? '승인이 필요해요 — 소유자 계정으로 이 주소를 열어 허용하면 됩니다.' : '지금 필요한 권한은 모두 승인되어 있어요.' };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}
/** 최근 웹훅 발사 결과(읽기 전용) — 비서별 마지막 응답 코드·시각·오류. 주소는 없다. */
// ═══════════════════════════════════════════════════════════════
// 📥 주기 확인형 비서의 받은편지함·확인 기록 (2026-11-26)
//
//  키링·키투·부이·뷔투는 웹훅이 없어 5~30분마다 스스로 큐를 확인한다. 그래서
//   ① 확인 한 번이 가볍고 정확해야 한다 — queue_inbox 는 **내가 지금 처리할 말만** 준다
//      (내 앞·@전체 PENDING 중 내가 아직 답 안 한 것 + 내가 집고 안 끝낸 것). 이미 답한 말은 빼고 건수만.
//   ② 살아 있는지가 보여야 한다 — 비서가 자기 앞 목록을 읽을 때(queue_inbox·queue_head·queue_list target·queue_claim)
//      마지막 확인 시각을 캐시에 남기고, 브리핑이 "마지막 확인 N분 전 · 주기 확인"으로 보여 준다.
//      말이 밀려도 확인은 꾸준하면 '느린 것', 확인도 끊겼으면 '멈춘 것'이다.
//  기록은 CacheService(6시간) 한 칸 — 주소·키·본문은 남기지 않고 id → 시각만.
// ═══════════════════════════════════════════════════════════════
const QQ_CHECK_LOG_KEY = 'qq_check_log_v1';
const QQ_INBOX_MAX = 20;
function qqCheckLogAll_() {
  try {
    const m = JSON.parse(CacheService.getScriptCache().get(QQ_CHECK_LOG_KEY) || '{}');
    return isObj(m) ? m : {};
  } catch (e) { return {}; }
}
function qqCheckMark_(id) {
  const k = qqLow_(id);
  if (!qqIsAiId_(k)) return;
  try {
    const cur = qqCheckLogAll_();
    cur[k] = qqNow_();
    CacheService.getScriptCache().put(QQ_CHECK_LOG_KEY, JSON.stringify(cur), 21600);
  } catch (e) { /* 진단용 기록 — 실패해도 읽기에는 영향 없다 */ }
}
/** 내 받은편지함 — {action:'queue_inbox', key, as:'keyring', since?} (GET 도 됨) */
function queueInbox(body) {
  const me = qqLow_(body && (body.as || body.target));
  if (!qqIsAiId_(me)) throw qqErr_('bad_request', 'as 에 내 비서 id 를 넣어주세요(영소문자·숫자·_·- 12자, portal 제외).');
  //  전달 규칙(2026-11-26): 내 앞(target=나)·내가 집은 말은 **답하거나 닫힐 때까지** 계속 보이고,
  //  @전체·본문 @멘션으로만 부른 말은 **내가 마지막으로 확인한 뒤 온 것만 한 번** 보인다.
  //  (안 그러면 @전체 공지가 영원히 받은편지함에 남아 "count 0 이면 침묵" 규칙이 깨진다 / 멘션만 된 말은 아예 안 보였다)
  const checks = qqCheckLogAll_();
  const prevMs = Date.parse(String(checks[me] || '')) || 0;     // 마크하기 **전에** 읽는다
  qqCheckMark_(me);
  const sinceMs = Date.parse(String((body && body.since) || '')) || 0;
  const castFrom = prevMs || (Date.now() - 6 * 3600000);        // 확인 기록이 없으면 최근 6시간(경계는 '<' — 같은 초에 온 말을 놓치지 않는다)
  const ctx = qqOpen_();
  const rows = qqRows_(ctx, QQ_SCAN_ROWS);
  const answered = {};                                  // 내가 이미 답장한 원글
  rows.forEach(function (r) {
    if (qqLow_(r.source) !== me) return;
    const m = QQ_REPLY_JSON_RE.exec(String(r.payload == null ? '' : r.payload));
    if (m) answered[m[1]] = true;
  });
  const myCollabParents = {};                           // 나에게 협업 요청(자식 줄)이 만들어진 원 보고
  rows.forEach(function (r) {
    const raw = String(r.payload == null ? '' : r.payload);
    if (raw.indexOf('"collab":true') < 0 || qqRowTarget_(r) !== me) return;
    const m = QQ_REPLY_JSON_RE.exec(raw);
    if (m) myCollabParents[m[1]] = true;
  });
  const items = [];
  let count = 0, repliedOpen = 0, running = 0, cast = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const st = String(r.status == null ? '' : r.status).trim().toUpperCase();
    const by = qqLow_(r.claimed_by);
    const mineRunning = st === 'RUNNING' && by === me;
    const t = qqRowTarget_(r);
    const createdMs = Date.parse(String(r.created_at || '')) || 0;
    // 2026-11-27 — '전달 완료'로 닫힌 대화(@전체 공지·알림·사람 앞 보고 속 @멘션)도 마지막 확인 뒤 온 것만 한 번 준다
    let doneCast = false;
    if (st !== 'PENDING' && !mineRunning) {
      if (st !== 'DONE' || createdMs < castFrom) continue;
      const raw0 = String(r.payload == null ? '' : r.payload);
      if (!/"kind"\s*:\s*"chat"/.test(raw0)) continue;
      doneCast = true;
    }
    if (qqLow_(r.source) === me) continue;               // 내가 보낸 말은 내 일이 아니다
    let isCast = doneCast;
    if (!mineRunning && (t !== me || doneCast)) {
      if (t === 'all') isCast = true;
      else if (doneCast && t === me) {                      // 내 앞 말이 이미 닫혔으면 알림(notice)일 때만 한 번
        if (!/"notice"\s*:\s*true/.test(String(r.payload == null ? '' : r.payload))) continue;
        isCast = true;
      }
      else {
        // 본문 @멘션·'협업 필요' 줄로만 부른 말 — PENDING 줄만, 문자열에 @·협업이 있을 때만 무겁게 본다
        const raw = String(r.payload == null ? '' : r.payload);
        if (raw.indexOf('@') < 0 && raw.indexOf('협업') < 0) continue;
        let hit = false;
        try { hit = qqMentionIds_(qqParse_(r.payload).prompt, r.source, false).indexOf(me) >= 0; } catch (e) { hit = false; }
        if (!hit) continue;
        isCast = true;
      }
    }
    if (answered[String(r.id)]) { repliedOpen++; continue; }
    if (isCast && myCollabParents[String(r.id)]) continue;   // 같은 내용이 협업 요청으로 이미 내 앞에 있다
    if (isCast && (createdMs < castFrom || (sinceMs && createdMs <= sinceMs))) continue;   // 이미 한 번 전달한 말
    if (!isCast && sinceMs && createdMs <= sinceMs && !mineRunning) continue;
    count++;
    if (mineRunning) running++;
    if (isCast) cast++;
    if (items.length < QQ_INBOX_MAX) items.push(qqItem_(r));
  }
  // 가져간 말에 「전달됨 ✓」 자동 표시 — 비서가 아무것도 안 해도 회의실에서 '전달 안 됨 / 전달됨'이 갈린다.
  const rmap = qqReactRead_(ctx);
  qqDeliverMark_(ctx, me, items.map(function (x) { return x.id; }), rmap);
  items.forEach(function (x) { x.reactions = rmap[x.id] || []; });
  return { ok: true, at: qqNow_(), as: me, count: count, running: running, replied_open: repliedOpen, cast: cast,
    items: items, report_rule: QQ_REPORT_RULE, delivered_mark: true,
    how: '내 앞으로 온 말은 답하거나 닫힐 때까지 계속 보이고, @전체·@멘션으로 부른 말은 한 번만 전달돼요(items[].target 이 me 가 아니면 참고용 — 내 할 일이 없으면 침묵). ' +
      '답할 때 payload.reply_to 에 그 말의 id 를 넣으면 원글이 자동으로 닫혀요(@전체 말은 제외). 확인만 하는 답장("확인했어요")은 보내지 마세요.' };
}

function queueWebhookLast() {
  return { ok: true, last: qqWebhookLogAll_(), registered: Object.keys(qqWebhookMap_()).length,
    note: '최근 6시간 안에 쏜 웹훅의 응답 코드만 남겨요(주소는 저장하지 않아요).' };
}
/**
 * 접수된 오더를 기다리는 비서를 실시간으로 깨운다.
 *  조건: source !== agentId 이고 (target === agentId · target === 'all' · mentions 에 agentId).
 *  · 본인이 낸 글에는 본인을 깨우지 않는다(비서끼리 무한 루프 방지).
 *  · 호출은 통째로 격리한다 — 웹훅이 실패해도 queue_enqueue 는 그대로 성공이다.
 *  반환: 깨운 에이전트 id 배열(시험·보고용).
 */
function qqFireWebhooks_(row, p, skip) {
  try {
    const map = qqWebhookMap_();
    const ids = Object.keys(map);
    if (!ids.length) return [];
    const source = String((row && row.source) == null ? '' : row.source).trim().toLowerCase();
    const target = String((p && p.target) == null ? '' : p.target).trim().toLowerCase();
    const mentioned = qqMentionIds_(p && p.prompt, source, false);
    const fired = [];
    ids.forEach(function (agentId) {
      if (source === agentId) return;
      if (skip && skip.indexOf(agentId) >= 0) return;   // 협업 요청으로 따로 깨울 비서는 원 보고로 또 깨우지 않는다
      if (!(target === agentId || target === 'all' || mentioned.indexOf(agentId) >= 0)) return;
      try {
        if (typeof UrlFetchApp === 'undefined') throw new Error('no UrlFetchApp');
        const res = UrlFetchApp.fetch(map[agentId], {
          method: 'post', contentType: 'application/json',
          payload: JSON.stringify(qqWebhookBody_(row, p, agentId)),
          muteHttpExceptions: true
        });
        let code = 0;
        try { code = res && res.getResponseCode ? Number(res.getResponseCode()) : 0; } catch (e2) { code = 0; }
        qqWebhookLog_(agentId, code);
        fired.push(agentId);
      } catch (err) {
        qqWebhookLog_(agentId, null, (err && err.message) || '웹훅 호출 실패');
      }
    });
    return fired;
  } catch (err) { return []; }
}
/**
 * 웹훅 주소 등록·변경·삭제(비밀 키 인증 필요).
 *  본문: {"action":"webhook_set","key":"…","triggers":{"cue":"https://…","cue2":"https://…"}}
 *  · 준 키만 새로 넣고 나머지는 그대로 둔다(부분 갱신). 값을 빈 문자열로 주면 그 키를 지운다.
 *  · URL 은 응답에 돌려주지 않는다(id·개수만). 저장은 ScriptProperties 한 곳뿐.
 */
function queueWebhookSet(body) {
  const t = isObj(body && body.triggers) ? body.triggers : (isObj(body && body.webhooks) ? body.webhooks : null);
  if (!t) throw qqErr_('bad_request', 'triggers(에이전트 id → https 주소)가 필요해요.');
  const map = qqWebhookMap_();
  const ids = [];
  Object.keys(t).forEach(function (k) {
    const id = String(k == null ? '' : k).trim().toLowerCase();
    if (!QQ_AGENT_ID_RE.test(id)) throw qqErr_('bad_request', '에이전트 id 는 영소문자·숫자·_·- 12자 이내여야 해요.');
    const url = String(t[k] == null ? '' : t[k]).trim();
    if (!url) { delete map[id]; ids.push(id); return; }
    if (!/^https:\/\/[^\s]+$/.test(url)) throw qqErr_('bad_request', id + ' 웹훅은 https 주소여야 해요.');
    map[id] = url;
    ids.push(id);
  });
  PropertiesService.getScriptProperties().setProperty(QQ_WEBHOOK_PROP, JSON.stringify(map));
  return { ok: true, ids: ids, count: Object.keys(map).length,
    note: '웹훅 주소는 ScriptProperties 에만 저장했어요(응답에는 돌려주지 않아요).' };
}

/**
 * 오더 본문 → worker 가 읽는 payload 객체.
 *  2026-11-26 — 비서(pi1·큐투…)는 `{type, kind:'chat', target:'portal', payload:{prompt}}` 처럼
 *  **봉투 바깥**에 kind·target 을 적어 보낸다. 예전엔 payload 안만 읽어서 kind·target 이 조용히 사라졌고,
 *  그 결과 대화가 '오더 요약(클로드: …160자)'으로 저장되고 target 이 본문 @멘션으로 덮였다.
 *  이제 바깥 값을 payload 로 옮긴다(payload 안에 있으면 그게 우선).
 */
function qqEnvelopeOf_(body) {
  const b = isObj(body) ? body : {};
  let p = b.payload;
  //  · 예전 창구는 payload 를 JSON 문자열이나 **글 자체**로도 보냈다 — 둘 다 받아 준다.
  if (typeof p === 'string') {
    const raw = p.trim();
    if (!raw) p = {};
    else { try { p = JSON.parse(raw); } catch (err) { p = { prompt: raw }; } }
    if (!isObj(p)) p = { prompt: raw };
  }
  p = isObj(p) ? Object.assign({}, p) : {};
  ['prompt', 'mode', 'engine', 'kind', 'target', 'reply_to', 'replied_by', 'risk'].forEach(function (k) {
    const v = b[k];
    if (v === undefined || v === null || v === '') return;
    if (p[k] === undefined || p[k] === null || p[k] === '') p[k] = v;   // payload 안 값이 우선
  });
  // 본문 없이 summary 만 보낸 창구도 있다 — 오더 내용이 비어 거절되느니 그걸 쓴다.
  if (!p.prompt && b.summary) p.prompt = String(b.summary);
  return p;
}
/** AI 가 쓴 4항목 보고서 모양인가(`1. 프로젝트:` … ) — 답장 주인을 가릴 때 쓴다. */
const QQ_AI_REPORT_RE = /(?:^|\n)[ \t]*(?:1[.)][ \t]*)?프로젝트[ \t]*[:：]|(?:^|\n)[ \t]*(?:2[.)][ \t]*)?완료[ \t]*작업[ \t]*[:：]/;
/**
 * 누가 낸 오더인가(source) — 비서가 source 를 빼먹어 '내 말(portal)'이 되는 일을 막는다(2026-11-26).
 *  ① 답장에 replied_by(비서 id)가 있으면 **무조건** 그 비서 — source:'portal' 이 명시돼 있어도.
 *  ② source/client_id/payload.source 를 명시했으면 그대로(포털 UI 는 항상 source:'portal').
 *  ③ source 가 없고 reply_to 가 있으면 원글의 target 이 비서일 때 그 비서의 답장으로 본다
 *     (AI 보고 모양의 글이거나, 원글이 비서 앞으로 온 것이면).
 *  ④ 그래도 모르면 portal(사용자).
 */
/** 본문이 `[키투 보고]`·`【뷔투 …】` 처럼 그 비서의 이름표로 시작하는가 (이름·별칭·id). */
function qqSelfLabeled_(text, id) {
  const m = /^\s*[【\[]\s*([^\]】\s·:：\/]{1,12})/.exec(String(text == null ? '' : text));
  if (!m) return false;
  const label = m[1].toLowerCase();
  const names = (QQ_SECONDARY[id] || []).slice();
  Object.keys(QQ_TARGET_NAMES).forEach(function (n) { if (QQ_TARGET_NAMES[n] === id) names.push(n); });
  names.push(id);
  return names.some(function (n) { return String(n).toLowerCase() === label; });
}
function qqSourceFor_(body, ctx) {
  const b = isObj(body) ? body : {};
  const rb = String(b.replied_by || (isObj(b.payload) && b.payload.replied_by) || '').trim().toLowerCase();
  if (qqIsAiId_(rb)) return rb;
  const explicit = String(b.source || b.client_id || (isObj(b.payload) && b.payload.source) || '').trim();
  // 2026-11-27 — 키투의 `[키투 보고] …` 4건이 source:'portal' 로 들어와 레이 님 말(오른쪽 파란 말풍선)로 찍혔다.
  //  명시한 source 가 portal 이어도, 답장(reply_to)의 원글이 비서 앞이고 본문이 그 비서의 이름표로 시작하면 그 비서의 말로 본다.
  let viaPortal = false;
  if (explicit) {
    const s = qqSourceOf_(explicit);
    if (s !== 'portal') return s;
    viaPortal = true;
  }
  const replyTo = String(b.reply_to || (isObj(b.payload) && b.payload.reply_to) || '').trim();
  if (replyTo && ctx) {
    let row = null;
    try { row = qqFindRow_(ctx, replyTo); } catch (err) { row = null; }
    const t = row ? qqRowTarget_(row) : '';
    if (qqIsAiId_(t)) {
      const rep = String(b.summary || (isObj(b.payload) && b.payload.prompt) || '');
      if (viaPortal) { if (qqSelfLabeled_(rep, t)) return t; }
      else if (!rep.trim() || QQ_AI_REPORT_RE.test(rep)) return t;
    }
  }
  return 'portal';
}

// ═══════════════════════════════════════════════════════════════
// ↩ 답장하면 원글을 닫는다 (2026-11-26)
//
//  왜: 비서들은 일을 받으면 queue_claim/queue_done 대신 **reply_to 를 단 새 말**로 답한다.
//      원글은 PENDING 으로 남아 대기 건수·지연 배지를 부풀리고, 진짜 안 읽은 말과 구분이 안 됐다
//      (2026-11-26 실측: 큐 8건 중 4건, 큐투 4건 중 3건, 피투 8건 중 5건이 '답은 했는데 안 닫음').
//  규칙
//   · 답장을 단 비서(source)가 그 원글의 **주인**이어야 한다 — PENDING 이면 target, RUNNING 이면 claimed_by.
//   · target='all' 원글은 닫지 않는다(여러 비서가 각자 답할 수 있는 말이다).
//   · 노트북 앞 실행 오더·노트북이 집은 오더는 건드리지 않는다(워커가 결과를 쓰는 길이 따로 있다).
//   · 원글의 결과칸이 비어 있으면 `↩ 답장 <id>` 를 적는다. 그 비서가 나중에 queue_done 으로 결과를 주면 바꿔 준다.
// ═══════════════════════════════════════════════════════════════
const QQ_REPLY_CLOSE_MARK = '↩ 답장 ';
function qqCloseOnReply_(ctx, row, p, nowMs) {
  try {
    const rid = String((p && p.reply_to) == null ? '' : p.reply_to).trim();
    const by = String((row && row.source) == null ? '' : row.source).trim().toLowerCase();
    if (!rid || !qqIsAiId_(by) || by === 'notebook') return null;
    const r = qqFindRow_(ctx, rid);
    if (!r) return null;
    const st = String(r.status == null ? '' : r.status).trim().toUpperCase();
    // 2026-11-27 — TIMEOUT_REVIEW 도 닫는다: 집은 비서(claimed_by)가 결과를 냈다면 '응답 없음'이 아니다.
    //  (뷔투 2건: 노트북 워커가 20분 넘게 신호 없는 RUNNING 을 격리했는데 뷔투는 그 뒤에 산출물을 냈다 — 원 오더만 빨갛게 남았다)
    if (st !== 'PENDING' && st !== 'RUNNING' && st !== 'TIMEOUT_REVIEW') return null;
    const tgt = qqRowTarget_(r);
    const claimed = String(r.claimed_by == null ? '' : r.claimed_by).trim().toLowerCase();
    if (tgt === 'notebook' || claimed === 'notebook') return null;
    const owner = (st === 'RUNNING' || st === 'TIMEOUT_REVIEW') && claimed ? claimed : tgt;
    if (owner !== by) return null;
    const started = Date.parse(String(r.claimed_at || '')) || 0;
    const hasResult = !!String(r.result == null ? '' : r.result).trim();
    qqUpdateRow_(ctx, r.__row, {
      status: 'DONE', claimed_by: by, claimed_at: claimed ? r.claimed_at : qqIso_(nowMs), finished_at: qqIso_(nowMs),
      duration_ms: started ? Math.max(0, nowMs - started) : 0, exit_code: 0,
      result: hasResult ? r.result : QQ_REPLY_CLOSE_MARK + String(row.id),
      error: st === 'TIMEOUT_REVIEW' ? '' : r.error
    });
    return { id: rid, by: by, status: 'DONE' };
  } catch (err) { return null; }      // 닫기에 실패해도 답장 접수는 그대로 성공
}

// ═══════════════════════════════════════════════════════════════
// 👀 이모지 반응 — queue_react · 자동 「전달됨 ✓」 (2026-11-26, 사용자 "이모지로 확인했나만 표시하면 토큰 안 먹잖아")
//
//  왜: "확인했어요" 한 줄도 글을 쓰는 토큰 + 시트 한 줄 + 그걸 받은 다른 비서가 또 읽고 답하는 연쇄가 든다.
//      반응은 호출 한 번(수십 토큰)이고, 회의실 글로 쌓이지 않고, 웹훅으로 아무도 깨우지 않는다.
//  저장: 같은 스프레드시트의 `Reactions` 탭(at·order_id·agent·emoji)에 **덧붙이기만** 한다.
//        Command_Queue 의 22칸은 건드리지 않는다(노트북 CommandQueue.gs 와 100% 호환 유지).
//  종류
//   · ✓ 전달됨 — **서버가 자동**으로 남긴다: 비서가 queue_inbox 로 그 말을 가져간 순간. 토큰 0, 비서 수정 없음.
//                '읽음'이 아니다 — 가져간 것만 확실하고 이해했는지는 서버가 모른다.
//   · 👀 접수   — 비서가 직접. 내 일로 보고 있다(닫지 않음).
//   · 🔧 진행 중 — 비서가 직접. **반응만**(상태는 안 바뀐다) — RUNNING 으로 집으면 노트북 워커가 20분 넘게 신호 없는 RUNNING 을
//                '응답 없음(TIMEOUT_REVIEW)'으로 격리한다(2026-11-27 실측 — 뷔투 2건).
//   · ✅ 완료   — 비서가 직접. 내 앞 말이면 닫는다(DONE, 결과칸 `✅ 완료`). 확인 답장을 대신한다(TIMEOUT_REVIEW 도 닫는다).
//   · 🙅 내 일 아님 — 비서가 직접. 내 앞 말이면 닫는다(DONE, 결과칸 `🙅 내 일 아님`).
//  @전체·멘션으로만 부른 말·노트북 앞 오더는 반응만 남기고 상태는 바꾸지 않는다.
// ═══════════════════════════════════════════════════════════════
const QQ_REACT_TAB = 'Reactions';
const QQ_REACT_COLS = ['at', 'order_id', 'agent', 'emoji'];
const QQ_REACT_EMOJI = ['👀', '🔧', '✅', '🙅'];
const QQ_DELIVERED = '✓';
const QQ_REACT_ALIAS = { seen: '👀', ack: '👀', working: '🔧', doing: '🔧', done: '✅', ok: '✅', na: '🙅', skip: '🙅' };
const QQ_REACT_SCAN = 800;                           // 반응 탭에서 아래(최근)부터 읽는 줄 수
const QQ_REACT_PER_ITEM = 12;
function qqReactSheet_(ctx, create) {
  let sh = ctx.ss.getSheetByName(QQ_REACT_TAB);
  if (!sh && create) {
    sh = ctx.ss.insertSheet(QQ_REACT_TAB);
    sh.getRange(1, 1, 1, QQ_REACT_COLS.length).setValues([QQ_REACT_COLS.slice()]);
  }
  return sh || null;
}
/** 최근 반응을 {오더 id: [{by, e, at}]} 로. 탭이 없거나 읽기 실패면 빈 표(읽기에서는 탭을 만들지 않는다). */
function qqReactRead_(ctx) {
  const out = {};
  try {
    const sh = qqReactSheet_(ctx, false);
    if (!sh) return out;
    const last = Number(sh.getLastRow()) || 0;
    if (last < 2) return out;
    const from = Math.max(2, last - QQ_REACT_SCAN + 1);
    const vals = sh.getRange(from, 1, last - from + 1, QQ_REACT_COLS.length).getValues();
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i] || [];
      const id = String(v[1] == null ? '' : v[1]).trim();
      const by = qqLow_(v[2]);
      const e = String(v[3] == null ? '' : v[3]).trim();
      if (!id || !by || !e) continue;
      const list = out[id] || (out[id] = []);
      if (list.length < QQ_REACT_PER_ITEM) list.push({ by: by, e: e, at: clip(v[0], 40) });
    }
  } catch (err) { /* 반응은 보조 정보 — 못 읽어도 오더 흐름은 그대로 */ }
  return out;
}
function qqReactAppend_(ctx, rows) {
  const sh = qqReactSheet_(ctx, true);
  for (let i = 0; i < rows.length; i++) sh.appendRow(rows[i]);       // appendRow 는 원자적 — 동시에 불러도 줄이 겹치지 않는다
}
/** 비서가 가져간 말에 「전달됨 ✓」을 남긴다 — 이 비서가 그 말에 남긴 반응이 아직 없을 때만. 실패해도 조용히 넘어간다. */
function qqDeliverMark_(ctx, me, ids, rmap) {
  try {
    if (!ids.length) return;
    const map = rmap || qqReactRead_(ctx);
    const at = qqNow_();
    const rows = [];
    ids.forEach(function (id) {
      const has = (map[id] || []).some(function (x) { return x.by === me; });
      if (!has) { rows.push([at, id, me, QQ_DELIVERED]); (map[id] = map[id] || []).push({ by: me, e: QQ_DELIVERED, at: at }); }
    });
    if (rows.length) qqReactAppend_(ctx, rows);
  } catch (err) { /* 진단용 — 실패해도 받은편지함 응답에는 영향 없다 */ }
}
// ═══════════════════════════════════════════════════════════════
// 🔔 승인함 — approval_list · approval_decide (2026-11-27, 사용자 "승인 필요한 것만 딱딱 볼 수 있게")
//
//  왜: 비서들이 승인이 필요한 일을 가끔 자기 앱(텔레그램·슬랙 등)으로 보내 관리가 흩어졌다.
//      → 승인은 회의실의 `kind:'approval'` 하나로 받고, 레이 님이 결정할 것만 한곳에 모은다.
//  모으는 것(최근 400행)
//   ① request   — 비서가 kind:'approval' 로 낸 승인 요청 중 PENDING(아직 결정 안 함)
//   ② order     — 실행 승인 대기(WAITING_APPROVAL: 파일 수정·영상 렌더 등) — 결정은 기존 queue_decide 와 같은 길
//   ③ suggested — kind 는 대화인데 본문이 승인을 묻는 말(정규식) + 48시간 안 + 아직 결정·답장 안 함.
//                 비서가 형식을 몰라 대화로 물은 것을 놓치지 않으려는 '보조' 갈래다(확실하지 않다고 표시한다).
//  결정(approval_decide {id, decision:'approve'|'hold'|'reject', note?})
//   · request: 승인 → DONE · 거절 → REJECTED · 보류 → PENDING 유지(승인함에 '보류'로 남는다). approval_by/at/note 에 기록.
//   · order  : queue_decide 로 넘긴다(보류는 없음 — 15분 안에 승인하지 않으면 만료).
//   · suggested: 상태는 그대로, approval_by/at/note 만 기록(승인함에서 빠진다).
//   · 어느 경우든 요청한 비서에게 결과를 reply_to 답장으로 보낸다(웹훅 비서는 바로 깨어나고 폴링 비서는 받은편지함에서 본다).
// ═══════════════════════════════════════════════════════════════
const QQ_APPROVAL_TITLE_MAX = 80;
// 2026-11-27 실측 보정 — 처음 규칙은 6건 중 4건이 오탐이었다("승인이 필요한 사항은 확인하겠습니다"·"승인은 없습니다"·"승인된 요청이 오면").
//  문장 단위로 보고, '요청 형태'만 잡고, 부정·약속 문장은 뺀다(qqApprovalHint_).
const QQ_APPROVAL_HINT_RE = /(승인|허락|결재|컨펌)\s*(을|를)?\s*(부탁|요청)\s*(드립니다|드려요|드릴게요|합니다|해요)|(재?승인|허락|결재|컨펌)\s*(이|가)?\s*필요\s*(합니다|해요|함|$)|(승인|허락|컨펌)\s*해\s*주(세요|시겠|실\s*수)|(진행|발행|결제|구매|삭제|배포|등록|업로드|전송)\s*해도\s*(될까요|되나요|괜찮을까요|괜찮나요)|(결정|선택)\s*(해|을|를)?\s*주세요/;
const QQ_APPROVAL_NEG_RE = /(없습니다|없어요|없음|않겠|않습니다|하지 않|안 할|확인하겠습니다)/;
function qqApprovalHint_(text) {
  return String(text == null ? '' : text).split(/[.!?。\n]+/).some(function (sen) {
    return QQ_APPROVAL_HINT_RE.test(sen) && !QQ_APPROVAL_NEG_RE.test(sen);
  });
}
const QQ_DECISIONS = { approve: '✅ 승인', hold: '⏸ 보류', reject: '🚫 거절' };
/** 시트 줄의 결정 — approval_note 머리의 표시로 읽는다('approve'|'hold'|'reject'|'') */
function qqDecisionOf_(r) {
  const note = String((r && r.approval_note) == null ? '' : r.approval_note);
  const by = String((r && r.approval_by) == null ? '' : r.approval_by).trim().toLowerCase();
  if (by !== 'portal') return '';
  if (note.indexOf(QQ_DECISIONS.approve) === 0) return 'approve';
  if (note.indexOf(QQ_DECISIONS.hold) === 0) return 'hold';
  if (note.indexOf(QQ_DECISIONS.reject) === 0) return 'reject';
  return '';
}
function approvalList(body) {
  const ctx = qqOpen_();
  const rows = qqRows_(ctx, QQ_SCAN_ROWS);
  const nowMs = Date.now();
  const portalReplied = {};                              // 레이 님이 이미 답장한 원글
  rows.forEach(function (r) {
    if (qqLow_(r.source) !== 'portal') return;
    const m = QQ_REPLY_JSON_RE.exec(String(r.payload == null ? '' : r.payload));
    if (m) portalReplied[m[1]] = true;
  });
  const items = [];
  const count = { request: 0, order: 0, suggested: 0, held: 0 };
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const st = String(r.status == null ? '' : r.status).trim().toUpperCase();
    const raw = String(r.payload == null ? '' : r.payload);
    let kind = '';
    if (st === 'WAITING_APPROVAL') kind = 'order';
    else if (st === 'PENDING' && /"kind"\s*:\s*"approval"/.test(raw)) kind = 'request';
    else if (/"kind"\s*:\s*"chat"/.test(raw) && /"target"\s*:\s*"portal"/.test(raw)) {
      const src = qqLow_(r.source);
      if (!qqIsAiId_(src) || qqDecisionOf_(r) || portalReplied[String(r.id)]) continue;
      if (nowMs - (Date.parse(String(r.created_at || '')) || 0) > 48 * 3600000) continue;
      const p0 = qqParse_(r.payload);
      if (!qqApprovalHint_(p0.prompt)) continue;
      kind = 'suggested';
    }
    if (!kind) continue;
    const it = qqItem_(r);
    it.approval_kind = kind;
    if (kind === 'request' && qqDecisionOf_(r) === 'hold') { it.held = true; count.held++; }
    count[kind]++;
    items.push(it);
  }
  // 보류는 맨 뒤로(아직 볼 것 먼저) — 안에서는 최신순
  items.sort(function (a, b) { return (a.held ? 1 : 0) - (b.held ? 1 : 0); });
  return { ok: true, at: qqNow_(), count: count.request + count.order + count.suggested, counts: count, items: items.slice(0, 40),
    version: SERVER_VERSION };
}
function approvalDecide(body) {
  const id = clip((body && body.id) || '', 60).trim();
  if (!id) throw qqErr_('bad_request', '오더 id 가 없어요.');
  const decision = String((body && body.decision) || '').trim().toLowerCase();
  if (!QQ_DECISIONS[decision]) throw qqErr_('bad_request', '결정은 approve · hold · reject 중 하나예요.');
  const note = clip(String((body && body.note) || '').replace(/\s+/g, ' ').trim(), 300);
  // 실행 승인 대기는 기존 길(해시·만료·감사 로그)을 그대로 쓴다
  let first = null;
  try { first = qqFindRow_(qqOpen_(), id); } catch (err) { first = null; }
  if (!first) throw qqErr_('not_found', '그 항목을 찾지 못했어요.');
  if (String(first.status || '').trim().toUpperCase() === 'WAITING_APPROVAL') {
    if (decision === 'hold') throw qqErr_('bad_request', '실행 승인은 보류할 수 없어요 — 15분 안에 승인하지 않으면 만료돼요.');
    const d = queueDecide({ id: id, decision: decision, note: note });
    return { ok: true, id: id, decision: decision, kind: 'order', changed: !!(d && d.changed), status: d && d.status };
  }
  let requester = '', title = '', kind = '', changed = false, status = '';
  const nowIso = qqNow_();
  const res = qqLock_(function () {
    const ctx = qqOpen_();
    const r = qqFindRow_(ctx, id);
    if (!r) throw qqErr_('not_found', '그 항목을 찾지 못했어요.');
    const st = String(r.status == null ? '' : r.status).trim().toUpperCase();
    const p = qqParse_(r.payload);
    const isReq = qqLow_(p.kind) === 'approval';
    const isChatToMe = qqLow_(p.kind) === 'chat' && qqLow_(p.target) === 'portal';
    if (!isReq && !isChatToMe) throw qqErr_('bad_request', '승인 요청이 아니에요.');
    requester = qqIsAiId_(qqLow_(r.source)) ? qqLow_(r.source) : '';
    title = clip(String(String(p.title || '').trim() || String(p.prompt || '').split(/\r?\n/)[0])
      .replace(/^(\s*@\S+)+\s*/, '').trim(), 60);
    kind = isReq ? 'request' : 'suggested';
    const prev = qqDecisionOf_(r);
    if (prev && prev !== 'hold') return { ok: true, id: id, changed: false, status: st, decision: prev, reason: '이미 결정한 항목이에요.' };
    if (isReq && st !== 'PENDING') return { ok: true, id: id, changed: false, status: st, reason: '이미 끝난 요청이에요.' };
    const mark = QQ_DECISIONS[decision] + (note ? ' — ' + note : '');
    const patch = { approval_by: 'portal', approval_at: nowIso, approval_note: mark };
    if (isReq && decision === 'approve') { patch.status = 'DONE'; patch.finished_at = nowIso; patch.result = mark; patch.exit_code = 0; }
    if (isReq && decision === 'reject') { patch.status = 'REJECTED'; patch.finished_at = nowIso; patch.error = mark; }
    qqUpdateRow_(ctx, r.__row, patch);
    qqAudit_(ctx, { id: id, type: String(r.type || ''), workspace: String(r.workspace || ''), risk: String(r.risk_level || ''),
      decision: decision, by: 'portal', channel: 'approval', note: note, payloadHash: '', source: String(r.source || '') });
    changed = true;
    status = patch.status || st;
    return null;
  });
  if (res) return res;
  // 요청한 비서에게 결과를 답장으로 — 실패해도 결정은 이미 기록됐다
  let replyId = '';
  if (requester) {
    const ws = String(first.workspace || '').trim() || (qqWorkspaces_()[0] || '');
    const text = '@' + qqAgentName_(requester) + ' [레이 님 결정] ' + QQ_DECISIONS[decision] + ' — ' + title + (note ? '\n메모: ' + note : '') +
      (decision === 'approve' ? '\n진행하고, 끝나면 reply_to 로 결과를 한 번 남겨 주세요.'
        : decision === 'hold' ? '\n아직 진행하지 마세요. 필요한 정보가 있으면 이 말에 reply_to 로 답해 주세요.'
        : '\n진행하지 마세요.');
    try {
      const e = queueEnqueue({ type: 'claude_prompt', workspace: ws, source: 'portal', client_id: 'portal',
        payload: { kind: 'chat', target: requester, reply_to: id, prompt: text, notice: true } });
      replyId = e && e.item ? e.item.id : '';
    } catch (err) { replyId = ''; }
  }
  return { ok: true, id: id, decision: decision, kind: kind, changed: changed, status: status, reply_id: replyId, requester: requester };
}

// ── 🤝 협업 요청 자동 할 일 · 이름 · 어사이드 판정 (2026-11-27) ─────────────
const QQ_COLLAB_MAX = 3;
/** id → 부르는 이름(큐투·뷔투·키투 확정 호칭 먼저, 다음 명부) */
function qqAgentName_(id) {
  const k = qqLow_(id);
  if (QQ_SECONDARY[k]) return QQ_SECONDARY[k][0];
  for (const n in QQ_TARGET_NAMES) { if (QQ_TARGET_NAMES[n] === k && n !== '전체') return n; }
  try { const a = agentRoster_().filter(function (x) { return x.id === k; })[0]; if (a && a.name) return a.name; } catch (e) { /* 명부 없음 */ }
  return k;
}
/**
 * 보고서의 '협업 필요: ○○' → ○○ 앞으로 할 일 한 줄씩(최대 3명). 원 보고를 reply_to 로 묶어 스레드로 보인다.
 *  노트북은 빼고(실행은 오더로 따로), 이미 대상인 비서·자기 자신·사람·@전체도 뺀다. 실패해도 원 보고 접수는 그대로.
 */
function qqCollabTasks_(ctx, row, p, nowMs) {
  try {
    const src = qqLow_(row.source);
    if (!qqIsAiId_(src) || src === 'notebook') return [];
    const text = String(p.prompt == null ? '' : p.prompt);
    if (text.indexOf('[협업 요청 · 자동]') >= 0) return [];   // 자동 협업 요청을 옮겨 적은 말은 다시 퍼뜨리지 않는다
    const tgt = qqLow_(p.target);
    const ids = qqCollabMentions_(text, false).filter(function (id) {
      return id !== src && id !== tgt && id !== 'portal' && id !== 'all' && id !== 'notebook' && qqIsAiId_(id);
    }).slice(0, QQ_COLLAB_MAX);
    if (!ids.length) return [];
    const line = clip(qqCollabSegments_(text).join(' / ').replace(/\s+/g, ' ').trim(), 160);
    const out = [];
    ids.forEach(function (id, i) {
      const ms = nowMs + i + 1;
      const pl = { prompt: '[협업 요청 · 자동] ' + qqAgentName_(src) + '의 보고에서 협업이 필요하다고 했어요 — 「' + line + '」' +
          '\n원문: ' + row.id + '\n할 수 있으면 👀 반응 뒤 진행하고 이 말에 reply_to 로 결과를 남겨 주세요. 내 일이 아니면 🙅.',
        mode: 'ask', kind: 'chat', target: id, reply_to: String(row.id), collab: true };
      const pj = JSON.stringify(pl);
      const child = { id: qqMakeId_(ms), created_at: qqIso_(ms), source: src, type: 'claude_prompt', workspace: row.workspace,
        payload: pj, status: 'PENDING', attempts: 0, claimed_at: '', claimed_by: '', finished_at: '', duration_ms: '', exit_code: '',
        result: '', error: '', detail: '', risk_level: 'LOW', approval_expires_at: '', approval_by: '', approval_at: '',
        approval_note: '', approval_hash: qqHashPayload_(pj) };
      qqAppend_(ctx, child);
      out.push(child);
    });
    return out;
  } catch (err) { return []; }
}
/** 🌿 어사이드 한 줄 명령 중 외부에 흔적이 남는 작업을 비서가 시켰는가(상태 확인은 아니다) */
const QQ_ASIDE_CMD_RE = /^\s*🌿\s*어사이드\s+(\S+)\s*$/;
const QQ_ASIDE_SAFE = ['상태', '확인', '점검', 'status', 'health', '헬스'];
function qqAsideExternal_(type, payload, source) {
  if (type !== 'claude_prompt') return false;
  const p = qqParse_(payload);
  if (qqLow_(p.kind) !== 'chat' || qqLow_(p.target) !== 'notebook') return false;
  const m = QQ_ASIDE_CMD_RE.exec(String(p.prompt == null ? '' : p.prompt));
  if (!m) return false;
  if (QQ_ASIDE_SAFE.indexOf(String(m[1]).toLowerCase()) >= 0) return false;
  return qqLow_(source) !== 'portal';
}

// ═══════════════════════════════════════════════════════════════
// 🧹 묵은 대화 정리 — queue_sweep (2026-11-26, 사용자 "정리해줘")
//
//  쌓인 PENDING 대화를 안전한 두 갈래로만 닫는다. **기본은 미리보기**(apply:true 일 때만 쓴다).
//   ① answered — 받는 비서(target)가 이미 reply_to 로 답한 말 → DONE(결과칸 `↩ 답장 <id>`). 새 규칙(답장하면 원글 닫기)이 하던 일을 묵은 말에 한 번.
//   ② stale    — 대화인데 min_age_hours(기본 12, 6~168)가 넘도록 받는 비서가 **가져가서 접수(👀·🔧)한 적도 없는** 말 → EXPIRED(사유를 error 에).
//                실행 안 한 채 닫는 거라 DONE 이 아니라 EXPIRED 로 정직하게 남긴다. 필요하면 다시 보내면 된다.
//  건드리지 않는 것: 실행 오더(git_pull·렌더 등 비-chat) · @전체 · 노트북 앞 · 사람(포털) 앞 · 승인 대기 · 접수(👀·🔧)한 말.
//  apply 는 한 번에 최대 limit(기본 30)건 — 남으면 remaining 으로 알리니 한 번 더 부른다(30초 제한 방어). Audit_Log 에 한 줄.
// ═══════════════════════════════════════════════════════════════
const QQ_SWEEP_LIMIT = 30;
const QQ_SWEEP_SEEN_H = 72;                          // 접수(👀·🔧) 뒤 진행·답장 없음
const QQ_SWEEP_REVIEW_H = 72;                        // 보류 브랜치·결과 미확인 방치
const QQ_AUTOSWEEP_KEY = 'qq_autosweep_at';
const QQ_AUTOSWEEP_EVERY_MS = 6 * 3600000;           // 자동 정리는 6시간에 한 번
function queueSweep(body) {
  // 2026-11-27 — auto:true(포털이 6시간에 한 번) = 안전한 갈래만 바로 닫는다. 사람이 고르는 stale(미접수) 은 빼고.
  const auto = !!(body && (body.auto === true || String(body.auto) === 'true'));
  const apply = auto || !!(body && (body.apply === true || String(body.apply) === 'true'));
  const hours = Math.min(168, Math.max(6, Number(body && body.min_age_hours) || 12));
  const limit = Math.min(60, Math.max(1, Math.round(Number(body && body.limit) || QQ_SWEEP_LIMIT)));
  if (auto && !(body && body.force === true)) {
    try {
      const c = CacheService.getScriptCache();
      const last = Number(c.get(QQ_AUTOSWEEP_KEY) || 0);
      if (last && Date.now() - last < QQ_AUTOSWEEP_EVERY_MS) return { ok: true, auto: true, skipped: true, last_at: qqIso_(last) };
      c.put(QQ_AUTOSWEEP_KEY, String(Date.now()), 21600);
    } catch (e) { /* 캐시가 없으면 그냥 돈다 */ }
  }
  const run = function () {
    const ctx = qqOpen_();
    const rows = qqRows_(ctx, QQ_SCAN_ROWS);
    const rmap = qqReactRead_(ctx);
    const nowMs = Date.now();
    const firstReply = {};                              // 원글 id → {답한 비서: 그 답장의 id}
    rows.forEach(function (r) {
      const m = QQ_REPLY_JSON_RE.exec(String(r.payload == null ? '' : r.payload));
      if (!m) return;
      const by = qqLow_(r.source);
      const slot = firstReply[m[1]] || (firstReply[m[1]] = {});
      if (by && !slot[by]) slot[by] = String(r.id);
    });
    const plan = [];
    rows.forEach(function (r) {
      const st = String(r.status == null ? '' : r.status).trim().toUpperCase();
      const p = qqParse_(r.payload);
      const kind = qqLow_(p.kind);
      const t0 = qqRowTarget_(r);
      const claimedBy = qqLow_(r.claimed_by);
      const id = String(r.id);
      const ageH = (nowMs - (Date.parse(String(r.created_at || '')) || nowMs)) / 3600000;
      // ⓐ 보류 브랜치(REVIEW_NEEDED)·결과 미확인(TIMEOUT_REVIEW)이 3일 넘게 방치 — 기록만 닫는다(브랜치는 GitHub 에 남는다)
      if ((st === 'REVIEW_NEEDED' || st === 'TIMEOUT_REVIEW') && ageH >= QQ_SWEEP_REVIEW_H) {
        const answeredByClaimer = st === 'TIMEOUT_REVIEW' && kind === 'chat' && firstReply[id] && firstReply[id][claimedBy || t0];
        if (!answeredByClaimer) { plan.push({ row: r, kind: 'review', to: claimedBy || t0, branch: String(r.branch || '') }); return; }
      }
      if (st !== 'PENDING' && st !== 'TIMEOUT_REVIEW') return;
      if (kind !== 'chat') return;                       // 실행 오더는 안 건드린다
      // ⓑ @전체 공지(예전 줄) — 이제는 접수 순간 닫히지만, 그 전 것은 '전달됨'으로 닫는다
      if (t0 === 'all') { if (st === 'PENDING' && ageH >= 1) plan.push({ row: r, kind: 'broadcast', to: 'all' }); return; }
      if (!qqIsAiId_(t0) || t0 === 'notebook') return;  // 노트북·사람(포털) 앞은 안 건드린다
      if (claimedBy === 'notebook') return;
      const t = st === 'TIMEOUT_REVIEW' ? (claimedBy || t0) : t0;
      const rid = firstReply[id] && firstReply[id][t];
      if (rid) { plan.push({ row: r, kind: 'answered', to: t, reply: rid, was: st }); return; }
      if (st === 'TIMEOUT_REVIEW') return;
      // ⓒ 알림(notice)이 예전 배포에서 대기로 남은 것 — 전달됨으로
      if (p.notice === true) { plan.push({ row: r, kind: 'broadcast', to: t }); return; }
      const seen = (rmap[id] || []).some(function (x) { return x.by === t && (x.e === '👀' || x.e === '🔧'); });
      // ⓓ 접수(👀·🔧)하고 3일 넘게 진행·답장 없음
      if (seen) { if (ageH >= QQ_SWEEP_SEEN_H) plan.push({ row: r, kind: 'seen_stale', to: t }); return; }
      // ⓔ 미접수 묵은 말 — 사람이 직접 고를 때만(자동 모드에선 '안 읽는 비서'를 숨기지 않는다)
      if (!auto && ageH >= hours) plan.push({ row: r, kind: 'stale', to: t });
    });
    const count = { answered: 0, stale: 0, broadcast: 0, seen_stale: 0, review: 0 };
    const byAgent = {};
    plan.forEach(function (x) {
      count[x.kind]++;
      const a = byAgent[x.to] || (byAgent[x.to] = { answered: 0, stale: 0, broadcast: 0, seen_stale: 0, review: 0 });
      a[x.kind]++;
    });
    const batch = plan.slice(0, limit);
    const show = function (x) {
      return { id: String(x.row.id), kind: x.kind, to: x.to, from: qqLow_(x.row.source),
        age_h: Math.round(((nowMs - (Date.parse(String(x.row.created_at || '')) || nowMs)) / 3600000) * 10) / 10,
        text: clip(qqBriefText_(x.row), 70) };
    };
    const res = { ok: true, apply: apply, auto: auto, min_age_hours: hours, scanned: rows.length, plan: plan.length,
      answered: count.answered, stale: count.stale, broadcast: count.broadcast, seen_stale: count.seen_stale, review: count.review,
      by_agent: byAgent, version: SERVER_VERSION };
    if (!apply) {
      res.items = batch.map(show);
      res.note = '미리보기예요 — 아무것도 바꾸지 않았어요. 닫으려면 apply:true 로 다시 부르세요.';
      return res;
    }
    const nowIso = qqIso_(nowMs);
    const done = [];
    batch.forEach(function (x) {
      const r = x.row;
      if (x.kind === 'answered') {
        qqUpdateRow_(ctx, r.__row, { status: 'DONE', claimed_by: x.to, claimed_at: nowIso, finished_at: nowIso,
          duration_ms: 0, exit_code: 0, result: QQ_REPLY_CLOSE_MARK + x.reply,
          error: x.was === 'TIMEOUT_REVIEW' ? '' : r.error });
      } else if (x.kind === 'broadcast') {
        qqUpdateRow_(ctx, r.__row, { status: 'DONE', finished_at: nowIso, duration_ms: 0, exit_code: 0,
          result: String(r.result || '').trim() ? r.result : '📣 전달됨(공지·알림 — 답장 필요 없음)' });
      } else if (x.kind === 'seen_stale') {
        qqUpdateRow_(ctx, r.__row, { status: 'EXPIRED', finished_at: nowIso,
          error: '🧹 정리: 접수(👀) 뒤 ' + Math.round(QQ_SWEEP_SEEN_H / 24) + '일 넘게 진행·답장이 없어 닫았어요(필요하면 다시 보내 주세요).' });
      } else if (x.kind === 'review') {
        qqUpdateRow_(ctx, r.__row, { status: 'EXPIRED', finished_at: nowIso,
          error: '🧹 정리: ' + Math.round(QQ_SWEEP_REVIEW_H / 24) + '일 넘게 병합·확인되지 않아 기록을 닫았어요' +
            (x.branch ? ' — 브랜치 ' + x.branch + ' 는 GitHub 에 그대로 있어요(필요하면 병합).' : '.') });
      } else {
        qqUpdateRow_(ctx, r.__row, { status: 'EXPIRED', finished_at: nowIso,
          error: '🧹 정리: ' + hours + '시간 넘게 받는 비서가 접수하지 않아 닫았어요(필요하면 다시 보내 주세요).' });
      }
      done.push(show(x));
    });
    if (done.length) {
      const n = function (k) { return done.filter(function (d) { return d.kind === k; }).length; };
      qqAudit_(ctx, { id: 'sweep', type: 'sweep', workspace: '', risk: 'LOW', decision: auto ? 'autosweep' : 'sweep', by: 'api', channel: 'api',
        note: '정리 ' + done.length + '건 — 답장됨 ' + n('answered') + ' · 공지·알림 ' + n('broadcast') + ' · 접수 후 방치 ' + n('seen_stale') +
          ' · 보류 브랜치 ' + n('review') + ' · 미접수 ' + n('stale'), payloadHash: '', source: 'api' });
    }
    res.applied = done.length;
    res.remaining = plan.length - done.length;
    res.items = done;
    return res;
  };
  return apply ? qqLock_(run) : run();
}

/** 비서가 오더에 이모지로 반응한다. {action:'queue_react', key, as, id, emoji:'👀'|'🔧'|'✅'|'🙅'} */
function queueReact(body) {
  const as = qqActorOf_(body);
  const id = clip((body && body.id) || '', 60).trim();
  if (!id) throw qqErr_('bad_request', '오더 id 가 없어요.');
  let emoji = String((body && body.emoji) || '').replace(/️/g, '').trim();
  if (QQ_REACT_ALIAS[emoji.toLowerCase()]) emoji = QQ_REACT_ALIAS[emoji.toLowerCase()];
  if (QQ_REACT_EMOJI.indexOf(emoji) < 0) {
    throw qqErr_('bad_request', 'emoji 는 ' + QQ_REACT_EMOJI.join(' ') + ' 중 하나(또는 seen·working·done·na)여야 해요.');
  }
  qqCheckMark_(as);
  return qqLock_(function () {
    const ctx = qqOpen_();
    const r = qqFindRow_(ctx, id);
    if (!r) throw qqErr_('not_found', '그 오더를 찾지 못했어요(오래된 기록은 정리될 수 있어요).');
    const st = String(r.status == null ? '' : r.status).trim().toUpperCase();
    const tgt = qqRowTarget_(r);
    const claimed = qqLow_(r.claimed_by);
    const nowMs = Date.now();
    const map = qqReactRead_(ctx);
    const had = (map[id] || []).some(function (x) { return x.by === as && x.e === emoji; });
    const add = [];
    if (!had) add.push([qqIso_(nowMs), id, as, emoji]);
    let effect = '', status = st;
    const owner = st === 'RUNNING' && claimed ? claimed : tgt;
    const mine = owner === as && tgt !== 'notebook' && claimed !== 'notebook' && as !== 'notebook';
    // 🔧 은 **반응만** 남긴다(2026-11-27). 예전엔 RUNNING 으로 집었는데, 노트북 워커(CommandQueue.gs)가
    //  20분 넘게 신호(beat)가 없는 RUNNING 을 '응답 없음 → TIMEOUT_REVIEW' 로 격리해 버렸다(뷔투 2건 실측).
    //  집어서 표시하고 싶으면 queue_claim 을 쓰되 오래 걸리면 쓰지 않는다.
    if ((emoji === '✅' || emoji === '🙅') && (st === 'PENDING' || st === 'RUNNING' || st === 'TIMEOUT_REVIEW') && mine) {
      const started = Date.parse(String(r.claimed_at || '')) || 0;
      const hasResult = !!String(r.result == null ? '' : r.result).trim();
      qqUpdateRow_(ctx, r.__row, {
        status: 'DONE', claimed_by: as, claimed_at: claimed ? r.claimed_at : qqIso_(nowMs), finished_at: qqIso_(nowMs),
        duration_ms: started ? Math.max(0, nowMs - started) : 0, exit_code: 0,
        result: hasResult ? r.result : emoji + (emoji === '✅' ? ' 완료' : ' 내 일 아님')
      });
      effect = 'closed'; status = 'DONE';
    }
    if (add.length) qqReactAppend_(ctx, add);
    return { ok: true, id: id, emoji: emoji, as: as, added: !had, effect: effect, status: status, at: qqIso_(nowMs),
      hint: '내용 없는 확인 답장 대신 이 반응을 쓰세요 — 👀 접수 · 🔧 진행 중 · ✅ 완료 · 🙅 내 일 아님.' };
  });
}

// ═══════════════════════════════════════════════════════════════
// 📋 오늘 브리핑 — queue_brief (2026-11-26, 사용자 "얘네가 뭐 하고 있는지 모르겠어")
//
//  최근 400행을 **한 번** 훑어 비서마다:
//   · 받은 일 — 안 읽음(unread: 주인이 답도 안 함) · 답만 하고 안 닫음(replied_open) · 실행 중(running)
//   · 가장 오래 안 읽은 말(누가·언제·무슨 말)
//   · 오늘 처리(원글 기준: 끝냈거나 답장한 말 — 같은 말은 한 번만) · 오늘 보낸 말 · 그중 '확인했어요'류 · 오늘 실패
//   · 마지막 활동(보낸 말 또는 끝낸 일)과 그 한 줄
//  payload 는 필요한 몇 줄(마지막 말·가장 오래된 말·오늘 보낸 말의 확인 여부)만 푼다 — 400행 전부를 qqItem_ 로 만들지 않는다.
//  읽기 전용 · GET 으로도 열린다(비서가 자기 밀린 일을 볼 때도 쓴다).
// ═══════════════════════════════════════════════════════════════
const QQ_BRIEF_ORDER = ['pi1', 'pi2', 'cue', 'cue2', 'vooy', 'vooy2', 'keyring', 'keyring2', 'notebook'];
const QQ_BRIEF_TEXT = 160;
// 내용 없이 '받았다'만 말하는 답장 — 오늘 보낸 말 중 몇 개가 이런지 센다(회의실 소음 지표).
const QQ_ACK_RE = /^(?:@\S+\s*)*(?:네[,.!\s]|넵|확인했어요|확인했습니다|확인 완료|수신 완료|알겠습니다|알겠어요|접수했어요|접수했습니다|접수 완료|잘 받았|받았어요|받았습니다)/;
const QQ_ACK_MAX = 120;
function qqKstDay_(ms) { return new Date(ms + 9 * 3600000).toISOString().slice(0, 10); }
function qqLow_(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
/** 한 줄 요약(가림 + 160자) — 브리핑에만 쓴다. 회의실 말풍선은 qqSummary_ 그대로 자르지 않는다. */
function qqBriefText_(r) {
  const p = qqParse_(r.payload);
  const type = String(r.type == null ? '' : r.type).trim();
  const s = type === 'claude_prompt' ? qqStripWorkerNote_(p.prompt) : qqSummary_(type, p);
  return qqMask_(String(s || '').replace(/\s+/g, ' ').trim(), QQ_BRIEF_TEXT);
}
function qqIsAck_(r) {
  const p = qqParse_(r.payload);
  const s = String(p.prompt == null ? '' : p.prompt).replace(/\s+/g, ' ').trim();
  return !!s && s.length <= QQ_ACK_MAX && QQ_ACK_RE.test(s);
}
function queueBrief(body) {
  const ctx = qqOpen_();
  const rows = qqRows_(ctx, QQ_SCAN_ROWS);               // 오래된 것 → 새것
  const rmap = qqReactRead_(ctx);                        // 👀 이모지 반응 — 전달됨/접수를 가르는 근거
  const nowMs = Date.now();
  const today = qqKstDay_(nowMs);
  const dayOf = function (v) { const t = Date.parse(String(v == null ? '' : v)); return isFinite(t) ? qqKstDay_(t) : ''; };
  const msOf = function (v) { const t = Date.parse(String(v == null ? '' : v)); return isFinite(t) ? t : 0; };

  // 1) 한 줄씩 싸게 — target·reply_to·kind 는 payload 문자열에서 정규식으로만
  const replies = {};                                   // 원글 id → {답한 비서: true}
  const meta = rows.map(function (r) {
    const raw = String(r.payload == null ? '' : r.payload);
    const m = QQ_REPLY_JSON_RE.exec(raw);
    const o = { r: r, id: String(r.id), src: qqLow_(r.source), st: String(r.status == null ? '' : r.status).trim().toUpperCase(),
      tgt: qqRowTarget_(r), by: qqLow_(r.claimed_by), reply: m ? String(m[1]) : '',
      cday: dayOf(r.created_at), fday: dayOf(r.finished_at) };
    if (o.reply && o.src) (replies[o.reply] = replies[o.reply] || {})[o.src] = true;
    return o;
  });

  // 2) 비서 목록 — 정해진 9명 순서 + 명부에 더 있는 비서 + 큐에서 말한 비서
  const ids = QQ_BRIEF_ORDER.slice();
  const names = {};
  const add = function (id) {
    id = qqLow_(id);
    if (qqIsAiId_(id) && QQ_SRC_ALIAS.indexOf(id) < 0 && ids.indexOf(id) < 0) ids.push(id);
  };
  try { agentRoster_().forEach(function (a) { names[a.id] = a.name; add(a.id); }); } catch (err) { /* 명부 없이도 된다 */ }
  meta.forEach(function (o) { add(o.src); });
  const A = {};
  ids.forEach(function (id) {
    A[id] = { id: id, name: names[id] || '', unread: 0, replied_open: 0, running: 0, oldest: null,
      undelivered: 0, delivered: 0, seen: 0, lat: [], oldestU: null,
      handled: {}, sent_today: 0, acks_today: 0, failed_today: 0, last: null, lastMs: 0, lastKind: '' };
  });

  const tot = { unread: 0, replied_open: 0, running: 0, all_open: 0, waiting: 0, review: 0, failed_today: 0, to_me_today: 0,
    undelivered: 0, delivered: 0, seen: 0 };
  meta.forEach(function (o) {
    // 받은 일 — PENDING 은 대상(target), RUNNING 은 집은 비서가 주인
    if (o.st === 'PENDING' || o.st === 'RUNNING') {
      const owner = o.st === 'RUNNING' && o.by ? o.by : o.tgt;
      const a = A[owner];
      if (owner === 'all') tot.all_open++;
      else if (a) {
        if (replies[o.id] && replies[o.id][owner]) a.replied_open++;
        else if (o.st === 'RUNNING') a.running++;
        else {
          a.unread++; if (!a.oldest) a.oldest = o;           // 오래된 것부터 돌므로 첫 줄이 가장 오래된 말
          // 안 읽음을 셋으로 가른다 — 아무 반응 없음(미전달) / 가져가기만 함 ✓(전달됨) / 👀·🔧(접수)
          const mine = (rmap[o.id] || []).filter(function (x) { return x.by === owner; });
          if (mine.some(function (x) { return x.e === '👀' || x.e === '🔧'; })) a.seen++;
          else if (mine.length) a.delivered++;
          else { a.undelivered++; if (!a.oldestU) a.oldestU = o; }    // 가장 오래 미전달된 말 — 빨강 판정의 근거
        }
      }
    }
    if (o.st === 'WAITING_APPROVAL') tot.waiting++;
    if (o.st === 'REVIEW_NEEDED' || o.st === 'TIMEOUT_REVIEW') tot.review++;
    // 오늘 처리 — 끝낸 비서(claimed_by)의 원글. 자기가 보낸 말을 자기가 닫은 건 세지 않는다.
    if (o.st === 'DONE' && o.by && A[o.by] && o.fday === today && o.src !== o.by) A[o.by].handled[o.id] = true;
    // 접수까지 걸린 시간 — 오늘 내 앞으로 온 말에 내가 처음 남긴 반응(✓·👀·🔧·✅·🙅)의 시각 − 받은 시각
    if (o.cday === today && A[o.tgt] && rmap[o.id]) {
      let first = 0;
      rmap[o.id].forEach(function (x) { if (x.by === o.tgt) { const t = msOf(x.at); if (t && (!first || t < first)) first = t; } });
      const born = msOf(o.r.created_at);
      if (first && born && first >= born) A[o.tgt].lat.push(Math.round((first - born) / 60000));
    }
    // 오늘 처리 — 오늘 단 답장(원글 기준, 같은 원글은 한 번)
    if (o.reply && A[o.src] && o.cday === today) A[o.src].handled[o.reply] = true;
    // 오늘 실패
    if (o.st === 'FAILED' && o.fday === today) {
      const f = A[o.by || o.tgt];
      if (f) f.failed_today++;
      tot.failed_today++;
    }
    // 오늘 보낸 말 · 확인만 한 말
    if (A[o.src] && o.cday === today) {
      A[o.src].sent_today++;
      if (qqIsAck_(o.r)) A[o.src].acks_today++;
    }
    if (o.tgt === 'portal' && o.src && o.src !== 'portal' && o.cday === today) tot.to_me_today++;
    // 마지막 활동 — 보낸 말 또는 끝낸 일
    const sentMs = A[o.src] ? msOf(o.r.created_at) : 0;
    if (sentMs && sentMs >= A[o.src].lastMs) { A[o.src].lastMs = sentMs; A[o.src].last = o; A[o.src].lastKind = 'sent'; }
    const doneMs = o.by && A[o.by] && o.by !== o.src ? msOf(o.r.finished_at) : 0;
    if (doneMs && doneMs > A[o.by].lastMs) { A[o.by].lastMs = doneMs; A[o.by].last = o; A[o.by].lastKind = 'done'; }
  });

  const agents = ids.map(function (id) {
    const a = A[id];
    const handled = Object.keys(a.handled).length;
    const busy = a.unread || a.replied_open || a.running || handled || a.sent_today || a.failed_today || a.last;
    if (!busy && QQ_BRIEF_ORDER.indexOf(id) < 0) return null;   // 명부에만 있고 아무 기록 없는 비서는 뺀다
    tot.unread += a.unread; tot.replied_open += a.replied_open; tot.running += a.running;
    tot.undelivered += a.undelivered; tot.delivered += a.delivered; tot.seen += a.seen;
    // 접수까지 걸린 시간(오늘 온 말의 첫 반응 − 받은 시각) 중간값(분) — 근거 없으면 null(지어내지 않는다)
    const lat = a.lat.slice().sort(function (x, y) { return x - y; });
    const old = a.oldest;
    const last = a.last;
    return {
      id: id, name: a.name, unread: a.unread, replied_open: a.replied_open, running: a.running,
      undelivered: a.undelivered, delivered: a.delivered, seen: a.seen,
      oldest_undelivered: a.oldestU ? { id: a.oldestU.id, at: clip(a.oldestU.r.created_at, 40), from: a.oldestU.src, text: qqBriefText_(a.oldestU.r) } : null,
      pickup_med_min: lat.length ? lat[lat.length >> 1] : null, pickup_n: lat.length,
      handled_today: handled, sent_today: a.sent_today, acks_today: a.acks_today, failed_today: a.failed_today,
      oldest_unread: old ? { id: old.id, at: clip(old.r.created_at, 40), from: old.src, text: qqBriefText_(old.r) } : null,
      last: last ? {
        id: last.id, kind: a.lastKind, at: clip(a.lastKind === 'done' ? last.r.finished_at : last.r.created_at, 40),
        to: a.lastKind === 'sent' ? last.tgt : last.src,
        text: a.lastKind === 'done' && String(last.r.result == null ? '' : last.r.result).trim()
          ? qqMask_(String(last.r.result).replace(/\s+/g, ' ').trim(), QQ_BRIEF_TEXT)
          : qqBriefText_(last.r)
      } : null
    };
  }).filter(function (x) { return !!x; });
  tot.handled_today = agents.reduce(function (s, a) { return s + a.handled_today; }, 0);
  // 깨우는 방식 — 웹훅이 있으면 즉시, 노트북은 워커, 나머지는 스스로 주기 확인(키링·부이 계열).
  //  주소는 절대 내보내지 않고 id 가 등록돼 있는지만 본다.
  let hooks = {};
  try { hooks = qqWebhookMap_(); } catch (err) { hooks = {}; }
  const checks = qqCheckLogAll_();
  agents.forEach(function (a) {
    a.wake = a.id === 'notebook' ? 'worker' : (hooks[a.id] ? 'webhook' : 'poll');
    a.last_check_at = clip(checks[a.id] || '', 40);
  });

  return { ok: true, at: qqNow_(), day: today, version: SERVER_VERSION, scanned: rows.length,
    from: rows.length ? clip(rows[0].created_at, 40) : '', agents: agents, totals: tot };
}

function queueEnqueue(body) {
  const type = String((body && body.type) || '').trim();
  const spec = QQ_TYPES[type];
  if (!spec) throw qqErr_('type', '이 오더함에서는 보낼 수 없는 오더예요.');
  let workspace = String((body && body.workspace) || '').trim();
  // 2026-11-27 — 승인 요청(kind:'approval')은 실행할 곳이 없다. 작업 위치를 안 줘도 기본 위치로 받는다.
  const bodyKind = String((body && ((isObj(body.payload) && body.payload.kind) || body.kind)) || '').trim().toLowerCase();
  if (!workspace && bodyKind === 'approval') workspace = qqWorkspaces_()[0] || '';
  if (spec.needsWorkspace && !workspace) throw qqErr_('workspace', '작업 위치를 골라주세요.');
  if (workspace) qqCheckWorkspace_(workspace);
  else workspace = '';
  const envelope = qqEnvelopeOf_(body);
  const payload = qqWithWorkerNote_(type, qqPayloadOf_(type, envelope));
  if (payload.length > QQ_MAX_PAYLOAD) throw qqErr_('too_long', '오더 내용이 너무 길어요.');

  // 2026-11-27 — 🌿 어사이드 외부 작업(무신사·카카오·퀴즈·네이버·알리 — 사용자 계정으로 외부에 흔적)은
  //  사람(포털)이 아닌 비서가 시키면 레이 님 승인(WAITING_APPROVAL)을 거친다. 상태 확인(status)은 그대로.
  const asideExternal = qqAsideExternal_(type, payload, qqSourceFor_(body, null));
  const risk = (type === 'content_render' || asideExternal || (type === 'claude_prompt' && qqModeOf_(payload) === 'edit')) ? 'HIGH' : 'LOW';
  const verdict = (risk === 'HIGH' && !asideExternal) ? qqAutoDelegation_(type, qqParse_(payload), workspace) : { auto: false, reason: '' };
  const autoBy = risk === 'HIGH' && verdict.auto ? 'auto' : '';
  const needsApproval = risk === 'HIGH' && !verdict.auto;
  const nowMs = Date.now();
  const ttlMin = Math.round(QQ_APPROVAL_TTL_MS / 60000);
  // 사람(포털) 앞으로 온 대화는 아무도 실행하지 않는다 — 접수 순간에 전달 완료로 닫는다(2026-11-25).
  const delivered = qqDeliveredOnly_(type, payload);

  let posted = null;   // 락 밖에서 웹훅을 쏘려고 잡아 두는 줄(락을 네트워크로 잡지 않는다)
  let collabRows = []; // 협업 요청으로 새로 만든 줄(같이 깨운다)
  const res = qqLock_(function () {
    const ctx = qqOpen_();
    if (!spec.idempotent) {
      const dupe = qqFindInflight_(ctx, type, workspace, payload, nowMs);
      if (dupe) {
        return {
          ok: true, duplicate: true, item: qqItem_(dupe),
          note: '같은 오더가 아직 ' + String(dupe.status || '') + ' 상태예요. 새로 넣지 않았어요.'
        };
      }
    }
    const row = {
      // source = 누가 낸 오더인가(portal·pi1·pi2·vooy·cue …). 모르는 모양이면 portal.
      // 2026-11-26 — 어떤 비서는 최상위 source 대신 payload.source 에만 발신자를 넣는다(그러면 남의 말이
      //  '내 말(portal)'로 찍혀 오른쪽 파란 말풍선이 됐다). 세 자리를 이 순서로 본다: source → client_id → payload.source.
      id: qqMakeId_(nowMs), created_at: qqIso_(nowMs), source: qqSourceFor_(body, ctx), type: type, workspace: workspace,
      payload: payload, status: delivered ? 'DONE' : (needsApproval ? 'WAITING_APPROVAL' : 'PENDING'), attempts: 0,
      claimed_at: '', claimed_by: '', finished_at: delivered ? qqIso_(nowMs) : '', duration_ms: delivered ? 0 : '', exit_code: '', result: '', error: '', detail: '',
      risk_level: risk, approval_expires_at: needsApproval ? qqIso_(nowMs + QQ_APPROVAL_TTL_MS) : '',
      approval_by: autoBy, approval_at: autoBy ? qqIso_(nowMs) : '',
      approval_note: autoBy ? verdict.reason : '', approval_hash: qqHashPayload_(payload)
    };
    qqAppend_(ctx, row);
    posted = row;
    // 2026-11-27 — 보고서의 '협업 필요: ○○' 를 ○○ 의 할 일로 만든다(실측: 지목 25건 중 이어받은 게 7건뿐이었다).
    const ppC = qqParse_(payload);
    if (type === 'claude_prompt' && qqLow_(ppC.kind) === 'chat' && !ppC.collab && !ppC.notice) collabRows = qqCollabTasks_(ctx, row, ppC, nowMs);
    // 2026-11-26 — 답장(reply_to)을 단 비서가 그 원글의 주인이면 원글을 닫는다.
    //  실측: 큐·피투·뷔투 앞 PENDING 의 절반이 '답장은 했는데 queue_done 을 안 찍은' 줄이었다(대기 45건 부풀림).
    const closed = qqCloseOnReply_(ctx, row, qqParse_(payload), nowMs);
    return {
      ok: true, duplicate: false, item: qqItem_(row), closed: closed,
      note: delivered
        ? '전달했어요 — 포털(사람) 앞 메시지라 실행 없이 바로 읽혀요.'
        : needsApproval
        ? (type === 'content_render' ? '영상 렌더 오더예요 — ' : '파일을 고치는 오더예요 — ') + ttlMin + '분 안에 승인해야 노트북이 실행해요.'
        : (autoBy
          ? '자동 승인(위임) — 승인 없이 바로 실행 대기열에 들어갔어요.'
          : '접수했어요. 노트북이 다음 확인 때 실행해요.')
    };
  });
  // 접수에 성공했을 때만 — 기다리는 외부 비서(큐·큐투 …)를 깨운다. 실패는 접수에 영향 없다.
  const collabIds = collabRows.map(function (c) { return qqParse_(c.payload).target; });
  if (posted) qqFireWebhooks_(posted, qqParse_(posted.payload), collabIds);
  collabRows.forEach(function (c) { qqFireWebhooks_(c, qqParse_(c.payload)); });
  if (res && res.ok && collabRows.length) res.collab = collabRows.map(function (c) { return { id: c.id, to: qqParse_(c.payload).target }; });
  // 2026-11-26 — 오더를 낸 화면·비서도 "끝나면 보고를 남기라"는 규칙을 응답에서 바로 본다.
  if (res && res.ok) res.report_rule = QQ_REPORT_RULE;
  return res;
}

/** 승인(approve → PENDING) / 거절(reject → REJECTED). 둘 다 Audit_Log 에 남긴다. */
function queueDecide(body) {
  const id = clip((body && body.id) || '', 60).trim();
  if (!id) throw qqErr_('bad_request', '오더 id 가 없어요.');
  let decision = String((body && body.decision) || '').toLowerCase();
  if (decision === 'deny' || decision === 'no') decision = 'reject';
  if (decision !== 'approve' && decision !== 'reject') {
    throw qqErr_('bad_request', '승인(approve) 또는 거절(reject)만 할 수 있어요.');
  }
  const note = clip((body && body.note) || '', 300);
  const givenHash = clip((body && body.payload_hash) || '', 80).trim();
  const ttlMin = Math.round(QQ_APPROVAL_TTL_MS / 60000);

  return qqLock_(function () {
    const ctx = qqOpen_();
    const r = qqFindRow_(ctx, id);
    if (!r) throw qqErr_('not_found', '그 오더를 찾지 못했어요(오래된 기록은 정리될 수 있어요).');
    const st = String(r.status == null ? '' : r.status).trim().toUpperCase();
    const hash = qqHashPayload_(r.payload);

    if (st === 'PENDING' || st === 'RUNNING') {
      return { ok: true, id: id, decision: decision, changed: false, status: st, note: '이미 승인되어 진행 중이에요.' };
    }
    if (st !== 'WAITING_APPROVAL') {
      throw qqErr_('not_waiting', '승인 대기 상태가 아니에요(' + (st || '상태 없음') + ').');
    }
    const nowMs = Date.now();
    const expMs = Date.parse(String(r.approval_expires_at || ''));
    if (isFinite(expMs) && nowMs > expMs) {
      qqUpdateRow_(ctx, r.__row, {
        status: 'EXPIRED', finished_at: qqIso_(nowMs),
        error: '승인 시간(' + ttlMin + '분)이 지나 실행하지 않았어요.'
      });
      qqAudit_(ctx, { id: id, type: r.type, workspace: r.workspace, risk: r.risk_level,
        decision: 'expired', by: 'system', channel: 'portal', note: note || '기한 만료', payloadHash: hash, source: r.source });
      throw qqErr_('expired', '승인 시간(' + ttlMin + '분)이 지나 실행하지 않았어요. 필요하면 새로 넣어주세요.');
    }
    if (givenHash && hash !== givenHash) {
      qqAudit_(ctx, { id: id, type: r.type, workspace: r.workspace, risk: r.risk_level,
        decision: 'mismatch', by: 'portal', channel: 'portal', note: '해시 불일치', payloadHash: hash, source: r.source });
      throw qqErr_('hash_mismatch', '승인하려는 내용이 큐의 오더와 달라요. 새로고침 뒤 다시 시도해주세요.');
    }

    const now = qqIso_(nowMs);
    if (decision === 'approve') {
      qqUpdateRow_(ctx, r.__row, {
        status: 'PENDING', approval_by: 'portal', approval_at: now, approval_note: note,
        claimed_at: '', claimed_by: '', error: ''
      });
    } else {
      qqUpdateRow_(ctx, r.__row, {
        status: 'REJECTED', finished_at: now, approval_by: 'portal', approval_at: now,
        approval_note: note, error: '승인 거절' + (note ? ': ' + note : '')
      });
    }
    qqAudit_(ctx, { id: id, type: r.type, workspace: r.workspace, risk: r.risk_level,
      decision: decision, by: 'portal', channel: 'portal', note: note, payloadHash: hash, source: r.source });
    return {
      ok: true, id: id, decision: decision, changed: true,
      status: decision === 'approve' ? 'PENDING' : 'REJECTED', at: now, audit: true
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// 🤖 외부 비서의 오더 집기·결과 쓰기 — queue_claim · queue_done (2026-11-25 v27)
//
//  키링·큐·부이·피원·피투처럼 **늘 떠 있지 않은** 비서가 같은 오더를 두 번 처리하지 않게,
//  자기 앞으로 온 PENDING 한 건을 「집고(RUNNING)」 → 「끝냈다(DONE/FAILED)」고 남긴다.
//
//  · 인증은 다른 쓰기와 같은 비밀 키(POST 본문 key). GET 으로는 절대 안 된다.
//  · 자기 앞으로 온 것(target=나 또는 all)만 집는다. 노트북 앞(무 target) 오더는 안 집는다.
//  · 승인 대기(WAITING_APPROVAL)는 집지 않는다 — 사람이 승인해야 실행된다.
//  · 결과는 가리고(qqMask_) 자르지 않는다 — 시트 셀 한도까지만. 다른 비서가 집은 오더의 결과는 덮지 않는다.
//  · 잠금은 포털 스크립트 잠금 — 노트북 워커(CommandQueue.gs)와는 별개라 충돌할 수 있다.
//    그래서 claim 은 쓰기 직전에 다시 읽어 PENDING 인지 확인하고, 이미 RUNNING 이면 changed:false 로 돌려준다.
// ═══════════════════════════════════════════════════════════════
function qqActorOf_(body) {
  const as = String((body && (body.as || body.by || body.source)) || '').trim().toLowerCase();
  if (!QQ_AGENT_ID_RE.test(as) || as === 'portal') {
    throw qqErr_('bad_request', 'as 에 내 비서 id 를 넣어주세요(영소문자·숫자·_·- 12자, portal 제외).');
  }
  return as;
}

/** 내 앞으로 온 PENDING 한 건을 집는다. {action:'queue_claim', key, as:'keyring', id?} */
function queueClaim(body) {
  const as = qqActorOf_(body);
  qqCheckMark_(as);
  const wantId = clip((body && body.id) || '', 60).trim();
  return qqLock_(function () {
    const ctx = qqOpen_();
    const rows = qqRows_(ctx, QQ_SCAN_ROWS);
    let pick = null;
    for (let i = 0; i < rows.length; i++) {
      const st = String(rows[i].status == null ? '' : rows[i].status).trim().toUpperCase();
      if (wantId) {
        if (String(rows[i].id) !== wantId) continue;
        const t = qqRowTarget_(rows[i]);
        if (t !== as && t !== 'all') throw qqErr_('not_mine', '내 앞으로 온 오더가 아니에요(target=' + (t || 'notebook') + ').');
        if (st !== 'PENDING') {
          return { ok: true, changed: false, id: wantId, status: st || 'unknown',
            reason: st === 'RUNNING' ? '이미 누가 집었어요(claimed_by=' + clip(rows[i].claimed_by, 20) + ').' : 'PENDING 오더가 아니에요.' };
        }
        pick = rows[i]; break;
      }
      if (st !== 'PENDING') continue;
      const t = qqRowTarget_(rows[i]);
      if (t !== as && t !== 'all') continue;
      pick = rows[i]; break;
    }
    if (!pick) return { ok: true, changed: false, id: '', status: '', reason: '내 앞으로 온 PENDING 오더가 없어요.' };
    const now = qqNow_();
    const attempts = Number(pick.attempts || 0) + 1;
    qqUpdateRow_(ctx, pick.__row, { status: 'RUNNING', claimed_at: now, claimed_by: as, attempts: attempts });
    try { qqReactAppend_(ctx, [[now, String(pick.id), as, '🔧']]); } catch (err) { /* 반응은 보조 */ }   // 집었으면 '진행 중' 반응도
    const row = qqFindRow_(ctx, String(pick.id)) || pick;
    // 2026-11-26 — 오더를 집은 비서에게 "끝나면 회의실에 보고를 남겨라"를 같은 응답에 실어 준다.
    return { ok: true, changed: true, at: now, claimed_by: as, item: qqItem_(row), report_rule: QQ_REPORT_RULE };
  });
}

/** 집어 간 오더의 결과를 남긴다. {action:'queue_done', key, as, id, status:'DONE'|'FAILED', result?, error?, duration_ms?} */
function queueDone(body) {
  const as = qqActorOf_(body);
  const id = clip((body && body.id) || '', 60).trim();
  if (!id) throw qqErr_('bad_request', '오더 id 가 없어요.');
  const status = String((body && body.status) || 'DONE').trim().toUpperCase();
  if (status !== 'DONE' && status !== 'FAILED') throw qqErr_('bad_request', 'status 는 DONE 또는 FAILED 여야 해요.');
  // 2026-11-26 — 답장 본문을 500자에서 자르면 대화가 문장 중간에 끊긴다. 시트 셀 한도까지만.
  const result = qqMask_(String((body && body.result) || ''), QQ_CELL_MAX);
  const error = qqMask_(String((body && (body.error || (status === 'FAILED' ? body.result : ''))) || ''), QQ_CELL_MAX);
  const dur = Number((body && body.duration_ms));
  return qqLock_(function () {
    const ctx = qqOpen_();
    const r = qqFindRow_(ctx, id);
    if (!r) throw qqErr_('not_found', '그 오더를 찾지 못했어요.');
    const st = String(r.status == null ? '' : r.status).trim().toUpperCase();
    if (st === 'WAITING_APPROVAL') throw qqErr_('not_approved', '승인 대기 오더예요 — 사람이 승인해야 끝낼 수 있어요.');
    const by = String(r.claimed_by == null ? '' : r.claimed_by).trim().toLowerCase();
    if (by && by !== as) throw qqErr_('not_mine', '다른 비서가 집은 오더예요(claimed_by=' + clip(by, 20) + ').');
    // 답장으로 자동 닫힌 줄(qqCloseOnReply_)에 나중에 결과를 적으면 그 결과로 바꿔 준다 — 결과를 잃지 않게.
    if (st === 'DONE' && by === as && status === 'DONE' && String(result || '').trim() &&
        String(r.result == null ? '' : r.result).indexOf(QQ_REPLY_CLOSE_MARK) === 0) {
      qqUpdateRow_(ctx, r.__row, { result: result });
      const row2 = qqFindRow_(ctx, id) || r;
      return { ok: true, changed: true, id: id, status: 'DONE', at: qqNow_(), item: qqItem_(row2),
        needs_report: false, report_rule: QQ_REPORT_RULE, hint: '', note: '답장으로 닫힌 오더에 결과를 덧붙였어요.' };
    }
    if (st === 'DONE' || st === 'FAILED' || st === 'REJECTED' || st === 'EXPIRED') {
      return { ok: true, changed: false, id: id, status: st, reason: '이미 끝난 오더예요.' };
    }
    const nowMs = Date.now();
    const started = Date.parse(String(r.claimed_at || r.started_at || '')) || 0;
    const duration = Number.isFinite(dur) && dur >= 0 ? Math.round(dur) : (started ? Math.max(0, nowMs - started) : '');
    qqUpdateRow_(ctx, r.__row, {
      status: status, claimed_by: by || as, finished_at: qqIso_(nowMs), duration_ms: duration,
      result: status === 'DONE' ? result : '', error: status === 'DONE' ? error : (error || '실패'),
      exit_code: status === 'DONE' ? 0 : 1
    });
    const row = qqFindRow_(ctx, id) || r;
    const empty = status === 'DONE' && !String(result || '').trim();
    // 2026-11-26 — 결과가 비었으면 「보고 누락」이 된다. 응답에서 바로 알려 줘서 비서가 한 줄이라도 남기게 한다.
    return { ok: true, changed: true, id: id, status: status, at: qqIso_(nowMs), item: qqItem_(row),
      needs_report: empty, report_rule: QQ_REPORT_RULE,
      hint: empty ? '결과가 비어 있어요 — 회의실에 한 줄 보고를 남겨 주세요(화면에 「보고누락」으로 보입니다).' : '' };
  });
}

// ═══════════════════════════════════════════════════════════════
// ⌨️ 기기 상태 비트(agent_beat) — 노트북 직접작업(free) · 회사 PC
//
//  {action:'agent_beat', key, target:'direct'|'pc', state:'working'|'idle',
//   project, task, source:'manual'|'commit', stale_min}
//  → Drive 김성래포털/포털_agent_직접.json · 포털_agent_pc.json 에
//     지금 상태 + 최근 8건 이력을 남긴다.
//  포털 관제의 '⌨️ 노트북·직접' · '💻 회사 PC' 카드와 agent_status 의 direct·pc 가 이 파일을 읽는다.
//
//  · target 이 없으면 direct — 예전 $PROFILE free 함수와 그대로 호환된다.
//  · stale_min = '이만큼 조용하면 미확인' 기준(5~240분). 회사 PC 의 커밋 알림은 120분을 보낸다
//    (커밋 간격은 30분~2시간이라 25분으로 두면 작업 중에도 계속 '미확인'이 뜬다).
//  · 이 파일에는 비밀도, 사람 이름·전화번호도 남기지 않는다(작업명은 qqMask_ 로 가림).
// ═══════════════════════════════════════════════════════════════
const AB_TARGETS = ['direct', 'pc', 'pi1', 'pi2'];
// 피원(pi1)·피투(pi2)는 저장소 파일(status/…)을 못 쓸 때 agent_beat 로 "지금 작업"만 남길 수 있다.
const AB_FILE = { direct: '포털_agent_직접.json', pc: '포털_agent_pc.json', pi1: '포털_agent_pi1.json', pi2: '포털_agent_pi2.json' };
const AD_FILE = AB_FILE.direct;              // 예전 이름 그대로(다른 곳에서 씀)
const AB_STALE_DEFAULT = 30, AB_STALE_LOW = 5, AB_STALE_HIGH = 240;
const AB_KEEP = 8;                           // 보관하는 이력 줄 수

/** 'direct' | 'pc' — 모르는 값은 예전 그대로 direct */
function abTarget_(v) {
  const t = String(v == null ? '' : v).toLowerCase();
  return AB_TARGETS.indexOf(t) >= 0 ? t : 'direct';
}
/** 조용하면 '미확인'으로 볼 기준(분) — 5~240 으로 자르고, 없으면 30 */
function abStale_(v) {
  const n = Math.round(Number(v));
  if (!isFinite(n) || n <= 0) return AB_STALE_DEFAULT;
  return Math.min(AB_STALE_HIGH, Math.max(AB_STALE_LOW, n));
}
function agentBeat_(body) {
  const b = isObj(body) ? body : {};
  const target = abTarget_(b.target);
  const st = String(b.state || '').toLowerCase() === 'idle' ? 'idle' : 'working';
  const staleMin = abStale_(b.stale_min);
  const source = String(b.source || '').toLowerCase() === 'commit' ? 'commit' : 'manual';
  const logInfo = qqLock_(function () {
    const fo = DriveApp.getFoldersByName(PORTAL_FOLDER);
    const folder = fo.hasNext() ? fo.next() : DriveApp.createFolder(PORTAL_FOLDER);
    const name = AB_FILE[target];
    const it = folder.getFilesByName(name);
    const f = it.hasNext() ? it.next() : null;
    let d = null;
    if (f) { try { d = JSON.parse(f.getBlob().getDataAsString()); } catch (_) { d = null; } }
    if (!isObj(d)) d = { version: 1, agent: null, history: [] };
    if (!Array.isArray(d.history)) d.history = [];
    const now = new Date().toISOString();
    const prev = isObj(d.agent) ? d.agent : {};
    let logEvt = null;
    if (st === 'idle') {
      const s0 = Date.parse(String(prev.started_at || ''));
      const durMin = isFinite(s0) ? Math.max(0, Math.round((Date.now() - s0) / 60000)) : 0;
      d.history.unshift({
        project: clip(prev.project, 24), started_at: clip(prev.started_at, 40), ended_at: now,
        dur_min: durMin,
        source: clip(prev.source, 12)
      });
      d.history = d.history.slice(0, AB_KEEP);
      if (prev.state === 'working' || source === 'commit') {
        logEvt = {
          device: target,
          project: clip(b.project || prev.project, 40),
          ev: source === 'commit' ? 'COMMIT' : 'DONE',
          task: qqMask_(b.task || prev.task || '(작업 완료)', 120),
          via: source,
          status: 'DONE',
          note: durMin ? (durMin + '분') : ''
        };
      }
      d.agent = { state: 'idle', project: clip(prev.project, 24), task: qqMask_(prev.task, 60),
        started_at: clip(prev.started_at, 40), source: clip(prev.source, 12) || source, stale_min: staleMin };
    } else {
      const nextProj = clip(b.project, 24);
      const nextTask = qqMask_(b.task, 60);
      if (prev.state !== 'working' || prev.project !== nextProj || prev.task !== nextTask) {
        logEvt = {
          device: target,
          project: clip(b.project, 40),
          ev: 'START',
          task: qqMask_(b.task || '(작업 시작)', 120),
          via: source,
          status: 'WORKING',
          note: ''
        };
      }
      d.agent = {
        state: 'working', project: nextProj, task: nextTask,
        started_at: String((prev.state === 'working' && prev.started_at) ? prev.started_at : now).slice(0, 40),
        source: source, stale_min: staleMin
      };
    }
    d.version = 1;
    d.target = target;
    d.updated_at = now;
    const js = JSON.stringify(d);
    if (f) f.setContent(js); else folder.createFile(name, js, 'application/json');
    return logEvt;
  });
  if (logInfo) workLogAppend_(logInfo.device, logInfo.project, logInfo.ev, logInfo.task, logInfo.via, logInfo.status, logInfo.note);
  return { ok: true, target: target, state: st, stale_min: staleMin };
}

/** 통합 작업 로그(Work_Log) 1줄 추가 — 회사 PC(pc)·노트북 직접(direct) 시작/종료 이중 기록 */
function workLogAppend_(device, project, ev, task, via, status, note) {
  try {
    const id = String(PropertiesService.getScriptProperties().getProperty('QUEUE_SHEET_ID') || '').trim();
    if (!id) return;
    const ss = SpreadsheetApp.openById(id);
    let sh = ss.getSheetByName('Work_Log');
    if (!sh) {
      sh = ss.insertSheet('Work_Log');
      sh.getRange(1, 1, 1, 8).setValues([['시각', '기기', '프로젝트', '이벤트', '작업명', '경로', '상태', '비고']]);
      sh.setFrozenRows(1);
    }
    const kst = Utilities.formatDate(new Date(), 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ss+09:00");
    sh.appendRow([
      kst,
      clip(device, 30),
      clip(project, 40),
      clip(ev, 20),
      qqMask_(task, 120),
      clip(via, 40),
      clip(status, 30),
      clip(note, 120)
    ]);
  } catch (_) {}
}
/** 기기 상태 파일 하나를 포털이 쓰는 모양으로 — 없거나 깨졌으면 null */
function agentBeatRead_(target) {
  try {
    const fo = DriveApp.getFoldersByName(PORTAL_FOLDER);
    if (!fo.hasNext()) return null;
    const it = fo.next().getFilesByName(AB_FILE[abTarget_(target)]);
    if (!it.hasNext()) return null;
    const dd = JSON.parse(it.next().getBlob().getDataAsString());
    if (!isObj(dd) || !isObj(dd.agent)) return null;
    const a = dd.agent;
    const dm = Date.parse(String(dd.updated_at || ''));
    return {
      state: clip(a.state, 12), project: clip(a.project, 24), task: qqMask_(a.task, 60),
      started_at: clip(a.started_at, 40), source: clip(a.source, 12) || 'manual',
      stale_min: abStale_(a.stale_min), updated_at: clip(dd.updated_at, 40),
      min: isFinite(dm) ? Math.max(0, Math.round((Date.now() - dm) / 60000)) : null
    };
  } catch (_) { return null; }
}

// ═══════════════════════════════════════════════════════════════
// 📎 파일·이미지 공유 (2026-11-27) — 회의실에서 사진·서류를 붙여 보낸다
//
//  레이 님 지시: "여기서 파일이나 이미지도 공유할 수 있게 업데이트해".
//
//  · 왜 Drive 인가 — Command_Queue 는 시트 한 줄이고 payload 상한이 4,000자다
//    (CommandQueue.gs 와 같은 값). 사진을 base64 로 실을 수 없다(작은 썸네일도 2,000자).
//    그래서 **파일 본체는 Drive 에 두고, 시트에는 {id,n,s,m} 네 칸만** 싣는다.
//  · 어디에 — 김성래포털/포털_공유. 메모 백업 옆이고, **이 폴더 파일만** file_get 으로 다시 꺼낸다.
//  · 공개하지 않는다 — 링크 공유를 켜지 않는다(회의실에는 사적인 사진·서류가 온다).
//    화면은 비밀 키가 붙은 POST(file_get)로 바이트를 받아 data URL 로 그린다.
//  · 지우는 법 — Drive 의 포털_공유 폴더에서 지우면 된다(시트 줄의 첨부는 '지워짐'으로 보인다).
//  · 무료 범위 — Apps Script·Drive 만 쓴다(외부 저장 서비스 없음).
const QQ_FILE_FOLDER = '포털_공유';                 // 김성래포털/포털_공유
const QQ_FILE_MAX = 4;                              // 한 말에 붙는 파일 수
const QQ_FILE_BYTES = 4 * 1024 * 1024;              // 파일 하나 4MB (큰 사진은 화면이 먼저 줄인다)
const QQ_FILE_FILES_CHARS = 1200;                   // payload 안 files 글자 상한
const QQ_FILE_ID_RE = /^[A-Za-z0-9_-]{10,80}$/;     // Drive 파일 id 모양
// 붙일 수 있는 종류 — 화면(index.html·room/app.js)의 목록과 같게 유지한다.
const QQ_FILE_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv', 'text/markdown': 'md',
  'application/zip': 'zip',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/haansofthwp': 'hwp', 'application/x-hwp': 'hwp',
  'application/haansofthwpx': 'hwpx', 'application/x-hwpx': 'hwpx',
  'application/vnd.hancom.hwp': 'hwp'
};
/** 사람이 읽는 크기 — '240KB' · '1.2MB' */
function qqFileSize_(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v < 1024) return v + 'B';
  if (v < 1024 * 1024) return Math.round(v / 1024) + 'KB';
  return (Math.round(v / 104857.6) / 10) + 'MB';
}
/** 올린 파일 이름 — 경로를 떼고 위험한 글자를 지우고 80자로 줄인다(확장자는 살린다). */
function qqFileName_(raw, mime) {
  let n = String(raw == null ? '' : raw).replace(/\\/g, '/').split('/').pop();
  n = n.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim();
  const ext = QQ_FILE_MIME[String(mime || '').toLowerCase()] || '';
  const hasExt = /\.[A-Za-z0-9]{1,7}$/.test(n);
  if (!n) n = '첨부';
  if (!hasExt && ext) n += '.' + ext;
  if (n.length > 80) {
    const dot = n.lastIndexOf('.');
    const tail = (dot > 0 && n.length - dot <= 8) ? n.slice(dot) : '';
    n = n.slice(0, Math.max(1, 80 - tail.length)) + tail;
  }
  return n;
}
/**
 * payload.files → [{id,n,s,m}]. strict 면 잘못된 것을 **거절**하고(접수할 때),
 * 아니면 조용히 걸러 낸다(읽을 때 — 옛 줄·남이 쓴 값 때문에 목록이 깨지면 안 된다).
 */
function qqFileVec_(raw, strict) {
  if (strict && raw !== undefined && raw !== null && !Array.isArray(raw)) {
    throw qqErr_('bad_request', '첨부(files)는 목록이어야 해요.');
  }
  const arr = Array.isArray(raw) ? raw : [];
  if (strict && arr.length > QQ_FILE_MAX) {
    throw qqErr_('bad_request', '한 번에 붙일 수 있는 파일은 ' + QQ_FILE_MAX + '개까지예요.');
  }
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const f = isObj(arr[i]) ? arr[i] : null;
    const bad = function (msg) { if (strict) throw qqErr_('bad_request', msg); };
    if (!f) { bad('첨부 모양이 올바르지 않아요.'); continue; }
    const id = String(f.id == null ? '' : f.id).trim();
    const m = String(f.m == null ? '' : f.m).trim().toLowerCase();
    const s = Math.floor(Number(f.s));
    if (!QQ_FILE_ID_RE.test(id)) { bad('첨부 파일 id 가 올바르지 않아요.'); continue; }
    if (!QQ_FILE_MIME[m]) { bad('붙일 수 없는 파일 종류예요: ' + clip(m, 60)); continue; }
    if (!isFinite(s) || s <= 0 || s > QQ_FILE_BYTES) { bad('첨부 크기가 올바르지 않아요(한 개 ' + qqFileSize_(QQ_FILE_BYTES) + '까지).'); continue; }
    out.push({ id: id, n: qqFileName_(f.n, m), s: s, m: m });
    if (out.length >= QQ_FILE_MAX) break;
  }
  return out;
}
/** 공유 폴더 하나(없으면 만든다) */
function qqFileFolder_() { return getFolder(QQ_FILE_FOLDER, getRoot()); }
/** 이 파일이 포털_공유 안에 있는가 — 비밀 키가 있어도 남의 Drive 파일을 이 창구로 읽지 않게. */
function qqFileShared_(file) {
  try {
    const it = file.getParents();
    let guard = 0;
    while (it.hasNext() && guard++ < 50) {
      if (String(it.next().getName()) === QQ_FILE_FOLDER) return true;
    }
  } catch (_) { return false; }
  return false;
}
/**
 * 📎 file_upload — 화면이 파일을 base64 로 올린다.
 *  본문: {name, mime, size?, data(base64 — data:… 접두사 허용)}
 *  돌려줌: {ok, at, file:{id,n,s,m}} — 이 file 을 말풍선 payload.files 에 실어 보낸다.
 */
function queueFileUpload_(body) {
  const b = isObj(body) ? body : {};
  const mime = String(b.mime == null ? '' : b.mime).trim().toLowerCase().split(';')[0];
  if (!QQ_FILE_MIME[mime]) throw qqErr_('bad_request', '올릴 수 있는 파일이 아니에요(사진·PDF·문서·압축).');
  const name = qqFileName_(b.name, mime);
  const data = String(b.data == null ? '' : b.data).replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!data) throw qqErr_('bad_request', '파일 내용이 비어 있어요.');
  if (!/^[A-Za-z0-9+/=_\-]+$/.test(data)) throw qqErr_('bad_request', '파일 내용(base64)이 올바르지 않아요.');
  // 디코딩 **전에** 길이로 막는다 — 큰 본문으로 시간·메모리를 쓰지 않게.
  const b64Max = Math.ceil(QQ_FILE_BYTES / 3) * 4 + 16;
  const given = Math.floor(Number(b.size));
  if (data.length > b64Max || (isFinite(given) && given > QQ_FILE_BYTES)) {
    throw qqErr_('too_large', '파일이 너무 커요 — 한 개 ' + qqFileSize_(QQ_FILE_BYTES) + '까지예요(' + name + ').');
  }
  let bytes;
  try { bytes = Utilities.base64Decode(data); } catch (e) { throw qqErr_('bad_request', '파일 내용을 읽지 못했어요.'); }
  if (!bytes || !bytes.length) throw qqErr_('bad_request', '파일 내용이 비어 있어요.');
  if (bytes.length > QQ_FILE_BYTES) throw qqErr_('too_large', '파일이 너무 커요 — 한 개 ' + qqFileSize_(QQ_FILE_BYTES) + '까지예요(' + name + ').');
  const blob = Utilities.newBlob(bytes, mime, name);
  const file = qqFileFolder_().createFile(blob);
  return {
    ok: true, at: qqNow_(),
    file: { id: file.getId(), n: name, s: bytes.length, m: mime },
    note: 'Drive 「' + PORTAL_FOLDER + '/' + QQ_FILE_FOLDER + '」에 보관했어요(공개 링크 아님).'
  };
}
/**
 * 📎 file_get — 공유한 파일의 바이트를 돌려준다(base64). 화면이 blob 으로 그린다.
 *  본문: {id} · 비밀 키 필요(POST 전용). 포털_공유 밖의 파일은 거절한다.
 */
function queueFileGet_(body) {
  const id = String((body && body.id) || '').trim();
  if (!QQ_FILE_ID_RE.test(id)) throw qqErr_('bad_request', '파일 id 가 올바르지 않아요.');
  let f = null;
  try { f = DriveApp.getFileById(id); } catch (e) { f = null; }
  if (!f) throw qqErr_('not_found', '그 파일을 찾지 못했어요 — Drive 에서 지웠을 수 있어요.');
  if (!qqFileShared_(f)) throw qqErr_('forbidden', '회의실에서 공유한 파일이 아니에요.');
  const blob = f.getBlob();
  const bytes = blob.getBytes();
  if (!bytes || !bytes.length) throw qqErr_('not_found', '파일 내용이 비어 있어요.');
  return {
    ok: true, id: id, n: clip(f.getName(), 80), s: bytes.length,
    m: String(blob.getContentType() || '').toLowerCase(),
    data: Utilities.base64Encode(bytes)
  };
}
