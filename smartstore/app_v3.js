/* app_v3.js — 묘한살림 운영 대시보드 v3 (8탭)
 * 데이터: data.enc.json (AES-GCM · PBKDF2-SHA256) → 복호화 결과는 메모리에만.
 * 계산: v3_core.js 한 벌(노드 테스트와 같은 코드). 업로드: v3_upload.js(이 기기에서만).
 *
 * 원칙
 *  - 12월(매출 0원)에는 storeMode=PRE_OPEN_PREP 로 홈을 '오픈 준비도'로 바꾼다.
 *    dataMode=DEMO 는 합성 픽스처로 그래프·경보를 그대로 검증하는 스위치다(상단 주황 배지).
 *  - 쓰기는 이 화면에서 스토어로 나가지 않는다(2027-01-02 이전 WRITE_ENABLED=false).
 *    버튼은 확인창 → 복사용 JSON 까지만 한다.
 */
'use strict';

const LS = {
  pass: 'myohan.pass',
  mask: 'myohan.mask',
  tab: 'myohan.tab.v3',
  storeMode: 'myohan.v3.storeMode',
  dataMode: 'myohan.v3.dataMode',
  orders45: 'myohan.orders',
  closing: 'myohan.closing',
  runbook: 'myohan.runbook',
  traffic: 'myohan.v3.traffic',
  candidates: 'myohan.v3.candidates',
};

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const Core = window.V3Core;

let MODEL = null;
let V3 = null;
let MASK = true;
let STORE_MODE = 'PRE_OPEN_PREP';
let DATA_MODE = 'DEMO';
let ORDER_FILTER = null;
let UPLOAD = null; // 업로드한 유입 데이터 {rows, channels, keywords, funnel, savedAt, source}

const readLS = (k, f) => { try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch (e) { return f; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 공간 없음 */ } };

const num = (v) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : null);
const fmt = (v) => (num(v) == null ? '—' : num(v).toLocaleString('ko-KR'));
const won = (v) => (num(v) == null ? '—' : `${num(v).toLocaleString('ko-KR')}원`);
const secret = (v, suffix) => (MASK ? '•••' : (num(v) == null ? '—' : `${fmt(v)}${suffix || ''}`));
const pct = (v) => (num(v) == null ? '—' : `${num(v)}%`);

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 1800);
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('복사했습니다')).catch(() => fallbackCopy(text));
  } else fallbackCopy(text);
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); toast('복사했습니다'); } catch (e) { toast('복사 실패'); }
  ta.remove();
}

function openSheet(html) {
  $('#sheetIn').innerHTML = html + '<button class="btn ghost block" id="sheetClose" style="margin-top:10px">닫기</button>';
  $('#sheet').hidden = false;
  $('#sheetClose').onclick = () => { $('#sheet').hidden = true; };
}
$('#sheet').addEventListener('click', (ev) => { if (ev.target.id === 'sheet') $('#sheet').hidden = true; });

/* ─────────────── 암호 해제 · 부팅 ─────────────── */
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function decryptPayload(payload, passphrase) {
  const salt = b64(payload.kdf.salt);
  const iv = b64(payload.cipher.iv);
  const ct = b64(payload.ct);
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: payload.kdf.iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(plain));
}

function showLock(message) {
  $('#lockScreen').hidden = false;
  $('#hdr').hidden = true;
  $('#main').hidden = true;
  $('#lockErr').textContent = message || '';
  setTimeout(() => { try { $('#pass').focus(); } catch (e) {} }, 120);
  MODEL = null; V3 = null;
}

function showApp() {
  $('#lockScreen').hidden = true;
  $('#lockErr').textContent = '';
  $('#hdr').hidden = false;
  $('#main').hidden = false;
  STORE_MODE = readLS(LS.storeMode, (V3.settings || {}).storeMode || 'PRE_OPEN_PREP');
  DATA_MODE = readLS(LS.dataMode, (V3.settings || {}).dataMode || 'DEMO');
  UPLOAD = readLS(LS.traffic, null);
  renderAll();
}

async function boot() {
  MASK = readLS(LS.mask, true) !== false;
  let payload;
  try {
    const res = await fetch('data.enc.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    payload = await res.json();
  } catch (e) {
    showLock('데이터 파일(data.enc.json)을 불러오지 못했습니다.');
    $('#unlockBtn').disabled = true;
    return;
  }
  const saved = readLS(LS.pass, null);
  if (saved) {
    try {
      MODEL = await decryptPayload(payload, saved);
      V3 = MODEL.v3 || {};
      showApp();
      return;
    } catch (e) { localStorage.removeItem(LS.pass); }
  }
  showLock('');
}

$('#lockForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const pass = $('#pass').value;
  if (!pass) return;
  $('#lockErr').textContent = '';
  $('#unlockBtn').disabled = true;
  $('#unlockBtn').textContent = '여는 중…';
  try {
    const res = await fetch('data.enc.json', { cache: 'no-store' });
    const payload = await res.json();
    MODEL = await decryptPayload(payload, pass);
    V3 = MODEL.v3 || {};
    if ($('#remember').checked) writeLS(LS.pass, pass);
    $('#pass').value = '';
    showApp();
    toast('열었습니다');
  } catch (e) {
    $('#lockErr').textContent = '암호가 맞지 않습니다.';
  } finally {
    $('#unlockBtn').disabled = false;
    $('#unlockBtn').textContent = '열기';
  }
});

$('#lockBtn').addEventListener('click', () => {
  if (confirm('잠글까요? 이 기기에 기억된 암호도 지웁니다.')) {
    localStorage.removeItem(LS.pass);
    showLock('');
  }
});

/* ─────────────── 공통: 지금 시각 기준 뷰 ─────────────── */
function view() {
  const now = Date.now();
  const bundle = V3.bundle || { orders: [], claims: [], settlements: [], traffic: [] };
  const demo = Core.materializeDemo(bundle, now);
  const live = DATA_MODE === 'LIVE';
  const traffic = live ? { daily: [], channels: [], keywords: [], funnel: null }
    : (UPLOAD ? { daily: UPLOAD.rows, channels: UPLOAD.channels, keywords: UPLOAD.keywords, funnel: UPLOAD.funnel }
      : { daily: demo.traffic, channels: bundle.channels || [], keywords: bundle.keywords || [], funnel: bundle.funnel || null });
  const orders = live ? [] : demo.orders;
  const claims = (live ? [] : demo.claims).map((c) => Object.assign({}, c, { sla: Core.claimSla(c, now) }));
  const settlements = live ? [] : demo.settlements;
  const products = (V3.ledger && V3.ledger.skus) || [];
  const inquiries = live ? [] : (demo.inquiries || []);
  const widgets = Core.widgets({ orders, claims, inquiries, products, now });
  const summary = Core.summarize({ orders, claims, traffic: traffic.daily, now });
  const annual = live ? null : (bundle.annualNetProfitKrw || summary.netProfitKrw);
  return {
    now, bundle, orders, claims, settlements, traffic, products, inquiries, widgets, summary,
    gauges: Core.gauges(annual || 0),
    annualKrw: annual,
    pipeline: Core.pipeline(orders),
    fake: Core.fakeTracking(orders, now),
    rec: Core.reconcile(settlements),
    dDay: V3.settings && V3.settings.openingDate ? Math.round((Date.parse(`${V3.settings.openingDate}T00:00:00+09:00`) - Date.parse(`${new Date(now + 9 * 3600000).toISOString().slice(0, 10)}T00:00:00+09:00`)) / 86400000) : null,
  };
}

function modeBadges() {
  const b = [];
  if (STORE_MODE === 'PRE_OPEN_PREP') b.push('<span class="badge prep">준비모드</span>');
  else b.push('<span class="badge live">실운영</span>');
  if (DATA_MODE === 'DEMO') b.push('<span class="badge demo">DEMO 시뮬레이션</span>');
  else b.push('<span class="badge live">LIVE</span>');
  return b.join('');
}

function bannerHtml(v) {
  if (DATA_MODE === 'DEMO') {
    return `<div class="banner demo"><span>🧪</span><div><b>[DEMO 시뮬레이션]</b> 합성 주문 30·클레임 6·정산 12·유입 56일로 화면을 검증하는 중입니다. 실제 주문·고객정보가 아닙니다.${STORE_MODE === 'PRE_OPEN_PREP' ? ' storeMode는 <b>오픈 준비 모드</b>(2026년 매출 0원)입니다.' : ''} <b>설정·시스템</b>에서 LIVE로 바꿀 수 있습니다.</div></div>`;
  }
  if (STORE_MODE === 'PRE_OPEN_PREP') {
    return `<div class="banner prep"><span>📦</span><div><b>오픈 준비 모드</b> — 2026년 매출 0원 유지(청년창업 감면 방어), ${V3.settings && V3.settings.openingDate ? esc(V3.settings.openingDate) : '2027-01-02'} 간이과세 개업${v.dDay != null ? ` · <b>D-${v.dDay}</b>` : ''}. 실데이터는 GAS·커머스API 연결 후 표시됩니다.</div></div>`;
  }
  return `<div class="banner live"><span>✅</span><div><b>실운영 모드</b> — ${esc(V3.settings && V3.settings.openingDate ? V3.settings.openingDate : '2027-01-02')} 개업. 쓰기는 WRITE_ENABLED 스위치가 켜지기 전까지 잠겨 있습니다.</div></div>`;
}

