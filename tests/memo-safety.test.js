// 메모·할 일 안전 (2026-11-15 전체 점검): 편집 중 동기화 · 저장 공간 가득 참 · 저장 충돌 후 재시도 · 할 일 저장 실패
const fs = require('fs'), path = require('path'), vm = require('vm'), nodeCrypto = require('crypto');
const mk = require('./lib/portal_fake_server.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const SCRIPT = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n');
const URL1 = 'https://script.google.com/macros/s/AKfycbPORTALTESTPORTALTEST1234/exec';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌', m); } };

function makeDevice(server, seedLS, opts = {}) {
  const store = new Map(Object.entries(seedLS || {}));
  const localStorage = { getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => { if (opts.failKey && opts.failKey(k)) throw new Error('QuotaExceededError'); store.set(k, String(v)); }, removeItem: k => store.delete(k) };
  const mkEl = () => ({ value: '', textContent: '', innerHTML: '', placeholder: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, appendChild() {}, focus() {}, onclick: null });
  const els = {}; const el = id => els[id] || (els[id] = mkEl());
  const dev = { hooks: {} };
  const ctx = vm.createContext({ console, localStorage, crypto: nodeCrypto.webcrypto, Promise, setTimeout, clearTimeout, URLSearchParams,
    document: { getElementById: el, querySelectorAll: () => [], createElement: () => mkEl(), addEventListener() {}, activeElement: null },
    window: { addEventListener() {} }, alert: () => {}, confirm: () => true,
    fetch: async (u, o) => { const body = JSON.parse(o.body);
      if (body.action === 'saveMemos' && dev.hooks.beforeSave) { const f = dev.hooks.beforeSave; dev.hooks.beforeSave = null; f(); }
      if (dev.hooks.fail) return { json: async () => ({ ok: false, error: '서버 오류' }) };
      return { json: async () => server.post(o.body) }; } });
  vm.runInContext(SCRIPT, ctx);
  dev.run = c => vm.runInContext(c, ctx); dev.get = e => JSON.parse(vm.runInContext('JSON.stringify(' + e + ')', ctx));
  dev.el = el; dev.store = store; dev.opts = opts;
  dev.config = () => dev.run("PORTAL_URL='" + URL1 + "'; PORTAL_KEY='" + server.KEY + "'");
  return dev;
}
const M = (id, t, b) => `{id:'${id}',title:'${t}',body:'${b}',color:'mc-blue',pinned:false,updatedAt:'2026-10-01T00:00:00Z'}`;
const srvMemos = S => JSON.parse(S.memoFile().content).memos.map(m => [m.id, m.title, m.body]);

