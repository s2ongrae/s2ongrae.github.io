// 미리보기 HTML 생성 — 실제 index.html 의 CSS·렌더 함수로 '작업 관제' 화면을 그려 파일로 저장한다.
// (기기 화면 캡처용. 데이터는 샘플 — 서버·Drive 에 붙지 않는다)
// 사용: node tools/gen_preview.js preview/work-console.html
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SCRIPT = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n');
const STYLE = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';

const store = new Map();
const localStorage = {getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)};
const mkEl = () => ({value: '', textContent: '', innerHTML: '', placeholder: '', style: {}, dataset: {},
  classList: {add() {}, remove() {}, toggle() {}, contains() { return false; }}, appendChild() {}, focus() {}, onclick: null});
const els = {};
const el = id => els[id] || (els[id] = mkEl());
const ctx = vm.createContext({
  console, localStorage, crypto: require('crypto').webcrypto, Promise, setTimeout, clearTimeout, URLSearchParams,
  document: {getElementById: el, querySelectorAll: () => [], createElement: () => mkEl(), addEventListener() {}, activeElement: null},
  window: {addEventListener() {}}, alert() {}, confirm: () => true, fetch: async () => ({json: async () => ({})})
});
vm.runInContext(SCRIPT, ctx);
const run = c => vm.runInContext(c, ctx);
const iso = ms => new Date(ms).toISOString();
const now = Date.now();

run(`ORD_ITEMS = ${JSON.stringify([
  {id: 'Q-20261117-101502-ab12', type: 'claude_prompt', workspace: 'content-hub', status: 'RUNNING',
   created_at: iso(now - 9 * 60000), claimed_at: iso(now - 9 * 60000 + 15000), claimed_by: 'notebook',
   summary: '클로드: 콘텐츠 허브 11월 3주차 카드 3장 문구 다듬고 미리보기 링크 정리', duration_ms: null},
  {id: 'Q-20261117-100800-cd34', type: 'git_pull', workspace: 'gaegyebu', status: 'PENDING',
   created_at: iso(now - 3 * 60000), summary: '코드 최신화 (git pull --ff-only)'},
  {id: 'Q-20261117-101010-ef56', type: 'claude_prompt', workspace: 'insurance-manager', status: 'WAITING_APPROVAL',
   created_at: iso(now - 6 * 60000), risk_level: 'HIGH', approval_expires_at: iso(now + 8 * 60000),
   expires_in_ms: 8 * 60000, summary: '클로드: 보장분석 표 담보 이름 규칙 정리 (파일 수정)'},
  {id: 'Q-20261117-095500-gh78', type: 'toss_sync', workspace: '', status: 'DONE',
   created_at: iso(now - 41 * 60000), claimed_at: iso(now - 41 * 60000 + 5000), claimed_by: 'notebook',
   finished_at: iso(now - 40 * 60000), duration_ms: 19000, result: '토스 동기화 완료 · 날짜별 기록 6일',
   summary: '토스증권 → 가계부 동기화'},
  {id: 'Q-20261117-092200-ij90', type: 'claude_prompt', workspace: 'smartstore-hub', status: 'FAILED',
   created_at: iso(now - 95 * 60000), claimed_at: iso(now - 94 * 60000), finished_at: iso(now - 84 * 60000),
   duration_ms: 601000, error: '엔진: 정품 Claude Code(claude) 폴백: claude→timeout', summary: '클로드: 상세페이지 문구 점검 (파일 수정)'}
])}`);
run(`ORD_SUM = {pending: 1, running: 1, waiting: 1, timeout: 0, done: 8, failed: 5}`);
run(`ORD_AT = ${JSON.stringify(iso(now))}; ORD_FETCH_AT = ${now}`);
run(`QSTAT_DATA = {ok: true, at: ${JSON.stringify(iso(now))}, connected: true,
  heartbeat: {state: 'ok', min: 0, source: 'drive', current: '', current_type: '', processed: 34, polls: 810, daemon: 'running', version: '1.2.0'},
  queue: {state: 'warn', pending: 1, waiting: 1, timeout: 0, oldest_min: 3},
  toss: {state: 'ok', date: '2026-11-17', days: 0}}`);
