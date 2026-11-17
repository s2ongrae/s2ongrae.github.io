/* 묘한살림 운영 대시보드 — app.js
 * 데이터: data.enc.json (AES-GCM, PBKDF2-SHA256) — 복호화 결과는 메모리에만 둔다.
 * 브라우저 안에서만 동작한다. 서버로 보내는 요청은 data.enc.json 하나뿐이다.
 */
'use strict';

const LS = {
  pass: 'myohan.pass',
  mask: 'myohan.mask',
  orders: 'myohan.orders',
  closing: 'myohan.closing',
  runbook: 'myohan.runbook',
  tab: 'myohan.tab',
};

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let MODEL = null;      // 복호화된 모델 (메모리에만)
let MASK = true;       // 공급가·마진 가리기 (기본 ON)

const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : null);
const fmt = (n) => (num(n) == null ? '-' : num(n).toLocaleString('ko-KR'));
const won = (n) => (num(n) == null ? '-' : `${num(n).toLocaleString('ko-KR')}원`);

/** 가릴 값 — 마스크 상태면 점으로 */
const secret = (n, suffix) => {
  if (MASK) return '•••';
  const v = num(n);
  if (v == null) return '-';
  return `${v.toLocaleString('ko-KR')}${suffix || ''}`;
};

const readLS = (k, fallback) => {
  try {
    const v = localStorage.getItem(k);
    return v == null ? fallback : JSON.parse(v);
  } catch (e) { return fallback; }
};
const writeLS = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 공간 없음 */ }
};

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 1600);
}

/* ─────────────────────────── 암호 해제 ─────────────────────────── */
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function decryptPayload(payload, passphrase) {
  const salt = b64(payload.kdf.salt);
  const iv = b64(payload.cipher.iv);
  const ct = b64(payload.ct);
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: payload.kdf.iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(plain));
}

function showLock(message) {
  $('#lockScreen').hidden = false;
  $('#hdr').hidden = true;
  $('#main').hidden = true;
  $('#tabbar').hidden = true;
  $('#lockErr').textContent = message || '';
  setTimeout(() => { try { $('#pass').focus(); } catch (e) {} }, 120);
  MODEL = null;
}

function showApp() {
  $('#lockScreen').hidden = true;
  $('#hdr').hidden = false;
  $('#main').hidden = false;
  $('#tabbar').hidden = false;
  renderAll();
}

