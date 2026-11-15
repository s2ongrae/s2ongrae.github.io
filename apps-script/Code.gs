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
function doGet(e) {
  return out({ ok: false, error: 'POST로만 사용할 수 있어요.' });
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
      case 'queue_list':        return out(queueList(body));      // 🤖 오더함 — 최근 오더
      case 'queue_enqueue':     return out(queueEnqueue(body));   // 🤖 오더함 — 오더 접수
      case 'queue_decide':      return out(queueDecide(body));    // 🤖 오더함 — 승인/거절
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
    const eEnd = ev.getEndTime();
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
//   ① 노트북 응답   : HEARTBEAT_FILE_ID 가 있으면 그 파일의 updated_at,
//                     없으면 Command_Queue 의 마지막 활동 시각(대략)
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
  } else if (lastQueueAt) {
    res.heartbeat = heartAge_(lastQueueAt, 'sheet');   // 정확한 하트비트가 없을 때의 대략값
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
  if (iStatus < 0) return { summary: { state: 'unknown', error: 'status 칸을 찾지 못했어요' }, lastActivityAt: '' };

  let pending = 0, waiting = 0, timeout = 0, oldest = 0, last = 0;
  const start = Math.max(1, values.length - QS_MAX_ROWS);
  for (let r = start; r < values.length; r++) {
    const row = values[r];
    if (!row) continue;
    const st = String(row[iStatus] == null ? '' : row[iStatus]).trim().toUpperCase();
    if (!st) continue;
    const created = iCreated >= 0 ? qsCellMs_(row[iCreated]) : 0;
    if (st === 'PENDING') {
      pending++;
      if (created && (!oldest || created < oldest)) oldest = created;
    } else if (st === 'WAITING_APPROVAL') waiting++;
    else if (st === 'TIMEOUT_REVIEW') timeout++;
    last = Math.max(last,
      created,
      iClaimed >= 0 ? qsCellMs_(row[iClaimed]) : 0,
      iFinished >= 0 ? qsCellMs_(row[iFinished]) : 0);
  }

  const oldestMin = oldest ? Math.max(0, Math.round((Date.now() - oldest) / 60000)) : null;
  let state = 'ok';
  if (timeout >= 1) state = 'bad';
  else if (oldestMin !== null && oldestMin >= QS_PENDING_LATE_MIN) state = 'bad';
  else if (pending >= 2 || waiting >= 1) state = 'warn';
  return {
    summary: { state: state, pending: pending, waiting: waiting, timeout: timeout, oldest_min: oldestMin },
    lastActivityAt: last ? new Date(last).toISOString() : ''
  };
}

/** 마지막 응답 시각 → 신호등. source:'sheet' 은 '죽었나/쉬나'를 가릴 수 없어 빨강을 주지 않는다. */
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

function heartbeatStatus_(fileId) {
  const f = DriveApp.getFileById(fileId);
  let d;
  try { d = JSON.parse(f.getBlob().getDataAsString()); }
  catch (_) { return { state: 'unknown', source: 'drive', error: '하트비트 파일을 읽을 수 없어요' }; }
  return heartAge_((d && (d.updated_at || d.last_poll_at)) || '', 'drive');
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
  'risk_level', 'approval_expires_at', 'approval_by', 'approval_at', 'approval_note', 'approval_hash'
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
  claude_prompt: { label: '클로드 지시', needsWorkspace: true,  idempotent: false }
};
const QQ_PROP_WS = 'QUEUE_WORKSPACES';            // (선택) 허용 워크스페이스 덮어쓰기
// AI 엔진 — 노트북 lib/engines.js 의 ENGINE_IDS 와 같아야 한다.
//   auto 는 claude → agy → freellmapi 순으로 넘어간다(워커가 판단).
const QQ_ENGINES = ['auto', 'claude', 'agy', 'freellmapi'];
const QQ_WS_DEFAULT = 'gaegyebu,content-hub,insurance-manager,smartstore-hub';
const QQ_LIST_DEFAULT = 15;
const QQ_LIST_MAX = 20;
const QQ_SCAN_ROWS = 400;                          // 목록·중복 확인용으로 아래에서 읽는 줄 수
const QQ_DEDUPE_MS = 5 * 60000;                    // 같은 비멱등 오더 재접수 방지 창
const QQ_APPROVAL_TTL_MS = 15 * 60000;             // 승인 대기 15분 (워커와 같은 값)
const QQ_MAX_PAYLOAD = 4000;                       // CommandQueue 와 같은 payload 상한(자)
const QQ_MAX_PROMPT = 2000;                        // 오더 글 길이 상한
const QQ_FINAL = { DONE: true, FAILED: true, REJECTED: true, EXPIRED: true };

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