/* ─────────────── 렌더: 전체 ─────────────── */
function renderAll() {
  $('#modeBadges').innerHTML = modeBadges();
  $('#maskBtn').setAttribute('aria-pressed', String(MASK));
  document.body.classList.toggle('masked', MASK);
  const v = view();
  renderSys(v);
  renderHome(v);
  renderInflow(v);
  renderOrders(v);
  renderClaims(v);
  renderProducts(v);
  renderSourcing(v);
  renderSettle(v);
  renderSettings(v);
  const w = v.widgets.find((x) => x.key === 'dispatch');
  const c = v.claims.filter((x) => x.status === 'OPEN').length;
  $('#tabOrders').textContent = w && w.count ? w.count : '';
  $('#tabOrders').hidden = !(w && w.count);
  $('#tabClaims').textContent = c ? c : '';
  $('#tabClaims').hidden = !c;
}

function renderSys(v) {
  const level = MODEL.freshness || 'UNKNOWN';
  const bar = $('#sysBar');
  bar.className = `sysbar${level === 'WARN' ? ' warn' : level === 'CRIT' ? ' crit' : level === 'PAUSED' ? ' paused' : ''}`;
  const at = MODEL.snapshotAt ? new Date(MODEL.snapshotAt) : null;
  const stamp = at ? at.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  const parts = [
    `도매의신 확인 ${stamp}`,
    `공인IP 미확인`,
    `도매잔액 미확인`,
    `GAS ${DATA_MODE === 'DEMO' ? '데모' : '미연결'}`,
  ];
  $('#sysText').textContent = parts.join(' · ');
}

/* ─────────────── 홈 ─────────────── */
function renderHome(v) {
  $('#homeBanner').innerHTML = bannerHtml(v);

  $('#widgets').innerHTML = v.widgets.map((w) => `
    <button class="wg ${w.count > 0 ? 'crit' : 'zero'}" data-wg="${esc(w.key)}">
      <span class="k">${esc(w.label)}</span>
      <span class="v">${w.count}<small>건</small></span>
      <span class="d">${esc(w.detail)}</span>
    </button>`).join('');

  $('#taxGauges').innerHTML = v.gauges.map((g) => `
    <div class="gauge ${g.level.toLowerCase()}" title="${esc(g.note)}">
      <div class="g-top"><b>${esc(g.label)}</b><span class="amt">${secret(g.currentKrw)} / ${fmt(g.baseKrw)}</span><span class="pct">${g.pct}%</span></div>
      <div class="track ${g.level.toLowerCase()}"><i style="width:${Math.min(100, Math.max(0, g.pct))}%"></i></div>
      <div class="g-note">${esc(g.note)}</div>
    </div>`).join('');

  const lg = V3.ledger || {};
  const prep = prepRows(v);
  $('#prepGauges').innerHTML = prep.map((g) => `
    <div class="gauge ${g.level.toLowerCase()}">
      <div class="g-top"><b>${esc(g.label)}</b><span class="amt">${esc(g.note)}</span><span class="pct">${esc(g.valueText)}</span></div>
      <div class="track ${g.level.toLowerCase()}"><i style="width:${g.pct == null ? 0 : Math.min(100, g.pct)}%"></i></div>
    </div>`).join('');
  $('#prepHint').textContent = STORE_MODE === 'PRE_OPEN_PREP' ? '개업 준비 4항목' : '실운영 중 점검';

  const k = v.summary;
  const today = (v.traffic.daily || []).slice(-1)[0] || null;
  const todayOrders = today ? num(today.orders) : null;
  const todayCvr = today ? Core.cvrOf(today.uv, today.orders) : null;
  $('#kpiRow').innerHTML = `
    <div class="kpi"><i>순방문자(오늘)</i><b>${fmt(today ? today.uv : k.uv)}<small>명</small></b><div class="sub">${v.traffic.daily.length}일 누적 ${fmt(k.uvPeriod)}명</div></div>
    <div class="kpi ${Core.kpiLevel('cvr', todayCvr) === 'GOOD' ? 'good' : Core.kpiLevel('cvr', todayCvr) === 'CRIT' ? 'crit' : 'warn'}"><i>결제(오늘)</i><b>${fmt(todayOrders)}<small>건</small></b><div class="sub">CVR ${pct(todayCvr)}</div></div>
    <div class="kpi ${k.marginLevel === 'GOOD' ? 'good' : k.marginLevel === 'CRIT' ? 'crit' : 'warn'}"><i>실순익(${DATA_MODE === 'DEMO' ? '누적' : '이번 달'})</i><b class="secretv">${secret(k.netProfitKrw)}</b><div class="sub">이익률 ${pct(k.marginPct)}</div></div>`;

  const daily = (v.traffic.daily || []).slice(-28);
  const trendEl = $('#trendChart');
  // 업로드 파일에 매출 열이 없으면 결제건수로 막대를 그린다(0으로 비워 두지 않는다)
  const hasRevenue = daily.some((r) => num(r.revenueKrw) != null);
  trendEl.innerHTML = trendSvg(daily, {
    barKey: hasRevenue ? 'revenueKrw' : 'orders',
    lineKey: 'uv',
    barLabel: hasRevenue ? '매출' : '결제',
    lineLabel: 'UV',
    width: trendEl.clientWidth || 320,
    height: trendEl.clientWidth > 900 ? 240 : 170,
    ariaLabel: hasRevenue ? '매출과 방문 추이' : '결제와 방문 추이',
  });
  $('#trendHint').textContent = daily.length ? `최근 ${daily.length}일 · ${daily[0].date} ~ ${daily[daily.length - 1].date}` : '데이터 없음';

  render45(v);
}

function prepRows(v) {
  const l = V3.ledger || {};
  const flags = l.flags || {};
  const skus = l.skus || [];
  const seoKnown = skus.filter((s) => s.seoScore != null);
  const seoGood = seoKnown.filter((s) => s.seoScore >= 80).length;
  const seoPct = seoKnown.length ? Core.trunc2((seoGood / seoKnown.length) * 100) : null;
  const draft = skus.filter((s) => s.track === 'GLOBAL');
  const draftOk = draft.filter((s) => !s.seoViolations || s.seoViolations.length === 0).length;
  const draftPct = draft.length ? Core.trunc2((draftOk / draft.length) * 100) : null;
  return [
    { label: '개업까지', valueText: v.dDay == null ? '—' : `D-${v.dDay}`, pct: null, level: 'GOOD', note: (V3.settings && V3.settings.openingDate) || '2027-01-02' },
    { label: 'SEO 80점 달성률', valueText: seoPct == null ? '—' : `${seoPct}%`, pct: seoPct, level: seoPct == null ? 'UNKNOWN' : seoPct >= 80 ? 'GOOD' : seoPct >= 60 ? 'WARN' : 'CRIT', note: `${seoGood}/${seoKnown.length}종` },
    { label: '품절·역마진', valueText: `${flags.soldOutCount || 0}종`, pct: null, level: (flags.soldOutCount || 0) ? 'CRIT' : 'GOOD', note: (flags.soldOutCount || 0) ? '판매 전 점검' : '이상 없음' },
    { label: '해외 DRAFT 준비율', valueText: draftPct == null ? '—' : `${draftPct}%`, pct: draftPct, level: draftPct == null ? 'UNKNOWN' : draftPct >= 100 ? 'GOOD' : draftPct >= 80 ? 'WARN' : 'CRIT', note: `${draftOk}/${draft.length}종` },
  ];
}

function render45(v) {
  const count = Math.max(0, Math.min(99, Number(readLS(LS.orders45, 0)) || 0));
  const L = { warn: 35, lock: 42, urgent: 44 };
  const stage = count >= L.urgent ? 'URGENT' : count >= L.lock ? 'LOCK' : count >= L.warn ? 'WARN' : 'NORMAL';
  const suspended = (V3.ledger && V3.ledger.flags && V3.ledger.flags.suspendedCount) || 0;
  const label = suspended >= 45 ? '판매중지 기간' : { NORMAL: '정상', WARN: '유입 중단', LOCK: '판매중지 요청', URGENT: '즉시 중지' }[stage];
  const cls = suspended >= 45 ? 'crit' : stage === 'NORMAL' ? 'good' : stage === 'WARN' ? 'warn' : 'crit';
  $('#gauge45').innerHTML = `
    <div class="gauge ${cls}">
      <div class="g-top"><b>결제완료 누적</b><span class="amt">상한 45건 · 35 유입중단 / 42 판매중지 / 44 긴급</span><span class="pct">${count}건</span></div>
      <div class="track ${cls}"><i style="width:${Math.min(100, (count / 45) * 100)}%"></i></div>
      <div class="g-note">${suspended >= 45 ? '스토어 45종 전부 판매중지 — 재오픈(2027-01-02) 전까지 이 카운터는 쓸 일이 없습니다.' : label}</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-top:9px">
      <button class="btn ghost tiny" data-g45="-1">−</button>
      <input id="g45input" type="number" min="0" max="99" value="${count}" style="width:64px;text-align:center;border:1px solid var(--line);border-radius:8px;padding:6px;font-weight:700;background:#fdfbf7">
      <button class="btn ghost tiny" data-g45="1">+</button>
      <span class="muted" style="font-size:11px;margin-left:auto">이 기기에만 저장</span>
    </div>`;
}

