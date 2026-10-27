// 모든 테스트 실행: 앱·서버 코드에서 테스트용 조각을 뽑고(.build) 각 테스트를 한국 시간대로 돌려요.
// 사용: npm test   /   node tests/run-all.js merge
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..'), BUILD = path.join(__dirname, '.build');
fs.mkdirSync(BUILD, { recursive: true });
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const m = html.match(/\/\/ <MEMO_CORE>([\s\S]*?)\/\/ <\/MEMO_CORE>/);
if (!m) { console.error('index.html 에서 // <MEMO_CORE> 표시를 찾지 못했어요 (메모 병합 핵심 코드 경계 표시는 지우면 안 돼요)'); process.exit(1); }
fs.writeFileSync(path.join(BUILD, 'memo_core.js'), m[1]);
fs.copyFileSync(path.join(ROOT, 'apps-script', 'Code.gs'), path.join(BUILD, 'portal_gs.js'));
const order = ['portal_server', 'portal_merge', 'portal_integration'];
const only = process.argv[2]; let failed = 0;
for (const name of order) {
  if (only && !name.endsWith(only)) continue;
  const r = spawnSync(process.execPath, [path.join(__dirname, name + '.test.js')], { env: { ...process.env, TZ: 'Asia/Seoul' }, encoding: 'utf8', timeout: 240000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const summary = (out.match(/[^\n]*\d+건 통과, \d+건 실패[^\n]*/g) || []).pop() || '(요약 없음 — 테스트가 중간에 멈춤)';
  const ok = r.status === 0; if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${name.padEnd(19)} ${summary.trim()}`);
  if (!ok) console.log(out.split('\n').filter(l => /❌|Error|^\s+at /.test(l)).slice(0, 15).map(l => '    ' + l).join('\n'));
}
process.exit(failed ? 1 : 0);
