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
      default:                  return out({ ok: false, error: '알 수 없는 요청이에요.' });
    }
  } catch (err) {
    return out({ ok: false, error: String((err && err.message) || err) });
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