/* ─────────────── 차트 ─────────────── */
function trendSvg(daily, opts) {
  const o = opts || {};
  const rows = daily || [];
  if (!rows.length) return '<div class="muted" style="font-size:12px;padding:18px 0;text-align:center">표시할 데이터가 없습니다</div>';
  // 실제 픽셀 폭으로 viewBox 를 잡는다 — 폭이 다른 화면에서 글자가 늘어나지 않게(1:1 스케일).
  const W = Math.max(260, Math.round(o.width || 320));
  const H = Math.max(150, Math.round(o.height || 170));
  const L = 34, R = 10, T = 12, B = 22;
  const bars = rows.map((r) => num(r[o.barKey]) || 0);
  const line = rows.map((r) => num(r[o.lineKey]));
  const maxBar = Math.max(1, ...bars);
  const maxLine = Math.max(1, ...line.filter((x) => x != null));
  const iw = (W - L - R) / rows.length;
  const bw = Math.max(1.2, iw * 0.62);
  const yBar = (v) => T + (H - T - B) * (1 - v / maxBar);
  const yLine = (v) => T + (H - T - B) * (1 - v / maxLine);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(o.ariaLabel || '추이 그래프')}">`;
  [0, 0.5, 1].forEach((f) => {
    const y = T + (H - T - B) * f;
    svg += `<line class="gl" x1="${L}" y1="${y}" x2="${W - R}" y2="${y}"></line>`;
  });
  rows.forEach((r, i) => {
    const x = L + i * iw + (iw - bw) / 2;
    const y = yBar(bars[i]);
    svg += `<rect class="bar${i >= rows.length - 3 ? ' hot' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.8, (H - B) - y).toFixed(1)}" rx="1"></rect>`;
  });
  const pts = [];
  rows.forEach((r, i) => {
    if (line[i] == null) return;
    pts.push(`${(L + i * iw + iw / 2).toFixed(1)},${yLine(line[i]).toFixed(1)}`);
  });
  if (pts.length > 1) {
    const area = `${L + iw / 2},${H - B} ${pts.join(' ')} ${L + (rows.length - 1) * iw + iw / 2},${H - B}`;
    svg += `<polygon class="area" points="${area}"></polygon>`;
    svg += `<polyline class="line" points="${pts.join(' ')}"></polyline>`;
    svg += `<circle class="dot" cx="${L + (rows.length - 1) * iw + iw / 2}" cy="${yLine(line[line.length - 1]).toFixed(1)}" r="2.4"></circle>`;
  }
  svg += `<text class="lbl" x="2" y="${T + 8}">${fmt(maxBar)}</text>`;
  svg += `<text class="lbl" x="2" y="${H - B}">0</text>`;
  svg += `<text class="lbl" x="${L}" y="${H - 6}">${esc(rows[0].date.slice(5))}</text>`;
  svg += `<text class="lbl" x="${W - R}" y="${H - 6}" text-anchor="end">${esc(rows[rows.length - 1].date.slice(5))}</text>`;
  svg += `<text class="lbl" x="${W - R}" y="${T + 8}" text-anchor="end">${o.lineLabel || ''} ${fmt(maxLine)}</text>`;
  svg += '</svg>';
  return svg;
}

/* ─────────────── 유입 ─────────────── */
function renderInflow(v) {
  const t = v.traffic;
  const daily = t.daily || [];
  const last = daily[daily.length - 1];
  const prev = daily[daily.length - 2];
  const sumUv = daily.reduce((a, r) => a + (num(r.uv) || 0), 0);
  const sumPv = daily.reduce((a, r) => a + (num(r.pv) || 0), 0);
  const sumOrders = daily.reduce((a, r) => a + (num(r.orders) || 0), 0);
  const cvr = Core.cvrOf(sumUv, sumOrders);
  // 체류·이탈은 파일에 그 열이 없으면 0이 아니라 '미확인'이다(0과 없는 값을 섞지 않는다)
  const dwellRows = daily.filter((r) => num(r.dwellSec) != null);
  const bounceRows = daily.filter((r) => num(r.bouncePct) != null);
  const dwell = dwellRows.length ? Math.round(dwellRows.reduce((a, r) => a + Number(r.dwellSec), 0) / dwellRows.length) : null;
  const bounce = bounceRows.length ? Math.round(bounceRows.reduce((a, r) => a + Number(r.bouncePct), 0) / bounceRows.length) : null;

  $('#inflowSrc').textContent = UPLOAD
    ? `업로드 ${new Date(UPLOAD.savedAt).toLocaleDateString('ko-KR')} · ${UPLOAD.rows.length}일`
    : (DATA_MODE === 'DEMO' ? 'DEMO 데이터' : '데이터 없음');
  $('#inflowKpis').innerHTML = `
    <div class="kpi"><i>순방문자(UV)</i><b>${fmt(last ? last.uv : null)}<small>명</small></b><div class="sub">${prev && last ? `전일 ${last.uv - prev.uv >= 0 ? '+' : ''}${fmt(last.uv - prev.uv)}` : '전일 비교 없음'}</div></div>
    <div class="kpi ${Core.kpiLevel('cvr', cvr) === 'GOOD' ? 'good' : Core.kpiLevel('cvr', cvr) === 'CRIT' ? 'crit' : 'warn'}"><i>전환율</i><b>${pct(cvr)}</b><div class="sub">결제 ${fmt(sumOrders)}건 / UV ${fmt(sumUv)}</div></div>
    <div class="kpi"><i>체류·이탈</i><b>${dwell == null ? '—' : `${dwell}s`}</b><div class="sub">이탈률 ${bounce == null ? '—' : `${bounce}%`}</div></div>`;
  const inEl = $('#inflowChart');
  inEl.innerHTML = trendSvg(daily.slice(-28), { barKey: 'uv', lineKey: 'cvr', barLabel: 'UV', lineLabel: 'CVR', width: inEl.clientWidth || 320, height: inEl.clientWidth > 900 ? 240 : 170, ariaLabel: '방문자와 전환율 추이' });
  $('#inflowTrendHint').textContent = daily.length ? `${daily.length}일 누적 · 최근 28일 표시` : '업로드 필요';

  const ch = t.channels || [];
  const chSum = ch.reduce((a, c) => a + (num(c.uv) || 0), 0) || 1;
  $('#channelTable').innerHTML = `
    <thead><tr><th>경로</th><th class="num">UV</th><th class="num">비중</th><th class="num">결제</th><th class="num">CVR</th></tr></thead>
    <tbody>${ch.length ? ch.map((c) => `
      <tr>
        <td class="name">${esc(c.channel)}${c.marketingLink ? ' <span class="pill demo">4.63%</span>' : ''}</td>
        <td class="num">${fmt(c.uv)}</td>
        <td class="num">${Core.trunc2(((num(c.uv) || 0) / chSum) * 100)}%</td>
        <td class="num">${fmt(c.orders)}</td>
        <td class="num">${pct(Core.cvrOf(c.uv, c.orders))}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="muted">데이터 없음</td></tr>'}</tbody>`;

  const kw = (t.keywords || []).slice(0, 12);
  $('#kwHint').textContent = (t.keywords || []).length ? `TOP ${kw.length}` : '';
  $('#keywordTable').innerHTML = `
    <thead><tr><th>검색어</th><th class="num">UV</th><th class="num">결제</th><th class="num">CVR</th></tr></thead>
    <tbody>${kw.length ? kw.map((k) => `<tr><td class="name">${esc(k.keyword)}</td><td class="num">${fmt(k.uv)}</td><td class="num">${fmt(k.orders)}</td><td class="num">${pct(Core.cvrOf(k.uv, k.orders))}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">데이터 없음</td></tr>'}</tbody>`;

  const f = t.funnel;
  $('#funnel').innerHTML = f ? [
    ['상품조회', f.views, '#cbb695'],
    ['장바구니', f.cart, '#d8b98a'],
    ['결제완료', f.paid, '#2f7a4f'],
  ].map(([label, val, color]) => {
    const p = f.views > 0 ? Math.round((val / f.views) * 1000) / 10 : 0;
    return `<div style="display:grid;gap:3px;margin-bottom:8px">
      <div style="display:flex;font-size:11.5px"><span>${label}</span><span style="margin-left:auto;font-weight:800">${fmt(val)}</span></div>
      <div class="track"><i style="width:${Math.max(1, p)}%;background:${color}"></i></div>
      <div class="muted" style="font-size:10.5px">조회 대비 ${p}%</div>
    </div>`;
  }).join('') : '<div class="muted" style="font-size:12px">퍼널 데이터가 없습니다 — 쇼핑행동분석 표가 포함된 파일을 올려 주세요.</div>';
}

/* ─────────────── 주문 ─────────────── */
const STAGE_LABEL = { NEW: '신규', ORDER_WAIT: '발주대기', DISPATCH_WAIT: '발송대기', IN_TRANSIT: '배송중', CONFIRMED: '구매확정' };

