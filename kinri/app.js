// ===========================
// 金利の今と昔（K245、Q-806）— 画面: 国債金利（年限を押して替える）と物価の前年比を 1 枚の図に。年を 1 つ入れると、その年の値・いまの値・差
// 系列の計算は series.js（window.Kinri）。データは同じ repo の data/*.json だけを読む（外の口には何も送らない。D627）
// 予測・評価の語・商品の名前は出さない（D592）。年限をまたいで値をつながない。値の無い年には値と差を出さない（D645）
// 字にする関数（下の Model）は画面から切り離し、Node（テスト）では module.exports で使う
// ===========================
(function (root) {
  'use strict';

  var Kinri = root.Kinri || (typeof require === 'function' ? require('./series.js') : null);
  var MINUS = '−';

  function ymNum(ym) { return Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1; }
  /** '10年' → '10 年' */
  function tenorLabel(name) { return String(name).replace(/^(\d+)\s*年$/, '$1 年'); }
  /** '1986-07' → '1986 年 7 月' */
  function ymText(ym) { return Number(ym.slice(0, 4)) + ' 年 ' + Number(ym.slice(5, 7)) + ' 月'; }
  function signed(v, digits) {
    var t = Math.abs(v).toFixed(digits);
    if (Number(t) === 0) return (0).toFixed(digits);
    return (v < 0 ? MINUS : '+') + t;
  }
  function num(v, digits) {
    var t = Math.abs(v).toFixed(digits);
    if (Number(t) === 0) return (0).toFixed(digits);
    return (v < 0 ? MINUS : '') + t;
  }

  // 字の桁: 金利は公表の桁（小数 3 桁）、物価の前年比は小数 1 桁。差は出した値どうしの差（字の値と食い違わない）
  var DIGITS = { rate: 3, cpi: 1 };

  /** 物価の写しを、前年比の月の系列に（最初に前年比の在る月から。その後の前年比の無い月は null） */
  function cpiYoy(cpi) {
    var months = (cpi.series[0].months || []).map(function (m) { return { ym: m.ym, value: typeof m.yoy === 'number' ? m.yoy : null }; });
    var i = 0;
    while (i < months.length && months[i].value === null) i++;
    return { name: '物価の前年比', kind: 'rate', unit: '%', months: months.slice(i) };
  }
  function rateSeries(jgb, name) {
    var s = (jgb.series || []).filter(function (x) { return x.name === name; })[0];
    return s ? { name: s.name, kind: 'rate', unit: '%', months: s.months } : null;
  }
  function lastYear(list) {
    var y = null;
    list.forEach(function (s) { var m = s.months[s.months.length - 1]; if (m) y = Math.max(y || 0, Number(m.ym.slice(0, 4))); });
    return y;
  }

  /**
   * 年を 1 つ入れた時に出す物。year が年でない・最後の年より後なら null（印を付けない）。
   * rate: { label, then, thenYm, now, nowYm, diff } か、その年に値が無ければ { label, from }（値と差は出さない）
   * cpi:  同じ形。その年に値が無ければ null（物価は出さない）
   */
  function yearView(jgb, cpi, tenor, year) {
    var rate = rateSeries(jgb, tenor), yoy = cpiYoy(cpi);
    if (!rate) return null;
    var max = lastYear([rate, yoy]);
    if (!(Number.isInteger(year) && year >= 1000 && year <= max)) return null;
    var marks = Kinri.yearMark([rate, yoy], year);
    function cell(m, digits) {
      var then = Number(m.then.toFixed(digits)), now = Number(m.now.toFixed(digits));
      return { then: num(m.then, digits), thenYm: m.thenYm, now: num(m.now, digits), nowYm: m.nowYm, diff: signed(now - then, digits) };
    }
    var r = marks[0], c = marks[1];
    var out = { year: year, rate: null, cpi: null };
    if (r.none) out.rate = { label: tenorLabel(tenor), from: r.from };
    else { out.rate = cell(r, DIGITS.rate); out.rate.label = tenorLabel(tenor); }
    if (!c.none) { out.cpi = cell(c, DIGITS.cpi); out.cpi.label = '物価の前年比'; }
    return out;
  }

  /** 値の無い年の 1 行（始まりの月は jgb.json から） */
  function fromLine(rate) { return rate.label + 'の値は ' + ymText(rate.from) + 'から'; }

  /** 縦の目盛り: min・max を含む、きざみ 1・2・5×10^n の並び */
  function ticks(min, max, want) {
    if (!(isFinite(min) && isFinite(max))) return [0];
    if (min === max) { min -= 1; max += 1; }
    var raw = (max - min) / (want || 5), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
    var out = [];
    for (var v = Math.floor(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
    if (out[out.length - 1] < max) out.push(Math.round((out[out.length - 1] + step) * 1e6) / 1e6);
    return out;
  }

  /** 写しの出典の行（credit）の「を加工して作成」より後ろ（物価なら「（前年同月比は指数から計算）」。無ければ空） */
  var MADE = 'を加工して作成';
  function creditNote(d) { var i = d.credit.lastIndexOf(MADE); return i < 0 ? '' : d.credit.slice(i + MADE.length); }

  /** 図の線の d。値の無い月（null）で線を切る（年限をまたいでも、欠けた月をまたいでもつながない。D694） */
  function linePath(points, X, Y) {
    var d = '', pen = false;
    (points || []).forEach(function (p) {
      if (p.value === null) { pen = false; return; }
      d += (pen ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.value).toFixed(1);
      pen = true;
    });
    return d;
  }

  /** 図の上で選んだ月の値の字。その月の値が欠けていれば「—」（字は足さない。D694） */
  function pointText(value, digits) { return value === null ? '—' : num(value, digits) + '%'; }

  var Model = { tenorLabel: tenorLabel, ymText: ymText, cpiYoy: cpiYoy, rateSeries: rateSeries, yearView: yearView, fromLine: fromLine, ticks: ticks, signed: signed, num: num, creditNote: creditNote, linePath: linePath, pointText: pointText };
  if (typeof module !== 'undefined' && module.exports) { module.exports = Model; return; }
  root.KinriApp = Model;

  // ===========================
  // 画面
  // ===========================
  var doc = root.document;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var $ = function (id) { return doc.getElementById(id); };
  var state = { jgb: null, cpi: null, tenor: null, year: null };

  function el(name, attrs, text) {
    var e = doc.createElementNS(SVGNS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function h(name, cls, text) {
    var e = doc.createElement(name);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function seriesNow() {
    return [rateSeries(state.jgb, state.tenor), cpiYoy(state.cpi)];
  }

  function draw() {
    var box = $('chart');
    var list = seriesNow();
    var cp = Kinri.chartPoints(list);
    var W = Math.max(280, Math.round(box.clientWidth || 600));
    var H = Math.round(Math.min(380, Math.max(240, W * 0.58)));
    var pad = { l: 40, r: 12, t: 22, b: 30 };
    var n = ymNum(cp.to) - ymNum(cp.from) + 1;
    var vmin = 0, vmax = 0;
    cp.series.forEach(function (s) { s.points.forEach(function (p) { if (p.value !== null) { vmin = Math.min(vmin, p.value); vmax = Math.max(vmax, p.value); } }); });
    var ys = ticks(vmin, vmax, 6);
    var y0 = ys[0], y1 = ys[ys.length - 1];
    var X = function (x) { return pad.l + (x + 0.5) / n * (W - pad.l - pad.r); };
    var Y = function (v) { return pad.t + (y1 - v) / (y1 - y0) * (H - pad.t - pad.b); };

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-labelledby': 'chart-title' });
    svg.appendChild(el('title', { id: 'chart-title' }, tenorLabel(state.tenor) + 'の国債の金利と物価の前年比（' + ymText(cp.from) + '〜' + ymText(cp.to) + '、%）'));
    // 年の印（帯）は線の下に
    var bandLayer = el('g', { 'class': 'k-band-layer' });
    svg.appendChild(bandLayer);
    ys.forEach(function (v) {
      svg.appendChild(el('line', { 'class': v === 0 ? 'k-zero' : 'grid', x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }));
      svg.appendChild(el('text', { 'class': 'k-axis', x: pad.l - 6, y: Y(v) + 4, 'text-anchor': 'end' }, String(v)));
    });
    svg.appendChild(el('text', { 'class': 'k-axis', x: pad.l - 6, y: 12, 'text-anchor': 'end' }, '%'));
    var fy = Number(cp.from.slice(0, 4)), ty = Number(cp.to.slice(0, 4));
    var every = W < 520 ? 10 : 5;
    for (var y = Math.ceil(fy / every) * every; y <= ty; y += every) {
      var x = X(y * 12 - ymNum(cp.from));
      svg.appendChild(el('line', { 'class': 'k-tick', x1: x, x2: x, y1: H - pad.b, y2: H - pad.b + 4 }));
      svg.appendChild(el('text', { 'class': 'k-axis', x: x, y: H - pad.b + 18, 'text-anchor': 'middle' }, String(y)));
    }
    // 線は値の在る月だけ（値の無い月で切る。年限をまたいでつながない）
    cp.series.forEach(function (s, i) {
      svg.appendChild(el('path', { 'class': 'k-line k-s' + (i + 1), d: linePath(s.points, X, Y) }));
    });
    var markLayer = el('g', { 'class': 'k-mark-layer' });
    svg.appendChild(markLayer);
    var hair = el('line', { 'class': 'k-hair', x1: 0, x2: 0, y1: pad.t, y2: H - pad.b, visibility: 'hidden' });
    svg.appendChild(hair);

    box.replaceChildren(svg, $('tip'));
    state.geom = { X: X, Y: Y, from: cp.from, n: n, pad: pad, W: W, H: H, series: cp.series, band: bandLayer, marks: markLayer, hair: hair, svg: svg };
    drawMark();
  }

  function drawMark() {
    var g = state.geom;
    if (!g) return;
    g.band.replaceChildren();
    g.marks.replaceChildren();
    var v = state.year === null ? null : yearView(state.jgb, state.cpi, state.tenor, state.year);
    if (v) {
      var a = Math.max(0, v.year * 12 - ymNum(g.from)), b = Math.min(g.n, (v.year + 1) * 12 - ymNum(g.from));
      if (b > a) g.band.appendChild(el('rect', { 'class': 'k-band', x: g.X(a - 0.5), y: g.pad.t, width: g.X(b - 0.5) - g.X(a - 0.5), height: g.H - g.pad.t - g.pad.b }));
      [v.rate, v.cpi].forEach(function (c, i) {
        if (!c || c.from) return;
        var raw = g.series[i].points.filter(function (p) { return p.ym === c.thenYm; })[0];
        if (raw) g.marks.appendChild(el('circle', { 'class': 'k-dot k-s' + (i + 1), cx: g.X(raw.x), cy: g.Y(raw.value), r: 5 }));
      });
    }
    showResult(v);
  }

  function showResult(v) {
    var out = $('result');
    out.replaceChildren();
    if (!v) { out.hidden = true; return; }
    out.hidden = false;
    if (v.rate.from) out.appendChild(h('p', 'k-from', fromLine(v.rate)));
    var cols = [];
    if (!v.rate.from) cols.push({ head: v.rate.label + 'の国債の金利', c: v.rate, unit: '%', end: '末' });
    if (v.cpi) cols.push({ head: v.cpi.label, c: v.cpi, unit: '%', end: '' });
    if (!cols.length) return;
    var wrap = h('div', 'table-wrap');
    var t = h('table', 'tbl num k-tbl');
    var thead = h('thead'), tr = h('tr');
    tr.appendChild(h('td'));
    cols.forEach(function (c) { var th = h('th', '', c.head); th.scope = 'col'; tr.appendChild(th); });
    thead.appendChild(tr);
    t.appendChild(thead);
    var tb = h('tbody');
    [['then', v.year + ' 年'], ['now', 'いま'], ['diff', '差']].forEach(function (row) {
      var r = h('tr'), th = h('th', '', row[1]);
      th.scope = 'row';
      r.appendChild(th);
      cols.forEach(function (c) {
        var td = h('td');
        if (row[0] === 'diff') { td.className = 'diff'; td.textContent = c.c.diff + ' ポイント'; }
        else {
          td.textContent = c.c[row[0]] + c.unit;
          var ym = c.c[row[0] + 'Ym'];
          td.appendChild(h('small', '', (row[0] === 'then' ? Number(ym.slice(5, 7)) + ' 月' : ymText(ym)) + c.end));
        }
        r.appendChild(td);
      });
      tb.appendChild(r);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    out.appendChild(wrap);
    window.yzUsed?.();
  }

  // 図の上を指でなぞる・マウスを載せると、その月の値（値は表と字でも読める。ここは足すだけ）
  function onPoint(e) {
    var g = state.geom;
    if (!g) return;
    var r = g.svg.getBoundingClientRect();
    var px = (e.clientX - r.left) * (g.W / r.width);
    var x = Math.round((px - g.pad.l) / (g.W - g.pad.l - g.pad.r) * g.n - 0.5);
    if (x < 0 || x >= g.n) return hideTip();
    var tip = $('tip'), ym = null, rows = [];
    g.series.forEach(function (s, i) {
      var p = s.points.filter(function (q) { return q.x === x; })[0];
      if (p) ym = p.ym;
      if (p) rows.push({ i: i, label: i === 0 ? tenorLabel(state.tenor) : '物価', text: pointText(p.value, i === 0 ? DIGITS.rate : DIGITS.cpi), value: p.value });
    });
    if (!ym || !rows.some(function (row) { return row.value !== null; })) return hideTip();
    g.hair.setAttribute('x1', g.X(x)); g.hair.setAttribute('x2', g.X(x));
    g.hair.setAttribute('visibility', 'visible');
    tip.replaceChildren(h('div', 'k-tip-ym', ymText(ym)));
    rows.forEach(function (row) {
      var d = h('div', 'k-tip-row');
      d.appendChild(h('span', 'k-key k-s' + (row.i + 1)));
      d.appendChild(h('strong', '', row.text));
      d.appendChild(doc.createTextNode(' ' + row.label));
      tip.appendChild(d);
    });
    tip.hidden = false;
    var left = (g.X(x) / g.W) * r.width;
    tip.style.left = Math.min(Math.max(left - tip.offsetWidth / 2, 0), r.width - tip.offsetWidth) + 'px';
  }
  function hideTip() {
    var g = state.geom;
    if (g) g.hair.setAttribute('visibility', 'hidden');
    var tip = $('tip');
    if (tip) tip.hidden = true;
  }

  function setTenor(name) {
    state.tenor = name;
    Array.prototype.forEach.call($('tenors').querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.tenor === name)); });
    $('lg-rate').textContent = tenorLabel(name) + 'の国債の金利';
    draw();
  }

  function onYear() {
    var t = $('year').value.trim();
    var y = /^\d{4}$/.test(t) ? Number(t) : null;
    state.year = y;
    drawMark();
  }

  function table() {
    // 図と同じ値を年ごとの表で（その年で最後に値の在る月の値。D627）
    var body = $('years-body');
    var rate = rateSeries(state.jgb, state.tenor), yoy = cpiYoy(state.cpi);
    $('years-rate').textContent = tenorLabel(state.tenor) + 'の国債の金利';
    var fy = Math.min(Number(rate.months[0].ym.slice(0, 4)), Number(yoy.months[0].ym.slice(0, 4)));
    var ly = lastYear([rate, yoy]);
    body.replaceChildren();
    for (var y = ly; y >= fy; y--) {
      var m = Kinri.yearMark([rate, yoy], y);
      if (m[0].none && m[1].none) continue;
      var tr = h('tr'), th = h('th', '', String(y));
      th.scope = 'row';
      tr.appendChild(th);
      tr.appendChild(h('td', '', m[0].none ? '' : num(m[0].then, DIGITS.rate) + '%'));
      tr.appendChild(h('td', '', m[1].none ? '' : num(m[1].then, DIGITS.cpi) + '%'));
      body.appendChild(tr);
    }
  }

  function credit() {
    var a = $('src-jgb'), b = $('src-cpi');
    a.href = state.jgb.source.page; a.textContent = state.jgb.source.name;
    b.href = state.cpi.source.page; b.textContent = state.cpi.source.name;
    $('src-cpi-table').textContent = 'の' + state.cpi.source.table;
    $('src-note').textContent = creditNote(state.cpi);
    $('fetched').textContent = state.jgb.fetched === state.cpi.fetched ? state.jgb.fetched : state.jgb.fetched + '・' + state.cpi.fetched;
    // 「いま」の月（最後の月末）を字で。2 つの写しの最後の月が違えば、それぞれを出す
    var lr = state.jgb.series[0].months, lc = state.cpi.series[0].months;
    var r = lr[lr.length - 1].ym, c = lc[lc.length - 1].ym;
    $('asof').textContent = r === c ? ymText(r) + 'までの公表値' : '国債の金利は ' + ymText(r) + '末、物価は ' + ymText(c) + 'までの公表値';
  }

  function start() {
    Promise.all([fetch('./data/jgb.json'), fetch('./data/cpi.json')]).then(function (rs) {
      return Promise.all(rs.map(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }));
    }).then(function (d) {
      state.jgb = d[0]; state.cpi = d[1];
      var row = $('tenors');
      state.jgb.series.forEach(function (s) {
        var b = h('button', 'k-tenor', tenorLabel(s.name));
        b.type = 'button';
        b.dataset.tenor = s.name;
        b.addEventListener('click', function () { setTenor(s.name); table(); });
        row.appendChild(b);
      });
      var yi = $('year');
      yi.max = String(lastYear([cpiYoy(state.cpi)].concat(state.jgb.series.map(function (s) { return rateSeries(state.jgb, s.name); }))));
      credit();
      setTenor(state.jgb.series[0].name);
      table();
      onYear();
      yi.addEventListener('input', onYear);
      var box = $('chart');
      box.addEventListener('pointermove', onPoint);
      box.addEventListener('pointerdown', onPoint);
      box.addEventListener('pointerleave', hideTip);
      var last = box.clientWidth;
      root.addEventListener('resize', function () { if (box.clientWidth !== last) { last = box.clientWidth; draw(); } });
    }).catch(function () {
      $('chart').replaceChildren(h('p', 'k-from', 'データを読めませんでした。'));
    });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
})(this);
