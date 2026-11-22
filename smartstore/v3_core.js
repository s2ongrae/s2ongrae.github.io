/* v3_core.js — 스마트스토어 대시보드 v3 계산 코어 (브라우저·노드 공용)
 * ─────────────────────────────────────────────────────────────
 * 이 파일 하나가 v3의 모든 판정을 낸다: 데모 픽스처 시간 정렬, 발송기한 SLA, 반품률,
 * 6대 위젯, 4대 세무 게이지, KPI, 클레임 미리보기, 주문 파이프라인 집계,
 * 그리고 채널 정리(사입·번개 프로상점) 순익·감가·경보.
 * 브라우저는 <script src="v3_core.js"> 로, 노드는 agent/kpi_rollup.js 가 require 한다.
 * 그래서 화면과 테스트가 같은 숫자를 본다(두 벌 계산 금지).
 *
 * 규칙: 값을 지어내지 않는다 — 모르면 null, 0이면 0. 기준값·문구는 설계서 v3.0 §4-7~4-9.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.V3Core = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TRACK = { DOMESTIC: 'DOMESTIC', GLOBAL: 'GLOBAL' };
  var STAGE = { NEW: 'NEW', ORDER_WAIT: 'ORDER_WAIT', DISPATCH_WAIT: 'DISPATCH_WAIT', IN_TRANSIT: 'IN_TRANSIT', CONFIRMED: 'CONFIRMED' };
  var STAGE_LABEL = { NEW: '신규', ORDER_WAIT: '발주대기', DISPATCH_WAIT: '발송대기', IN_TRANSIT: '배송중', CONFIRMED: '구매확정' };

  /** 4대 게이지 기준값(원) — 설계서 §4-8 정본 */
  var GAUGE_BASE = {
    VAT_FREE: { baseKrw: 48000000, label: '부가세 납부면제', warnPct: 80, dangerPct: 95, note: '간이과세 부가세 납부면제 상한' },
    SIMPLE_TAX: { baseKrw: 104000000, label: '간이과세 유지', warnPct: 80, dangerPct: 95, note: '간이→일반과세 전환 매출 절벽' },
    NHIS: { baseKrw: 16530000, label: '건보료 추가부과', warnPct: 85, dangerPct: 100, note: '보수외소득 2,000만 초과 시작선(근로소득금액 2,779.8만 반영)' },
    INCOME_TAX: { baseKrw: 21010000, label: '종합소득세 24% 구간', warnPct: 90, dangerPct: 100, note: '24% + 지방세 2.4% = 26.4%' },
  };

  var RETURN_RATE = { warnPct: 3.5, dangerPct: 6.0 };
  var KPI_LIMITS = { cvrGoodPct: 2.0, cvrWarnPct: 1.0, aovGoodKrw: 15000, aovWarnKrw: 10000, marginGoodPct: 15, marginWarnPct: 8 };

  function num(v, d) {
    var n = Number(v);
    return isFinite(n) ? n : (d === undefined ? null : d);
  }
  function round0(n) { return Math.round(num(n, 0)); }
  /** % 소수 2자리 — 자른다(내림). 84.997% → 84.99% (설계서 경계값 표기와 같게) */
  function trunc2(n) { return Math.floor(num(n, 0) * 100) / 100; }
  function pctOf(part, whole) {
    var p = num(part);
    var w = num(whole);
    if (p == null || w == null || w <= 0) return null;
    return trunc2((p / w) * 100);
  }
  function cvrOf(uv, orders) {
    var p = pctOf(orders, uv);
    return p == null ? null : Math.round(p * 10) / 10;
  }
  function dayKey(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function isoMinusMinutes(nowMs, minutes) { return new Date(nowMs - minutes * 60000).toISOString(); }
  function dateMinusDays(nowMs, days) {
    var d = new Date(nowMs - days * 86400000);
    return dayKey(d.getTime());
  }

  /** 발송기한 SLA — 여유 24시간 초과=D-2(정상), 24시간 이내=D-1(주의), 지남=D-0(위험) */
  function dispatchSla(dueAt, nowMs) {
    var due = Date.parse(dueAt);
    var now = num(nowMs, Date.now());
    if (!isFinite(due)) return { level: 'UNKNOWN', hoursLeft: null, label: '기한 미확인', code: 'UNKNOWN' };
    var h = (due - now) / 3600000;
    var level = h > 24 ? 'GOOD' : h > 0 ? 'WARN' : 'CRIT';
    var code = h > 24 ? 'D2' : h > 0 ? 'D1' : 'D0';
    var hoursLeft = Math.round(h * 100) / 100;
    var label = h > 24 ? 'D-2 여유' : h > 0 ? 'D-1 ' + Math.floor(h) + 'h' + String(Math.floor((h % 1) * 60)).padStart(2, '0') + 'm' : 'D-0 기한 지남';
    return { level: level, hoursLeft: hoursLeft, label: label, code: code };
  }

  /** 30일 반품률 — 3.5% 이하 정상, 3.5~6.0% 주의, 6.0% 초과 위험 */
  function returnRateLevel(pct) {
    if (pct === null || pct === undefined || pct === '') return 'UNKNOWN';
    var p = num(pct);
    if (p == null) return 'UNKNOWN';
    if (p > RETURN_RATE.dangerPct) return 'CRIT';
    if (p > RETURN_RATE.warnPct) return 'WARN';
    return 'GOOD';
  }

  /** 세무·건보 게이지 4종 */
  function gauges(annualNetProfitKrw, opts) {
    var o = opts || {};
    var cur = num(annualNetProfitKrw, 0);
    return Object.keys(GAUGE_BASE).map(function (key) {
      var g = GAUGE_BASE[key];
      var pct = trunc2((cur / g.baseKrw) * 100);
      var level = pct >= g.dangerPct ? 'CRIT' : pct >= g.warnPct ? 'WARN' : 'GOOD';
      return {
        key: key, label: g.label, baseKrw: g.baseKrw, currentKrw: cur, pct: pct, level: level,
        warnPct: g.warnPct, dangerPct: g.dangerPct, note: g.note,
        remainKrw: Math.max(0, g.baseKrw - cur),
      };
    });
  }

  /** KPI 판정 — CVR·객단가·순이익률 */
  function kpiLevel(kind, value) {
    var v = num(value);
    if (v == null) return 'UNKNOWN';
    if (kind === 'cvr') return v >= KPI_LIMITS.cvrGoodPct ? 'GOOD' : v >= KPI_LIMITS.cvrWarnPct ? 'WARN' : 'CRIT';
    if (kind === 'aov') return v >= KPI_LIMITS.aovGoodKrw ? 'GOOD' : v >= KPI_LIMITS.aovWarnKrw ? 'WARN' : 'CRIT';
    if (kind === 'margin') return v >= KPI_LIMITS.marginGoodPct ? 'GOOD' : v >= KPI_LIMITS.marginWarnPct ? 'WARN' : 'CRIT';
    return 'UNKNOWN';
  }

  /** 데모 픽스처(상대 오프셋) → 지금 시각 기준 절대 시각 */
  function materializeDemo(bundle, nowMs) {
    var now = num(nowMs, Date.now());
    var b = bundle || {};
    var orders = (b.orders || []).map(function (o) {
      var paidMs = now - num(o.paidAgoMin, 0) * 60000;
      var dueMs = now + num(o.dueInMin, 0) * 60000;
      return Object.assign({}, o, {
        paidAt: new Date(paidMs).toISOString(),
        dispatchDue: new Date(dueMs).toISOString(),
        dispatchedAt: o.dispatchedAgoMin != null ? isoMinusMinutes(now, o.dispatchedAgoMin) : null,
        collectedAt: o.collectedAgoMin != null ? isoMinusMinutes(now, o.collectedAgoMin) : null,
        deliveredAt: o.deliveredAgoMin != null ? isoMinusMinutes(now, o.deliveredAgoMin) : null,
      });
    });
    var claims = (b.claims || []).map(function (c) {
      return Object.assign({}, c, {
        requestedAt: isoMinusMinutes(now, num(c.requestedAgoMin, 0)),
        slaDueAt: new Date(now - num(c.requestedAgoMin, 0) * 60000 + num(c.slaHours, 24) * 3600000).toISOString(),
      });
    });
    var settlements = (b.settlements || []).map(function (s) {
      return Object.assign({}, s, { settleDate: dateMinusDays(now, num(s.settleAgoDays, 0)) });
    });
    var traffic = (b.traffic || []).map(function (t) {
      return Object.assign({}, t, { date: dateMinusDays(now, num(t.dayAgo, 0)) });
    }).sort(function (a, c) { return a.date < c.date ? -1 : 1; });
    return { orders: orders, claims: claims, settlements: settlements, traffic: traffic, inquiries: b.inquiries || [], candidates: b.candidates || [] };
  }

  /** 주문 파이프라인 — 5단계별 건수 */
  function pipeline(orders) {
    var out = { NEW: 0, ORDER_WAIT: 0, DISPATCH_WAIT: 0, IN_TRANSIT: 0, CONFIRMED: 0, total: 0 };
    (orders || []).forEach(function (o) {
      if (out[o.stage] != null) out[o.stage] += 1;
      out.total += 1;
    });
    out.list = Object.keys(STAGE).map(function (k) { return { stage: k, label: STAGE_LABEL[k], count: out[k] }; });
    return out;
  }

  /** 발송 추적 경고 — 발송 후 24시간이 지나도 집화 기록이 없으면 가송장 */
  function fakeTracking(orders, nowMs) {
    var now = num(nowMs, Date.now());
    return (orders || []).filter(function (o) {
      if (!o.dispatchedAt || o.collectedAt) return false;
      return now - Date.parse(o.dispatchedAt) > 24 * 3600000;
    });
  }

  /** 클레임 SLA — 요청 + slaHours 남은 시간 */
  function claimSla(claim, nowMs) {
    var now = num(nowMs, Date.now());
    var due = Date.parse(claim && claim.slaDueAt);
    if (!isFinite(due)) return { level: 'UNKNOWN', hoursLeft: null };
    var h = Math.round(((due - now) / 3600000) * 10) / 10;
    return { level: h < 0 ? 'CRIT' : h <= 12 ? 'WARN' : 'GOOD', hoursLeft: h };
  }

  /**
   * 반품·교환 미리보기 — agent/return_cost.js calcClaim 과 같은 규칙(테스트가 대조한다).
   * @param {{type,fault,grade,salePrice,supplyPrice,orderProfitKrw,feeKrw,options}} p
   */
  function claimPreview(p) {
    var i = p || {};
    var o = i.options || {};
    var type = String(i.type || '');
    var fault = String(i.fault || (type === 'DEFECT' ? 'SELLER' : 'BUYER'));
    var grade = String(i.grade || 'DOMESTIC_STD');
    var sale = num(i.salePrice);
    var supply = num(i.supplyPrice, 0);
    var fee = num(i.feeKrw, Math.round(sale * 0.0495));
    var profit = num(i.orderProfitKrw);
    function out(x) {
      return {
        ok: x.ok !== false, action: x.action || 'REVIEW',
        deductKrw: Math.max(0, round0(x.deductKrw)), refundCapKrw: x.refundCapKrw == null ? null : Math.max(0, round0(x.refundCapKrw)),
        netProfitDeltaKrw: x.netProfitDeltaKrw == null ? null : round0(x.netProfitDeltaKrw),
        messageKey: x.messageKey || null, reasons: x.reasons || [], blocked: !!x.blocked,
      };
    }
    if (['CHANGE_OF_MIND', 'DEFECT', 'CUSTOMS_HOLD'].indexOf(type) < 0) return out({ ok: false, action: 'REJECT', reasons: ['알 수 없는 유형'] });
    if (!(sale > 0)) return out({ ok: false, action: 'REJECT', reasons: ['판매가 없음'] });
    if (o.alreadyOrdered && type !== 'CUSTOMS_HOLD') return out({ ok: false, action: 'BLOCKED_ALREADY_ORDERED', blocked: true, reasons: ['기발주 건 — 도매 취소완료 확인 전 승인 금지'] });

    if (type === 'CUSTOMS_HOLD') {
      var disposal = num(o.disposalFeeKrw, 0);
      var capH = sale - disposal;
      if (capH <= 0) return out({ ok: true, action: 'SCRAP', deductKrw: 0, refundCapKrw: 0, netProfitDeltaKrw: 0, messageKey: 'MSG_CUSTOMS_HOLD', reasons: ['반송·폐기 실비가 결제액 이상'] });
      return out({ ok: true, action: 'PARTIAL_REFUND', deductKrw: 0, refundCapKrw: capH, netProfitDeltaKrw: -disposal, messageKey: 'MSG_CUSTOMS_HOLD', reasons: ['관세청 반송·폐기 실비 ' + disposal + '원 공제'] });
    }
    if (type === 'CHANGE_OF_MIND') {
      if (grade === 'GLOBAL') {
        var rtMin = num(o.roundTripFeeMinKrw, 15000);
        var rtMax = num(o.roundTripFeeMaxKrw, 30000);
        var rt = Math.min(rtMax, Math.max(rtMin, num(o.roundTripFeeKrw, rtMin)));
        var capG = sale - rt;
        if (capG <= 0) return out({ ok: true, action: 'REJECT', deductKrw: rt, refundCapKrw: 0, netProfitDeltaKrw: 0, messageKey: 'MSG_RETURN_SIMPLE_DOM', reasons: ['실비가 결제액 이상 — 반품 불가'] });
        return out({ ok: true, action: 'SCRAP', deductKrw: rt, refundCapKrw: capG, netProfitDeltaKrw: 0, messageKey: 'MSG_RETURN_SIMPLE_DOM', reasons: ['해외 단순변심 실비 차감'] });
      }
      var trip = (o.large || grade === 'DOMESTIC_LARGE') ? 10000 : 6000;
      return out({ ok: true, action: 'RETRIEVE', deductKrw: trip, refundCapKrw: 0, netProfitDeltaKrw: profit == null ? null : trip - 3500 - profit, messageKey: 'MSG_RETURN_SIMPLE_DOM', reasons: ['왕복 ' + trip + '원 차감'] });
    }
    var partialCap = Math.min(2500, Math.floor(sale * 0.2));
    if (grade === 'GLOBAL') {
      var freight = num(o.internationalFreightKrw, 0);
      return out({ ok: true, action: 'SCRAP', deductKrw: 0, refundCapKrw: Math.floor(sale * 0.2), netProfitDeltaKrw: -(supply + freight + fee), messageKey: 'MSG_RETURN_DEFECT', reasons: ['해외 파손 무회수 폐기'] });
    }
    if (supply < 3500) return out({ ok: true, action: 'SCRAP', deductKrw: 0, refundCapKrw: partialCap, netProfitDeltaKrw: -(supply + fee), messageKey: 'MSG_RETURN_DEFECT', reasons: ['원가 3,500원 미만 — 무회수 폐기'] });
    return out({ ok: true, action: 'RETRIEVE', deductKrw: 0, refundCapKrw: partialCap, netProfitDeltaKrw: o.wholesalerAcknowledged === true ? -supply : -(supply + 6000), messageKey: 'MSG_RETURN_DEFECT', reasons: ['회수 후 도매 청구'] });
  }

  /**
   * 홈 6대 위젯.
   * @param {{orders, claims, inquiries, products, now, customsHolds}} d
   */
  function widgets(d) {
    var x = d || {};
    var now = num(x.now, Date.now());
    var orders = x.orders || [];
    var claims = x.claims || [];
    var products = x.products || [];
    var inquiries = x.inquiries || [];
    var open = orders.filter(function (o) { return o.stage !== STAGE.CONFIRMED; });

    var dispatch = open.filter(function (o) { return o.stage === STAGE.DISPATCH_WAIT; })
      .map(function (o) { return { id: o.productOrderId, sla: dispatchSla(o.dispatchDue, now), name: o.name }; })
      .filter(function (o) { return o.sla.level === 'CRIT' || o.sla.level === 'WARN'; });
    var orderWait = open.filter(function (o) { return o.stage === STAGE.ORDER_WAIT; });
    var slaOver = claims.filter(function (c) { return c.status === 'OPEN' && claimSla(c, now).level === 'CRIT'; });
    var unanswered = inquiries.filter(function (q) { return !q.answered; });
    var lowReviews = (x.reviews || []).filter(function (r) { return num(r.rating, 5) <= 3 && !r.replied; });
    var stock = products.filter(function (p) { return p.soldOut || (num(p.marginPct) != null && num(p.marginPct) < 0); });
    var customs = claims.filter(function (c) { return c.type === 'CUSTOMS_HOLD' && c.status === 'OPEN'; });

    function w(key, label, count, detail, href) {
      var n = num(count, 0);
      return { key: key, label: label, count: n, level: n > 0 ? 'CRIT' : 'GOOD', detail: detail, href: href || null };
    }
    return [
      w('dispatch', '발송임박 D-0·D-1', dispatch.length, dispatch.length ? dispatch.map(function (o) { return o.name + ' ' + o.sla.label; }).slice(0, 3).join(' · ') : '기한 내 발송분 없음', '#orders'),
      w('order_wait', '도매 발주대기', orderWait.length, orderWait.length ? '원가·잔액 확인 후 21:00 배치' : '발주 대기 없음', '#orders'),
      w('claim_sla', '클레임 SLA 초과', slaOver.length, slaOver.length ? '24시간 넘긴 클레임 — 오늘 처리' : '기한 내 처리 중', '#claims'),
      w('unanswered', '미답변 문의·리뷰', unanswered.length + lowReviews.length, (unanswered.length || lowReviews.length) ? '문의 ' + unanswered.length + ' · 3점↓ ' + lowReviews.length : '미답변 없음', '#claims'),
      w('stock_risk', '품절·역마진', stock.length, stock.length ? stock.slice(0, 3).map(function (p) { return p.name; }).join(' · ') : '이상 없음', '#products'),
      w('customs', '통관보류(PCCC)', customs.length, customs.length ? '고유부호 회신 기한 확인' : '보류 0건', '#claims'),
    ];
  }

  /** 데모·실데이터 공통 요약 — 홈 KPI 3열 + 정산 */
  function summarize(d) {
    var x = d || {};
    var now = num(x.now, Date.now());
    var orders = (x.orders || []).filter(function (o) { return o.stage !== 'CANCELED'; });
    var paid = orders.filter(function (o) { return ['DISPATCH_WAIT', 'IN_TRANSIT', 'CONFIRMED'].indexOf(o.stage) >= 0; });
    var revenue = paid.reduce(function (a, o) { return a + (num(o.amount, 0) || 0); }, 0);
    var cost = paid.reduce(function (a, o) { return a + (num(o.supplyCost, 0) || 0); }, 0);
    var fee = paid.reduce(function (a, o) { return a + (num(o.fee, 0) || 0); }, 0);
    var returns = (x.claims || []).reduce(function (a, c) { return a + Math.max(0, -(num(c.netProfitDeltaKrw, 0) || 0)); }, 0);
    var net = revenue - cost - fee - returns;
    var traffic = x.traffic || [];
    var uv = traffic.length ? traffic[traffic.length - 1].uv : null;
    var uvPeriod = traffic.reduce(function (a, r) { return a + (num(r.uv, 0) || 0); }, 0);
    var paidCount = paid.length;
    var cnt = paidCount;
    return {
      revenueKrw: revenue,
      costKrw: cost,
      feeKrw: fee,
      claimLossKrw: returns,
      netProfitKrw: net,
      marginPct: revenue > 0 ? trunc2((net / revenue) * 100) : null,
      uv: uv,
      uvPeriod: uvPeriod || null,
      paidCount: cnt,
      cvrPct: uvPeriod ? cvrOf(uvPeriod, cnt) : null,
      aovKrw: cnt ? Math.round(revenue / cnt) : null,
      returnRatePct: cnt ? trunc2(((x.claims || []).length / cnt) * 100) : null,
    };
  }

  /**
   * 채널 정리·번개 프로상점 — 상수 정본은 config/myohan_policy.json 의 channels 블록.
   * 기획서(downloads/묘한살림_당근70도_번개장터_연계기획_20261121.md) §3-B·5-B~5-F.
   * 당근 70도는 사업 물량을 올리지 않으므로 상태값에 LISTED_CARROT 를 두지 않는다(§5-B).
   */
  var RESALE = {
    LOCK_UNTIL: '2026-12-31',        // 사입·재판매 0건 유지(청년창업 세액감면)
    OPENING_DATE: '2027-01-02',      // 간이과세 개업 · 번개 프로상점 전환
    CAT_RATES: { DIGITAL: 0.06, FASHION: 0.08, ETC: 0.10 },
    BUYER_SHIP_FEE_RATE: 0.035,      // 구매자가 별도 결제한 배송비의 3.5%
    MIN_LIST_PRICE_KRW: 15000,       // 이 아래는 번개 정리 부적합(스토어 묶음으로)
    DROP_AFTER_DAYS: 14,
    WRITE_OFF_AFTER_DAYS: 28,
    DROP_PCT: 15,
    STOP_LOSS_PCT: 70,
    STORE_FEE_PCT: 4.95,
    STORE_SHIP_KRW: 3000,            // 스토어 무료배송의 배송비 내재
    GRADE_RANGE: { S: [75, 80], A: [60, 65], B: [45, 55] },
    ORIGIN: { RETURN: '반품 회수', TEST_LOT: '사입 테스트', BULK_SLOW: '잔여·부진재고', PERSONAL: '개인 불용품' },
    STATUS: {
      INSPECTED_GRADE: '검수·등급 완료',
      LISTED_BUNJANG_PRO: '번개 게시중',
      PRICE_DROPPED: '감가 적용',
      SOLD_PENDING: '판매·입금 대기',
      SETTLED_LEDGERED: '정산 반영',
      WRITTEN_OFF: '처분·폐기',
    },
    LIVE: ['INSPECTED_GRADE', 'LISTED_BUNJANG_PRO', 'PRICE_DROPPED', 'SOLD_PENDING'],
    SOLD: ['SOLD_PENDING', 'SETTLED_LEDGERED'],
  };

  /** 10 또는 0.1 → 0.10. 모르는 값은 '그 외' 10% */
  function catRateOf(v) {
    var n = num(v);
    if (n == null || n <= 0) return RESALE.CAT_RATES.ETC;
    return n > 1 ? n / 100 : n;
  }

  /**
   * 번개 프로상점 순이익 (§3-C)
   *   순이익 = P − P×r − B×3.5% − S_seller − C
   * @param {{price,cogs,catRate,buyerShipKrw,sellerShipKrw}} p
   */
  function bunjangNetProfit(p) {
    var i = p || {};
    var price = num(i.price);
    var cogs = num(i.cogsKrw, 0);
    if (price == null) return null;
    var r = catRateOf(i.catRate);
    var buyerShip = num(i.buyerShipKrw, 0);
    var sellerShip = num(i.sellerShipKrw, 0);
    // 수수료는 건별로 원 단위 반올림한다(기획서 §3-C 표와 1원까지 같게).
    var catFee = round0(price * r);
    var shipFeeComm = round0(buyerShip * RESALE.BUYER_SHIP_FEE_RATE);
    return price - catFee - shipFeeComm - sellerShip - cogs;
  }

  /** 손익분기 판매가 — (C + S_seller) ÷ (1 − r) */
  function bunjangBepPrice(p) {
    var i = p || {};
    var cost = num(i.cogsKrw, 0) + num(i.sellerShipKrw, 0);
    var div = 1 - catRateOf(i.catRate);
    if (!(div > 0)) return null;
    return Math.ceil(cost / div);
  }

  /** 목표마진 판매가 — (C + S_seller) ÷ (1 − r − m) */
  function bunjangTargetPrice(p) {
    var i = p || {};
    var cost = num(i.cogsKrw, 0) + num(i.sellerShipKrw, 0);
    var m = num(i.marginPct, 20) / 100;
    var div = 1 - catRateOf(i.catRate) - m;
    if (!(div > 0)) return null;
    return Math.ceil(cost / div);
  }

  /** 같은 가격을 스토어에서 팔 때의 순익 — 수수료 4.95% + 배송비 내재 3,000 */
  function storeNetProfit(p) {
    var i = p || {};
    var price = num(i.price);
    if (price == null) return null;
    var feePct = num(i.feePct, RESALE.STORE_FEE_PCT);
    var ship = num(i.shipKrw, RESALE.STORE_SHIP_KRW);
    return price - round0(price * (feePct / 100)) - ship - num(i.cogsKrw, 0);
  }

  /** 등급별 게시가 범위 (§5-F) — 정가 대비 % */
  function resaleGradeRange(p) {
    var i = p || {};
    var retail = num(i.retailPriceKrw);
    var range = RESALE.GRADE_RANGE[String(i.grade || 'A')] || RESALE.GRADE_RANGE.A;
    if (retail == null || retail <= 0) return null;
    return { minKrw: Math.round((retail * range[0]) / 100), maxKrw: Math.round((retail * range[1]) / 100) };
  }

  /** KST 날짜 문자열 → 그날 0시(ms) */
  function kstDayMs(day) {
    var t = Date.parse(String(day || '').slice(0, 10) + 'T00:00:00+09:00');
    return isFinite(t) ? t : null;
  }
  function kstToday(nowMs) {
    return new Date(num(nowMs, Date.now()) + 9 * 3600000).toISOString().slice(0, 10);
  }
  function daysBetweenKst(fromDay, nowMs) {
    var a = kstDayMs(fromDay);
    var b = kstDayMs(kstToday(nowMs));
    if (a == null || b == null) return null;
    return Math.round((b - a) / 86400000);
  }

  /**
   * 채널 잠금 판정 — 2026-12-31까지 사입·재판매 0건, 2027-01-02 개업 후 추적 시작.
   * @param {{openingDate, now}} d
   */
  function resaleGate(d) {
    var x = d || {};
    var today = kstToday(x.now);
    var lockUntil = x.lockUntil || RESALE.LOCK_UNTIL;
    var openingDate = x.openingDate || RESALE.OPENING_DATE;
    var openMs = kstDayMs(openingDate);
    var dDay = openMs == null ? null : Math.round((openMs - kstDayMs(today)) / 86400000);
    return {
      today: today,
      lockUntil: lockUntil,
      openingDate: openingDate,
      locked: today <= lockUntil,        // 잠금: 2026-12-31 포함
      preOpen: today < openingDate,       // 개업 전(추적 시작 전)
      dDay: dDay,
    };
  }

  /**
   * 원장 한 줄 → 화면·경보에 쓰는 모양 (§5-D 경보 5종)
   * @param {object} r assetId·originType·productName·grade·cogsKrw·retailPriceKrw·catRate·
   *                   shippingMode·listedAt·listPriceKrw·soldAt·soldPriceKrw·
   *                   buyerShipFeeKrw·sellerShipCostKrw·receiptType·status
   * @param {number} nowMs
   */
  function resaleRow(r, nowMs) {
    var x = r || {};
    var now = num(nowMs, Date.now());
    var status = RESALE.STATUS[x.status] ? x.status : 'INSPECTED_GRADE';
    var sold = RESALE.SOLD.indexOf(status) >= 0;
    var price = sold ? num(x.soldPriceKrw, num(x.listPriceKrw)) : num(x.listPriceKrw);
    var net = bunjangNetProfit({
      price: price, cogsKrw: x.cogsKrw, catRate: x.catRate,
      buyerShipKrw: x.buyerShipFeeKrw, sellerShipKrw: x.sellerShipCostKrw,
    });
    var margin = price ? trunc2((net / price) * 100) : null;
    var days = x.listedAt ? daysBetweenKst(x.listedAt, now) : null;
    var dropDay = x.listedAt ? kstToday(kstDayMs(x.listedAt) + RESALE.DROP_AFTER_DAYS * 86400000) : null;
    var alerts = [];
    var listed = RESALE.LIVE.indexOf(status) >= 0;
    if (status === 'LISTED_BUNJANG_PRO' || status === 'PRICE_DROPPED') {
      if (days != null && days >= RESALE.DROP_AFTER_DAYS) alerts.push({ level: 'WARN', code: 'DROP_DUE', text: '감가 적용 시점' });
    }
    if (status !== 'WRITTEN_OFF' && x.shippingMode === 'FREE_SELLER' && num(x.listPriceKrw) != null && num(x.listPriceKrw) < RESALE.MIN_LIST_PRICE_KRW) {
      alerts.push({ level: 'WARN', code: 'PRICE_TOO_LOW', text: '15,000원 미만 — 번개 정리 부적합' });
    }
    if (listed && days != null && days >= RESALE.WRITE_OFF_AFTER_DAYS && RESALE.SOLD.indexOf(status) < 0) {
      alerts.push({ level: 'CRIT', code: 'WRITE_OFF', text: '묶음처분·손절 검토' });
    }
    if (status !== 'WRITTEN_OFF' && net != null && net < 0) alerts.push({ level: 'CRIT', code: 'NEGATIVE_MARGIN', text: '역마진 — 가격 재산정' });
    if (sold && x.receiptType === 'NONE') alerts.push({ level: 'WARN', code: 'NO_RECEIPT', text: '증빙 미기재 — 주간 마감에서 처리' });
    return Object.assign({}, x, {
      status: status, statusLabel: RESALE.STATUS[status],
      originLabel: RESALE.ORIGIN[x.originType] || '기타',
      sold: sold, priceKrw: price, netProfitKrw: net, marginPct: margin, estimated: !sold,
      daysListed: days, dropDay: dropDay, alerts: alerts,
      level: alerts.some(function (a) { return a.level === 'CRIT'; }) ? 'CRIT' : alerts.length ? 'WARN' : 'GOOD',
    });
  }

  /** 원장 요약 — 게시·판매·정산·실현 순익 */
  function resaleSummary(rows, nowMs) {
    var list = (rows || []).map(function (r) { return resaleRow(r, nowMs); });
    var listed = list.filter(function (r) { return r.status === 'LISTED_BUNJANG_PRO' || r.status === 'PRICE_DROPPED'; });
    var sold = list.filter(function (r) { return RESALE.SOLD.indexOf(r.status) >= 0; });
    var settled = list.filter(function (r) { return r.status === 'SETTLED_LEDGERED'; });
    var realized = settled.reduce(function (a, r) { return a + (num(r.netProfitKrw, 0) || 0); }, 0);
    var revenue = settled.reduce(function (a, r) { return a + (num(r.priceKrw, 0) || 0); }, 0);
    return {
      rows: list,
      total: list.length,
      listed: listed.length,
      sold: sold.length,
      settled: settled.length,
      pending: sold.length - settled.length,
      realizedNetKrw: realized,
      realizedMarginPct: revenue > 0 ? trunc2((realized / revenue) * 100) : null,
      alertCount: list.filter(function (r) { return r.alerts.length > 0; }).length,
    };
  }

  /**
   * DEMO 표본 4줄 — 화면·경보를 실데이터 없이 검증한다(값은 합성, 시간은 상대 오프셋).
   * 실데이터는 개업(2027-01-02) 후 사용자가 입력하거나 GAS Resale_Ledger 가 채운다.
   */
  function resaleDemoRows(nowMs) {
    var now = num(nowMs, Date.now());
    var day = function (ago) { return kstToday(now - ago * 86400000); };
    return [
      { assetId: 'R-DEMO-001', originType: 'TEST_LOT', productName: '골판지 스크래쳐 3개입(사입 테스트)', grade: 'S',
        cogsKrw: 7500, retailPriceKrw: 19900, catRate: 0.10, shippingMode: 'FREE_SELLER',
        listedAt: day(4), qty: 3, listPriceKrw: 15000, buyerShipFeeKrw: 0, sellerShipCostKrw: 3200,
        receiptType: 'NONE', status: 'LISTED_BUNJANG_PRO', note: 'DEMO 표본' },
      { assetId: 'R-DEMO-002', originType: 'BULK_SLOW', productName: '차량 세차 드라이 타월(잔여)', grade: 'A',
        cogsKrw: 4900, retailPriceKrw: 9900, catRate: 0.06, shippingMode: 'FREE_SELLER',
        listedAt: day(16), qty: 2, listPriceKrw: 7900, buyerShipFeeKrw: 0, sellerShipCostKrw: 3200,
        receiptType: 'NONE', status: 'PRICE_DROPPED', note: 'DEMO 표본 · 15,000원 미만' },
      { assetId: 'R-DEMO-003', originType: 'RETURN', productName: '고양이 숨숨집(반품 회수·박스손상)', grade: 'B',
        cogsKrw: 9950, retailPriceKrw: 24900, catRate: 0.10, shippingMode: 'HALF',
        listedAt: day(6), qty: 1, listPriceKrw: 13900, buyerShipFeeKrw: 1800, sellerShipCostKrw: 0,
        receiptType: 'PG_AUTO', status: 'SETTLED_LEDGERED', soldAt: day(2), soldPriceKrw: 12900, note: 'DEMO 표본' },
      { assetId: 'R-DEMO-004', originType: 'TEST_LOT', productName: '휠 브러시(사입 테스트·처분 완료)', grade: 'S',
        cogsKrw: 3660, retailPriceKrw: 9900, catRate: 0.10, shippingMode: 'FREE_SELLER',
        listedAt: day(40), qty: 1, listPriceKrw: 7500, buyerShipFeeKrw: 0, sellerShipCostKrw: 3200,
        receiptType: 'NONE', status: 'WRITTEN_OFF', note: 'DEMO 표본 · 28일 미판매로 묶음처분' },
    ];
  }

  /** 정산 대사 — 12건 중 우리 계산과 실제 정산의 차이를 4원인으로 태깅 */
  var DIFF_CAUSES = ['취소·반품 미반영', '반품배송비 중복 공제', '쿠폰 판매자 분담', '지급보류·유보금'];
  function reconcile(settlements) {
    var rows = (settlements || []).map(function (s) {
      var exp = num(s.expectedKrw, 0);
      var act = num(s.actualKrw, 0);
      return {
        settleId: s.settleId, orderId: s.orderId, settleDate: s.settleDate,
        expectedKrw: exp, actualKrw: act, diffKrw: act - exp,
        diffCause: s.diffCause || (act === exp ? null : '원인 미분류'),
        matched: act === exp,
      };
    });
    var byCause = {};
    DIFF_CAUSES.forEach(function (c) { byCause[c] = 0; });
    rows.forEach(function (r) { if (r.diffCause && byCause[r.diffCause] != null) byCause[r.diffCause] += 1; });
    return { rows: rows, matched: rows.filter(function (r) { return r.matched; }).length, diffs: rows.filter(function (r) { return !r.matched; }).length, byCause: byCause };
  }

  return {
    TRACK: TRACK, STAGE: STAGE, STAGE_LABEL: STAGE_LABEL,
    GAUGE_BASE: GAUGE_BASE, RETURN_RATE: RETURN_RATE, KPI_LIMITS: KPI_LIMITS, DIFF_CAUSES: DIFF_CAUSES,
    RESALE: RESALE,
    num: num, trunc2: trunc2, pctOf: pctOf, cvrOf: cvrOf, dayKey: dayKey, kstToday: kstToday,
    dispatchSla: dispatchSla, returnRateLevel: returnRateLevel, gauges: gauges, kpiLevel: kpiLevel,
    materializeDemo: materializeDemo, pipeline: pipeline, fakeTracking: fakeTracking, claimSla: claimSla,
    claimPreview: claimPreview, widgets: widgets, summarize: summarize, reconcile: reconcile,
    catRateOf: catRateOf, bunjangNetProfit: bunjangNetProfit, bunjangBepPrice: bunjangBepPrice,
    bunjangTargetPrice: bunjangTargetPrice, storeNetProfit: storeNetProfit, resaleGradeRange: resaleGradeRange,
    resaleGate: resaleGate, resaleRow: resaleRow, resaleSummary: resaleSummary, resaleDemoRows: resaleDemoRows,
  };
}));