function renderOrders(v) {
  const open = v.pipeline;
  const dispatchCount = v.widgets.find((w) => w.key === 'dispatch').count;
  $('#orderSummary').innerHTML = v.orders.length
    ? `<div class="banner live"><span>📦</span><div>진행 <b>${open.NEW + open.ORDER_WAIT + open.DISPATCH_WAIT + open.IN_TRANSIT}건</b> 중 발주대기 <b>${open.ORDER_WAIT}건</b> · 금일 발송마감 <b>${dispatchCount}건</b>이 우선 출고 대상입니다.</div></div>`
    : `<div class="banner prep"><span>📦</span><div>${STORE_MODE === 'PRE_OPEN_PREP' ? '12월 준비 모드 — 신규 주문 0건. 개업 후 3분 주기 주문 피드가 자동 감시합니다.' : '처리 대기 0건. 3분 주기 주문 피드가 정상 감시 중입니다.'}</div></div>`;

  $('#pipeline').innerHTML = Object.keys(STAGE_LABEL).map((k) => `
    <button data-stage="${k}" aria-pressed="${ORDER_FILTER === k}">
      <span class="s">${STAGE_LABEL[k]}</span><span class="c">${v.pipeline[k] || 0}</span>
    </button>`).join('');

  const dlist = v.orders.filter((o) => o.stage === 'DISPATCH_WAIT')
    .map((o) => ({ o, sla: Core.dispatchSla(o.dispatchDue, v.now) }))
    .filter((x) => x.sla.level === 'WARN' || x.sla.level === 'CRIT') // D-1·D-0 만 — 여유분은 주문 목록에
    .sort((a, b) => a.sla.hoursLeft - b.sla.hoursLeft);
  const fakeIds = new Set(v.fake.map((f) => f.productOrderId));
  $('#dispatchList').innerHTML = (dlist.length || fakeIds.size) ? [
    ...dlist.map(({ o, sla }) => `
      <div class="item">
        <div class="row1"><span class="nm">${esc(o.name)}</span><span class="pill ${sla.level === 'CRIT' ? 'crit' : sla.level === 'WARN' ? 'warn' : 'good'}">${esc(sla.label)}</span></div>
        <div class="meta"><span>${esc(o.productOrderId)}</span><span>${o.track === 'GLOBAL' ? '해외' : '국내'} · ${esc(o.option)} · ${o.qty}개</span><span>도매 <b>${esc(o.domaesinOrderNo || '미발주')}</b></span><span>${secret(o.supplyCost, '원')}</span></div>
        <div class="acts"><button class="btn ghost tiny" data-domaesin="${esc(o.productOrderId)}">도매 일괄 발주</button><button class="btn ghost tiny" data-copyorder="${esc(o.productOrderId)}">주문정보 복사</button></div>
      </div>`).join(''),
    ...v.fake.map((o) => `
      <div class="item">
        <div class="row1"><span class="nm">${esc(o.name)}</span><span class="pill crit">24h 미집화</span></div>
        <div class="meta"><span>${esc(o.productOrderId)}</span><span>발송 ${new Date(o.dispatchedAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit' })}</span><span>가송장 확인 필요</span></div>
      </div>`).join(''),
  ].join('') : '<div class="muted" style="font-size:12px">발송기한 임박·가송장 건이 없습니다.</div>';

  const list = v.orders.filter((o) => !ORDER_FILTER || o.stage === ORDER_FILTER);
  $('#orderCount').textContent = `${list.length}건${ORDER_FILTER ? ` · ${STAGE_LABEL[ORDER_FILTER]}` : ''}`;
  $('#orderTable').innerHTML = `
    <thead><tr><th>주문</th><th>상품</th><th>단계</th><th class="num">금액</th><th class="num">순익</th><th>기한</th><th>택배</th></tr></thead>
    <tbody>${list.length ? list.map((o) => {
      const sla = Core.dispatchSla(o.dispatchDue, v.now);
      return `<tr>
        <td>${esc(o.productOrderId)}</td>
        <td class="name">${esc(o.name)}<br><span class="muted" style="font-size:10.5px">${esc(o.option)} · ${o.track === 'GLOBAL' ? '해외' : '국내'}</span></td>
        <td><span class="pill ${o.stage === 'CONFIRMED' ? 'good' : o.stage === 'NEW' ? 'warn' : 'mute'}">${STAGE_LABEL[o.stage]}</span></td>
        <td class="num">${secret(o.amount)}</td>
        <td class="num">${secret(o.profitKrw)}</td>
        <td>${o.stage === 'CONFIRMED' ? '<span class="pill good">완료</span>' : o.stage === 'IN_TRANSIT' ? `<span class="pill ${o.collectedAt ? 'good' : 'warn'}">${o.collectedAt ? '배송중' : '집화 대기'}</span>` : `<span class="pill ${sla.level === 'CRIT' ? 'crit' : sla.level === 'WARN' ? 'warn' : 'good'}">${esc(sla.label)}</span>`}</td>
        <td>${esc(o.courier || '—')}${o.trackingNo ? `<br><span class="muted" style="font-size:10px">${esc(o.trackingNo)}</span>` : ''}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="7" class="muted">주문이 없습니다.</td></tr>'}</tbody>`;

  renderRunbook();
}

const RUNBOOK = [
  { t: '주문 확인 · 도매처 실재고/단가 대조', min: '2분', body: '신규 주문의 상품·옵션·수량을 확인하고, 도매의신에서 지금도 살 수 있는지(품절 아님)와 공급가가 그대로인지 본다.', chk: '도매처 결제액(배송비 포함)이 정산 예정액보다 작은가?', copy: '안녕하세요, 묘한살림입니다 :) 주문해 주신 상품 확인되었습니다. 꼼꼼히 검수해서 안전하게 출고하겠습니다!' },
  { t: '발주확인 · 도매의신 위탁 발주', min: '4분', body: '스마트스토어에서 [발주확인]을 누르고, 도매의신 주문서에 받는 분 이름·연락처·주소·배송메모를 그대로 넣어 결제한다.', chk: '결제자가 아니라 "받는 분" 이름·번호·주소가 정확히 들어갔는가?', copy: '[위탁발송] 거래명세서·가격표·홍보물은 동봉하지 말아 주세요. 파손 주의 부탁드립니다.' },
  { t: '송장 수집 · 발송처리', min: '2분', body: '도매의신에서 출고되면 송장번호를 복사해 스마트스토어 [발송처리]에 택배사와 송장번호를 넣는다. 발송기한은 결제+3영업일이다.', chk: '택배사가 실제 출고 택배사와 같은가?', copy: '고객님, 주문하신 상품이 오늘 출고되었습니다! 택배사 사정에 따라 보통 1~2영업일 안에 받아보실 수 있어요. 감사합니다 :)' },
  { t: '배송 추적 · CS·반품 방어', min: '1분', body: '집화·배송완료를 확인하고, 파손·오배송 클레임은 사진을 먼저 요청한다. 단순변심 반품은 왕복 배송비를 먼저 안내한다.', chk: '반품 안내 전에 이 상품의 왕복 반품비를 확인했는가?', copy: '단순변심 반품은 왕복 배송비가 발생합니다. 상품 파손·오배송이라면 박스와 상품 사진을 톡톡으로 보내주세요. 확인 후 바로 처리해 드리겠습니다.' },
  { t: '일일 마감 · 45건 게이지 확인', min: '1분', body: '오늘 건수·매출을 정산·세무 탭의 일일 마감에 넣고, 결제완료 누적을 게이지에 반영한다.', chk: '취소·반품 확정 건이 누적 카운트에 반영됐는가?', copy: '[날짜] 신규 0건 / 누적 00건 / 도매 발주 완료 / 특이사항 없음' },
];

function renderRunbook() {
  const done = readLS(LS.runbook, []);
  $('#runbook').innerHTML = RUNBOOK.map((s, i) => `
    <div class="step${done.includes(i) ? ' done' : ''}">
      <button class="step-top" type="button"><span class="step-no">${done.includes(i) ? '✓' : i + 1}</span><span class="step-t">${esc(s.t)}</span><span class="step.min">${esc(s.min)}</span><span class="muted" style="font-size:10px">▾</span></button>
      <div class="step-body" hidden>
        <p style="margin:0">${esc(s.body)}</p>
        <div class="chk"><span>⚠️</span><span>${esc(s.chk)}</span></div>
        <button class="copy" data-copy="${esc(s.copy)}">${esc(s.copy)}</button>
        <button class="btn ghost tiny" data-done="${i}">${done.includes(i) ? '완료 취소' : '이 단계 완료'}</button>
      </div>
    </div>`).join('');
  $('#rbProg').textContent = `${done.length} / ${RUNBOOK.length} 완료`;
}

/* ─────────────── 클레임 ─────────────── */
const TYPE_LABEL = { CHANGE_OF_MIND: '단순변심', DEFECT: '파손·불량', CUSTOMS_HOLD: '통관보류' };
const FAULT_LABEL = { BUYER: '구매자', SELLER: '판매자', WHOLESALER: '도매처' };
const GRADE_LABEL = { DOMESTIC_STD: '국내 일반', DOMESTIC_LARGE: '국내 대형', GLOBAL: '해외' };
const MSG = {
  MSG_RETURN_SIMPLE_DOM: '단순변심 반품 접수 안내드립니다. 상품 미개봉·구성품 완비 상태에 한해 수령 후 7일 이내 반품이 가능하며, 왕복 택배비 6,000원(대형 상품 10,000원)이 환불 금액에서 자동 차감됩니다. 지정 택배사 수거 접수를 진행해 드렸으니 문 앞에 포장해 두시면 기사님이 방문 수거합니다.',
  MSG_RETURN_DEFECT: '제품 수령 과정에서 불편을 드려 죄송합니다. 신속한 처리를 위해 ① 외부 택배 박스 송장 사진 1장 ② 불량·파손 부위 사진 1장을 톡톡으로 보내주시면, 확인 즉시 추가 비용 없이 전액 환불 또는 새 상품 재발송을 진행해 드리겠습니다.',
  MSG_CUSTOMS_HOLD: "주문하신 상품이 세관 통관 과정에서 '수취인 성함·연락처와 개인통관고유부호 불일치'로 보류되었습니다. 모바일 관세청 앱 또는 unipass.customs.go.kr에서 수취인 본인 명의 부호를 확인하신 후, 보세창고 보관료 발생 방지를 위해 [보류통보일+3영업일 15:00]까지 톡톡으로 [수취인명 / 연락처 / P로 시작하는 13자리 부호]를 회신해 주세요. 기한 내 미회신 시 관세청 규정에 따라 반송·폐기 실비가 청구될 수 있습니다.",
};

