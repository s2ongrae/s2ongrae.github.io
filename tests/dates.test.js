// 날짜 경계 (2026-11-15 점검): 자정에 끝나는 일정 · 사전진단툴 월말 계산
const fs = require('fs'), path = require('path'), vm = require('vm');
const mk = require('./lib/portal_fake_server.js');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌', m); } };

console.log('A) 캘린더: 23:00 에 시작해 자정에 끝나는 일정은 그날만');
{ const S = mk(); const post = b => S.post(JSON.stringify(Object.assign({ key: S.KEY }, b)));
  post({ action: 'createEvent', date: '2026-11-14', title: '늦은일정', startTime: '23:00' });              // 기본 1시간 → 24:00(다음 날 0시)
  post({ action: 'createEvent', date: '2026-11-20', title: '밤샘', startTime: '23:30', endTime: '23:59' });
  const ev = post({ action: 'getCalendarEvents', ym: '2026-11' }).events;
  ok(ev['2026-11-14'] && ev['2026-11-14'].some(e => e.title === '늦은일정'), '14일에 보임');
  ok(!(ev['2026-11-15'] || []).some(e => e.title === '늦은일정'), '15일에는 안 보임 (예전엔 다음 날에도 23:00 으로 보임)');
  ok((ev['2026-11-20'] || []).some(e => e.title === '밤샘') && !(ev['2026-11-21'] || []).some(e => e.title === '밤샘'), '자정 전에 끝나는 일정도 그날만');
}

console.log('B) 사전진단툴: 월말 날짜');
{ const html = fs.readFileSync(path.join(__dirname, '..', 'prediag', 'index.html'), 'utf8');
  const core = html.match(/\/\/ <PREDIAG_CORE>[^\n]*\n([\s\S]*?)\/\/ <\/PREDIAG_CORE>/)[1];
  const ctx = vm.createContext({}); vm.runInContext(core, ctx);
  const age = (f, b, now) => vm.runInContext(`insAgeFromRrn(${JSON.stringify(f)},${JSON.stringify(b)},new Date(${JSON.stringify(now)}))`, ctx);
  ok(age('900831', '1', '2027-02-27T12:00:00') === 36, '8월 31일생: 2월 27일까지 36');
  ok(age('900831', '1', '2027-02-28T12:00:00') === 37, '8월 31일생: 2월 28일(말일)부터 37 (예전엔 3월 3일부터)');
  ok(age('900315', '1', '2026-09-15T12:00:00') === 37 && age('900315', '1', '2026-09-14T12:00:00') === 36, '보통 날짜는 그대로 (3월 15일생 → 9월 15일부터 +1)');
  const cut = (m, now) => vm.runInContext(`calcCutoff(${m}, new Date(${JSON.stringify(now)}))`, ctx);
  ok(cut(3, '2026-05-31T12:00:00') === '2026년 2월 28일', '5월 31일 기준 3개월 전 = 2월 28일 (예전엔 3월 3일)');
  ok(cut(1, '2026-03-31T12:00:00') === '2026년 2월 28일', '3월 31일 기준 1개월 전 = 2월 28일');
  ok(vm.runInContext(`calcYearCutoff(5, new Date('2028-02-29T12:00:00'))`, ctx) === '2023년 2월 28일', '2월 29일 기준 5년 전 = 2월 28일');
}

console.log(`\n날짜 경계 테스트: ${pass}건 통과, ${fail}건 실패`); process.exit(fail ? 1 : 0);