async function boot() {
  MASK = readLS(LS.mask, true) !== false;
  $('#maskBtn').setAttribute('aria-pressed', String(MASK));

  let payload;
  try {
    const res = await fetch('data.enc.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    payload = await res.json();
  } catch (e) {
    showLock('');
    $('#lockErr').textContent = '데이터 파일(data.enc.json)을 불러오지 못했습니다.';
    $('#unlockBtn').disabled = true;
    return;
  }

  const saved = readLS(LS.pass, null);
  if (saved) {
    try {
      MODEL = await decryptPayload(payload, saved);
      showApp();
      return;
    } catch (e) {
      localStorage.removeItem(LS.pass); // 암호가 바뀌었거나 기억된 값이 틀림
    }
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

/* ─────────────────────────── 렌더 ─────────────────────────── */
function renderAll() {
  renderFreshness();
  renderKpis();
  renderGauge();
  renderList();
  renderRunbook();
  renderCalcOptions();
  renderClosing();
  applyMask();
  $('#builtAt').textContent = MODEL.generatedAt
    ? `화면 데이터 생성 ${new Date(MODEL.generatedAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
    : '';
}

function hoursText(h) {
  if (h == null) return '시각 정보 없음';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}분 전`;
  if (h < 48) return `${Math.floor(h)}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

function renderFreshness() {
  const bar = $('#freshBar');
  const level = MODEL.freshness || 'UNKNOWN';
  bar.className = `fresh${level === 'WARN' ? ' warn' : level === 'CRIT' ? ' crit' : ''}`;
  const at = MODEL.snapshotAt ? new Date(MODEL.snapshotAt) : null;
  const stamp = at ? at.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
  const ageH = MODEL.snapshotAgeHours;
  let label = `도매의신 확인 ${hoursText(ageH)} · ${stamp}`;
  if (level === 'WARN') label += ' · 확인 필요';
  if (level === 'CRIT') label += ' · 오래됨(직접 확인)';
  $('#freshText').textContent = label;
}

function renderKpis() {
  const s = MODEL.summary || {};
  const warn = (s.warnCount || 0) + (s.critCount || 0);
  const items = [
    { k: '판매중', v: s.skuCount, u: '종', cls: '' },
    { k: '평균 마진', v: s.avgMarginPct == null ? '-' : s.avgMarginPct, u: '%', cls: 'good' },
    { k: '마진 경고', v: warn, u: '종', cls: warn ? 'warn' : '' },
    { k: '품절', v: s.soldOutCount || 0, u: '종', cls: (s.soldOutCount || 0) ? 'crit' : '' },
  ];
  $('#kpis').innerHTML = items.map((i) => `
    <div class="kpi ${i.cls}"><i>${i.k}</i><b>${i.v}<small>${i.u}</small></b></div>`).join('');
}

function renderGauge() {
  const count = Math.max(0, Math.min(99, Number(readLS(LS.orders, 0)) || 0));
  const L = (MODEL.thresholds && MODEL.thresholds.orderLadder) || { warn: 35, lock: 42, urgent: 44 };
  const stage = count >= L.urgent ? 'URGENT' : count >= L.lock ? 'LOCK' : count >= L.warn ? 'WARN' : 'NORMAL';
  const pct = Math.min(100, (count / 45) * 100);
  const stageLabel = { NORMAL: '정상', WARN: '유입 중단', LOCK: '판매중지 요청', URGENT: '즉시 중지' }[stage];
  const act = {
    NORMAL: `잔여 ${45 - count}건. 지금은 그대로 팔아도 됩니다.`,
    WARN: `<b>${count}건</b> — SNS·쇼츠 유입을 멈추고 자연검색만 남기세요.`,
    LOCK: `<b>${count}건</b> — 전 상품 판매중지 승인 요청 단계입니다. 승인 후에도 상품은 삭제하지 마세요.`,
    URGENT: `<b>${count}건</b> — 즉시 판매중지. 구매확정 50건이 통신판매업 신고 기준입니다.`,
  }[stage];
  $('#gNow').textContent = count;
  $('#gStage').textContent = stageLabel;
  $('#gStage').className = `stage${stage === 'WARN' ? ' warn' : stage === 'LOCK' || stage === 'URGENT' ? ' crit' : ''}`;
  const bar = $('#gBar');
  bar.className = `bar${stage === 'WARN' ? ' warn' : stage === 'LOCK' || stage === 'URGENT' ? ' crit' : ''}`;
  bar.firstElementChild.style.width = `${pct}%`;
  $('#gAct').innerHTML = act;
  $('#gInput').value = count;
  $('#gSaved').textContent = count ? '이 기기에 저장됨' : '';
}

function setGauge(next) {
  const v = Math.max(0, Math.min(99, Number(next) || 0));
  writeLS(LS.orders, v);
  renderGauge();
}

$('#gPlus').addEventListener('click', () => setGauge(Number(readLS(LS.orders, 0)) + 1));
$('#gMinus').addEventListener('click', () => setGauge(Number(readLS(LS.orders, 0)) - 1));
$('#gInput').addEventListener('change', (e) => setGauge(e.target.value));

function gradeLabel(g) {
  return { GOOD: '정상', WARN: '주의', CRIT: '심각', UNKNOWN: '확인불가' }[g] || '확인불가';
}

function renderList() {
  const sort = $('#sortSel').value;
  const list = (MODEL.skus || []).slice();
  if (sort === 'risk') list.sort((a, b) => (num(a.marginPct) ?? 999) - (num(b.marginPct) ?? 999));
  if (sort === 'name') list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));
  if (sort === 'price') list.sort((a, b) => (num(b.salePrice) ?? 0) - (num(a.salePrice) ?? 0));

  const stale = MODEL.freshness && MODEL.freshness !== 'FRESH';
  $('#listCnt').textContent = `${list.length}종 · ${sort === 'risk' ? '마진 낮은 순' : sort === 'price' ? '판매가 높은 순' : '이름 순'}`;

  $('#skuList').innerHTML = list.map((s) => {
    const statusPill = s.soldOut
      ? '<span class="chip off">품절</span>'
      : s.options && s.options.total && s.options.sellable < s.options.total
        ? `<span class="chip todo">옵션 ${s.options.sellable}/${s.options.total}</span>`
        : '<span class="chip on">판매중</span>';
    const missing = (s.missingOptions || []).length
      ? `<span class="chip todo">옵션 추가 검토 ${esc(s.missingOptions.join('·'))}</span>` : '';
    const exposure = s.exposure && s.exposure !== '미확인'
      ? `<span class="chip ${s.exposure === '노출중' ? 'on' : 'off'}">${esc(s.exposure)}</span>`
      : '<span class="chip">노출 미확인</span>';
    const expired = s.exposureCheckedAt
      ? `<span style="font-size:10.5px;color:var(--ink-3)">${new Date(s.exposureCheckedAt).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })} 확인</span>` : '';

    const caps = [];
    if (s.returnImpact && s.returnImpact.roundTripKrw) {
      caps.push(`반품 1건 = 왕복 ${secret(s.returnImpact.roundTripKrw, '원')}${s.returnImpact.unitsOfProfit != null && !MASK ? ` (순익 ${s.returnImpact.unitsOfProfit}건분)` : ''}`);
    }
    if (s.breakevenSalePrice) caps.push(`15% 최소가 ${secret(s.breakevenSalePrice, '원')}`);
    if (s.supplierCode) caps.push(`공급사 ${esc(s.supplierCode)}`);

    return `
    <article class="sku${stale ? ' stale' : ''}">
      <div class="sku-head">
        <span class="nm">${esc(s.name)}${stale ? '<span class="stale-badge">미확인</span>' : ''}</span>
        <span class="pill ${s.grade === 'WARN' ? 'warn' : s.grade === 'CRIT' ? 'crit' : s.grade === 'UNKNOWN' ? 'mute' : ''}">${s.marginPct == null ? '확인불가' : `${s.marginPct}%`}</span>
      </div>
      <div class="nums">
        <div><label>판매가</label><b>${won(s.salePrice)}</b></div>
        <div><label>공급+배송</label><b class="secretv">${secret(num(s.supplyPrice) == null ? null : num(s.supplyPrice) + (num(s.shipFee) || 0), '원')}</b></div>
        <div><label>한 건 순익</label><b class="secretv">${secret(s.profitKrw, '원')}</b></div>
      </div>
      <div class="chips">
        ${statusPill}${missing}${exposure}${expired}
        <span class="links">
          ${s.storeUrl ? `<a href="${esc(s.storeUrl)}" target="_blank" rel="noopener">스토어 ↗</a>` : ''}
          ${s.domesinUrl ? `<a href="${esc(s.domesinUrl)}" target="_blank" rel="noopener">도매의신 ↗</a>` : ''}
        </span>
      </div>
      <details>
        <summary>상세</summary>
        <div class="dtl">
          <div><span>마진율</span><span>${s.marginPct == null ? '-' : s.marginPct + '%'} · ${gradeLabel(s.grade)}</span></div>
          <div><span>반품 1건</span><span class="secretv">${s.returnImpact && s.returnImpact.roundTripKrw ? `왕복 ${secret(s.returnImpact.roundTripKrw, '원')} · 순익 ${s.returnImpact.unitsOfProfit == null ? '-' : (MASK ? '•••' : s.returnImpact.unitsOfProfit + '건분')}` : '정보 없음'}</span></div>
          <div><span>15% 최소가</span><span class="secretv">${secret(s.breakevenSalePrice, '원')}</span></div>
          <div><span>배송비</span><span>${(num(s.shipFee) || 0) === 0 ? '무료' : won(s.shipFee)}</span></div>
          <div><span>반품 편도</span><span>${won(s.returnFee)}</span></div>
          <div><span>옵션</span><span>${s.options && s.options.total ? `${s.options.sellable}/${s.options.total}${s.options.soldLabels.length ? ` · 품절 ${esc(s.options.soldLabels.join(', '))}` : ''}` : '단일 구성'}</span></div>
          ${(s.registeredOptions || []).length ? `<div><span>등록 옵션</span><span>${esc(s.registeredOptions.join(', '))}</span></div>` : ''}
          <div><span>도매의신 확인</span><span>${s.fetchedAt ? new Date(s.fetchedAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</span></div>
          <div><span>상품번호</span><span>${esc(s.productNo || '-')} · ${esc(s.code || '')}</span></div>
        </div>
      </details>
    </article>`;
  }).join('');
}

$('#sortSel').addEventListener('change', renderList);

/* ── 첫 주문 RUNBOOK ── */
const RUNBOOK = [
  {
    t: '주문 확인 · 도매처 실재고/단가 대조', min: '2분',
    body: '신규 주문의 상품·옵션·수량을 확인하고, 도매의신 상품 페이지에서 지금도 살 수 있는지(품절 아님)와 공급가가 그대로인지 본다.',
    chk: '도매처 장바구니 결제액(배송비 포함)이 내 정산 예정액보다 작은가?',
    copy: '안녕하세요, 묘한살림입니다 :) 주문해 주신 상품 확인되었습니다. 꼼꼼히 검수해서 안전하게 출고하겠습니다!',
  },
  {
    t: '발주확인 · 도매의신 위탁 발주', min: '4분',
    body: '스마트스토어에서 [발주확인]을 누르고, 도매의신 주문서에 받는 분 이름·연락처·주소·배송메모를 그대로 넣어 결제한다.',
    chk: '결제자가 아니라 "받는 분" 이름·번호·주소가 정확히 들어갔는가?',
    copy: '[위탁발송] 거래명세서·가격표·홍보물은 동봉하지 말아 주세요. 파손 주의 부탁드립니다.',
  },
  {
    t: '송장 수집 · 발송처리', min: '2분',
    body: '도매의신에서 출고되면 송장번호를 복사해 스마트스토어 [발송처리]에 택배사와 송장번호를 넣는다. 발송기한은 결제+3영업일이다.',
    chk: '택배사가 실제 출고 택배사와 같은가?',
    copy: '고객님, 주문하신 상품이 오늘 출고되었습니다! 택배사 사정에 따라 보통 1~2영업일 안에 받아보실 수 있어요. 감사합니다 :)',
  },
  {
    t: '배송 추적 · CS·반품 방어', min: '1분',
    body: '집화·배송완료를 확인하고, 파손·오배송 클레임은 사진을 먼저 요청한다. 단순변심 반품은 왕복 배송비를 먼저 안내한다.',
    chk: '반품 안내 전에 이 상품의 왕복 반품비(편도×2)를 확인했는가?',
    copy: '단순변심 반품은 왕복 배송비가 발생합니다. 상품 파손·오배송이라면 박스와 상품 사진을 톡톡으로 보내주세요. 확인 후 바로 처리해 드리겠습니다.',
  },
  {
    t: '일일 마감 · 45건 게이지 확인', min: '1분',
    body: '오늘 건수·매출을 마감 탭에 넣고, 결제완료 누적을 게이지에 반영한다. 35건이면 SNS 유입을 멈춘다.',
    chk: '취소·반품 확정 건이 누적 카운트에 반영됐는가?',
    copy: '[날짜] 신규 0건 / 누적 00건 / 도매 발주 완료 / 특이사항 없음',
  },
];

function renderRunbook() {
  const done = readLS(LS.runbook, []);
  $('#runbook').innerHTML = RUNBOOK.map((s, i) => `
    <div class="step${done.includes(i) ? ' done' : ''}" data-step="${i}">
      <button class="step-top" type="button" aria-expanded="false">
        <span class="step-no">${done.includes(i) ? '✓' : i + 1}</span>
        <span class="step-t">${esc(s.t)}</span>
        <span class="step.min">${esc(s.min)}</span>
        <span class="step-cv">▾</span>
      </button>
      <div class="step-body" hidden>
        <p>${esc(s.body)}</p>
        <div class="chk"><span>⚠️</span><span>${esc(s.chk)}</span></div>
        <button class="copy" data-copy="${esc(s.copy)}">${esc(s.copy)}</button>
        <div style="height:9px"></div>
        <button class="btn ghost" data-done="${i}">${done.includes(i) ? '완료 취소' : '이 단계 완료'}</button>
      </div>
    </div>`).join('');
  $('#rbProg').textContent = `${done.length} / ${RUNBOOK.length} 완료`;
}

$('#runbook').addEventListener('click', (ev) => {
  const top = ev.target.closest('.step-top');
  if (top) {
    const body = top.parentElement.querySelector('.step-body');
    body.hidden = !body.hidden;
    top.setAttribute('aria-expanded', String(!body.hidden));
    top.parentElement.classList.toggle('open', !body.hidden);
    return;
  }
  const doneBtn = ev.target.closest('[data-done]');
  if (doneBtn) {
    const i = Number(doneBtn.dataset.done);
    const done = readLS(LS.runbook, []);
    const next = done.includes(i) ? done.filter((x) => x !== i) : done.concat(i);
    writeLS(LS.runbook, next);
    renderRunbook();
    return;
  }
  const copyBtn = ev.target.closest('[data-copy]');
  if (copyBtn) copyText(copyBtn.dataset.copy);
});

$('#rbReset').addEventListener('click', () => {
  writeLS(LS.runbook, []);
  renderRunbook();
  toast('초기화했습니다');
});

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('복사했습니다')).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); toast('복사했습니다'); } catch (e) { toast('복사 실패'); }
  ta.remove();
}
$$('.copy[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy)));

/* ── 계산기 ── */
function renderCalcOptions() {
  const list = MODEL.skus || [];
  const pick = $('#cPick');
  pick.innerHTML = '<option value="">직접 입력</option>' + list.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('');
  if (list.length) {
    const lowest = list.slice().sort((a, b) => (num(a.marginPct) ?? 999) - (num(b.marginPct) ?? 999))[0];
    const idx = list.indexOf(lowest);
    pick.value = String(idx);
    fillCalc(list[idx]);
  } else {
    fillCalc({});
  }
}

function fillCalc(s) {
  $('#cSale').value = num(s.salePrice) ?? '';
  $('#cSupply').value = num(s.supplyPrice) ?? '';
  $('#cShip').value = num(s.shipFee) ?? 0;
  $('#cReturn').value = num(s.returnFee) ?? '';
  $('#cFee').value = MODEL.store ? MODEL.store.feeRatePct : 4.95;
  $('#cReserve').value = MODEL.store ? MODEL.store.returnReservePct : 4;
  calc();
}

$('#cPick').addEventListener('change', (e) => {
  const i = Number(e.target.value);
  if (Number.isInteger(i) && MODEL.skus[i]) fillCalc(MODEL.skus[i]);
});

function calc() {
  const sale = num($('#cSale').value);
  const supply = num($('#cSupply').value);
  const ship = num($('#cShip').value) || 0;
  const ret = num($('#cReturn').value);
  const feePct = num($('#cFee').value) ?? 4.95;
  const resPct = num($('#cReserve').value) ?? 4;
  if (!sale || sale <= 0 || supply == null) {
    $('#oProfit').textContent = '-'; $('#oMargin').textContent = '-';
    $('#oBreakeven').textContent = '-'; $('#oReturn').textContent = '-';
    $('#oVerdict').className = 'verdict';
    $('#oVerdict').textContent = '판매가와 공급가를 넣으면 판정이 나옵니다.';
    return;
  }
  const profit = Math.round(sale - supply - ship - sale * (feePct / 100) - sale * (resPct / 100));
  const margin = Math.round((profit / sale) * 1000) / 10;
  const divisor = 1 - feePct / 100 - resPct / 100 - 0.15;
  const breakeven = divisor > 0 ? Math.ceil((supply + ship) / divisor) : null;
  const roundTrip = ret ? ret * 2 : null;
  const units = roundTrip && profit > 0 ? Math.round((roundTrip / profit) * 10) / 10 : null;

  $('#oProfit').textContent = MASK ? '•••' : won(profit);
  $('#oMargin').textContent = `${margin}%`;
  $('#oBreakeven').textContent = MASK ? '•••' : won(breakeven);
  $('#oReturn').textContent = MASK
    ? '•••'
    : (roundTrip ? `${won(roundTrip)}${units ? ` · 순익 ${units}건분` : ''}` : '-');

  const v = $('#oVerdict');
  if (margin < 0) {
    v.className = 'verdict crit';
    v.textContent = MASK
      ? '역마진입니다. 한 건 팔 때마다 돈이 나갑니다. 판매가를 올리거나 상품을 내리세요.'
      : `역마진입니다. 한 건 팔 때마다 ${fmt(Math.abs(profit))}원이 나갑니다. 판매가를 올리거나 상품을 내리세요.`;
  } else if (margin < 8) {
    v.className = 'verdict crit';
    v.textContent = `마진 ${margin}% — 심각선(8%) 미만입니다. 판매중지 검토 대상입니다.`;
  } else if (margin < 15) {
    v.className = 'verdict warn';
    v.textContent = `마진 ${margin}% — 주의선(15%) 미만입니다. 광고를 태우지 말고 묶음배송용으로만 두세요.${MASK || !units ? '' : ` 반품 1건이면 순익 ${units}건이 사라집니다.`}`;
  } else {
    v.className = 'verdict';
    v.textContent = `마진 ${margin}% — 기준(15%)을 넘습니다.${MASK ? '' : ` 15%를 지키는 최소 판매가는 ${breakeven ? fmt(breakeven) + '원' : '-'}입니다.`}`;
  }
}
['cSale', 'cSupply', 'cShip', 'cReturn', 'cFee', 'cReserve'].forEach((id) => {
  document.addEventListener('input', (e) => { if (e.target.id === id) calc(); });
});

/* ── 일일 마감 ── */
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function monthOf(dateStr) { return String(dateStr || '').slice(0, 7); }

function renderClosing() {
  $('#dDate').value = $('#dDate').value || todayStr();
  const all = readLS(LS.closing, []);
  const month = monthOf($('#dDate').value || todayStr());
  const rows = all.filter((r) => monthOf(r.date) === month).sort((a, b) => (a.date < b.date ? 1 : -1));
  const orders = rows.reduce((a, r) => a + (Number(r.orders) || 0), 0);
  const sales = rows.reduce((a, r) => a + (Number(r.sales) || 0), 0);
  const avgMargin = MODEL.summary && MODEL.summary.avgMarginPct != null ? MODEL.summary.avgMarginPct : 0;
  const fee = Math.round(sales * ((MODEL.store ? MODEL.store.feeRatePct : 4.95) / 100));
  const profit = Math.round(sales * (avgMargin / 100));
  const has = rows.length > 0;

  $('#mOrders').textContent = `${orders}건`;
  $('#mSales').textContent = !has ? '-' : (MASK ? '•••' : `${fmt(sales)}원`);
  $('#mAov').textContent = orders ? (MASK ? '•••' : `${fmt(Math.round(sales / orders))}원`) : '-';
  $('#mFee').textContent = !has ? '-' : (MASK ? '•••' : `${fmt(fee)}원`);
  $('#mProfit').textContent = !has ? '-' : (MASK ? '•••' : `${fmt(profit)}원`);
  $('#mTax').textContent = !has ? '-' : (MASK ? '•••' : `${fmt(Math.round(profit * 0.3))}~${fmt(Math.round(profit * 0.35))}원`);

  $('#entryCnt').textContent = rows.length ? `${rows.length}일 기록` : '';
  $('#entries').innerHTML = rows.length
    ? rows.map((r, i) => `
      <div class="row">
        <span class="d">${esc(r.date.slice(5))}</span>
        <span class="n">${Number(r.orders) || 0}건 · ${MASK ? '•••' : fmt(r.sales) + '원'}${Number(r.returns) ? ` · 반품 ${Number(r.returns)}` : ''}</span>
        <button class="x" data-del="${esc(r.date)}" aria-label="삭제">×</button>
      </div>`).join('')
    : '<div class="row"><span class="n" style="color:var(--ink-3)">아직 기록이 없습니다.</span></div>';
}

$('#dSave').addEventListener('click', () => {
  const date = $('#dDate').value || todayStr();
  const entry = {
    date,
    orders: Number($('#dOrders').value) || 0,
    sales: Number($('#dSales').value) || 0,
    returns: Number($('#dReturns').value) || 0,
  };
  const all = readLS(LS.closing, []).filter((r) => r.date !== date);
  all.push(entry);
  writeLS(LS.closing, all);
  $('#dOrders').value = ''; $('#dSales').value = ''; $('#dReturns').value = '';
  renderClosing();
  toast(`${date.slice(5)} 마감 저장`);
});

$('#entries').addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-del]');
  if (!btn) return;
  const date = btn.dataset.del;
  if (!confirm(`${date} 기록을 지울까요?`)) return;
  writeLS(LS.closing, readLS(LS.closing, []).filter((r) => r.date !== date));
  renderClosing();
});
$('#dDate').addEventListener('change', renderClosing);

/* ── 마스킹·탭·시트 ── */
function applyMask() {
  $('#maskBtn').setAttribute('aria-pressed', String(MASK));
  document.body.classList.toggle('masked', MASK);
}

$('#maskBtn').addEventListener('click', () => {
  MASK = !MASK;
  writeLS(LS.mask, MASK);
  applyMask();
  renderKpis(); renderList(); renderCalcOptions(); renderClosing();
  toast(MASK ? '공급가·마진을 가립니다' : '공급가·마진을 보여 줍니다');
});

function goTab(name) {
  $$('section[data-tab]').forEach((s) => { s.hidden = s.dataset.tab !== name; });
  $$('#tabbar button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.go === name)));
  writeLS(LS.tab, name);
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}
$('#tabbar').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-go]');
  if (b) goTab(b.dataset.go);
});

function openSheet(html) {
  $('#sheetIn').innerHTML = html + '<button class="btn ghost close" id="sheetClose">닫기</button>';
  $('#sheet').hidden = false;
  $('#sheetClose').addEventListener('click', () => { $('#sheet').hidden = true; });
}
$('#sheet').addEventListener('click', (ev) => { if (ev.target.id === 'sheet') $('#sheet').hidden = true; });

$('#refreshInfo').addEventListener('click', () => {
  const at = MODEL.snapshotAt ? new Date(MODEL.snapshotAt).toLocaleString('ko-KR') : '-';
  openSheet(`
    <h3>데이터 갱신 안내</h3>
    <p>이 화면의 도매의신 숫자는 <b>${esc(at)}</b> 기준입니다. 품절·가격은 하루 두 번(09:00·18:00) 자동 감시가 확인해 저장소에 남기고, 그 값을 암호화해 이 페이지에 실어 둡니다.</p>
    <p>화면은 스냅샷이고, 실제 품절은 도매의신에서 확인해야 합니다. 그래서 <b>${esc(String(MODEL.thresholds ? MODEL.thresholds.staleWarnHours : 16))}시간</b>이 지나면 숫자가 흐려지고 <b>미확인</b> 표시가 붙습니다 — 그때는 상품 카드의 <b>도매의신 ↗</b>을 눌러 원본을 보세요.</p>
    <p>갱신 방법: 피클에게 <code>묘한살림 대시보드 갱신</code>이라고 하면 최신 스냅샷으로 다시 만들어 이 페이지에 올립니다(암호는 그대로).</p>
    <p class="note">이 페이지에는 공급가·마진이 암호문으로만 들어 있습니다. 암호는 이 기기에만 저장됩니다.</p>
  `);
});

/* 시작 */
boot().then(() => {
  const last = readLS(LS.tab, 'dash');
  if (MODEL && ['dash', 'order', 'calc', 'close'].includes(last)) goTab(last);
});