function renderClaims(v) {
  const open = v.claims.filter((c) => c.status === 'OPEN');
  const over = open.filter((c) => c.sla.level === 'CRIT');
  const deduct = open.reduce((a, c) => a + (num(c.deductKrw) || 0), 0);
  $('#claimSummary').innerHTML = v.claims.length
    ? `<div class="banner ${over.length ? 'demo' : 'live'}"><span>${over.length ? '⏰' : '✅'}</span><div>미처리 <b>${open.length}건</b> · SLA 초과 <b>${over.length}건</b> · 예상 차감액 <b>${secret(deduct, '원')}</b>${over.length ? ' — 24시간이 지난 클레임부터 처리하세요.' : ''}</div></div>`
    : `<div class="banner prep"><span>✅</span><div>${STORE_MODE === 'PRE_OPEN_PREP' ? '12월 준비 모드 — 미처리 클레임·미답변 문의 0건.' : '미처리 클레임·미답변 문의·저평점 리뷰가 모두 0건입니다.'}</div></div>`;

  $('#claimList').innerHTML = open.length ? open.map((c) => `
    <div class="item">
      <div class="row1"><span class="nm">${esc(TYPE_LABEL[c.type] || c.type)} · ${esc(FAULT_LABEL[c.fault] || c.fault)}</span>
        <span class="pill ${c.sla.level === 'CRIT' ? 'crit' : c.sla.level === 'WARN' ? 'warn' : 'good'}">${c.sla.level === 'CRIT' ? `SLA ${Math.abs(c.sla.hoursLeft)}h 초과` : `SLA ${c.sla.hoursLeft}h`}</span></div>
      <div class="meta"><span>${esc(c.productOrderId)}</span><span>${esc(GRADE_LABEL[c.grade] || c.grade)}</span><span>차감 <b>${secret(c.deductKrw, '원')}</b></span><span>${c.action === 'RETRIEVE' || c.refundCapKrw === 0 ? '전액 회수' : `환불상한 <b>${secret(c.refundCapKrw, '원')}</b>`}</span><span>순익 <b class="secretv">${secret(c.netProfitDeltaKrw, '원')}</b></span></div>
      <div class="acts">
        <button class="btn ghost tiny" data-copytext="${esc(MSG[c.messageKey] || '')}">안내문구 복사</button>
        <button class="btn primary tiny" data-claim="${esc(c.claimId)}:APPROVE">승인</button>
        <button class="btn danger tiny" data-claim="${esc(c.claimId)}:HOLD">보류·거부</button>
      </div>
    </div>`).join('') : '<div class="muted" style="font-size:12px">미처리 클레임이 없습니다.</div>';

  $('#inquiryList').innerHTML = v.inquiries.length ? v.inquiries.map((q) => `
    <div class="item">
      <div class="row1"><span class="nm">${esc(q.title)}</span><span class="pill ${q.answered ? 'good' : 'crit'}">${q.answered ? '답변 완료' : '미답변'}</span></div>
      <div class="meta"><span>${esc(q.productOrderId)}</span><span>${q.askedAgoMin != null ? `${Math.floor(q.askedAgoMin / 60)}시간 전 접수` : ''}</span></div>
    </div>`).join('') : '<div class="muted" style="font-size:12px">문의가 없습니다.</div>';

  calcClaim();
}

function calcClaim() {
  const p = {
    type: $('#clType').value,
    fault: $('#clFault').value,
    grade: $('#clGrade').value,
    salePrice: num($('#clSale').value),
    supplyPrice: num($('#clSupply').value) || 0,
    orderProfitKrw: num($('#clProfit').value),
    options: {},
  };
  const extra = num($('#clFee').value) || 0;
  if (p.type === 'CUSTOMS_HOLD') p.options.disposalFeeKrw = extra;
  else if (p.grade === 'GLOBAL' && p.type === 'CHANGE_OF_MIND') p.options.roundTripFeeKrw = extra || 15000;
  else if (p.grade === 'GLOBAL' && p.type === 'DEFECT') p.options.internationalFreightKrw = extra;
  const r = Core.claimPreview(p);
  $('#clDeduct').textContent = secret(r.deductKrw, '원');
  $('#clCap').textContent = r.action === 'RETRIEVE' ? '전액 회수' : (r.refundCapKrw == null ? '—' : secret(r.refundCapKrw, '원'));
  $('#clDelta').textContent = r.netProfitDeltaKrw == null ? '—' : secret(r.netProfitDeltaKrw, '원');
  $('#clAction').textContent = { RETRIEVE: '회수', SCRAP: '폐기', PARTIAL_REFUND: '부분환불', REJECT: '거절', BLOCKED_ALREADY_ORDERED: '승인 차단' }[r.action] || r.action;
  const vd = $('#clVerdict');
  vd.className = `verdict${r.blocked || r.action === 'REJECT' ? ' crit' : r.action === 'PARTIAL_REFUND' ? ' warn' : ''}`;
  vd.textContent = r.blocked
    ? '기발주 건입니다. 도매의신 취소완료를 확인한 뒤 승인하세요.'
    : (r.reasons.length ? r.reasons.join(' · ') : '계산 결과 없음');
  $('#clMsgWrap').innerHTML = r.messageKey ? `<button class="copy" data-copytext="${esc(MSG[r.messageKey])}">${esc(MSG[r.messageKey])}</button>` : '';
}

/* ─────────────── 상품·SEO ─────────────── */
let TRACK_FILTER = 'ALL';
function renderProducts(v) {
  const all = v.products || [];
  const dom = all.filter((s) => s.track === 'DOMESTIC').length;
  const glo = all.filter((s) => s.track === 'GLOBAL').length;
  const flags = (V3.ledger && V3.ledger.flags) || {};
  $('#productHint').textContent = `국내 ${dom} · 해외 ${glo} · 옵션누락 ${flags.optionMissingCount || 0} · 판매중지 ${flags.suspendedCount || 0}`;
  $('#trackChips').innerHTML = [['ALL', `전체 ${all.length}`], ['DOMESTIC', `국내 ${dom}`], ['GLOBAL', `해외 ${glo}`]]
    .map(([k, label]) => `<button class="pill ${TRACK_FILTER === k ? 'good' : 'mute'}" data-track="${k}" style="cursor:pointer">${label}</button>`).join('');
  const rows = all.filter((s) => TRACK_FILTER === 'ALL' || s.track === TRACK_FILTER);
  $('#productTable').innerHTML = `
    <thead><tr><th>상품</th><th>트랙</th><th class="num">판매가</th><th class="num">SEO</th><th>상태</th><th>옵션</th></tr></thead>
    <tbody>${rows.map((s) => `
      <tr>
        <td class="name">${esc(s.name)}<br><span class="muted" style="font-size:10px">${esc(s.sku)}</span></td>
        <td><span class="pill ${s.track === 'GLOBAL' ? 'demo' : 'mute'}">${s.track === 'GLOBAL' ? '해외' : '국내'}</span></td>
        <td class="num">${secret(s.salePrice)}</td>
        <td class="num">${s.seoScore == null ? '<span class="pill mute">미측정</span>' : `${s.seoScore} <span class="pill ${s.seoGrade === 'GOOD' ? 'good' : s.seoGrade === 'WARN' ? 'warn' : 'crit'}">${s.seoGrade === 'GOOD' ? '80↑' : s.seoGrade === 'WARN' ? '60↑' : '미달'}</span>`}</td>
        <td>${s.status === 'SUSPENSION' ? '<span class="pill crit">판매중지</span>' : s.status === 'DRAFT' ? '<span class="pill mute">DRAFT</span>' : '<span class="pill good">판매중</span>'}</td>
        <td>${s.optionMissing && s.optionMissing.length ? `<span class="pill warn">누락 ${s.optionMissing.length}</span>` : '<span class="muted">—</span>'}</td>
      </tr>`).join('')}</tbody>`;
  renderMarginCalc();
}

function renderMarginCalc() {
  const list = (MODEL.skus || []).slice();
  const pick = $('#cPick');
  if (!pick.dataset.filled) {
    pick.innerHTML = '<option value="">직접 입력</option>' + list.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('');
    pick.dataset.filled = '1';
  }
  if (list.length && !pick.dataset.init) {
    const low = list.slice().sort((a, b) => (num(a.marginPct) ?? 999) - (num(b.marginPct) ?? 999))[0];
    pick.value = String(list.indexOf(low));
    pick.dataset.init = '1';
    fillMargin(low);
  }
}