/** 목록에 보일 한 줄 요약 — 긴 프롬프트는 줄이고 가린다. payload 원문은 내보내지 않는다. */
function qqSummary_(type, p) {
  let s = '';
  if (type === 'git_pull') s = '코드 최신화 (git pull --ff-only)';
  else if (type === 'toss_sync') s = '토스증권 → 가계부 동기화';
  else if (type === 'claude_prompt') {
    const eng = String(p.engine || '').toLowerCase();
    s = '클로드: ' + String(p.prompt || '').replace(/\s+/g, ' ').slice(0, 160) +
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
    finished_at: clip(r.finished_at, 40),
    duration_ms: r.duration_ms === '' || r.duration_ms == null ? null : Number(r.duration_ms),
    exit_code: r.exit_code === '' || r.exit_code == null ? null : Number(r.exit_code),
    attempts: Number(r.attempts || 0),
    result: qqMask_(r.result, 200),
    error: qqMask_(r.error, 200),
    approval_by: clip(r.approval_by, 20),
    approval_at: clip(r.approval_at, 40),
    approval_expires_at: clip(r.approval_expires_at, 40),
    expires_in_ms: st === 'WAITING_APPROVAL' && isFinite(expMs) ? Math.max(0, expMs - Date.now()) : null,
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
  return JSON.stringify(out);
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
/** 최근 오더 목록 + 건수 + 고를 수 있는 작업 위치. payload 는 요약만 나간다. */
function queueList(body) {
  const ctx = qqOpen_();
  const limit = qqInt_(body && body.limit, 1, QQ_LIST_MAX, QQ_LIST_DEFAULT);
  const rows = qqRows_(ctx, QQ_SCAN_ROWS);
  const c = { pending: 0, waiting: 0, running: 0, timeout: 0, done: 0, failed: 0 };
  for (let i = 0; i < rows.length; i++) {
    const st = String(rows[i].status == null ? '' : rows[i].status).trim().toUpperCase();
    if (st === 'PENDING') c.pending++;
    else if (st === 'WAITING_APPROVAL') c.waiting++;
    else if (st === 'RUNNING') c.running++;
    else if (st === 'TIMEOUT_REVIEW') c.timeout++;
    else if (st === 'DONE') c.done++;
    else if (st === 'FAILED') c.failed++;
  }
  const items = [];
  for (let i = rows.length - 1; i >= 0 && items.length < limit; i--) items.push(qqItem_(rows[i]));
  return {
    ok: true, at: qqNow_(), items: items, count: items.length,
    pending: c.pending, waiting: c.waiting, running: c.running, timeout: c.timeout,
    done: c.done, failed: c.failed,
    workspaces: qqWorkspaces_(), types: Object.keys(QQ_TYPES), engines: QQ_ENGINES.slice(),
    approval_ttl_min: Math.round(QQ_APPROVAL_TTL_MS / 60000)
  };
}

/** 오더 한 건 접수. 위험(파일 수정)이면 WAITING_APPROVAL 로 세워 승인을 기다린다. */
function queueEnqueue(body) {
  const type = String((body && body.type) || '').trim();
  const spec = QQ_TYPES[type];
  if (!spec) throw qqErr_('type', '이 오더함에서는 보낼 수 없는 오더예요.');
  let workspace = String((body && body.workspace) || '').trim();
  if (spec.needsWorkspace && !workspace) throw qqErr_('workspace', '작업 위치를 골라주세요.');
  if (workspace) qqCheckWorkspace_(workspace);
  else workspace = '';
  const payload = qqPayloadOf_(type, body && body.payload);
  if (payload.length > QQ_MAX_PAYLOAD) throw qqErr_('too_long', '오더 내용이 너무 길어요.');

  const risk = (type === 'claude_prompt' && qqModeOf_(payload) === 'edit') ? 'HIGH' : 'LOW';
  const needsApproval = risk === 'HIGH';
  const nowMs = Date.now();
  const ttlMin = Math.round(QQ_APPROVAL_TTL_MS / 60000);

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
      id: qqMakeId_(nowMs), created_at: qqIso_(nowMs), source: 'portal', type: type, workspace: workspace,
      payload: payload, status: needsApproval ? 'WAITING_APPROVAL' : 'PENDING', attempts: 0,
      claimed_at: '', claimed_by: '', finished_at: '', duration_ms: '', exit_code: '', result: '', error: '', detail: '',
      risk_level: risk, approval_expires_at: needsApproval ? qqIso_(nowMs + QQ_APPROVAL_TTL_MS) : '',
      approval_by: '', approval_at: '', approval_note: '', approval_hash: qqHashPayload_(payload)
    };
    qqAppend_(ctx, row);
    return {
      ok: true, duplicate: false, item: qqItem_(row),
      note: needsApproval
        ? '파일을 고치는 오더예요 — ' + ttlMin + '분 안에 승인해야 노트북이 실행해요.'
        : '접수했어요. 노트북이 다음 확인 때 실행해요.'
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
