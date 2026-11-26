// 💬 AI 비서 회의실(room/) — 전용 PWA 정적 검사 + 핵심 로직 테스트
//  · 매니페스트·아이콘·Service Worker·화면 뼈대가 실제로 홈 화면 앱이 되게 갖춰졌는지
//  · app.js 의 <ROOM_CORE> 순수 로직(멘션·발신자·대상·답장 주체·마크다운)을 뽑아 검증
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..'), ROOM = path.join(ROOT, 'room');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌', m); } };
const read = p => fs.readFileSync(p, 'utf8');

function pngSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const html = read(path.join(ROOM, 'index.html'));
const js = read(path.join(ROOM, 'app.js'));
const css = read(path.join(ROOM, 'app.css'));
const sw = read(path.join(ROOM, 'sw.js'));

console.log('A) room/ 파일 구성');
{
  ['index.html', 'app.js', 'app.css', 'manifest.webmanifest', 'sw.js', 'icons/icon-192.png', 'icons/icon-512.png']
    .forEach(f => ok(fs.existsSync(path.join(ROOM, f)), f + ' 가 있음'));
  // 2026-11-26 사용자 지시 — 자기 호칭은 '레이 님'. 화면 소스에 옛 호칭이 다시 들어오면 여기서 잡는다.
  ok(!/성래/.test(js) && !/성래/.test(html) && !/성래/.test(css),
    'room/ 화면에 옛 호칭(성래)이 남아 있지 않다 — 자기 표시는 레이 님');
}