function fillMargin(s) {
  $('#cSale').value = num(s.salePrice) ?? '';
  $('#cSupply').value = num(s.supplyPrice) ?? '';
  $('#cShip').value = num(s.shipFee) ?? 0;
  $('#cReturn').value = num(s.returnFee) ?? '';
  calcMargin();
}

function calcMargin() {
  const sale = num($('#cSale').value);
  const supply = num($('#cSupply').value);
  const ship = num($('#cShip').value) || 0;
  const ret = num($('#cReturn').value);
  const feePct = (MODEL.store && MODEL.store.feeRatePct) || 4.95;
  const resPct = (MODEL.store && MODEL.store.returnReservePct) || 4;
  if (!sale || sale <= 0 || supply == null) {
    $('#oProfit').textContent = '-'; $('#oMargin').textContent = '-'; $('#oBreakeven').textContent = '-'; $('#oReturn').textContent = '-';
    $('#oVerdict').className = 'verdict'; $('#oVerdict').textContent = '판매가와 공급가를 넣으면 판정이 나옵니다.';
    return;
  }
  const profit = Math.round(sale - supply - ship - sale * (feePct / 100) - sale * (resPct / 100));
  const margin = Math.round((profit / sale) * 1000) / 10;
  const div = 1 - feePct / 100 - resPct / 100 - 0.15;
  const be = div > 0 ? Math.ceil((supply + ship) / div) : null;
  const rt = ret ? ret * 2 : null;
  $('#oProfit').textContent = secret(profit, '원');
  $('#oMargin').textContent = `${margin}%`;
  $('#oBreakeven').textContent = be == null ? '—' : secret(be, '원');
  $('#oReturn').textContent = rt == null ? '—' : secret(rt, '원');
  const vd = $('#oVerdict');
  if (margin < 0) { vd.className = 'verdict crit'; vd.textContent = `역마진입니다. 한 건 팔 때마다 ${secret(Math.abs(profit), '원')}이 나갑니다.`; }
  else if (margin < 8) { vd.className = 'verdict crit'; vd.textContent = `마진 ${margin}% — 심각선(8%) 미만. 판매중지 검토 대상입니다.`; }
  else if (margin < 15) { vd.className = 'verdict warn'; vd.textContent = `마진 ${margin}% — 주의선(15%) 미만. 광고를 태우지 말고 묶음배송용으로만 두세요.`; }
  else { vd.className = 'verdict'; vd.textContent = `마진 ${margin}% — 기준(15%)을 넘습니다.`; }
}

/* ─────────────── 추천·소싱 ─────────────── */
function renderSourcing(v) {
  const base = (v.bundle.candidates || []);
  const saved = readLS(LS.candidates, {});
  const list = base.map((c) => Object.assign({}, c, saved[c.key] || {}));
  const verified = list.filter((c) => c.status === 'VERIFIED');
  const pending = list.filter((c) => c.status !== 'VERIFIED');
  $('#sourcingBanner').innerHTML = `<div class="banner ${DATA_MODE === 'DEMO' ? 'demo' : 'prep'}"><span>🌱</span><div>실측 완료 후보 <b>${verified.length}종</b> · 실측 대기 <b>${pending.length}종</b>. 75점 이상 + 원가·배송비 실측(evidenceUrl)이 있어야 승격합니다. ${STORE_MODE === 'PRE_OPEN_PREP' ? '12월에는 등록하지 않고 DRAFT로만 쌓습니다.' : ''}</div></div>`;
  $('#candidateList').innerHTML = list.map((c) => `
    <div class="item">
      <div class="row1"><span class="nm">${esc(c.name)}</span>
        <span class="pill ${c.status === 'VERIFIED' ? 'good' : 'warn'}">${c.status === 'VERIFIED' ? '실측 완료' : '실측 대기'}</span></div>
      <div class="meta"><span>점수 <b>${c.score}</b></span><span>마진 <b>${pct(c.marginPct)}</b></span><span>원가 ${c.unitKrw == null ? '—' : secret(c.unitKrw)}</span><span>배송 ${c.shipKrw == null ? '—' : secret(c.shipKrw)}</span>${c.badge ? `<span class="pill demo">${esc(c.badge)}</span>` : ''}</div>
      <div class="acts">
        ${c.evidenceUrl ? `<a class="btn ghost tiny" href="${esc(c.evidenceUrl)}" target="_blank" rel="noopener">원본 ↗</a>` : ''}
        ${c.status === 'VERIFIED' ? '' : `<button class="btn primary tiny" data-measure="${esc(c.key)}">실측 입력</button>`}
      </div>
    </div>`).join('');
  $('#gatePanel').innerHTML = `
    <div class="gauge"><div class="g-top"><b>1. 실측</b><span class="amt">단가·배송비·evidenceUrl</span><span class="pct">${verified.length}/${list.length}</span></div><div class="track ${verified.length === list.length ? '' : 'warn'}"><i style="width:${list.length ? (verified.length / list.length) * 100 : 0}%"></i></div></div>
    <div class="gauge"><div class="g-top"><b>2. QA·CS 게이트</b><span class="amt">표시광고·해외 고지 7종</span><span class="pct">자동</span></div><div class="track"><i style="width:100%"></i></div></div>
    <div class="gauge"><div class="g-top"><b>3. 등록</b><span class="amt">2027-01-02 사업자등록 후</span><span class="pct">잠금</span></div><div class="track crit"><i style="width:0%"></i></div></div>
    <p class="note">등록·판매상태 변경은 12월에 쓰지 않습니다(청년창업 감면 방어). 승격은 DRAFT 원장에만 쌓입니다.</p>`;
}

/* ─────────────── 정산·세무 ─────────────── */
function renderSettle(v) {
  const s = v.summary;
  const rows = [
    ['매출', s.revenueKrw, '#6f4f31'],
    ['판매수수료', -s.feeKrw, '#b0895f'],
    ['원가', -s.costKrw, '#a9701c'],
    ['반품손실', -s.claimLossKrw, '#b2372f'],
    ['실순익', s.netProfitKrw, '#2f7a4f'],
  ];
  const max = Math.max(1, ...rows.map((r) => Math.abs(r[1])));
  $('#pnlHint').textContent = DATA_MODE === 'DEMO' ? 'DEMO 30건 기준' : '정산 실값';
  $('#pnl').innerHTML = rows.map(([label, val, color]) => `
    <div style="display:grid;gap:3px;margin-bottom:8px">
      <div style="display:flex;font-size:11.5px"><span>${label}</span><span style="margin-left:auto;font-weight:800" class="${label === '실순익' ? 'secretv' : ''}">${secret(val)}</span></div>
      <div class="track"><i style="width:${Math.min(100, (Math.abs(val) / max) * 100)}%;background:${color}"></i></div>
    </div>`).join('') + `<p class="note">이익률 ${pct(s.marginPct)} · 객단가 ${secret(s.aovKrw, '원')} · 30일 반품률 ${pct(s.returnRatePct)}${DATA_MODE === 'DEMO' ? ' (DEMO 표본 30건·클레임 6건이라 실제보다 높게 보입니다)' : ''}</p>`;

  const rec = v.rec;
  $('#settleHint').textContent = rec.rows.length ? `일치 ${rec.matched} · 차이 ${rec.diffs}` : '정산 데이터 없음';
  $('#settleTable').innerHTML = rec.rows.length ? `
    <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">${Object.keys(rec.byCause).map((c) => `<span class="pill ${rec.byCause[c] ? 'warn' : 'mute'}">${esc(c)} ${rec.byCause[c]}</span>`).join('')}</div>
    <div class="tbl-wrap"><table class="t">
      <thead><tr><th>정산일</th><th>주문</th><th class="num">예상</th><th class="num">실제</th><th class="num">차이</th><th>원인</th></tr></thead>
      <tbody>${rec.rows.map((r) => `<tr>
        <td>${esc(r.settleDate)}</td><td>${esc(r.orderId)}</td>
        <td class="num">${secret(r.expectedKrw)}</td><td class="num">${secret(r.actualKrw)}</td>
        <td class="num">${r.diffKrw === 0 ? '0' : (MASK ? '•••' : `${fmt(r.diffKrw)}`)}</td>
        <td>${r.matched ? '<span class="pill good">일치</span>' : `<span class="pill warn">${esc(r.diffCause)}</span>`}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : `<div class="muted" style="font-size:12px">${STORE_MODE === 'PRE_OPEN_PREP' ? '12월은 확정 정산 0건 — 첫 구매확정 +1영업일 이후 채워집니다.' : '정산 API 연결 후 표시됩니다.'}</div>`;

  $('#taxDetail').innerHTML = v.gauges.map((g) => `
    <div class="gauge ${g.level.toLowerCase()}">
      <div class="g-top"><b>${esc(g.label)}</b><span class="amt">${secret(v.annualKrw)} / ${fmt(g.baseKrw)}</span><span class="pct">${g.pct}%</span></div>
      <div class="track ${g.level.toLowerCase()}"><i style="width:${Math.min(100, Math.max(0, g.pct))}%"></i></div>
      <div class="g-note">${esc(g.note)} · 남은 여유 ${secret(g.remainKrw)}</div>
    </div>`).join('') + `<p class="note">기준은 <b>연 순익</b>입니다. 12월은 매출 0원이라 게이지도 0이며, DEMO에서는 시뮬레이션 값(${secret(v.annualKrw)})으로 경보 색을 확인합니다.</p>`;

  renderClosing();
}