run(`GH_DATA = {at: ${JSON.stringify(iso(now))}, runs_at: ${JSON.stringify(iso(now))}, limited: false, repos: {
  's2ongrae.github.io': {commits: [
    {sha: 'a99b7a0', msg: 'fix(관제): 읽기 전 상태를 확인 중으로, 서버가 예전 배포면 재배포 안내', at: ${JSON.stringify(iso(now - 12 * 60000))}},
    {sha: 'c9f748a', msg: 'polish(관제): 승인 대기·대기 상태를 노트북 카드에 먼저 보여주고 CI 줄바꿈 정리', at: ${JSON.stringify(iso(now - 70 * 60000))}}],
    run: {name: 'pages build and deployment', status: 'completed', conclusion: 'success'}},
  'content-hub': {commits: [
    {sha: 'c8fe95b', msg: 'Merge pull request #1 from s2ongrae/agent/ui-visibility-v3', at: ${JSON.stringify(iso(now - 4 * 3600000))}}],
    run: {name: 'deploy', status: 'completed', conclusion: 'success'}},
  'gaegyebu': {commits: [{sha: 'd6f4a72', msg: 'refactor: JS 로직을 app.js로 분리', at: ${JSON.stringify(iso(now - 6 * 3600000))}}],
    run: {name: 'deploy', status: 'completed', conclusion: 'success'}},
  'insurance-manager': {commits: [{sha: '5fbdaa8', msg: '그루핑 3순위 수정: 저장해 둔 그룹 설정이 깨지지 않게', at: ${JSON.stringify(iso(now - 20 * 3600000))}}],
    run: {name: 'deploy', status: 'completed', conclusion: 'success'}}
}}`);
run('monRender(true); renderOrders(); renderQueueStatus(QSTAT_DATA);');

const cards = el('mon-cards').innerHTML;
const feed = el('mon-feed').innerHTML;
const ordList = el('ord-list').innerHTML;
const badge = el('mon-badge').textContent;
const note = el('mon-note').textContent;
const foot = el('mon-foot').textContent;

const out = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>미리보기 · 🖥️ 작업 관제</title>
<style>${STYLE}</style>
</head><body>
<div class="page" style="padding-top:24px">
  <div class="mon-card">
    <div class="section-head">
      <div class="section-title">🖥️ 작업 관제 <span class="badge badge-blue">${badge}</span></div>
      <div class="ord-head-right">
        <span class="ord-hint">${note}</span>
        <button class="ord-refresh" aria-label="새로고침">⟳</button>
      </div>
    </div>
    <div class="mon-grid">${cards}</div>
    <div class="mon-filters">
      <span class="mon-filters-h">🕒 통합 이력</span>
      <button class="mon-f on">전체</button>
      <button class="mon-f">🏠 노트북</button>
      <button class="mon-f">💻 회사 PC</button>
      <button class="mon-f">⚡ 에이전트</button>
    </div>
    <div class="mon-feed">${feed}</div>
    <div class="mon-note">${foot}</div>
  </div>
  <div class="order-card">
    <div class="section-head"><div class="section-title">🤖 노트북 오더함 <span class="badge badge-blue">대기 2</span></div></div>
    <div class="ord-list" style="max-height:none">${ordList}</div>
  </div>
  <div style="text-align:center;font-size:11px;color:var(--hint)">미리보기 — index.html 의 실제 CSS·렌더 함수로 그린 화면(데이터는 샘플)</div>
</div>
</body></html>`;
const OUT = path.join(ROOT, process.argv[2] || 'preview/work-console.html');
fs.mkdirSync(path.dirname(OUT), {recursive: true});
fs.writeFileSync(OUT, out);
console.log('저장:', path.relative(ROOT, OUT), (out.length / 1024).toFixed(1) + 'KB');