(async () => {
console.log('A) 메모 편집 창을 연 동안 다른 기기 메모가 들어와도, 편집하던 메모만 바뀜');
{ const S = mk(); const A = makeDevice(S); A.config();
  A.run(`memos=[${M('m1', 'one', '1')},${M('m2', 'two', '2')}]; saveLocalMemos();`); await A.run('syncMemos()');
  const B = makeDevice(S); B.config(); await B.run('syncMemos()');
  B.run(`memos.unshift({id:'mB',title:'from B',body:'b',color:'mc-blue',pinned:false,updatedAt:new Date().toISOString()}); saveLocalMemos();`); await B.run('syncMemos()');
  A.run("openMemoModal('m1')"); ok(A.el('m-title').value === 'one', '편집 창에 m1 이 열림');
  await A.run('syncMemos()');                                          // 편집 중 동기화 → B 메모가 맨 앞으로
  ok(A.get('memos[0].id') === 'mB', '동기화로 순서가 바뀜 (mB 가 맨 앞)');
  A.el('m-body').value = 'edited one'; A.run('saveMemoItem()');
  const by = Object.fromEntries(A.get('memos').map(m => [m.id, m]));
  ok(by.m1 && by.m1.body === 'edited one', '고친 내용은 m1 에 들어감');
  ok(by.mB && by.mB.title === 'from B' && by.mB.body === 'b', '다른 기기의 mB 는 그대로 (예전엔 덮어써짐)');
  ok(A.get('memos.length') === 3, '메모 수 3개 그대로');
  A.run("openMemoModal('m2')"); A.run('deleteMemo()');
  ok(!A.get('memos').some(m => m.id === 'm2') && A.get('memos').some(m => m.id === 'mB'), '삭제도 편집하던 메모(m2)만');
  A.run("togglePin('mB')"); ok(A.get("memos.find(m=>m.id==='mB').pinned") === true, '고정도 id 로');
}

console.log('B) 편집하던 메모가 다른 기기에서 지워졌으면 새 메모로 남김');
{ const S = mk(); const A = makeDevice(S); A.config();
  A.run(`memos=[${M('m1', 'one', '1')}]; saveLocalMemos();`);
  A.run("openMemoModal('m1')"); A.run("memos=[]");                      // 그 사이 사라짐
  A.el('m-body').value = '살릴 내용'; A.run('saveMemoItem()');
  ok(A.get('memos.length') === 1 && A.get('memos[0].body') === '살릴 내용' && A.get('memos[0].id') !== 'm1', '내용을 잃지 않고 새 메모로');
}

console.log('C) 이 기기 저장 공간이 가득 차도, 다시 열었을 때 Drive 를 옛 메모로 되돌리지 않음');
{ const S = mk(); const A = makeDevice(S); A.config();
  A.run(`memos=[${M('m1', 'v1', 'old')}]; saveLocalMemos();`); await A.run('syncMemos()');
  A.opts.failKey = k => k === 'portal_memos_v3';
  A.run(`memos[0]=Object.assign({},memos[0],{body:'new text'}); memos.unshift(${M('m2', 'brand new', 'x')}); saveLocalMemos();`);
  await A.run('syncMemos()');
  ok(JSON.stringify(srvMemos(S).map(x => x[0]).sort()) === '["m1","m2"]', 'Drive 에는 새 메모까지 저장');
  ok(A.get('LOCAL_SAVE_FAILED') === true, '이 기기 저장 실패를 알아챔');
  const A2 = makeDevice(S, Object.fromEntries(A.store)); A2.config(); A2.run('loadLocalMemos()'); await A2.run('syncMemos()');
  const after = Object.fromEntries(srvMemos(S).map(x => [x[0], x[2]]));
  ok(after.m1 === 'new text' && after.m2 === 'x', '다시 열고 동기화해도 Drive 는 그대로 (예전엔 m2 가 지워지고 m1 이 old 로)');
}

console.log('D) 저장 직전에 다른 기기가 먼저 저장(충돌)해도 그 기기의 최신 메모를 덮어쓰지 않음');
{ const S = mk(); const A = makeDevice(S); A.config();
  A.run(`memos=[${M('m1', 'a', '1')},${M('m5', 'z', 'v0')}]; saveLocalMemos();`); await A.run('syncMemos()');
  const other = body => { const d = JSON.parse(S.memoFile().content);
    d.memos = d.memos.map(m => m.id === 'm5' ? Object.assign({}, m, { body, updatedAt: new Date().toISOString() }) : m);
    return S.post(JSON.stringify({ action: 'saveMemos', key: S.KEY, memos: d.memos, tombstones: d.tombstones || {}, baseRev: d.rev })); };
  other('v1');                                                          // 기기 B
  A.run(`memos[0]=Object.assign({},memos[0],{body:'A 수정'}); saveLocalMemos();`);
  A.hooks.beforeSave = () => other('v2');                               // A 가 받은 뒤·저장 전에 기기 C
  const r = await A.run('syncMemos()');
  const after = Object.fromEntries(srvMemos(S).map(x => [x[0], x[2]]));
  ok(r.ok && after.m5 === 'v2', '기기 C 의 최신 v2 유지 (예전엔 v1 로 덮어씀)');
  ok(after.m1 === 'A 수정', 'A 의 수정 반영');
}

console.log('E) 할 일 저장이 실패하면 "저장됨"을 띄우지 않고 입력을 남김');
{ const S = mk(); const A = makeDevice(S); A.config();
  A.hooks.fail = true; A.el('task-inp').value = '우유 사기'; await A.run('addTask()');
  ok(!/저장됨/.test(A.el('sync-txt').textContent) && /실패/.test(A.el('sync-txt').textContent), '실패 안내');
  ok(A.el('task-inp').value === '우유 사기', '입력한 글자가 그대로 남음');
}

console.log(`\n메모 안전 테스트: ${pass}건 통과, ${fail}건 실패`); process.exit(fail ? 1 : 0);
})();