function renderClosing() {
  $('#dDate').value = $('#dDate').value || new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const all = readLS(LS.closing, []);
  const month = String($('#dDate').value).slice(0, 7);
  const rows = all.filter((r) => String(r.date).slice(0, 7) === month).sort((a, b) => (a.date < b.date ? 1 : -1));
  const orders = rows.reduce((a, r) => a + (Number(r.orders) || 0), 0);
  const sales = rows.reduce((a, r) => a + (Number(r.sales) || 0), 0);
  $('#closeEntries').innerHTML = rows.length
    ? `${rows.length}일 · ${orders}건 · ${secret(sales, '원')}` + rows.slice(0, 5).map((r) => `<div class="muted" style="font-size:11px">${esc(r.date.slice(5))} · ${r.orders}건 · ${secret(r.sales, '원')}</div>`).join('')
    : '<span class="muted" style="font-size:11.5px">이번 달 기록이 없습니다.</span>';
}

/* ─────────────── 설정 ─────────────── */
function renderSettings(v) {
  $('#storeMode').value = STORE_MODE;
  $('#dataMode').value = DATA_MODE;
  $('#modeNote').textContent = 'PRE_OPEN_PREP은 매출 0원 구간에서 오탐 경보를 숨기고 홈을 오픈 준비도로 바꿉니다. DEMO는 합성 픽스처로 그래프·경보를 검증하는 스위치입니다(상단 주황 배지 고정).';
  const slot = (V3.ledger && V3.ledger.slot) || {};
  $('#slotPanel').innerHTML = `
    <div class="gauge ${slot.level === 'RED' ? 'crit' : slot.level === 'YELLOW' ? 'warn' : ''}">
      <div class="g-top"><b>판매상품비중</b><span class="amt">${slot.sold_skus_13m || 0} / ${slot.denominator_slots || 0} (필요 ${slot.required_sold_skus || 0})</span><span class="pct">${slot.ratio_pct == null ? '—' : slot.ratio_pct + '%'}</span></div>
      <div class="track ${slot.level === 'RED' ? 'crit' : slot.level === 'YELLOW' ? 'warn' : ''}"><i style="width:${Math.min(100, ((slot.ratio_pct || 0) / 3.5) * 100)}%"></i></div>
      <div class="g-note">안전선 3.5% (3.49% 차단 / 3.50% 통과) · 활성 슬롯 ${slot.active_slots || 0} / 상한 ${slot.slot_cap || 40} · 여유 ${slot.headroom_slots || 0}개</div>
    </div>
    <p class="note">${(slot.denominator_slots || 0) === 0 ? '등록·판매중 상품이 0 — 판매상품비중 판정 보류(재오픈 후 계산).' : (slot.block_new_listing ? '지금은 신규 등록이 잠깁니다(3.5% 미만).' : '신규 등록 여유가 있습니다.')} 12월에는 등록을 하지 않고 2027-01-02 이후 재개합니다.</p>`;
  $('#systemPanel').innerHTML = `
    <div class="item"><div class="meta"><span>화면 데이터</span><span><b>${MODEL.generatedAt ? new Date(MODEL.generatedAt).toLocaleString('ko-KR') : '—'}</b></span></div><div class="meta"><span>도매의신 스냅샷</span><span>${MODEL.snapshotAt ? new Date(MODEL.snapshotAt).toLocaleString('ko-KR') : '—'} (${MODEL.freshness || '—'})</span></div></div>
    <div class="item"><div class="meta"><span>공인IP</span><span><b>미확인</b> — 노트북 10분 점검</span></div><div class="meta"><span>도매예치금</span><span><b>미확인</b> — 결제 방식 확인 전</span></div></div>
    <div class="item"><div class="meta"><span>GAS</span><span>${DATA_MODE === 'DEMO' ? '데모 데이터' : '웹앱 URL·기기키 미설정'}</span></div><div class="meta"><span>커머스API</span><span>미연결(P1)</span></div></div>`;
  $('#writePanel').innerHTML = `
    <div class="banner prep"><span>🔒</span><div><b>WRITE_ENABLED = false</b> — 2027-01-02 이전에는 어떤 경로로도 스토어로 쓰지 않습니다. 발주·송장·판매상태 변경 버튼은 확인창과 복사용 JSON 까지만 동작합니다.</div></div>
    <p class="note">안전장치: 1회 30건 상한 · 호출 간격 1,200ms 직렬 · 무변경 호출 차단 · 변경 후 재조회 대조 · 감사 로그(Audit).</p>`;
}

/* ─────────────── 이벤트 ─────────────── */
function goTab(name) {
  $$('section[data-tab]').forEach((s) => { s.hidden = s.dataset.tab !== name; });
  $$('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.go === name)));
  // 폰에서 탭이 가로로 넘칠 때 활성 탭이 보이게 스크롤한다(페이지 스크롤이 아니라 탭바만).
  const nav = $('#tabs');
  const active = nav.querySelector(`button[data-go="${name}"]`);
  if (nav && active) {
    const left = active.offsetLeft;
    if (left < nav.scrollLeft || left + active.offsetWidth > nav.scrollLeft + nav.clientWidth) {
      nav.scrollLeft = Math.max(0, left - 10);
    }
  }
  writeLS(LS.tab, name);
  // 숨겨진 탭은 clientWidth 가 0 이라 차트를 320px 로 그린다 → 보이게 된 뒤 다시 그린다.
  const v = view();
  if (name === 'home') renderHome(v);
  else if (name === 'inflow') renderInflow(v);
  window.scrollTo({ top: 0, behavior: 'auto' });
}

$('#tabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-go]');
  if (b) goTab(b.dataset.go);
});

$('#maskBtn').addEventListener('click', () => {
  MASK = !MASK;
  writeLS(LS.mask, MASK);
  renderAll();
  toast(MASK ? '금액을 가립니다' : '금액을 보여 줍니다');
});

$('#refreshInfo').addEventListener('click', () => {
  openSheet(`<h3>데이터 갱신 안내</h3>
    <p>화면은 <b>${esc(MODEL.generatedAt ? new Date(MODEL.generatedAt).toLocaleString('ko-KR') : '—')}</b> 에 만들어졌습니다. 도매의신 숫자는 하루 두 번(09:00·18:00) 감시한 스냅샷이고, <b>${esc(String((MODEL.thresholds && MODEL.thresholds.staleWarnHours) || 16))}시간</b>이 지나면 흐려집니다.</p>
    <p>DEMO 모드의 주문·클레임·정산·유입은 <b>합성 데이터</b>입니다. 실데이터는 GAS·커머스API 연결(P1) 후 표시됩니다.</p>
    <p>갱신: 피클에게 <code>묘한살림 대시보드 갱신</code>이라고 하면 새 스냅샷으로 다시 만들어 이 페이지에 올립니다.</p>`);
});

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-copytext]');
  if (t) { copyText(t.getAttribute('data-copytext')); return; }
  const c = ev.target.closest('[data-copy]');
  if (c) { copyText(c.getAttribute('data-copy')); return; }
  const w = ev.target.closest('[data-wg]');
  if (w) {
    const map = { dispatch: 'orders', order_wait: 'orders', claim_sla: 'claims', unanswered: 'claims', stock_risk: 'products', customs: 'claims' };
    goTab(map[w.dataset.wg] || 'home');
    return;
  }
  const st = ev.target.closest('[data-stage]');
  if (st) {
    ORDER_FILTER = ORDER_FILTER === st.dataset.stage ? null : st.dataset.stage;
    renderOrders(view());
    return;
  }
  const tr = ev.target.closest('[data-track]');
  if (tr) { TRACK_FILTER = tr.dataset.track; renderProducts(view()); return; }
  const g45 = ev.target.closest('[data-g45]');
  if (g45) {
    const cur = Number(readLS(LS.orders45, 0)) || 0;
    writeLS(LS.orders45, Math.max(0, Math.min(99, cur + Number(g45.dataset.g45))));
    render45(view());
    return;
  }
  const done = ev.target.closest('[data-done]');
  if (done) {
    const i = Number(done.dataset.done);
    const list = readLS(LS.runbook, []);
    writeLS(LS.runbook, list.includes(i) ? list.filter((x) => x !== i) : list.concat(i));
    renderRunbook();
    return;
  }
  const top = ev.target.closest('.step-top');
  if (top) {
    const body = top.parentElement.querySelector('.step-body');
    body.hidden = !body.hidden;
    return;
  }
  const dm = ev.target.closest('[data-domaesin]');
  if (dm) { confirmDomaesin(dm.dataset.domaesin); return; }
  const co = ev.target.closest('[data-copyorder]');
  if (co) {
    const v = view();
    const o = v.orders.find((x) => x.productOrderId === co.dataset.copyorder);
    if (o) copyText(JSON.stringify({ productOrderId: o.productOrderId, sku: o.sku, option: o.option, qty: o.qty, amount: o.amount }, null, 2));
    return;
  }
  const cl = ev.target.closest('[data-claim]');
  if (cl) {
    const [id, action] = cl.dataset.claim.split(':');
    confirmClaim(id, action);
    return;
  }
  const ms = ev.target.closest('[data-measure]');
  if (ms) { measureSheet(ms.dataset.measure); return; }
});

