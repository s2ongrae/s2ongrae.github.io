/* v3_upload.js — 업로드 파일(CSV·XLSX)을 브라우저에서 읽는 최소 파서
 * ─────────────────────────────────────────────────────────────
 * 판매자센터 데이터분석(비즈어드바이저) 파일은 .xlsx 또는 .csv 로 내려온다. 서버로 보내지 않고
 * 이 기기에서만 읽는다(원칙: 수집은 사람이 누르는 1회 다운로드).
 *
 * 브라우저: DecompressionStream('deflate-raw') + DOMParser
 * 노드:     zlib.inflateRawSync (테스트가 같은 코드를 돌린다)
 *
 * 지켜야 할 것: 열 이름이 다르면 지어내지 않고 ERR_SCHEMA_MISMATCH 를 돌려준다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.V3Upload = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ALIASES = {
    date: ['날짜', '일자', '일', '조회일', '기간', '기준일', 'date', 'day', '일시'],
    uv: ['순방문자', '순방문자수', '방문자', '방문자수', '방문수', 'UV', '순방문'],
    pv: ['페이지뷰', '페이지뷰수', '조회수', 'PV'],
    orders: ['결제건수', '결제수', '구매건수', '구매수', '주문건수', '주문수', '결제완료', '결제완료건수'],
    cvr: ['전환율', '구매전환율', 'CVR', '결제전환율'],
    dwell: ['평균체류시간', '체류시간', '체류 시간'],
    bounce: ['이탈률', '이탈율'],
    channel: ['유입경로', '유입경로명', '유입채널', '채널', '마케팅채널'],
    keyword: ['검색어', '검색키워드', '키워드', '인기검색어'],
    views: ['상품조회', '상품조회수', '상품 조회'],
    cart: ['장바구니', '장바구니담기', '장바구니수'],
    paid: ['결제완료수', '구매완료'],
    sales: ['매출', '결제금액', '판매금액', '매출액'],
  };
  var REQUIRED = ['date', 'uv', 'orders'];

  function norm(v) { return String(v == null ? '' : v).replace(/[()\[\]]/g, ' ').replace(/\s+/g, '').trim(); }

  function mapHeader(row) {
    var map = {};
    var used = {};
    var fields = Object.keys(ALIASES);
    var cells = (row || []).map(norm);
    [true, false].forEach(function (exactOnly) {
      cells.forEach(function (h, i) {
        if (!h || used[i]) return;
        fields.forEach(function (f) {
          if (map[f] != null || used[i]) return;
          var hit = ALIASES[f].some(function (a) {
            var n = norm(a);
            return exactOnly ? h === n : h.indexOf(n) >= 0;
          });
          if (hit) { map[f] = i; used[i] = true; }
        });
      });
    });
    return map;
  }

  function parseNumber(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim().replace(/\s/g, '');
    if (!s) return null;
    var m = /^(\d+)분(?:(\d+)초)?$/.exec(s);
    if (m) return Number(m[1]) * 60 + Number(m[2] || 0);
    s = s.replace(/[₩,%원건명초회개]/g, '');
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  function normalizeDate(v, year) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      var d = new Date(Math.round((v - 25569) * 86400000));
      return d.toISOString().slice(0, 10);
    }
    var s = String(v).trim();
    var m = /^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/.exec(s);
    if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = /^(\d{1,2})[-./](\d{1,2})$/.exec(s);
    if (m) return (year || new Date().getFullYear()) + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
    return null;
  }

  function cvrOf(uv, orders) {
    var u = Number(uv);
    var o = Number(orders);
    if (!isFinite(u) || u <= 0 || !isFinite(o)) return null;
    return Math.round((o / u) * 1000) / 10;
  }

  /** CSV/TSV — 따옴표·줄바꿈·BOM */
  function parseCsv(text) {
    var s = String(text || '').replace(/^\uFEFF/, '');
    var head = s.split('\n')[0] || '';
    var delim = (head.match(/\t/g) || []).length > (head.match(/,/g) || []).length ? '\t' : ',';
    var rows = [];
    var row = [];
    var cell = '';
    var q = false;
    for (var i = 0; i < s.length; i += 1) {
      var ch = s[i];
      if (q) {
        if (ch === '"') {
          if (s[i + 1] === '"') { cell += '"'; i += 1; } else q = false;
        } else cell += ch;
        continue;
      }
      if (ch === '"') { q = true; continue; }
      if (ch === delim) { row.push(cell); cell = ''; continue; }
      if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i += 1;
        row.push(cell); cell = '';
        if (row.some(function (c) { return String(c).trim() !== ''; })) rows.push(row);
        row = [];
        continue;
      }
      cell += ch;
    }
    row.push(cell);
    if (row.some(function (c) { return String(c).trim() !== ''; })) rows.push(row);
    return rows;
  }

  function parseMatrix(matrix, opts) {
    var o = opts || {};
    var rowsIn = matrix || [];
    var warnings = [];
    var best = { idx: -1, map: {}, score: 0 };
    for (var i = 0; i < Math.min(10, rowsIn.length); i += 1) {
      var map = mapHeader(rowsIn[i]);
      var score = ['date', 'uv', 'orders', 'pv', 'cvr'].filter(function (f) { return map[f] != null; }).length;
      if (score > best.score) best = { idx: i, map: map, score: score };
    }
    var missing = REQUIRED.filter(function (f) { return best.map[f] == null; });
    if (best.idx < 0 || missing.length) {
      return { ok: false, code: 'ERR_SCHEMA_MISMATCH', headerMap: best.map, rows: [], channels: [], keywords: [], funnel: null, marketingLink: null, warnings: ['필수 열 없음: ' + missing.join(', ')], missing: missing };
    }
    if (best.idx > 0) warnings.push('헤더가 ' + (best.idx + 1) + '행에 있습니다(위 ' + best.idx + '행은 건너뜀)');

    var byDate = {};
    var chMap = {};
    var kwMap = {};
    var funnel = { views: 0, cart: 0, paid: 0, known: false };
    var year = o.year || null;

    for (var r = best.idx + 1; r < rowsIn.length; r += 1) {
      var row = rowsIn[r] || [];
      var date = normalizeDate(row[best.map.date], year);
      if (!date) continue;
      if (!year) year = Number(date.slice(0, 4));
      var uv = parseNumber(row[best.map.uv]);
      var orders = parseNumber(row[best.map.orders]);
      if (uv == null && orders == null) continue;
      var pv = best.map.pv != null ? parseNumber(row[best.map.pv]) : null;
      var dwell = best.map.dwell != null ? parseNumber(row[best.map.dwell]) : null;
      var bounce = best.map.bounce != null ? parseNumber(row[best.map.bounce]) : null;
      var ch = best.map.channel != null ? String(row[best.map.channel] || '').trim() : '';
      var kw = best.map.keyword != null ? String(row[best.map.keyword] || '').trim() : '';

      var d = byDate[date] || { date: date, uv: 0, pv: 0, orders: 0, dwellSum: 0, dwellN: 0, bounce: null, channels: {}, keywords: [], revenue: 0 };
      if (uv != null) d.uv += uv;
      if (pv != null) d.pv += pv;
      if (orders != null) d.orders += orders;
      if (dwell != null) { d.dwellSum += dwell; d.dwellN += 1; }
      if (bounce != null) d.bounce = bounce;
      if (best.map.sales != null) d.revenue += parseNumber(row[best.map.sales]) || 0;
      if (ch) {
        d.channels[ch] = (d.channels[ch] || 0) + (uv || 0);
        var c = chMap[ch] || { channel: ch, uv: 0, pv: 0, orders: 0, days: 0, marketingLink: /마케팅\s*링크/.test(ch) };
        c.uv += uv || 0; c.pv += pv || 0; c.orders += orders || 0; c.days += 1;
        c.cvr = cvrOf(c.uv, c.orders);
        chMap[ch] = c;
      }
      if (kw) {
        if (uv != null || orders != null) d.keywords.push(kw);
        var k = kwMap[kw] || { keyword: kw, uv: 0, orders: 0 };
        k.uv += uv || 0; k.orders += orders || 0; k.cvr = cvrOf(k.uv, k.orders);
        kwMap[kw] = k;
      }
      if (best.map.views != null || best.map.cart != null || best.map.paid != null) {
        funnel.known = true;
        funnel.views += parseNumber(row[best.map.views]) || 0;
        funnel.cart += parseNumber(row[best.map.cart]) || 0;
        funnel.paid += best.map.paid != null ? (parseNumber(row[best.map.paid]) || 0) : (orders || 0);
      }
      byDate[date] = d;
    }

    var rows = Object.keys(byDate).sort().map(function (k) {
      var d = byDate[k];
      return {
        date: d.date, uv: d.uv, pv: d.pv || null, orders: d.orders, cvr: cvrOf(d.uv, d.orders),
        dwellSec: d.dwellN ? Math.round(d.dwellSum / d.dwellN) : null, bouncePct: d.bounce,
        revenueKrw: d.revenue || null,
        channelBreakdown: Object.keys(d.channels).length ? d.channels : null,
        topKeywords: d.keywords.length ? d.keywords : null,
      };
    });
    if (!rows.length) warnings.push('날짜가 있는 데이터 행이 없습니다');
    var chList = Object.keys(chMap).map(function (k) { return chMap[k]; }).sort(function (a, b) { return b.uv - a.uv; });
    var kwList = Object.keys(kwMap).map(function (k) { return kwMap[k]; }).sort(function (a, b) { return b.uv - a.uv; }).slice(0, 50);
    var marketing = null;
    chList.forEach(function (c) { if (c.marketingLink && !marketing) marketing = c; });
    return {
      ok: rows.length > 0,
      code: rows.length ? undefined : 'ERR_NO_ROWS',
      headerMap: best.map, rows: rows, channels: chList, keywords: kwList,
      funnel: funnel.known ? { views: funnel.views, cart: funnel.cart, paid: funnel.paid } : null,
      marketingLink: marketing, warnings: warnings, missing: [],
    };
  }

  /* ── zip · xlsx (DataView + 주입된 inflate) ───────────────── */

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function text(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
    var s = '';
    for (var i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(s));
  }

  function zipEntries(bytes) {
    var eocd = -1;
    for (var i = bytes.length - 22; i >= 0 && i >= bytes.length - 66000; i -= 1) {
      if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('zip: EOCD 없음');
    var count = u16(bytes, eocd + 10);
    var p = u32(bytes, eocd + 16);
    var out = [];
    for (var k = 0; k < count; k += 1) {
      if (u32(bytes, p) !== 0x02014b50) throw new Error('zip: 중앙 디렉터리 손상');
      var method = u16(bytes, p + 10);
      var compSize = u32(bytes, p + 20);
      var nameLen = u16(bytes, p + 28);
      var extraLen = u16(bytes, p + 30);
      var commentLen = u16(bytes, p + 32);
      var localOff = u32(bytes, p + 42);
      var name = text(bytes.subarray(p + 46, p + 46 + nameLen));
      var dataStart = localOff + 30 + u16(bytes, localOff + 26) + u16(bytes, localOff + 28);
      out.push({ name: name, method: method, bytes: bytes.subarray(dataStart, dataStart + compSize) });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  function unescapeXml(s) {
    return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCodePoint(Number(n)); })
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, n) { return String.fromCodePoint(parseInt(n, 16)); })
      .replace(/&amp;/g, '&');
  }

  function colIndex(ref) {
    var m = /^([A-Z]+)/.exec(String(ref || '').toUpperCase());
    if (!m) return -1;
    var n = 0;
    for (var i = 0; i < m[1].length; i += 1) n = n * 26 + (m[1].charCodeAt(i) - 64);
    return n - 1;
  }

  function sharedStrings(xml) {
    var out = [];
    var si = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    var m;
    while ((m = si.exec(xml))) {
      var inner = m[1];
      var t = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
      var x;
      var s = '';
      while ((x = t.exec(inner))) s += x[1];
      out.push(unescapeXml(s));
    }
    return out;
  }

  function sheetRows(xml, shared) {
    var rows = [];
    var rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    var r;
    while ((r = rowRe.exec(xml))) {
      var cells = [];
      var cellRe = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
      var c;
      while ((c = cellRe.exec(r[1]))) {
        var attrs = c[1] !== undefined ? c[1] : c[2];
        var inner = c[3] || '';
        var refM = /\br="([A-Z]+\d+)"/.exec(attrs || '');
        var idx = refM ? colIndex(refM[1]) : cells.length;
        var typeM = /\bt="([^"]+)"/.exec(attrs || '');
        var type = typeM ? typeM[1] : 'n';
        var val = '';
        if (type === 's') {
          var v = /<v>([\s\S]*?)<\/v>/.exec(inner);
          val = v ? (shared[Number(v[1])] != null ? shared[Number(v[1])] : '') : '';
        } else if (type === 'inlineStr') {
          var t = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
          var x;
          while ((x = t.exec(inner))) val += x[1];
          val = unescapeXml(val);
        } else if (type === 'str') {
          var v2 = /<v>([\s\S]*?)<\/v>/.exec(inner);
          val = v2 ? unescapeXml(v2[1]) : '';
        } else {
          var v3 = /<v>([\s\S]*?)<\/v>/.exec(inner);
          if (v3) {
            var n = Number(v3[1]);
            val = isFinite(n) ? n : unescapeXml(v3[1]);
          }
        }
        while (cells.length < idx) cells.push('');
        cells[idx] = val;
      }
      rows.push(cells);
    }
    return rows;
  }

  /**
   * xlsx → 시트 rows. inflate(bytes) → Uint8Array (압축 해제). 없으면 무압축(zip store)만 읽는다.
   * @returns {Promise<Array<{name, rows}>>}
   */
  function readXlsx(bytes, inflate) {
    return Promise.resolve().then(function () {
      var entries = zipEntries(bytes);
      function find(name) {
        for (var i = 0; i < entries.length; i += 1) if (entries[i].name === name) return entries[i];
        return null;
      }
      var sharedEntry = find('xl/sharedStrings.xml');
      var wbEntry = find('xl/workbook.xml');
      var relEntry = find('xl/_rels/workbook.xml.rels');
      var sheetEntries = entries.filter(function (e) { return e.name.indexOf('xl/worksheets/') === 0 && /\.xml$/.test(e.name); });
      if (!sheetEntries.length) throw new Error('xlsx: 워크시트 없음');
      var dec = [sharedEntry, wbEntry, relEntry].concat(sheetEntries);
      var texts = {};
      var chain = Promise.resolve();
      dec.forEach(function (e) {
        if (!e) return;
        chain = chain.then(function () {
          if (e.method === 0) { texts[e.name] = text(e.bytes); return; }
          if (!inflate) return Promise.reject(new Error('압축 해제기를 찾지 못했습니다'));
          return Promise.resolve(inflate(e.bytes)).then(function (out) { texts[e.name] = text(out); });
        });
      });
      return chain.then(function () {
        var shared = sharedStrings(texts['xl/sharedStrings.xml'] || '');
        var wb = texts['xl/workbook.xml'] || '';
        var rels = texts['xl/_rels/workbook.xml.rels'] || '';
        var relMap = {};
        var relRe = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
        var m;
        while ((m = relRe.exec(rels))) relMap[m[1]] = m[2].replace(/^\/?xl\//, '').replace(/^\//, '');
        var sheets = [];
        var sheetRe = /<sheet\b([^>]*)\/>/g;
        while ((m = sheetRe.exec(wb))) {
          var nameM = /\bname="([^"]*)"/.exec(m[1]);
          var ridM = /\br:id="([^"]*)"/.exec(m[1]);
          var name = nameM ? unescapeXml(nameM[1]) : 'Sheet' + (sheets.length + 1);
          var target = ridM && relMap[ridM[1]] ? 'xl/' + relMap[ridM[1]] : 'xl/worksheets/sheet1.xml';
          var xml = texts[target];
          if (!xml && sheetEntries[0]) xml = texts[sheetEntries[0].name];
          sheets.push({ name: name, rows: xml ? sheetRows(xml, shared) : [] });
        }
        if (!sheets.length) {
          sheets.push({ name: 'Sheet1', rows: sheetRows(texts[sheetEntries[0].name] || '', shared) });
        }
        return sheets;
      });
    });
  }

  /**
   * 파일 1개 파싱 — CSV/TSV/XLSX. 브라우저·노드 공용.
   * @param {{name?:string, bytes?:Uint8Array, text?:string, year?:number}} file
   * @param {{inflate?:Function}} opts
   */
  function parseFile(file, opts) {
    var f = file || {};
    var o = opts || {};
    var isZip = f.bytes && f.bytes.length > 3 && f.bytes[0] === 0x50 && f.bytes[1] === 0x4b;
    if (isZip) {
      return readXlsx(f.bytes, o.inflate).then(function (sheets) {
        var best = sheets.slice().sort(function (a, b) { return b.rows.length - a.rows.length; })[0];
        return parseMatrix(best ? best.rows : [], { year: f.year });
      }).catch(function (err) {
        return { ok: false, code: 'ERR_PARSE_FAILED', headerMap: {}, rows: [], channels: [], keywords: [], funnel: null, marketingLink: null, warnings: [String((err && err.message) || err)], missing: [] };
      });
    }
    var t = f.text != null ? f.text : (f.bytes ? text(f.bytes) : '');
    if (!t) return Promise.resolve({ ok: false, code: 'ERR_EMPTY_FILE', headerMap: {}, rows: [], channels: [], keywords: [], funnel: null, marketingLink: null, warnings: ['파일 내용이 없습니다'], missing: [] });
    return Promise.resolve(parseMatrix(parseCsv(t), { year: f.year }));
  }

  /** 브라우저용 inflate — DecompressionStream('deflate-raw') */
  function browserInflate(bytes) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('이 브라우저는 압축 해제(DecompressionStream)를 지원하지 않습니다. CSV로 저장해서 올려 주세요.'));
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }

  function rollup(rows, opts) {
    var o = opts || {};
    var days = Math.max(1, Number(o.days) || 90);
    var list = (rows || []).filter(function (r) { return r && r.date; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (!list.length) return { days: days, from: null, to: null, daysWithData: 0, uv: null, orders: null, cvr: null };
    var to = list[list.length - 1].date;
    var fromMs = Date.parse(to + 'T00:00:00Z') - (days - 1) * 86400000;
    var from = new Date(fromMs).toISOString().slice(0, 10);
    var inRange = list.filter(function (r) { return r.date >= from && r.date <= to; });
    var sum = function (k) { return inRange.reduce(function (a, r) { return a + (isFinite(Number(r[k])) ? Number(r[k]) : 0); }, 0); };
    return { days: days, from: from, to: to, daysWithData: inRange.length, uv: sum('uv'), orders: sum('orders'), cvr: cvrOf(sum('uv'), sum('orders')) };
  }

  return {
    ALIASES: ALIASES, REQUIRED: REQUIRED,
    parseCsv: parseCsv, mapHeader: mapHeader, parseMatrix: parseMatrix, parseFile: parseFile,
    readXlsx: readXlsx, zipEntries: zipEntries, sheetRows: sheetRows, sharedStrings: sharedStrings,
    browserInflate: browserInflate, normalizeDate: normalizeDate, parseNumber: parseNumber, cvrOf: cvrOf, rollup: rollup,
  };
}));
