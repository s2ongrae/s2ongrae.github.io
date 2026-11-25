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
const GET_ACTIONS = ['ping', 'queue_status', 'queue_list', 'queue_head', 'usage_get', 'agents_get'];
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
      case 'ping':         return out({ ok: true, at: new Date().toISOString() });
      case 'queue_status': return out(queueStatus());
      case 'queue_list':   return out(queueList({ target: p.target, limit: p.limit }));
      case 'queue_head':   return out(queueHead({ target: p.target }));
      case 'usage_get':    return out(usageGet());
      case 'agents_get':   return out(agentListGet());
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
      case 'ping':              return out({ ok: true });
      case 'getTaskLists':      return out(getTaskLists());
      case 'getTasks':          return out(getTasks(body.listId));
      case 'addTask':           return out(addTask(body.listId, body.title, body.notes));
      case 'completeTask':      return out(completeTask(body.listId, body.taskId));
      case 'deleteTask':        return out(deleteTask(body.listId, body.taskId));
      case 'getCalendarEvents': return out(getCalendarEvents(body.ym));
      case 'createEvent':       return out(createEvent(body));
      case 'deleteEvent':       return out(deleteCalEvent(body.eventId));
      case 'loadMemos':         return out(loadMemos());
      case 'saveMemos':         return out(saveMemos(body));
      case 'queue_status':      return out(queueStatus());   // 포털 상단 상태등(읽기 전용)
      case 'agent_status':      return out(agentStatus());        // 🤖 피클이 남긴 작업 상태(읽기 전용)
      case 'queue_list':        return out(queueList(body));      // 🤖 오더함 — 최근 오더
      case 'queue_enqueue':     return out(queueEnqueue(body));   // 🤖 오더함 — 오더 접수
      case 'queue_decide':      return out(queueDecide(body));    // 🤖 오더함 — 승인/거절
      case 'queue_claim':       return out(queueClaim(body));     // 🤖 외부 비서가 자기 앞 오더를 집어 감
      case 'queue_done':        return out(queueDone(body));      // 🤖 집어 간 오더의 결과를 남김
      case 'agent_beat':        return out(agentBeat_(body));      // ⌨️ 노트북 직접작업 상태
      case 'usage_get':         return out(usageGet());           // 📊 비서 사용량(읽기)
      case 'usage_set':         return out(usageSet_(body));      // 📊 비서 사용량(남은 % 기록)
      case 'usage_report':      return out(usageSet_(body));      // 📊 외부 비서의 자기 보고(usage_set 과 같은 곳)
      case 'agents_get':        return out(agentListGet());       // 👥 참여 비서 명부(읽기)
      case 'agent_save':        return out(agentSave_(body));     // 👥 참여 비서 명부(추가·이름 변경·제거)
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
// 기본 참여자와 담당 한 줄(2026-11-25 v28, 성래 님 지시) — API(agents_get·usage_get·queue_list)로도 보인다.
//  화면(AGENT_SEED.duty)과 같은 글이다. 바뀌면 양쪽을 같이 고친다.
const AG_BUILTINS = [
  { id: 'pi1', name: '피원', icon: '🍋', group: '일일', duty: '총괄 조율·스케줄·블로그/콘텐츠/보험툴/포털 지휘' },
  { id: 'pi2', name: '피투', icon: '🤖', group: '일일', duty: 'GitHub PR/이슈·분산 실행·SNS/커머스 보조' },
  { id: 'cue', name: '큐', icon: '🌀', group: '일일', duty: '최신 정보 리서치·근거 확인·결과 교차검증(팩트체크)' },
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
// 대상(target, @멘션) — 누구에게 시키는가. all=전체, notebook=집 노트북(기본 실행자).
const QQ_TARGETS = ['all', 'pi1', 'pi2', 'notebook', 'cue', 'vooy', 'keyring'];
// @이름 → 대상 id. 본문에만 @큐 처럼 적어도 그 비서 앞으로 가게 한다(화면 칩과 같은 규칙).
const QQ_TARGET_NAMES = { '전체': 'all', '피원': 'pi1', '피투': 'pi2', '노트북': 'notebook', '큐': 'cue', '부이': 'vooy', '키링': 'keyring' };
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
  // 2026-11-25 — 부계정(@큐2·@cue2·@부이2·@vooy2 …)은 명부에 등록되기 전에도 그 비서 앞으로 본다.
  //  명부에 정식으로 올라오면 아래 루프가 덮어써서 그 아이디를 쓴다.
  Object.keys(map).forEach(function (l) {
    var id = map[l];
    if (id === 'all') return;
    for (var n = 2; n <= 9; n++) { if (!map[l + n]) map[l + n] = id; }
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
const QQ_LIST_DEFAULT = 15;
const QQ_LIST_MAX = 20;
const QQ_SCAN_ROWS = 400;                          // 목록·중복 확인용으로 아래에서 읽는 줄 수
const QQ_DEDUPE_MS = 5 * 60000;                    // 같은 비멱등 오더 재접수 방지 창
const QQ_APPROVAL_TTL_MS = 15 * 60000;             // 승인 대기 15분 (워커와 같은 값)
const QQ_MAX_PAYLOAD = 4000;                       // CommandQueue 와 같은 payload 상한(자)
const QQ_MAX_PROMPT = 2000;                        // 오더 글 길이 상한
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

/** 화면·기록에 내보내기 전 가림: 비밀 키·토큰 모양·주민/전화번호 → [REDACTED] */
function qqMask_(s, max) {
  let t = String(s == null ? '' : s);
  const sk = secretKey();
  if (sk && sk.length >= 8) t = t.split(sk).join('[REDACTED]');
  t = t.replace(/(auth_token|token|password|pwd|secret|client_secret|api_?key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
  t = t.replace(/\b\d{6}[-– ]?[1-4]\d{6}\b/g, '[REDACTED]')
       .replace(/\b01[016789][-– ]?\d{3,4}[-– ]?\d{4}\b/g, '[REDACTED]')
       .replace(/\b0(?:2|3[1-9]|[4-6]\d|70)[-– ]?\d{3,4}[-– ]?\d{4}\b/g, '[REDACTED]');
  return t.length > max ? t.slice(0, max) + '…' : t;
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

/** 목록에 보일 한 줄 요약 — 긴 프롬프트는 줄이고 가린다. payload 원문은 내보내지 않는다. */
function qqSummary_(type, p) {
  let s = '';
  if (type === 'git_pull') s = '코드 최신화 (git pull --ff-only)';
  else if (type === 'toss_sync') s = '토스증권 → 가계부 동기화';
  else if (type === 'claude_prompt') {
    const eng = String(p.engine || '').toLowerCase();
    const kind = String(p.kind || '').toLowerCase();
    // 큐가 붙인 [워커 규칙] 은 실행 규칙이지 사람이 읽을 내용이 아니다 — 요약에서는 뗀다(2026-11-25).
    //  대화(kind='chat')는 '클로드: ' 접두사도 붙이지 않는다(말풍선에 그대로 보이던 것).
    const body = qqStripWorkerNote_(p.prompt).replace(/\s+/g, ' ');
    s = (kind === 'chat' ? '' : '클로드: ') + body.slice(0, 160) +
      (String(p.mode || '').toLowerCase() === 'edit' ? ' (파일 수정)' : '') +
      (eng && eng !== 'auto' ? ' · 엔진 ' + eng : '');
  } else if (type === 'git_push') s = '깃 푸시 → ' + String(p.branch || '(브랜치 없음)');
  else if (type === 'smartstore_api_relay') s = '스마트스토어 API ' + String(p.op || '');
  else s = Object.keys(p).length ? Object.keys(p).join(', ') : '(내용 없음)';
  return qqMask_(s, 200);
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
    // 채팅 답장은 길어서 조금 더 보여 준다(워커 result 상한 500자).
    result: qqMask_(r.result, 500),
    error: qqMask_(r.error, 200),
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
      const list = qqMentionAll_(p.prompt, 6, false);
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
    needs_decision: st === 'WAITING_APPROVAL'
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
  const target = qqTargetOf_(p) || qqMentionOf_(prompt);
  if (target && target !== 'notebook') out.target = target;
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
 */
const QQ_RENDER_BRANDS = ['daejeon_youth', 'ppiyak_kimmary'];
const QQ_RENDER_PROFILES = ['captions', 'bgm'];
function qqRenderPayloadOf_(p) {
  const o = isObj(p) ? p : {};
  const contentId = String(o.content_id == null ? '' : o.content_id).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(contentId)) throw qqErr_('bad_request', 'content_id 는 영숫자·_·- 만, 40자 이내여야 해요.');
  const brand = String(o.brand == null ? '' : o.brand).trim();
  if (QQ_RENDER_BRANDS.indexOf(brand) < 0) throw qqErr_('bad_request', '트랙(brand)이 올바르지 않아요.');
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
    if (rp) {
      // 2026-11-25 — 원글이 이미 DONE 이라 replied_by(처리한 비서)가 차 있어도
      //  답장한 비서를 걺지 않게 따로 남긴다(answer_by). 비어 있으면 replied_by 도 채운다.
      it.answer_by = rp.by; it.answered_at = rp.at;
      if (!it.replied_by) { it.replied_by = rp.by; it.replied_at = rp.at; }
    }
    items.push(it);
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
  const ctx = qqOpen_();
  const rows = qqRows_(ctx, QQ_SCAN_ROWS);
  const res = { ok: true, at: qqNow_(), empty: !rows.length, item: null };
  if (!rows.length) return res;
  const want = String((body && body.target) || '').trim().toLowerCase();
  const filter = !!want && want !== 'notebook' && want !== 'all' && QQ_AGENT_ID_RE.test(want);
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
function qqStripWorkerNote_(s) {
  return String(s == null ? '' : s).replace(QQ_WORKER_NOTE_RE, '').trim();
}
function qqWithWorkerNote_(type, payload) {
  if (type !== 'claude_prompt') return payload;
  var p;
  try { p = qqParse_(payload); } catch (err) { return payload; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return payload;
  if (String(p.kind || '').toLowerCase() === 'chat') return payload;
  var prompt = String(p.prompt || '');
  if (!prompt || prompt.indexOf('[워커 규칙]') !== -1) return payload;
  if (prompt.length + QQ_WORKER_NOTE.length > QQ_MAX_PAYLOAD) return payload;
  p.prompt = prompt + QQ_WORKER_NOTE;
  p.worker_note = 'auto';
  return JSON.stringify(p);
}

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
  return String(p.target || '').toLowerCase() === 'portal';
}

function queueEnqueue(body) {
  const type = String((body && body.type) || '').trim();
  const spec = QQ_TYPES[type];
  if (!spec) throw qqErr_('type', '이 오더함에서는 보낼 수 없는 오더예요.');
  let workspace = String((body && body.workspace) || '').trim();
  if (spec.needsWorkspace && !workspace) throw qqErr_('workspace', '작업 위치를 골라주세요.');
  if (workspace) qqCheckWorkspace_(workspace);
  else workspace = '';
  const payload = qqWithWorkerNote_(type, qqPayloadOf_(type, body && body.payload));
  if (payload.length > QQ_MAX_PAYLOAD) throw qqErr_('too_long', '오더 내용이 너무 길어요.');

  const risk = (type === 'content_render' || (type === 'claude_prompt' && qqModeOf_(payload) === 'edit')) ? 'HIGH' : 'LOW';
  const verdict = risk === 'HIGH' ? qqAutoDelegation_(type, qqParse_(payload), workspace) : { auto: false, reason: '' };
  const autoBy = risk === 'HIGH' && verdict.auto ? 'auto' : '';
  const needsApproval = risk === 'HIGH' && !verdict.auto;
  const nowMs = Date.now();
  const ttlMin = Math.round(QQ_APPROVAL_TTL_MS / 60000);
  // 사람(포털) 앞으로 온 대화는 아무도 실행하지 않는다 — 접수 순간에 전달 완료로 닫는다(2026-11-25).
  const delivered = qqDeliveredOnly_(type, payload);

  return qqLock_(function () {
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
      id: qqMakeId_(nowMs), created_at: qqIso_(nowMs), source: qqSourceOf_(body && (body.source || body.client_id)), type: type, workspace: workspace,
      payload: payload, status: delivered ? 'DONE' : (needsApproval ? 'WAITING_APPROVAL' : 'PENDING'), attempts: 0,
      claimed_at: '', claimed_by: '', finished_at: delivered ? qqIso_(nowMs) : '', duration_ms: delivered ? 0 : '', exit_code: '', result: '', error: '', detail: '',
      risk_level: risk, approval_expires_at: needsApproval ? qqIso_(nowMs + QQ_APPROVAL_TTL_MS) : '',
      approval_by: autoBy, approval_at: autoBy ? qqIso_(nowMs) : '',
      approval_note: autoBy ? verdict.reason : '', approval_hash: qqHashPayload_(payload)
    };
    qqAppend_(ctx, row);
    return {
      ok: true, duplicate: false, item: qqItem_(row),
      note: delivered
        ? '전달했어요 — 포털(사람) 앞 메시지라 실행 없이 바로 읽혀요.'
        : needsApproval
        ? (type === 'content_render' ? '영상 렌더 오더예요 — ' : '파일을 고치는 오더예요 — ') + ttlMin + '분 안에 승인해야 노트북이 실행해요.'
        : (autoBy
          ? '자동 승인(위임) — 승인 없이 바로 실행 대기열에 들어갔어요.'
          : '접수했어요. 노트북이 다음 확인 때 실행해요.')
    };
  });
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
//  · 결과는 가리고(qqMask_) 500자까지만 쓴다. 다른 비서가 집은 오더의 결과는 덮지 않는다.
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
    const row = qqFindRow_(ctx, String(pick.id)) || pick;
    return { ok: true, changed: true, at: now, claimed_by: as, item: qqItem_(row) };
  });
}

/** 집어 간 오더의 결과를 남긴다. {action:'queue_done', key, as, id, status:'DONE'|'FAILED', result?, error?, duration_ms?} */
function queueDone(body) {
  const as = qqActorOf_(body);
  const id = clip((body && body.id) || '', 60).trim();
  if (!id) throw qqErr_('bad_request', '오더 id 가 없어요.');
  const status = String((body && body.status) || 'DONE').trim().toUpperCase();
  if (status !== 'DONE' && status !== 'FAILED') throw qqErr_('bad_request', 'status 는 DONE 또는 FAILED 여야 해요.');
  const result = qqMask_(clip((body && body.result) || '', 500), 500);
  const error = qqMask_(clip((body && (body.error || (status === 'FAILED' ? body.result : ''))) || '', 300), 300);
  const dur = Number((body && body.duration_ms));
  return qqLock_(function () {
    const ctx = qqOpen_();
    const r = qqFindRow_(ctx, id);
    if (!r) throw qqErr_('not_found', '그 오더를 찾지 못했어요.');
    const st = String(r.status == null ? '' : r.status).trim().toUpperCase();
    if (st === 'WAITING_APPROVAL') throw qqErr_('not_approved', '승인 대기 오더예요 — 사람이 승인해야 끝낼 수 있어요.');
    const by = String(r.claimed_by == null ? '' : r.claimed_by).trim().toLowerCase();
    if (by && by !== as) throw qqErr_('not_mine', '다른 비서가 집은 오더예요(claimed_by=' + clip(by, 20) + ').');
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
    return { ok: true, changed: true, id: id, status: status, at: qqIso_(nowMs), item: qqItem_(row) };
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
