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
    'roomAgo', 'roomUseState', 'roomMd', 'roomLinks', 'roomWsPick', 'roomWsName', 'roomJosa', 'roomLastActivity', 'roomOnlineCount', 'esc'];
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
  ok(C.roomTargetLabel('portal').label === '@성래', '나를 가리키면 @성래');
  ok(C.roomTargetLabel('all').label === '@전체', '@전체 라벨');
  ok(C.roomTargetLabel('keyring2').label === '@키투', '부계정 라벨 @키투');
  ok(C.roomReplyKey({status: 'DONE', source: 'portal', replied_by: 'cue2'}) === 'cue2', '답장은 실제 답한 비서(cue2)');
  ok(C.roomReplyWhoKey({status: 'PENDING', target: 'cue', source: 'portal'}) === 'cue', '대기 중이면 받을 비서(cue) 앞에서 기다림');
  ok(C.roomReplyWhoKey({status: 'DONE', source: 'portal', target: 'notebook'}) === 'notebook', '답한 사람 기록이 없으면 나(성래 님)가 아니라 시킨 상대가 답한 것으로');
  ok(C.roomReplyWhoKey({status: 'DONE', source: 'portal', target: 'all'}) === 'notebook', '@전체 오더는 노트북이 답함');
  ok(C.roomReplyWhoKey({status: 'PENDING', target: 'all', source: 'portal'}) === 'portal', '@전체 대기는 말한 사람 앞');
  ok(C.roomNeedsWorker({kind: 'chat', target: 'cue', source: 'portal'}) === true, '내가 @큐 앞에 남긴 말은 처리자가 있음');
  ok(C.roomNeedsWorker({kind: 'chat', target: 'portal', source: 'cue2'}) === false, '비서가 나에게 남긴 순수 답장은 처리자 없음');
  ok(C.roomIsPlainReply({kind: 'chat', target: 'portal', source: 'cue2'}) === true, '순수 답장 판정');
  ok(C.roomShowReply({kind: 'chat', target: 'portal', source: 'cue2', status: 'DONE', summary: '출석!', result: '출석!'}) === false, '본문=결과인 순수 답장은 한 번만');
  ok(C.roomShowReply({kind: 'chat', target: 'portal', source: 'cue2', status: 'DONE', summary: '질문', result: '다른 답'}) === true, '내용이 다르면 답장 말풍선도');

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

  console.log('M) 비밀값 하드코딩 없음 (공개 저장소)');
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
