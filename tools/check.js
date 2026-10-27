// 정적 검사: 문법 · 중복 함수 · 정의 안 된 이름(ESLint no-undef) · 죽은 함수 · Code.gs 문법 · 서버 주소/키 하드코딩
// 사용: npm run check   (npm test 는 이 검사를 먼저 돌리고 테스트를 이어서 돌려요)
const fs = require('fs'), path = require('path'), { execFileSync, spawnSync } = require('child_process');
const { ESLint } = require('eslint'); const globals = require('globals');
(async () => {
  const ROOT = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const gsText = fs.readFileSync(path.join(ROOT, 'apps-script', 'Code.gs'), 'utf8');
  const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n');
  const BUILD = path.join(ROOT, 'tests', '.build'); fs.mkdirSync(BUILD, { recursive: true });
  const f = path.join(BUILD, 'app_scripts.js'); fs.writeFileSync(f, js);
  let bad = 0;
  const syn = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  console.log('문법:', syn.status === 0 ? '✅' : '❌ ' + syn.stderr.split('\n').slice(0, 4).join(' ')); if (syn.status !== 0) bad++;
  const names = [...js.matchAll(/^\s*(?:async\s+)?function\s+(\w+)\s*\(/gm)].map(m => m[1]);
  const dup = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  console.log('중복 함수:', dup.length ? '❌ ' + dup.join(', ') : '✅ 없음'); if (dup.length) bad++;
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: {
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser, PDFLib: 'readonly' } },
    rules: { 'no-undef': 'error', 'no-redeclare': 'error', 'no-dupe-keys': 'error' } } });
  const [res] = await eslint.lintText(js, { filePath: f });
  const errs = res.messages.filter(m => m.severity === 2);
  console.log('정의 안 된 이름·중복 선언:', errs.length ? '❌\n  ' + errs.slice(0, 10).map(m => `줄 ${m.line}: ${m.message}`).join('\n  ') : '✅ 없음'); if (errs.length) bad++;
  const dead = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'deadcode.js'), path.join(ROOT, 'index.html')], { encoding: 'utf8' }));
  console.log('죽은 함수:', dead.length ? '⚠️ ' + dead.join(', ') + ' (끊긴 기능인지 먼저 확인)' : '✅ 없음');
  const gs = path.join(BUILD, 'code_gs_check.js'); fs.writeFileSync(gs, gsText);
  const g = spawnSync(process.execPath, ['--check', gs], { encoding: 'utf8' });
  console.log('Code.gs 문법:', g.status === 0 ? '✅' : '❌ ' + g.stderr.split('\n').slice(0, 3).join(' ')); if (g.status !== 0) bad++;
  const leak = /AKfycb[0-9A-Za-z_-]{20,}|AIza[0-9A-Za-z_-]{20,}/.test(html + gsText);
  console.log('서버 주소·API 키 하드코딩(공개 저장소):', leak ? '❌ 있음' : '✅ 없음'); if (leak) bad++;
  process.exit(bad ? 1 : 0);
})();