function confirmDomaesin(productOrderId) {
  const v = view();
  const list = v.orders.filter((o) => o.stage === 'ORDER_WAIT' || o.stage === 'DISPATCH_WAIT');
  const cost = list.reduce((a, o) => a + (num(o.supplyCost) || 0), 0);
  const payload = { action: 'enqueue_intent', intentType: 'ORDER_BATCH', targetIds: [productOrderId], params: { note: '도매 일괄 발주' }, idempotencyKey: `ord-${productOrderId}-${Date.now()}` };
  openSheet(`<h3>도매 일괄 발주 — 확인</h3>
    <p>대상 <b>${list.length}건</b> · 원가합 <b>${secret(cost, '원')}</b> · 남은 예치금 <b>미확인</b>(도매의신 로그인 확인 필요).</p>
    <p class="note">호출 즉시 대금이 차감되고 실제 출고 지시가 나가 취소가 어렵습니다. 2027-01-02 이전에는 <b>WRITE_ENABLED=false</b> 라 요청만 만들어 둡니다.</p>
    <pre>${esc(JSON.stringify(payload, null, 2))}</pre>
    <button class="btn primary block" id="copyIntent">요청 JSON 복사</button>`);
  $('#copyIntent').onclick = () => copyText(JSON.stringify(payload, null, 2));
}

function confirmClaim(claimId, action) {
  const v = view();
  const c = v.claims.find((x) => x.claimId === claimId);
  if (!c) return;
  openSheet(`<h3>${action === 'APPROVE' ? '클레임 승인' : '반품·교환 보류'} — 확인</h3>
    <p>${esc(TYPE_LABEL[c.type])} · ${esc(FAULT_LABEL[c.fault])} · 차감 <b>${secret(c.deductKrw, '원')}</b> · 환불상한 <b>${secret(c.refundCapKrw, '원')}</b></p>
    <p class="note">${action === 'APPROVE' ? '기발주 건은 도매 취소완료를 먼저 대조해야 합니다. 사유·증빙 사진이 없으면 네이버 직권 환불·페널티로 이어질 수 있습니다.' : '보류·거부는 사유와 증빙을 먼저 확인하세요.'}</p>
    <label style="font-size:12px;display:flex;gap:7px;align-items:center;margin:8px 0"><input type="checkbox" id="clConfirmChk"> 증빙 사진·사유를 확인했습니다</label>
    <button class="btn primary block" id="clGo" disabled>${action === 'APPROVE' ? '승인 요청 만들기' : '보류 요청 만들기'}</button>`);
  $('#clConfirmChk').onchange = (e) => { $('#clGo').disabled = !e.target.checked; };
  $('#clGo').onclick = () => {
    $('#sheet').hidden = true;
    toast('12월 쓰기 잠금 — 요청을 만들지 않았습니다(복사용 JSON은 주문 탭)');
  };
}

function measureSheet(key) {
  openSheet(`<h3>실측 입력</h3>
    <p class="note">단가·배송비·근거 URL을 넣으면 VERIFIED 로 바뀝니다(이 기기 저장).</p>
    <div class="field"><label for="mUnit">단가(원)</label><input id="mUnit" type="number" inputmode="numeric"></div>
    <div class="field"><label for="mShip">배송비(원)</label><input id="mShip" type="number" inputmode="numeric" value="0"></div>
    <div class="field"><label for="mUrl">근거 URL</label><input id="mUrl" type="url" placeholder="https://" style="flex:1;width:auto"></div>
    <button class="btn primary block" id="mSave" style="margin-top:9px">저장</button>`);
  $('#mSave').onclick = () => {
    const unit = num($('#mUnit').value);
    const ship = num($('#mShip').value) || 0;
    const url = $('#mUrl').value.trim();
    if (!unit || !/^https:\/\//.test(url)) { toast('단가와 https 근거 URL이 필요합니다'); return; }
    const all = readLS(LS.candidates, {});
    all[key] = { status: 'VERIFIED', unitKrw: unit, shipKrw: ship, evidenceUrl: url };
    writeLS(LS.candidates, all);
    $('#sheet').hidden = true;
    renderSourcing(view());
    toast('실측 저장 — VERIFIED');
  };
}

$('#storeMode').addEventListener('change', (e) => {
  STORE_MODE = e.target.value;
  writeLS(LS.storeMode, STORE_MODE);
  renderAll();
  toast(STORE_MODE === 'PRE_OPEN_PREP' ? '오픈 준비 모드' : '실운영 모드');
});
$('#dataMode').addEventListener('change', (e) => {
  DATA_MODE = e.target.value;
  writeLS(LS.dataMode, DATA_MODE);
  renderAll();
  toast(DATA_MODE === 'DEMO' ? 'DEMO 시뮬레이션' : 'LIVE (실데이터 미연결)');
});

/* 유입 업로드 */
async function handleFile(file) {
  if (!file) return;
  const buf = new Uint8Array(await file.arrayBuffer());
  const res = await window.V3Upload.parseFile({ name: file.name, bytes: buf }, { inflate: window.V3Upload.browserInflate });
  applyUpload(res, file.name);
}

function applyUpload(res, label) {
  if (!res || !res.ok) {
    const code = res && res.code;
    toast(code === 'ERR_SCHEMA_MISMATCH' ? `열 이름을 못 읽었습니다 (${(res.missing || []).join(', ')})` : '파일을 읽지 못했습니다');
    openSheet(`<h3>업로드 실패 — ${esc(code || '알 수 없음')}</h3>
      <p>${esc((res && res.warnings || []).join(' / ') || '형식이 맞지 않습니다.')}</p>
      <p class="note">판매자센터 → 데이터분석 → 유입분석 표에 <b>날짜 · 순방문자 · 결제건수</b> 열이 있어야 합니다. 8.49% 확률의 열 이름 변경에 대비해, 안 되면 4칸 수동 입력으로 대체합니다.</p>
      <button class="btn ghost block" id="manualForm">수동 입력 열기</button>`);
    if ($('#manualForm')) $('#manualForm').onclick = () => { $('#sheet').hidden = true; goTab('inflow'); };
    return;
  }
  UPLOAD = { rows: res.rows, channels: res.channels, keywords: res.keywords, funnel: res.funnel, savedAt: new Date().toISOString(), source: label || '업로드' };
  writeLS(LS.traffic, UPLOAD);
  renderAll(); // 홈 KPI·추이도 같은 데이터를 쓴다
  goTab('inflow');
  toast(`${res.rows.length}일 치를 읽었습니다`);
}

$('#inflowFile').addEventListener('change', (e) => { handleFile(e.target.files && e.target.files[0]); e.target.value = ''; });

$('#inflowParse').addEventListener('click', async () => {
  const text = $('#inflowPaste').value.trim();
  if (!text) { toast('붙여넣은 표가 없습니다'); return; }
  const res = await window.V3Upload.parseFile({ text });
  applyUpload(res, '붙여넣기');
});

$('#inflowUseDemo').addEventListener('click', () => {
  UPLOAD = null;
  localStorage.removeItem(LS.traffic);
  renderAll(); // 다른 탭(홈 KPI)도 데모로 돌아가야 한다
  goTab('inflow');
  toast('데모 유입 데이터로 되돌렸습니다');
});

/* 클레임 계산기 */
['clType', 'clFault', 'clGrade', 'clSale', 'clSupply', 'clProfit', 'clFee'].forEach((id) => {
  $('#' + id).addEventListener('input', calcClaim);
  $('#' + id).addEventListener('change', calcClaim);
});

/* 마진 계산기 */
$('#cPick').addEventListener('change', (e) => {
  const i = Number(e.target.value);
  if (Number.isInteger(i) && MODEL.skus[i]) fillMargin(MODEL.skus[i]);
});
['cSale', 'cSupply', 'cShip', 'cReturn'].forEach((id) => {
  $('#' + id).addEventListener('input', calcMargin);
});

/* 일일 마감 */
$('#dSave').addEventListener('click', () => {
  const date = $('#dDate').value || new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const entry = { date, orders: Number($('#dOrders').value) || 0, sales: Number($('#dSales').value) || 0, returns: Number($('#dReturns').value) || 0 };
  const all = readLS(LS.closing, []);
  const prev = all.find((r) => r.date === date);
  const delta = entry.orders - (prev ? Number(prev.orders) || 0 : 0);
  writeLS(LS.closing, all.filter((r) => r.date !== date).concat([entry]));
  const g = Number(readLS(LS.orders45, 0)) || 0;
  writeLS(LS.orders45, Math.max(0, Math.min(99, g + delta)));
  $('#dOrders').value = ''; $('#dSales').value = ''; $('#dReturns').value = '';
  renderSettle(view());
  toast(`${date.slice(5)} 마감 저장`);
});
$('#dDate').addEventListener('change', renderClosing);
$('#main').addEventListener('change', (ev) => {
  if (ev.target && ev.target.id === 'g45input') {
    writeLS(LS.orders45, Math.max(0, Math.min(99, Number(ev.target.value) || 0)));
    render45(view());
  }
});

/* 창 폭이 바뀌면 차트를 다시 그린다(픽셀 폭 기준 viewBox) */
let resizeTimer = null;
window.addEventListener('resize', () => {
  if (!MODEL) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const v = view();
    renderHome(v);
    renderInflow(v);
  }, 180);
});

/* 시작 */
boot().then(() => {
  if (!MODEL) return;
  const last = readLS(LS.tab, 'home');
  if (['home', 'inflow', 'orders', 'claims', 'products', 'sourcing', 'settle', 'settings'].includes(last)) goTab(last);
});
