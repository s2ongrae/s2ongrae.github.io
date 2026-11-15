// 홈 화면 앱 아이콘(PWA): 홈 화면에 추가했을 때 앱처럼 열리게 하는 매니페스트·아이콘·head 태그
// - 아이콘 PNG 는 실제 크기(192·512)까지 본다. Service Worker 는 일부러 넣지 않는다(캐시 꼬임 방지).
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const head = (html.match(/<head>([\s\S]*?)<\/head>/) || [, ''])[1];
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌', m); } };

// PNG IHDR: 8바이트 시그니처 뒤 4바이트 길이·'IHDR'·width(4)·height(4)
function pngSize(file) {
  const buf = fs.readFileSync(file);
  const sig = '89504e470d0a1a0a';
  if (buf.subarray(0, 8).toString('hex') !== sig) return null;
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

console.log('A) manifest.webmanifest — 김성래 포털, 홈 화면에서 단독 앱으로');
let manifest = null;
{
  const p = path.join(ROOT, 'manifest.webmanifest');
  ok(fs.existsSync(p), 'manifest.webmanifest 파일이 있음');
  try { manifest = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { ok(false, 'JSON 으로 읽힘: ' + e.message); }
  if (manifest) {
    ok(manifest.name === '김성래 포털', 'name = 김성래 포털');
    ok(manifest.short_name === '성래포털', 'short_name = 성래포털 (홈 화면 라벨이 잘리지 않게 짧게)');
    ok(manifest.start_url === './', 'start_url = ./ (사이트 뿌리)');
    ok(manifest.scope === './', 'scope = ./');
    ok(manifest.display === 'standalone', 'display = standalone (주소창 없이)');
    ok(/^#[0-9A-Fa-f]{6}$/.test(manifest.background_color), 'background_color 는 #RRGGBB');
    ok(/^#[0-9A-Fa-f]{6}$/.test(manifest.theme_color), 'theme_color 는 #RRGGBB');
    ok(manifest.lang === 'ko', 'lang = ko');
  }
}

console.log('B) 아이콘 파일 — 192·512 실제 크기와 매니페스트 연결');
{
  const icons = (manifest && manifest.icons) || [];
  ok(icons.length === 2, 'icons 항목 2개(192·512)');
  for (const [want, src] of [[192, 'icons/icon-192.png'], [512, 'icons/icon-512.png']]) {
    const entry = icons.find(i => String(i.sizes).split(/\s+/).includes(`${want}x${want}`));
    ok(!!entry, `${want}px 항목이 있음`);
    if (!entry) continue;
    ok(entry.src === src, `${want}px src = ${src}`);
    ok(entry.type === 'image/png', `${want}px type = image/png`);
    ok(/maskable/.test(entry.purpose || ''), `${want}px purpose 에 maskable (안드로이드가 모양을 잘라도 안전) — 배경이 꽉 차 있고 글자는 가운데`);
    const f = path.join(ROOT, entry.src);
    ok(fs.existsSync(f), `${src} 파일이 있음`);
    if (fs.existsSync(f)) {
      const size = pngSize(f);
      ok(!!size, `${src} 가 진짜 PNG`);
      if (size) ok(size.w === want && size.h === want, `${src} 실제 크기 ${size.w}x${size.h} = ${want}x${want}`);
      ok(fs.statSync(f).size < 200 * 1024, `${src} 크기 ${Math.round(fs.statSync(f).size / 1024)}KB (<200KB)`);
    }
  }
  // 매니페스트에 적은 다른 아이콘도 실제로 있는지
  for (const i of icons) ok(fs.existsSync(path.join(ROOT, i.src)), `매니페스트의 모든 아이콘 경로가 실제 파일: ${i.src}`);
}

console.log('C) index.html head — 매니페스트·아이콘·테마 태그');
{
  ok(/<link[^>]+rel="manifest"[^>]+href="manifest\.webmanifest"/.test(head), 'link rel=manifest');
  ok(/<link[^>]+rel="icon"[^>]+href="icons\/icon-192\.png"/.test(head), 'link rel=icon (탭 아이콘)');
  ok(/<link[^>]+rel="apple-touch-icon"[^>]+href="icons\/icon-192\.png"/.test(head), 'link rel=apple-touch-icon (아이폰 홈 화면)');
  ok(/<meta[^>]+name="theme-color"[^>]+content="#[0-9A-Fa-f]{6}"/.test(head), 'meta theme-color');
  ok(/<meta[^>]+name="mobile-web-app-capable"[^>]+content="yes"/.test(head), 'meta mobile-web-app-capable');
  ok(/<meta[^>]+name="viewport"[^>]+width=device-width/.test(head), 'viewport 는 그대로');
}

console.log('D) Service Worker 는 넣지 않는다 (캐시가 꼬여 예전 화면이 남는 것 방지)');
{
  ok(!/serviceWorker/.test(html), 'index.html 에 serviceWorker 등록 없음');
  ok(!fs.existsSync(path.join(ROOT, 'sw.js')) && !fs.existsSync(path.join(ROOT, 'service-worker.js')), 'sw.js 파일 없음');
}

console.log(`\nPWA 홈 화면 아이콘 테스트: ${pass}건 통과, ${fail}건 실패`); process.exit(fail ? 1 : 0);
