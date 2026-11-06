// 사전진단툴(prediag/index.html): 보험나이·생년월일 계산과 화면 문구 검사
const fs = require('fs'), path = require('path'), vm = require('vm');
const acorn = require('acorn'), jsx = require('acorn-jsx');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌', m); } };

const FILE = process.env.PREDIAG_FILE || path.join(__dirname, '..', 'prediag', 'index.html');
const html = fs.readFileSync(FILE, 'utf8');
const core = (html.match(/\/\/ <PREDIAG_CORE>[^\n]*\n([\s\S]*?)\/\/ <\/PREDIAG_CORE>/) || [])[1];
ok(!!core, 'PREDIAG_CORE 구간이 있음');
const ctx = vm.createContext({});
try { vm.runInContext(core || '', ctx); } catch (e) { ok(false, '계산 구간 실행 오류: ' + e.message); }
const run = c => { try { return vm.runInContext(c, ctx); } catch (e) { return 'ERR ' + e.message; } };
const age = (f, b, now) => run(`insAgeFromRrn(${JSON.stringify(f)}, ${JSON.stringify(b)}, new Date(${JSON.stringify(now)}))`);

console.log('A) 생년월일·성별');
ok(run(`JSON.stringify(parseBirth('900315','1234567'))`) === JSON.stringify({ birth: new Date(1990, 2, 15), gender: '남성' }), '1990-03-15 남성 (뒤 1)');
ok(run(`parseBirth('050101','4234567').birth.getFullYear()`) === 2005 && run(`parseBirth('050101','4234567').gender`) === '여성', '2005년생 여성 (뒤 4)');
ok(run(`parseBirth('990101','2000000').birth.getFullYear()`) === 1999, '99로 시작해도 뒤 2면 1999년 (앞자리만 보고 2099년으로 오해하지 않음)');
ok(run(`parseBirth('900230','1234567')`) === null, '2월 30일 같은 없는 날짜는 거절');
ok(run(`parseBirth('9003','1234567')`) === null && run(`parseBirth('900315','')`) === null, '자릿수가 모자라면 계산 안 함');

console.log('B) 보험나이 (만 나이 + 직전 생일에서 6개월 이상이면 +1)');
// 독립 계산: 1990-03-15생
ok(age('900315', '1', '2026-03-14T12:00:00') === 36, '생일 하루 전(26-03-14): 만 35, 상령일(25-09-15) 지남 → 36');
ok(age('900315', '1', '2026-03-15T12:00:00') === 36, '생일 당일: 만 36세, 6개월 안 됨 → 36');
ok(age('900315', '1', '2026-09-14T12:00:00') === 36, '상령일 하루 전(26-09-14): 36');
ok(age('900315', '1', '2026-09-15T12:00:00') === 37, '상령일(26-09-15)부터: 37');
ok(age('900315', '1', '2026-01-10T12:00:00') === 36, '생일 전·상령일(25-09-15) 후: 만 35 + 1 = 36');
ok(age('900315', '1', '2025-09-14T12:00:00') === 35, '25-09-14: 만 35, 상령일 전 → 35');
ok(age('260101', '3', '2025-12-31T12:00:00') === null, '아직 안 태어난 날짜는 null');

console.log('C) 예전 버그 재현: 1단계에서 보험나이가 표시되지 않던 문제');
ok(!/calcInsAge\(/.test(html), '6자리 주민번호를 8자리 생년월일 함수에 넣던 calcInsAge 호출이 없음');
ok((html.match(/insAgeFromRrn\(/g) || []).length >= 3, '1·3·4단계가 같은 계산 함수(insAgeFromRrn)를 씀');

console.log('D) 화면 문구 (사실과 다른 표현 없음)');
ok(!/암호화되어 안전하게|뒷자리는 암호화/.test(html), '"암호화되어 안전하게 처리" 같은 사실과 다른 문구 없음');
ok(/Formspree/.test(html.replace(/<script>[\s\S]*?<\/script>/, '')) && /폼 전송 서비스\(Formspree\)/.test(html), '개인정보 안내에 Formspree 경유를 밝힘');
ok(!/인벤토리/.test(html), '뜻이 맞지 않는 "인벤토리 위험" 문구 없음');
ok(!/Netlify에 업로드|대시보드에서 도메인/.test(html), '고객에게 개발자용 오류 문구를 보여주지 않음');
ok(!/진단서 안전하게 전송/.test(html), '"진단서"(병원 서류)로 오해할 문구 없음');
ok(!/만 \{insAge\}세|`만 \$\{insAge\}세`/.test(html), '보험나이를 "만 ○세"(만 나이)로 표시하지 않음');

console.log('E) 문법');
const babel = (html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/) || [])[1] || '';
try { acorn.Parser.extend(jsx()).parse(babel, { ecmaVersion: 2022, sourceType: 'script' }); ok(true); }
catch (e) { ok(false, 'React(JSX) 코드 문법 오류: ' + e.message); }
const used = [...babel.matchAll(/\b(parseBirth|insAgeOf|insAgeFromRrn|calcCutoff|calcYearCutoff|dateStr)\(/g)].map(m => m[1]);
ok(used.every(n => run(`typeof ${n}`) === 'function'), '화면 코드가 쓰는 계산 함수가 모두 계산 구간에 있음');
ok(!/function (dateStr|calcCutoff|calcYearCutoff|insAgeOf)\(/.test(babel), '계산 함수가 화면 코드에 중복 정의되지 않음');
ok(/maxLength=\{7\}/.test(babel) && /주민번호: !!parsed/.test(babel), '주민번호는 날짜까지 맞아야 다음 단계로');

console.log('E) 사전진단툴에는 다른 앱 링크를 넣지 않음 (고객용 화면 — 사용자 결정 2026-11-06)');
ok(!/href="https:\/\/s2ongrae\.github\.io\/(?:gaegyebu|insurance-manager)?\/?"/.test(html) && !/s2ongrae\.github\.io\/(?:gaegyebu|insurance-manager)/.test(html),'가계부·보험관리툴·포털로 가는 링크가 없음');

console.log(`\n사전진단툴 테스트: ${pass}건 통과, ${fail}건 실패`); process.exit(fail ? 1 : 0);