console.log('B) manifest.webmanifest — 홈 화면에서 단독 앱으로 열림');
{
  let man = null;
  try { man = JSON.parse(read(path.join(ROOM, 'manifest.webmanifest'))); } catch (e) { ok(false, 'JSON 으로 읽힘: ' + e.message); }
  if (man) {
    ok(man.name === 'AI 비서 회의실', 'name = AI 비서 회의실');
    ok(man.short_name === 'AI 회의실', 'short_name = AI 회의실 (홈 라벨이 잘리지 않게)');
    ok(man.start_url === '/room/', 'start_url = /room/');
    ok(man.scope === '/room/', 'scope = /room/');
    ok(man.display === 'standalone', 'display = standalone (주소창 없이)');
    ok(man.lang === 'ko', 'lang = ko');
    ok(/^#[0-9A-Fa-f]{6}$/.test(man.background_color), 'background_color #RRGGBB');
    ok(/^#[0-9A-Fa-f]{6}$/.test(man.theme_color), 'theme_color #RRGGBB');
    ok(Array.isArray(man.icons) && man.icons.length === 2, 'icons 2개(192·512)');
    for (const want of [192, 512]) {
      const e = (man.icons || []).find(i => String(i.sizes).split(/\s+/).includes(`${want}x${want}`));
      ok(!!e, `${want}px 항목 있음`);
      if (!e) continue;
      ok(e.src === `icons/icon-${want}.png`, `${want}px src = icons/icon-${want}.png`);
      ok(e.type === 'image/png', `${want}px type = image/png`);
      ok(/maskable/.test(e.purpose || ''), `${want}px purpose 에 maskable (안드로이드가 잘라도 안전)`);
      const f = path.join(ROOM, e.src);
      ok(fs.existsSync(f), `${e.src} 파일 있음`);
      if (fs.existsSync(f)) {
        const s = pngSize(f);
        ok(!!s, `${e.src} 가 진짜 PNG`);
        if (s) ok(s.w === want && s.h === want, `${e.src} 실제 ${s.w}x${s.h}`);
        ok(fs.statSync(f).size < 200 * 1024, `${e.src} 크기 ${Math.round(fs.statSync(f).size / 1024)}KB < 200KB`);
      }
    }
    ok(man.start_url.indexOf('/room/') === 0 && man.scope.indexOf('/room/') === 0, 'start_url·scope 가 /room/ 안 — 포털과 안 섞임');
  }
}

console.log('C) index.html — 전용 앱 뼈대(head·머리말·타임라인·입력바·서랍)');
{
  const head = (html.match(/<head>([\s\S]*?)<\/head>/) || [, ''])[1];
  ok(/<link[^>]+rel="manifest"[^>]+href="manifest\.webmanifest"/.test(head), 'link rel=manifest');
  ok(/<link[^>]+rel="icon"[^>]+href="icons\/icon-192\.png"/.test(head), 'link rel=icon');
  ok(/<link[^>]+rel="apple-touch-icon"[^>]+href="icons\/icon-192\.png"/.test(head), 'apple-touch-icon');
  ok(/<meta[^>]+name="theme-color"[^>]+content="#[0-9A-Fa-f]{6}"/.test(head), 'meta theme-color');
  ok(/<meta[^>]+name="mobile-web-app-capable"[^>]+content="yes"/.test(head), 'meta mobile-web-app-capable');
  ok(/<meta[^>]+name="viewport"[^>]+width=device-width/.test(head), 'viewport width=device-width');
  ok(/<script src="app\.js(\?v=\d+)?" defer><\/script>/.test(html), 'app.js 를 defer 로 불러옴(버전 쿼리 허용)');
  ok(/<link rel="stylesheet" href="app\.css(\?v=\d+)?">/.test(html), 'app.css 를 불러옴(버전 쿼리 허용)');
  ok(/app\.js\?v=\d+/.test(html) && /app\.css\?v=\d+/.test(html), 'asset 주소에 버전 — GitHub Pages 10분 캐시에 예전 코드가 남지 않게');
  ok(/<html lang="ko">/.test(html), 'html lang=ko');
  ok(/AI 비서 회의실/.test(html), '방 제목 AI 비서 회의실');
  ['ppl', 'feed', 'inp', 'send', 'chips', 'drawer', 'refresh', 'strip', 'sheet', 'toast', 'jump']
    .forEach(id => ok(new RegExp(`id="${id}"`).test(html), `#${id} 요소 있음`));
  ok(/aria-modal="true"/.test(html), '서랍은 aria-modal');
  ok(!/onclick=/.test(html), '인라인 onclick 없음 — 동작은 app.js 가 붙임(escape 사고 방지)');
  // 포털의 다른 메뉴가 새어 들어오면 안 됨 (전용 앱)
  ['가계부', '보험관리툴', '사전진단툴', 'content-hub', '스마트스토어'].forEach(w =>
    ok(html.indexOf(w) < 0, `포털 메뉴 "${w}" 없음 — 오직 회의실`));
  ok(!/serviceWorker/.test(html), 'index.html 안에서 직접 등록하지 않음(app.js 가 함)');
  ok(css.indexOf('--mine') > -1 && css.indexOf('@media (prefers-color-scheme: dark)') > -1, '카톡형 색·다크모드 규칙');
  ok(/env\(safe-area-inset-bottom/.test(css), '아이폰 홈바 여백(safe-area-inset-bottom)');
  ok(/@media \(min-width:921px\)/.test(css), 'PC 넓은 화면 반응형 규칙');
}

console.log('D) sw.js — 설치 요건 + 네트워크 우선(예전 화면 방지)');
{
  ok(/self\.addEventListener\('install'/.test(sw), 'install 이벤트');
  ok(/self\.addEventListener\('activate'/.test(sw), 'activate 이벤트');
  ok(/self\.addEventListener\('fetch'/.test(sw), 'fetch 이벤트(설치 요건)');
  ok(/caches\.delete/.test(sw), '옛 캐시 정리');
  ok(/req\.method !== 'GET'/.test(sw), 'POST(오더 접수)는 건드리지 않음');
  ok(/url\.origin !== self\.location\.origin/.test(sw), '바깥 주소(Apps Script)는 통과');
  ok(/const res = await fetch\(req\)/.test(sw) || /await fetch\(req, \{cache: 'no-store'\}\)/.test(sw), '네트워크 먼저(no-store)');
  ok(/cache: 'no-store'/.test(sw), '브라우저 HTTP 캐시(GitHub Pages 10분)를 건너뜀', );
  ok(/cache\.put/.test(sw), '받은 것은 캐시에 남김');
  ok(/caches\.open\(ROOM_VER\)/.test(sw), '버전 붙은 캐시 이름');
}

console.log('E) app.js 문법·정의 안 된 이름');
{
  const tmp = path.join(__dirname, '.build', 'room_app.js');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, js);
  const syn = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  ok(syn.status === 0, 'node --check: ' + (syn.status === 0 ? '✅' : syn.stderr.split('\n').slice(0, 3).join(' ')));
  let ESLint = null;
  try { ESLint = require('eslint').ESLint; } catch (e) { /* eslint 없으면 건너뜀 */ }
  if (ESLint) {
    const globals = require('globals');
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: {
        languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: Object.assign({}, globals.browser, globals.serviceworker) },
        rules: { 'no-undef': 'error', 'no-redeclare': 'error', 'no-dupe-keys': 'error' }
      }
    });
    eslint.lintText(js, { filePath: tmp }).then(([res]) => {
      const errs = res.messages.filter(m => m.severity === 2);
      ok(errs.length === 0, 'no-undef: ' + (errs.length ? errs.slice(0, 6).map(m => `줄 ${m.line} ${m.message}`).join(' / ') : '없음'));
      finish();
    }).catch(e => { ok(false, 'eslint 실행 실패: ' + e.message); finish(); });
  } else {
    finish();
  }
}

/* ── 순수 로직 ───────────────────────────────────────────── */
function coreTests() {
  const m = js.match(/\/\/ <ROOM_CORE>([\s\S]*?)\/\/ <\/ROOM_CORE>/);
  ok(!!m, '<ROOM_CORE> 구간 표시가 있음');
  if (!m) return;
  const names = ['ROOM_AGENTS', 'ROOM_CHIPS', 'ROOM_ALIASES', 'roomAgentById', 'roomMentionMap', 'roomTargetFromText',
    'roomSenderKey', 'roomIsMine', 'roomTargetKey', 'roomTargetLabel', 'roomReplyKey', 'roomReplyWhoKey',
    'roomNeedsWorker', 'roomIsPlainReply', 'roomShowReply', 'roomMsgText', 'roomStatus', 'roomWhen', 'roomDay',
    'roomAgo', 'roomUseState', 'roomMd', 'roomLinks', 'roomWsPick', 'roomWsName', 'roomJosa', 'roomLastActivity', 'roomOnlineCount', 'esc',
    'ROOM_USE_TXT', 'ROOM_USE_ALIVE_MIN', 'roomResetOf', 'roomCycleStart', 'roomUseFresh', 'roomResetAt', 'roomResetText',
    'roomSignalOf', 'roomSignalsFrom', 'roomSignalMin', 'roomSignalLive', 'roomStateOf', 'roomUseView', 'roomUseSummary',
    'ROOM_LIVE_ST', 'ROOM_LIVE_CLS', 'ROOM_LIVE_RANK', 'ROOM_ACT_TXT', 'ROOM_ACT_WAIT_MIN',
    'roomLiveOwner', 'roomLiveItems', 'roomLiveSince', 'roomLiveWhat', 'roomDur', 'roomAgentAct', 'roomActCounts',
    'ROOM_MARKS', 'roomMarkInfo', 'roomMark'];
  const mod = { exports: {} };
  try {
    new Function('module', 'exports', m[1] + '\nmodule.exports = {' + names.join(',') + '};')(mod, mod.exports);
  } catch (e) { ok(false, '순수 구간을 불러오지 못함: ' + e.message); return; }
  const C = mod.exports;
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  console.log('F) 편대 9명 · 멘션 칩 10개');
  ok(C.ROOM_AGENTS.length === 9, '편대 9명');
  ok(eq(C.ROOM_AGENTS.map(a => a.id), ['pi1', 'pi2', 'notebook', 'cue', 'cue2', 'vooy', 'vooy2', 'keyring', 'keyring2']), '편대 순서·id');
  ok(eq(C.ROOM_AGENTS.map(a => a.name), ['피원', '피투', '노트북', '큐', '큐투', '부이', '뷔투', '키링', '키투']), '편대 호칭(큐투·뷔투·키투)');
  ok(eq(C.ROOM_CHIPS, ['@전체', '@피원', '@피투', '@노트북', '@큐', '@큐투', '@부이', '@뷔투', '@키링', '@키투']), '멘션 칩 10개·순서');
  ok(C.ROOM_AGENTS.every(a => a.duty && a.icon), '모두 역할 한 줄·이모지가 있음');

  console.log('G) @멘션 → 대상 (긴 이름 우선 · 조사 허용 · 옛 부름)');
  ok(C.roomTargetFromText('@큐투 웹훅 확인') === 'cue2', '@큐투 → cue2 ( = @큐 로 새지 않음)');
  ok(C.roomTargetFromText('@큐 확인해줘') === 'cue', '@큐 → cue');
  ok(C.roomTargetFromText('@큐2 봐줘') === 'cue2', '@큐2(옛 부름) → cue2');
  ok(C.roomTargetFromText('@부이2 정리') === 'vooy2', '@부이2 → vooy2');
  ok(C.roomTargetFromText('@키투 예약') === 'keyring2', '@키투 → keyring2');
  ok(C.roomTargetFromText('@전체 모여라') === 'all', '@전체 → all');
  ok(C.roomTargetFromText('안녕 @피원님') === 'pi1', '@피원님(조사 붙음) → pi1');
  ok(C.roomTargetFromText('@노트북 이거 봐') === 'notebook', '@노트북 → notebook');
  ok(C.roomTargetFromText('@cue 한 줄만') === 'cue', '@cue(영문 id) → cue');
  ok(C.roomTargetFromText('멘션 없이 그냥 말') === '', '멘션 없으면 빈 값(기본 @노트북)');

  console.log('G2) 여러 이름 — 어느 쪽으로 적어도 그 비서 (2026-11-26)');
  const route = [['@큐투', 'cue2'], ['@큐2', 'cue2'], ['@cue2', 'cue2'],
    ['@뷔투', 'vooy2'], ['@부이2', 'vooy2'], ['@부이투', 'vooy2'], ['@vooy2', 'vooy2'],
    ['@키투', 'keyring2'], ['@키링2', 'keyring2'], ['@키링투', 'keyring2'], ['@keyring2', 'keyring2'],
    ['@피원', 'pi1'], ['@피클1', 'pi1'], ['@pi1', 'pi1'], ['@레이의피클', 'pi1'],
    ['@피투', 'pi2'], ['@피클2', 'pi2'], ['@pi2', 'pi2'],
    ['@큐', 'cue'], ['@부이', 'vooy'], ['@키링', 'keyring'], ['@노트북', 'notebook']];
  const missed = route.filter(([t, id]) => C.roomTargetFromText(t + ' 이거 봐줘') !== id);
  ok(missed.length === 0, '모든 별칭이 제 비서 앞으로 (틀린 것: ' + missed.map(x => x[0]).join(' ') + ')');
  ok(C.roomTargetFromText('@레이의피클 확인') === 'pi1', '@레이의피클 이 @레이 보다 먼저 잡힌다');
  ok(C.roomTargetFromText('@레이 확인') === '' && C.roomTargetFromText('@포털 확인') === '', '나를 부른 말은 대상을 바꾸지 않는다');
  ok(C.roomMentionMap()['@레이'] === 'portal' && C.roomMentionMap()['@피클1'] === 'pi1', '멘션표에 @레이·@피클1 도 있다');
  ok(C.roomAgentById('레이') === null || C.roomAgentById('레이').id === 'portal', '레이 는 나(portal)로 읽힌다');
  ok(C.roomSenderKey({source: '피클1'}) === 'pi1' && C.roomSenderKey({source: 'pickle-pi1'}) === 'pi1', '피클1 발신 → pi1');
  ok(C.roomSenderKey({source: '레이'}) === 'portal', '레이 발신 → 나');
  ok(C.roomTargetKey({target: '큐2'}) === 'cue2' && C.roomTargetKey({target: '키링2'}) === 'keyring2' && C.roomTargetKey({target: '부이2'}) === 'vooy2',
    'target 에 남은 옛 이름도 제 비서');
  // 포털(index.html)의 AGENT_ALIASES 와 같은 목록을 쓰는지 — 한쪽만 고치면 이름이 갈라진다
  const idx = read(path.join(ROOT, 'index.html'));
  const block = (idx.match(/const AGENT_ALIASES = \{([\s\S]*?)\n\};/) || [])[1] || '';
  const pairs = [...block.matchAll(/^\s*([a-z0-9_]+):\s*\[([^\]]*)\]/gm)].map(m => [m[1], [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1])]);
  ok(pairs.length >= 9, '포털의 AGENT_ALIASES 를 읽었다(' + pairs.length + '줄)');
  const drift = [];
  pairs.forEach(([id, names]) => names.forEach(nm => { if (C.roomMentionMap()['@' + nm] !== id) drift.push(nm); }));
  ok(drift.length === 0, '포털 별칭이 회의실에도 모두 있다 (빠진 것: ' + drift.join(' ') + ')');
  // 회의실 편대 이름은 모두 확정 호칭 — 옛 이름(큐2·부이2·키링2)으로 보이지 않는다
  const old = ['큐2', '부이2', '키링2'];
  ok(old.every(nm => !C.ROOM_AGENTS.some(a => a.name === nm)), '편대 호칭에 옛 이름이 없다(큐투·뷔투·키투)');
  ok(C.roomTargetLabel('cue2').label === '@큐투' && C.roomTargetLabel('vooy2').label === '@뷔투' && C.roomTargetLabel('keyring2').label === '@키투', '대상 라벨도 큐투·뷔투·키투');

  console.log('H) 발신자·대상·답장 주체');
  ok(C.roomSenderKey({source: 'pi1'}) === 'pi1', 'pi1');
  ok(C.roomSenderKey({source: 'pickle'}) === 'pi1', 'pickle(옛 이름) → pi1');
  ok(C.roomSenderKey({source: 'hub-agent'}) === 'notebook', 'hub-agent → notebook');
  ok(C.roomSenderKey({source: 'cue2'}) === 'cue2', 'cue2');
  ok(C.roomSenderKey({source: 'portal'}) === 'portal', 'portal');
  ok(C.roomSenderKey({source: '알수없음'}) === 'portal', '모르는 값은 portal');
  ok(C.roomIsMine({source: 'portal'}) === true, '내 말은 오른쪽');
  ok(C.roomIsMine({source: 'cue'}) === false, '비서 말은 왼쪽');
  ok(C.roomIsMine({source: 'phone'}) === true, '폰에서 보낸 말도 오른쪽');
  ok(C.roomTargetKey({target: 'all'}) === 'all', '대상 all');
  ok(C.roomTargetKey({target: 'cue2'}) === 'cue2', '대상 cue2');
  ok(C.roomTargetKey({}) === 'notebook', '대상 없음 → notebook(예전 배포)');
  ok(C.roomTargetLabel('portal').label === '@레이', '나를 가리키면 @레이');
  ok(C.roomTargetLabel('portal').name === '레이 님', '내 이름 표시는 레이 님');
  ok(C.roomTargetLabel('all').label === '@전체', '@전체 라벨');
  ok(C.roomTargetLabel('keyring2').label === '@키투', '부계정 라벨 @키투');
  ok(C.roomReplyKey({status: 'DONE', source: 'portal', replied_by: 'cue2'}) === 'cue2', '답장은 실제 답한 비서(cue2)');
  ok(C.roomReplyWhoKey({status: 'PENDING', target: 'cue', source: 'portal'}) === 'cue', '대기 중이면 받을 비서(cue) 앞에서 기다림');
  ok(C.roomReplyWhoKey({status: 'DONE', source: 'portal', target: 'notebook'}) === 'notebook', '답한 사람 기록이 없으면 나(레이 님)가 아니라 시킨 상대가 답한 것으로');
  ok(C.roomReplyWhoKey({status: 'DONE', source: 'portal', target: 'all'}) === 'notebook', '@전체 오더는 노트북이 답함');
  ok(C.roomReplyWhoKey({status: 'PENDING', target: 'all', source: 'portal'}) === 'portal', '@전체 대기는 말한 사람 앞');
  ok(C.roomNeedsWorker({kind: 'chat', target: 'cue', source: 'portal'}) === true, '내가 @큐 앞에 남긴 말은 처리자가 있음');
  ok(C.roomNeedsWorker({kind: 'chat', target: 'all', source: 'portal'}) === false, '@전체 대화는 노트북이 읽지 않는다(2026-11-26)');
  ok(C.roomNeedsWorker({kind: 'chat', target: 'notebook', source: 'portal'}) === true, '@노트북 대화는 노트북 몫');
  ok(C.roomNeedsWorker({kind: 'ask', target: 'all', source: 'portal'}) === true, '실행 오더의 @전체는 노트북 몫');
  ok(C.roomNeedsWorker({kind: 'chat', target: 'portal', source: 'cue2'}) === false, '비서가 나에게 남긴 순수 답장은 처리자 없음');
  ok(C.roomIsPlainReply({kind: 'chat', target: 'portal', source: 'cue2'}) === true, '순수 답장 판정');
  ok(C.roomShowReply({kind: 'chat', target: 'portal', source: 'cue2', status: 'DONE', summary: '출석!', result: '출석!'}) === false, '본문=결과인 순수 답장은 한 번만');
  ok(C.roomShowReply({kind: 'chat', target: 'portal', source: 'cue2', status: 'DONE', summary: '질문', result: '다른 답'}) === true, '내용이 다르면 답장 말풍선도');
  ok(C.roomShowReply({kind: 'chat', source: 'portal', target: 'portal', status: 'DONE', summary: '오더 답변', result: '네, 알겠습니다.'}) === false, '나에게 온 답장을 내가 단 것처럼 그리지 않음');
  ok(C.roomShowReply({kind: 'chat', source: 'portal', target: 'notebook', status: 'DONE', summary: '시험', result: '네'}) === true, '내가 @노트북 에 보낸 말의 답장은 그림');

  console.log('I) 본문 정리 · 상태 · 시각');
  ok(C.roomMsgText({kind: 'chat', summary: '클로드: 안녕'}) === '안녕', '"클로드: " 머리말 제거');
  ok(C.roomMsgText({kind: 'chat', summary: '할 일 [워커 규칙] 셸 규칙…'}) === '할 일', '[워커 규칙] 문구 제거');
  ok(C.roomMsgText({summary: 'README 수정 (파일 수정) · 엔진 claude'}) === 'README 수정', '오더 꼬리표 제거');
  ok(C.roomStatus({status: 'DONE'}).t === '완료', 'DONE → 완료');
  ok(C.roomStatus({status: 'WAITING_APPROVAL'}).c === 'wait', '승인 대기는 wait 색');
  ok(C.roomStatus({status: '???'}).t === '???', '모르는 상태도 글자는 보임');
  const now = new Date(2026, 10, 25, 20, 46).getTime();
  ok(C.roomWhen(new Date(2026, 10, 25, 9, 5).toISOString(), now) === '09:05', '오늘은 HH:MM');
  ok(C.roomWhen(new Date(2026, 10, 24, 19, 1).toISOString(), now) === '11/24 19:01', '어제는 M/D HH:MM');
  ok(C.roomWhen('', now) === '', '시각 없으면 빈 값');
  ok(C.roomDay(new Date(2026, 10, 25, 1, 0).toISOString(), now) === '오늘', '날짜 구분 오늘');
  ok(C.roomDay(new Date(2026, 10, 24, 1, 0).toISOString(), now) === '어제', '날짜 구분 어제');
  ok(C.roomDay(new Date(2026, 10, 20, 1, 0).toISOString(), now) === '11월 20일', '그 전은 M월 D일');
  ok(C.roomAgo(0.4) === '방금', '방금');
  ok(C.roomAgo(3) === '3분 전', '3분 전');
  ok(C.roomAgo(65) === '1시간 5분 전', '1시간 5분 전');
  ok(C.roomJosa('부이', '이', '가') === '가' && C.roomJosa('큐', '이', '가') === '가', '받침 없으면 가');
  ok(C.roomJosa('노트북', '이', '가') === '이' && C.roomJosa('키링', '이', '가') === '이', '받침 있으면 이');
  ok(C.roomJosa('cue', '이', '가') === '이(가)', '한글이 아니면 이(가)');
  ok(C.roomUseState(5) === 'danger' && C.roomUseState(20) === 'soon' && C.roomUseState(50) === 'ok' && C.roomUseState(null) === 'unknown', '잔여 % 기준(위험<10·임박<30)');

  console.log('J) 말풍선 마크다운 — 안전(escape) + 줄바꿈·굵게·목록·코드·멘션');
  const evil = C.roomMd('<img src=x onerror="alert(1)">');
  ok(evil.indexOf('<img') < 0 && evil.indexOf('&lt;img') > -1, 'HTML 은 글자로만');
  ok(C.roomMd('**굵게**').indexOf('<strong>굵게</strong>') > -1, '**굵게**');
  ok(C.roomMd('첫 줄\n둘째 줄').indexOf('\n') > -1, '줄바꿈 보존');
  ok(C.roomMd('- 하나\n- 둘').indexOf('•') > -1, '목록 → •');
  ok(C.roomMd('```\ncode <b>\n```').indexOf('<pre class="code">') > -1, '코드블록');
  ok(C.roomMd('```\ncode <b>\n```').indexOf('<b>') < 0, '코드블록 안도 escape');
  ok(C.roomMd('@큐 확인').indexOf('<b class="mt') > -1, '@멘션은 칩으로');
  ok(C.roomMd('https://example.com/a').indexOf('<a href="https://example.com/a"') > -1, '링크는 새 창');
  const mdLink = C.roomMd('[월간 달력](https://example.com/a) 확인');
  ok(mdLink.indexOf('>월간 달력</a>') > -1, '[이름](주소) 마크다운 링크');
  ok((mdLink.match(/<a /g) || []).length === 1, '마크다운 링크가 두 번 감싸지지 않음');
  ok(C.roomMd('본문 https://example.com/a.').indexOf('href="https://example.com/a"') > -1, '문장 끝 마침표는 링크 밖');
  ok(C.roomMd('[x](javascript:alert(1))').indexOf('<a ') < 0, 'javascript: 마크다운 링크도 막힘');
  ok(C.roomMd('javascript:alert(1)').indexOf('<a ') < 0, 'javascript: 는 링크가 아님');
  ok(C.esc('"&\'<>') === '&quot;&amp;&#39;&lt;&gt;', 'esc 기본');

  console.log('K) 보내는 곳(작업 위치) — 서버가 준 허용 목록 안에서만');
  ok(C.roomWsPick(['gaegyebu', 'hub-agent'], 'gaegyebu') === 'gaegyebu', '저장한 곳이 허용 목록에 있으면 그대로');
  ok(C.roomWsPick(['gaegyebu', 'hub-agent'], 'smartstore-hub') === 'hub-agent', '목록에 없는 저장값이면 hub-agent');
  ok(C.roomWsPick(['gaegyebu'], '') === 'gaegyebu', 'hub-agent 가 없으면 첫 번째');
  ok(C.roomWsPick([], 'gaegyebu') === '', '목록을 모를 때는 빈 값(보내기가 hub-agent 로 보충)');
  ok(C.roomWsName('gaegyebu') === '가계부' && C.roomWsName('hub-agent').indexOf('허브') > -1, '작업 위치 한글 이름');

  console.log('L) 최근 활동·온라인 수');
  const nowMs = Date.now();
  const items = [
    {id: '1', source: 'pi1', target: 'portal', kind: 'chat', status: 'DONE', created_at: new Date(nowMs - 5 * 60000).toISOString()},
    {id: '2', source: 'portal', target: 'cue', kind: 'chat', status: 'PENDING', created_at: new Date(nowMs - 2 * 60000).toISOString()},
    {id: '3', source: 'portal', target: 'notebook', kind: 'chat', status: 'DONE', created_at: new Date(nowMs - 60 * 60000).toISOString(),
      replied_by: 'notebook', finished_at: new Date(nowMs - 59 * 60000).toISOString(), result: '네'}
  ];
  const act = C.roomLastActivity(items, nowMs);
  ok(Math.round(act.pi1) === 5, '피원 최근 활동 5분');
  ok(act.portal === undefined, '나(portal)는 활동 지도에서 빠짐');
  ok(act.notebook !== undefined && Math.round(act.notebook) === 59, '답한 노트북도 활동으로');
  ok(C.roomOnlineCount(items, {heartbeat: {state: 'ok', min: 1}}, nowMs) === 2, '활동 비서 1명 + 노트북 하트비트 = 2');
  ok(C.roomOnlineCount([], {heartbeat: {state: 'unknown', min: null}}, nowMs) === 0, '신호 없으면 0명');

  console.log('M) 사용량 표시 — 포털 PR #4 정책(리셋 경계·가동 신호·비공개)');
  {
    const now = new Date(2026, 10, 25, 22, 30).getTime();        // 2026-11-25(수) 22:30
    const at = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi).toISOString();
    ok(C.ROOM_USE_TXT.na === '비공개', '상태 글에 비공개가 있음');
    ok(C.ROOM_USE_ALIVE_MIN === 24 * 60, '가동 신호 유효 시간 24시간');
    ok(C.roomResetOf('pi1') === 'daily04' && C.roomResetOf('pc') === 'weekly', '일일 04:00 · 회사 PC만 주간');

    // 이번 주기 경계
    ok(C.roomCycleStart('pi1', now) === new Date(2026, 10, 25, 4, 0).getTime(), '일일 주기 시작 = 오늘 04:00');
    ok(C.roomCycleStart('pi1', new Date(2026, 10, 25, 3, 30).getTime()) === new Date(2026, 10, 24, 4, 0).getTime(),
      '04:00 전이면 어제 04:00');
    ok(C.roomCycleStart('pc', now) === new Date(2026, 10, 23, 9, 0).getTime(), '주간 주기 시작 = 이번 주 월요일 09:00');
    ok(C.roomCycleStart('pc', new Date(2026, 10, 23, 8, 0).getTime()) === new Date(2026, 10, 16, 9, 0).getTime(),
      '월요일 09:00 전이면 지난 월요일');
    ok(C.roomResetAt('pi1', now) === new Date(2026, 10, 26, 4, 0).getTime(), '다음 일일 리셋 = 내일 04:00');
    ok(C.roomResetAt('pc', now) === new Date(2026, 10, 30, 9, 0).getTime(), '다음 주간 리셋 = 월요일 09:00');
    ok(C.roomResetText('pi1', now) === '리셋 5시간 30분 후', '리셋까지 남은 시간 문구');

    // 지난 값은 무효
    ok(C.roomUseFresh('pi1', {pct: 85, at: at(2026, 10, 25, 5, 0)}, now) === true, '04:00 이후 보고는 이번 주기');
    ok(C.roomUseFresh('pi1', {pct: 85, at: at(2026, 10, 25, 3, 59)}, now) === false, '04:00 전 보고는 지난 주기');
    ok(C.roomUseFresh('pi1', {pct: 85}, now) === false, '시각 없는 기록은 믿지 않음');
    ok(C.roomUseFresh('pc', {pct: 40, at: at(2026, 10, 23, 8, 0)}, now) === false, '주간은 월요일 09:00 전 보고를 지난 값으로');
    ok(C.roomUseFresh('pc', {pct: 40, at: at(2026, 10, 23, 10, 0)}, now) === true, '주간은 월요일 09:00 이후 보고를 이번 주기로');

    // 상태 파일 → 신호
    const srv = {
      updated_at: at(2026, 10, 25, 19, 30), agent: {state: 'idle'},
      pi2: {updated_at: at(2026, 10, 25, 19, 0), agent: {state: 'working'}},
      pc: {updated_at: at(2026, 10, 25, 18, 0), state: 'working'}
    };
    ok(C.roomSignalOf(srv, 'pi1').at === at(2026, 10, 25, 19, 30), '서버 agent_status → pi1 신호');
    ok(C.roomSignalOf(srv, 'pi2').state === 'working', '서버 pi2 블록 → pi2 신호');
    ok(C.roomSignalOf({pi2: {updated_at: at(2026, 10, 25, 18, 0), state: 'working'}}, 'pi2').state === 'working',
      'agent_beat 의 평평한 pi2 비트도 읽음');
    ok(C.roomSignalOf(srv, 'pc').at === at(2026, 10, 25, 18, 0), '서버 pc 비트 → pc 신호');
    ok(C.roomSignalOf(srv, 'cue') === null, '상태 파일이 없는 비서는 신호 없음');
    const filePi2 = {version: 1, updated_at: at(2026, 10, 25, 17, 20), agent: {state: 'idle'}};
    ok(C.roomSignalsFrom(filePi2, 'pi2').pi2.at === at(2026, 10, 25, 17, 20), 'status/pi2.json 한 사람 모양 → pi2 신호');
    ok(C.roomSignalsFrom(filePi2, 'server').pi2 === undefined, '한 사람 모양을 서버 모양으로 읽지 않음');
    ok(C.roomSignalMin(C.roomSignalOf(srv, 'pi1'), now) === 180, '신호 3시간 전');
    ok(C.roomSignalLive({at: at(2026, 10, 24, 22, 31)}, now) === true, '23시간 59분 전 신호는 살아 있음');
    ok(C.roomSignalLive({at: at(2026, 10, 24, 22, 29)}, now) === false, '24시간 넘은 신호는 가동 중이라 하지 않음');
    ok(C.roomSignalLive(null, now) === false, '신호가 없으면 살아 있지 않음');

    // 카드 하나의 상태 = 숫자 → 신호 → 미확인
    const livePi2 = C.roomSignalOf(srv, 'pi2');
    ok(C.roomStateOf('pi1', {pct: 5, at: at(2026, 10, 25, 12, 0)}, null, now) === 'danger', '이번 주기 숫자가 있으면 그 숫자로');
    ok(C.roomStateOf('pi2', {pct: 90, at: at(2026, 10, 25, 3, 0)}, livePi2, now) === 'na', '지난 값 + 가동 신호 → 비공개');
    ok(C.roomStateOf('pi2', {pct: 90, at: at(2026, 10, 25, 3, 0)}, {at: at(2026, 10, 20, 9, 0)}, now) === 'unknown',
      '지난 값 + 오래된 신호 → 미확인');
    ok(C.roomStateOf('cue', null, null, now) === 'unknown', '아무 기록도 없으면 미확인');
    ok(C.roomStateOf('cue', {pct: 20, at: at(2026, 10, 25, 20, 0)}, null, now) === 'soon', '임박 <30');

    // 화면 문구 — 숫자를 지어내지 않고, 지운 값은 지웠다고 말한다
    const vOk = C.roomUseView('pi1', {pct: 85, at: at(2026, 10, 25, 22, 20)}, null, now);
    ok(vOk.label === '잔여 85%' && vOk.state === 'ok', '이번 주기 숫자는 잔여 N%');
    ok(vOk.note.indexOf('보고 10분 전') === 0, '언제 보고된 값인지 함께');
    const vNa = C.roomUseView('pi2', null, livePi2, now);
    ok(vNa.label === '잔여 비공개' && vNa.state === 'na' && vNa.pct === null, '신호만 있으면 잔여 비공개(숫자 없음)');
    ok(vNa.note === '작업 중 · 신호 3시간 30분 전', '가동 중 문구와 신호 시각');
    const vNaStale = C.roomUseView('pi2', {pct: 90, at: at(2026, 10, 25, 3, 0)}, livePi2, now);
    ok(vNaStale.label === '잔여 비공개' && vNaStale.note.indexOf('지난 값 90% 지움') > -1,
      '지난 값이 있어도 지웠다고 함께 말함(숫자를 다시 보여지 않음)');
    const vStale = C.roomUseView('pi1', {pct: 85, at: at(2026, 10, 25, 3, 0)}, null, now);
    ok(vStale.label === '— 새 보고 대기' && vStale.pct === null, '지난 값은 화면에서 내림');
    ok(vStale.note.indexOf('지난 값 85%는 지웠어요') > -1, '지운 값을 말해 줌');
    ok(vStale.stale === true, '지난 값 표시');
    ok(C.roomUseView('cue', null, null, now).label === '— 미확인', '아무 신호 없으면 미확인');

    // 요약 — 포털과 같은 다섯 칸
    const c = C.roomUseSummary(['pi1', 'pi2', 'cue', 'vooy'],
      {pi1: {pct: 50, at: at(2026, 10, 25, 12, 0)}, pi2: {pct: 90, at: at(2026, 10, 25, 3, 0)}, cue: {pct: 5, at: at(2026, 10, 25, 12, 0)}},
      {pi2: livePi2}, now);
    ok(c.ok === 1 && c.na === 1 && c.danger === 1 && c.unknown === 1, '숫자·지난 값·신호·미확인을 각각 셈');
    ok(['danger', 'soon', 'ok', 'na', 'unknown'].every(k => C.ROOM_USE_TXT[k]), '다섯 상태 모두 문구가 있음');
    ok(/\.pill\.na/.test(css) && /\.fill\.na/.test(css), '비공개 알약·막대 스타일이 있음');
    ok(/(새 보고 대기)/.test(js) && /(가동 중)/.test(js), '지난 값·가동 중 문구가 화면 코드에 있음');
    ok(/room_sig_cache/.test(js) && /status\/agent\.json/.test(js) && /status\/pi2\.json/.test(js), '가동 신호는 저장소 상태 파일에서도 읽음');
  }

  console.log('N-1) 🔴 지금 작업 중 — 작업중 리스트 · 누가 일하는지 (2026-11-26)');
  {
    const now = new Date(2026, 10, 26, 12, 0).getTime();          // 2026-11-26(목) 12:00
    const at = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi).toISOString();
    const items = [
      {id: 'L1', status: 'PENDING', kind: 'ask', source: 'portal', target: 'cue', created_at: at(2026, 10, 26, 11, 40)},
      {id: 'L2', status: 'RUNNING', kind: 'ask', source: 'portal', target: 'notebook', claimed_by: 'notebook',
        created_at: at(2026, 10, 26, 11, 30), started_at: at(2026, 10, 26, 11, 32)},
      {id: 'L3', status: 'DONE', kind: 'ask', source: 'portal', target: 'notebook', created_at: at(2026, 10, 26, 10, 0)},
      {id: 'L4', status: 'WAITING_APPROVAL', kind: 'ask', source: 'portal', created_at: at(2026, 10, 26, 11, 50),
        expires_in_ms: 600000},
      {id: 'L5', status: 'PENDING', kind: 'chat', source: 'portal', target: 'all', created_at: at(2026, 10, 26, 11, 55)},
      {id: 'L6', status: 'PENDING', kind: 'chat', source: 'cue', target: 'portal', created_at: at(2026, 10, 26, 11, 58)}
    ];
    const live = C.roomLiveItems(items);
    ok(live.map(x => x.state).join(',') === 'RUNNING,WAITING_APPROVAL,PENDING,PENDING',
      '실행 중 → 승인 대기 → 차례 대기 순(같은 상태는 먼저 접수된 것부터)');
    ok(live.map(x => x.it.id).join(',') === 'L2,L4,L1,L5', '끝난 오더(L3)·순수 답장(L6)은 작업중 리스트에 없음');
    ok(C.roomLiveOwner({status: 'RUNNING', claimed_by: 'notebook', target: 'cue'}) === 'notebook', '실행 중이면 잡은 비서');
    ok(C.roomLiveOwner({status: 'PENDING', target: 'cue'}) === 'cue', '대기는 받을 비서');
    ok(C.roomLiveOwner({status: 'PENDING'}) === 'notebook', '대상 없는 오더는 노트북 몫');
    ok(C.roomLiveOwner({status: 'PENDING', target: 'all'}) === '', '@전체는 아직 주인 없음');
    ok(C.roomLiveOwner({status: 'DONE', target: 'cue'}) === '', '끝난 오더는 주인 없음');
    ok(C.roomLiveSince({status: 'RUNNING', started_at: at(2026, 10, 26, 11, 32), created_at: at(2026, 10, 26, 11, 30)}) ===
      new Date(2026, 10, 26, 11, 32).getTime(), '실행은 시작 시각부터');
    ok(C.roomLiveSince({status: 'PENDING', created_at: at(2026, 10, 26, 11, 40)}) === new Date(2026, 10, 26, 11, 40).getTime(),
      '대기는 접수 시각부터');
    ok(C.roomDur(12000) === '12초' && C.roomDur(180000) === '3분' && C.roomDur(3900000) === '1시간 5분' && C.roomDur(-1) === '',
      '경과 문구(초·분·시간)');
    ok(C.roomLiveWhat({kind: 'chat', summary: '클로드: 큐 확인 [워커 규칙] 셸'}) === '큐 확인', '요약에서 머리말·워커 규칙을 뗌');
    ok(C.roomLiveWhat({summary: 'x'.repeat(90)}).length === 71, '긴 줄은 70자 + …로 줄임');

    // 누가 일하나 — 작업 중 → 한도 소진 → 대기 → 쉬는 중 → 응답 없음/미확인
    ok(C.roomAgentAct('notebook', items, {}, {}, null, now).state === 'work', '노트북은 지금 실행 중');
    ok(C.roomAgentAct('notebook', items, {}, {}, null, now).n === 2, '잡고 있는 일 2건(실행 + 승인 대기)');
    ok(C.roomAgentAct('cue', items, {}, {}, null, now).state === 'work', '큐도 내 앞 PENDING 을 받아서 작업 중');
    ok(C.roomAgentAct('vooy', items, {}, {}, null, now).state === 'unknown', '신호·기록 없는 비서는 미확인(지어내지 않음)');
    ok(C.roomAgentAct('pi1', items, {pi1: {at: at(2026, 10, 26, 11, 55), state: 'idle'}}, {}, null, now).state === 'wait',
      '5분 전 신호 = 대기');
    ok(C.roomAgentAct('pi1', items, {pi1: {at: at(2026, 10, 26, 10, 0), state: 'idle'}}, {}, null, now).state === 'idle',
      '2시간 전 신호 = 쉬는 중');
    ok(C.roomAgentAct('pi1', items, {pi1: {at: at(2026, 10, 25, 6, 0), state: 'working'}}, {}, null, now).state === 'out',
      '하루 넘은 신호 = 응답 없음');
    ok(C.roomAgentAct('keyring', items, {}, {keyring: {pct: 0, at: at(2026, 10, 26, 11, 0)}}, null, now).state === 'limit',
      '이번 주기 잔여 0% = 한도 소진');
    ok(C.roomAgentAct('cue', items, {}, {cue: {pct: 0, at: at(2026, 10, 26, 11, 0)}}, null, now).state === 'work',
      '한도 0 이어도 잡고 있는 일이 있으면 작업 중');
    ok(C.roomAgentAct('notebook', [], {}, {}, {heartbeat: {state: 'ok', min: 2}}, now).state === 'wait', '노트북 하트비트 2분 = 대기');
    ok(C.roomAgentAct('notebook', [], {}, {}, {heartbeat: {state: 'unknown', min: null}}, now).state === 'unknown',
      '시트 시각만으로는 가동이라 말하지 않음(heartbeat unknown)');
    const cnt = C.roomActCounts(['pi1', 'pi2', 'notebook', 'cue', 'vooy'], items,
      {pi1: {at: at(2026, 10, 26, 11, 55)}}, {}, null, now);
    ok(cnt.work === 2 && cnt.wait === 1 && cnt.unknown === 2, '작업 중·대기·미확인을 각각 센다');

    // 화면·CSS 계약
    ok(/id="live"/.test(html), 'index.html 에 #live 자리');
    ok(/지금 작업 중/.test(js), '화면 문구 "지금 작업 중"');
    ok(/function renderLive\(\)/.test(js) && (js.match(/renderLive\(\)/g) || []).length >= 3, 'renderLive 가 머리말·사용량·신호에서 다시 그려진다');
    ok(/data-since/.test(js) && /function tickLive\(\)/.test(js), '경과는 1초마다 글자만 고침');
    ok(/\.live\{/.test(css) && /\.lw-el/.test(css) && /\.live-a\.work/.test(css), '작업 판·경과·가동 칩 스타일');
    ok(!/onclick=/.test(html), '인라인 onclick 없음(동작은 app.js 가 붙임)');
    ok(/data-go=/.test(js) && /jumpToMsg/.test(js), '일 칩을 누르면 그 말로 이동');
    ok(/ROOM_LIVE_MAX/.test(js) && /live-more/.test(js) && /\.live-more/.test(css), '줄은 3개까지 — 나머지는 "+N건 더"');
  }

  console.log('N) 🎨 비서 마크 — 계열·호기 구분 (2026-11-26)');
  {
    const mark = id => C.roomMark(id);
    const IDS = C.ROOM_AGENTS.map(a => a.id);
    const sigs = IDS.map(id => mark(id).replace(/ title="[^"]*"/g, ''));
    ok(new Set(sigs).size === 9, '편대 9명의 마크가 모두 다르다');
    ok(/class="mk mk-pi1"/.test(mark('pi1')) && /class="mk mk-pi2 v2"/.test(mark('pi2')), '피원은 초록 채움 · 피투는 청록 테두리');
    ok(/class="mk mk-cue"/.test(mark('cue')) && /class="mk mk-cue2 v2"/.test(mark('cue2')), '큐는 다크 채움 · 큐투는 밝은 테두리');
    ok(/class="mk mk-vooy"/.test(mark('vooy')) && /class="mk mk-vooy2 v2"/.test(mark('vooy2')), '부이는 보라 채움 · 뷔투는 테두리');
    ok(/class="mk mk-key"/.test(mark('keyring')) && /class="mk mk-key2 v2"/.test(mark('keyring2')), '키링은 앰버 채움 · 키투는 테두리');
    ok(/class="mk mk-nb"/.test(mark('notebook')) && !/mk-b/.test(mark('notebook')), '노트북은 블루 모니터 마크·배지 없음');
    ok(/<span class="mk-b">1<\/span>/.test(mark('pi1')) && /<span class="mk-b">2<\/span>/.test(mark('cue2')), '1·2 숫자 배지로 호기를 가른다');
    ok(!/mk-b/.test(C.roomMark('cue2', {mini: true})), '작은 칩(mini)은 배지를 뻐다');
    ok(/<svg/.test(mark('keyring')) && !/<img|https?:\/\//.test(IDS.map(mark).join('')), '외부 이미지 없이 인라인 SVG');
    // 옛 부름·영문 id 도 같은 마크
    ok(C.roomMarkInfo('큐투').c === C.roomMarkInfo('cue2').c && C.roomMarkInfo('cue2').n === 2, '옛 부름(큐투)도 같은 마크');
    ok(C.roomMarkInfo('keyring2').c === 'mk-key2' && C.roomMarkInfo('keyring2').n === 2, '키투는 키링 계열 2호기');
    ok(C.roomMarkInfo('cue3').c === 'mk-cue' && C.roomMarkInfo('cue3').n === 3, '새 부계정 cue3 도 큐 계열·3호기');
    ok(C.roomMarkInfo('모르는이름').g === 'me' && C.roomMarkInfo('portal').c === 'mk-me', '모르는 id 는 내 마크로 안전하게');
    // 화면 곳곳이 같은 마크를 쓴다
    ok(/roomMark\(/.test(js) && (js.match(/roomMark\(/g) || []).length >= 8, '아바타·이름·칩·관제·서람이 모두 roomMark 를 쓴다');
    ok(/\.mk\{/.test(css) && /\.mk\.v2\{/.test(css) && /\.mk-pi2\{/.test(css) && /\.mk-key2\{/.test(css), '마크·테두리·계열 색 스타일');
    ok(!/<img/.test(js) && !/cdn\.[a-z]/i.test(css), 'CDN 이미지에 기대지 않는다');
  }

  console.log('O) 비밀값 하드코딩 없음 (공개 저장소)');
  const all = html + js + css + sw;
  ok(!/AKfycb[0-9A-Za-z_-]{20,}/.test(all), 'Apps Script 주소 없음');
  ok(!/AIza[0-9A-Za-z_-]{20,}/.test(all), '구글 API 키 없음');
  ok(!/[0-9a-f]{64}/.test(all), '64자리 비밀 키 모양 없음');
  ok(js.indexOf('portal_server_url') > -1 && js.indexOf('portal_server_key') > -1, '포털과 같은 저장 키를 씀(자동 인식)');
}

let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  coreTests();
  console.log(`\n회의실(room/) 테스트: ${pass}건 통과, ${fail}건 실패`);
  process.exit(fail ? 1 : 0);
}
