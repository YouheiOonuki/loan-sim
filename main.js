// ===========================
// 住宅ローン 返済シミュレーター — 画面の制御
// 計算は calc.js（純粋関数）、前提と出典は constants.js に置く
// ===========================
(function () {
  'use strict';

  var Calc = window.Calc;
  var K = window.Constants;
  var MAN = 10000;

  // --- ブラウザへの保存（README「ツールを追加するとき」12） ---
  // キーは必ず "loan-sim_" で始める。全ツールが同じオリジンで localStorage を共有しているため
  var KEY_PREFIX = 'loan-sim_';
  var store = {
    get: function (name, fallback) {
      try {
        var v = localStorage.getItem(KEY_PREFIX + name);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }   // 保存できない環境（プライベートモードなど）でも動くように
    },
    set: function (name, value) {
      try { localStorage.setItem(KEY_PREFIX + name, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
  };

  // --- 共有 URL（README「ツールを追加するとき」11） ---
  // 条件は "#" 以降に入れる（? クエリはサーバーとアクセス解析に届くので使わない）
  function toShareHash(state) {
    return '#s=' + encodeURIComponent(JSON.stringify(state));
  }
  function fromShareHash(hash) {
    var m = /^#s=(.+)$/.exec(hash || '');
    if (!m) return null;
    try { return JSON.parse(decodeURIComponent(m[1])); } catch (e) { return null; }
  }

  // --- 状態 ---
  function nextMonth() {
    var d = new Date();
    var y = d.getFullYear(), m = d.getMonth() + 2;
    if (m > 12) { m -= 12; y += 1; }
    return y + '-' + String(m).padStart(2, '0');
  }
  function defaults() {
    return {
      mode: 'purchase', price: 3300, down: 500, costs: 200, costsUnit: 'man', loan: 3000,
      years: 35, method: 'annuity', start: nextMonth(),
      rate0: 1.0, rates: [], rule5: true, rule125: true,
      prepays: [], fee: 0,
    };
  }
  // 共有リンクや古い保存データを、今の形にそろえる
  function normalize(s) {
    var d = defaults();
    if (!s || typeof s !== 'object') return d;
    Object.keys(d).forEach(function (k) { if (s[k] !== undefined && s[k] !== null) d[k] = s[k]; });
    if (!Array.isArray(d.rates)) d.rates = [];
    if (!Array.isArray(d.prepays)) d.prepays = [];
    d.rates = d.rates.slice(0, 60).map(function (r) { return { y: +r.y || 1, m: +r.m || 1, rate: +r.rate || 0 }; });
    d.prepays = d.prepays.slice(0, 60).map(function (p) {
      return { y: +p.y || 1, m: +p.m || 1, amount: +p.amount || 0, type: p.type === 'reduce' ? 'reduce' : 'shorten' };
    });
    if (!/^\d{4}-\d{2}$/.test(d.start)) d.start = nextMonth();
    return d;
  }

  var state = normalize(fromShareHash(location.hash) || store.get('draft', null));
  var fromShare = !!fromShareHash(location.hash);

  function $(id) { return document.getElementById(id); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function yen(v) { return Math.round(v).toLocaleString('ja-JP') + ' 円'; }
  function man(v) { return (Math.round(v / 1000) / 10).toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' 万円'; }
  function monthIndex(y, m) { return (y - 1) * 12 + m; }
  function startYM() {
    var p = state.start.split('-');
    return { y: +p[0], m: +p[1] };
  }
  function ymLabel(k) {
    var s = startYM();
    var ym = Calc.ymOf(s.y, s.m, k);
    return ym.year + '年' + ym.month + '月';
  }
  function termLabel(months) {
    var y = Math.floor(months / 12), m = months % 12;
    return (y ? y + ' 年' : '') + (m ? (y ? ' ' : '') + m + ' か月' : (y ? '' : '0 か月'));
  }
  function principalOf(s) {
    if (s.mode === 'direct') return num(s.loan) * MAN;
    var price = num(s.price) * MAN;
    var costs = s.costsUnit === 'pct' ? price * num(s.costs) / 100 : num(s.costs) * MAN;
    return Calc.loanFromPurchase(price, num(s.down) * MAN, costs);
  }
  function toInput(s, withPrepay) {
    return {
      principal: principalOf(s),
      months: Math.round(num(s.years) * 12),
      method: s.method,
      rates: [{ from: 1, rate: num(s.rate0) }].concat(s.rates.map(function (r) { return { from: monthIndex(r.y, r.m), rate: num(r.rate) }; })),
      rule5: s.rule5, rule125: s.rule125,
      prepayments: withPrepay ? s.prepays.map(function (p) { return { month: monthIndex(p.y, p.m), amount: num(p.amount) * MAN, type: p.type }; }) : [],
      prepayFee: num(s.fee),
    };
  }

  // --- 入力欄と状態のやりとり ---
  var simple = ['price', 'down', 'costs', 'loan', 'years', 'rate0', 'fee'];
  function fillForm() {
    simple.forEach(function (k) { $(k === 'rate0' ? 'rate0' : k).value = state[k]; });
    $('costs-unit').value = state.costsUnit;
    $('method').value = state.method;
    $('start').value = state.start;
    $('rule5').checked = !!state.rule5;
    $('rule125').checked = !!state.rule125;
    document.querySelectorAll('input[name="mode"]').forEach(function (r) { r.checked = r.value === state.mode; });
    renderRateRows();
    renderPreRows();
    syncVisibility();
  }
  function syncVisibility() {
    $('purchase-fields').hidden = state.mode !== 'purchase';
    $('direct-fields').hidden = state.mode !== 'direct';
    var dis = state.method === 'principal';
    $('rule5').disabled = dis;
    $('rule125').disabled = dis;
    $('rules').classList.toggle('is-disabled', dis);
    $('opt-costs').hidden = state.mode !== 'purchase';
  }

  simple.forEach(function (k) {
    $(k).addEventListener('input', function (e) { state[k] = e.target.value; schedule(); });
  });
  $('costs-unit').addEventListener('change', function (e) { state.costsUnit = e.target.value; schedule(); });
  $('method').addEventListener('change', function (e) { state.method = e.target.value; syncVisibility(); schedule(); });
  $('start').addEventListener('input', function (e) { if (e.target.value) { state.start = e.target.value; schedule(); } });
  $('rule5').addEventListener('change', function (e) { state.rule5 = e.target.checked; schedule(); });
  $('rule125').addEventListener('change', function (e) { state.rule125 = e.target.checked; schedule(); });
  document.querySelectorAll('input[name="mode"]').forEach(function (r) {
    r.addEventListener('change', function () {
      if (!r.checked) return;
      // 切り替えたとき、今の借入額を引き継ぐ
      if (r.value === 'direct' && state.mode === 'purchase') state.loan = Math.round(principalOf(state) / MAN * 10) / 10;
      state.mode = r.value;
      fillForm();
      schedule();
    });
  });

  // --- 行を足せる表（金利・繰上返済） ---
  function whenInputs(prefix, i, row, onChange) {
    var wrap = document.createElement('span');
    wrap.className = 'when';
    [['y', '年目', 50], ['m', 'か月目', 12]].forEach(function (f) {
      var inp = document.createElement('input');
      inp.type = 'number'; inp.min = 1; inp.max = f[2]; inp.step = 1; inp.inputMode = 'numeric';
      inp.value = row[f[0]];
      inp.className = 'short';
      inp.setAttribute('aria-label', prefix + ' ' + (i + 1) + ' 行目の' + f[1]);
      inp.addEventListener('input', function () { row[f[0]] = Math.max(1, Math.round(num(inp.value))); onChange(); });
      wrap.appendChild(inp);
      wrap.appendChild(document.createTextNode(f[1]));
    });
    return wrap;
  }
  function removeButton(label, fn) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'icon-btn'; b.textContent = '×';
    b.setAttribute('aria-label', label);
    b.addEventListener('click', fn);
    return b;
  }

  function renderRateRows() {
    var box = $('rate-rows');
    box.textContent = '';
    state.rates.forEach(function (row, i) {
      var div = document.createElement('div');
      div.className = 'row';
      div.appendChild(whenInputs('金利', i, row, schedule));
      div.appendChild(document.createTextNode('から'));
      var inp = document.createElement('input');
      inp.type = 'number'; inp.min = 0; inp.max = 20; inp.step = 0.01; inp.inputMode = 'decimal';
      inp.value = row.rate; inp.className = 'mid';
      inp.setAttribute('aria-label', '金利 ' + (i + 1) + ' 行目の年利（%）');
      inp.addEventListener('input', function () { row.rate = inp.value; schedule(); });
      div.appendChild(inp);
      div.appendChild(document.createTextNode('%'));
      var at = document.createElement('span'); at.className = 'at'; at.dataset.kind = 'rate'; at.dataset.i = i;
      div.appendChild(at);
      div.appendChild(removeButton('金利 ' + (i + 1) + ' 行目を消す', function () { state.rates.splice(i, 1); renderRateRows(); schedule(); }));
      box.appendChild(div);
    });
  }
  function renderPreRows() {
    var box = $('pre-rows');
    box.textContent = '';
    if (!state.prepays.length) {
      var p = document.createElement('p'); p.className = 'small'; p.textContent = '繰上返済はまだありません。';
      box.appendChild(p);
    }
    state.prepays.forEach(function (row, i) {
      var div = document.createElement('div');
      div.className = 'row';
      div.appendChild(whenInputs('繰上返済', i, row, schedule));
      div.appendChild(document.createTextNode('に'));
      var inp = document.createElement('input');
      inp.type = 'number'; inp.min = 0; inp.step = 10; inp.inputMode = 'decimal';
      inp.value = row.amount; inp.className = 'mid';
      inp.setAttribute('aria-label', '繰上返済 ' + (i + 1) + ' 行目の金額（万円）');
      inp.addEventListener('input', function () { row.amount = inp.value; schedule(); });
      div.appendChild(inp);
      div.appendChild(document.createTextNode('万円'));
      var sel = document.createElement('select');
      sel.setAttribute('aria-label', '繰上返済 ' + (i + 1) + ' 行目の種類');
      [['shorten', '期間短縮'], ['reduce', '返済額軽減']].forEach(function (o) {
        var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op);
      });
      sel.value = row.type;
      sel.addEventListener('change', function () { row.type = sel.value; schedule(); });
      div.appendChild(sel);
      var at = document.createElement('span'); at.className = 'at'; at.dataset.kind = 'pre'; at.dataset.i = i;
      div.appendChild(at);
      div.appendChild(removeButton('繰上返済 ' + (i + 1) + ' 行目を消す', function () { state.prepays.splice(i, 1); renderPreRows(); schedule(); }));
      box.appendChild(div);
    });
  }
  function focusLast(boxId) {
    var inputs = $(boxId).querySelectorAll('.row:last-child input');
    if (inputs.length) inputs[0].focus();
  }

  $('add-rate').addEventListener('click', function () {
    var last = state.rates[state.rates.length - 1];
    var y = last ? Math.min(50, last.y + 5) : 6;
    var rate = Math.round((num(last ? last.rate : state.rate0) + 0.5) * 100) / 100;
    state.rates.push({ y: y, m: 1, rate: rate });
    renderRateRows(); focusLast('rate-rows'); schedule();
  });
  $('add-pre').addEventListener('click', function () {
    var last = state.prepays[state.prepays.length - 1];
    state.prepays.push({ y: last ? Math.min(50, last.y + 5) : 5, m: 12, amount: 100, type: last ? last.type : 'shorten' });
    renderPreRows(); focusLast('pre-rows'); schedule();
  });
  $('presets').addEventListener('click', function (e) {
    var p = e.target.dataset && e.target.dataset.preset;
    if (!p) return;
    var base = num(state.rate0);
    var r2 = function (v) { return Math.round(v * 100) / 100; };
    if (p === 'yearly') {
      state.rates = [];
      for (var i = 1; i <= 10; i++) state.rates.push({ y: i + 1, m: 1, rate: r2(base + 0.1 * i) });
    } else if (p === 'y5') state.rates = [{ y: 6, m: 1, rate: r2(base + 1) }];
    else if (p === 'y10') state.rates = [{ y: 11, m: 1, rate: r2(base + 1) }];
    else state.rates = [];
    renderRateRows(); schedule();
  });

  // --- 再計算（入力が止まって 300ms 後） ---
  var timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(update, 300);
  }

  var last = null;   // 直近の結果（CSV 用）
  function update() {
    if (!fromShare) store.set('draft', state);
    updateSummaries();
    var P = principalOf(state);
    $('loan-derived').textContent = man(P);

    // 行の横に実際の年月を出す
    document.querySelectorAll('.at').forEach(function (el) {
      var row = (el.dataset.kind === 'rate' ? state.rates : state.prepays)[+el.dataset.i];
      if (row) el.textContent = '（' + ymLabel(monthIndex(row.y, row.m)) + (el.dataset.kind === 'rate' ? '〜）' : '）');
    });

    var withPre = Calc.simulate(toInput(state, true));
    var hasPre = state.prepays.length > 0;
    var none = hasPre ? Calc.simulate(toInput(state, false)) : withPre;
    last = withPre;

    var errs = withPre.errors.length ? withPre.errors : none.errors;
    $('errors').hidden = !errs.length;
    $('errors').innerHTML = errs.map(function (x) { return '<p>' + esc(x) + '</p>'; }).join('');
    $('summary').classList.toggle('is-stale', errs.length > 0);
    $('to-nenmatsu').hidden = errs.length > 0;
    if (errs.length) { setBar(''); return; }

    $('warnings').hidden = !withPre.warnings.length;
    $('warnings').innerHTML = withPre.warnings.map(function (w) { return '<p>' + esc(w.text) + (w.type === 'unpaid' ? ' <a href="./guide.html#unpaid">未払利息とは</a>' : '') + '</p>'; }).join('');

    var first = withPre.payments[0].payment;
    var varying = state.method === 'principal';
    $('k-monthly').textContent = (varying ? '初回 ' : '') + yen(first);
    $('k-total').textContent = man(withPre.totalPaid);
    $('k-interest').textContent = man(withPre.totalInterest);
    $('k-end').textContent = ymLabel(withPre.months) + '（' + termLabel(withPre.months) + '）';
    // 固定バーの文言は「毎月の返済額」とその数字
    setBar('毎月の返済額 ' + $('k-monthly').textContent);

    var ch = $('payment-changes');
    ch.textContent = '';
    var items = [];
    if (varying) {
      items.push('元金均等なので毎月の返済額は少しずつ減ります（最後の月 ' + yen(withPre.finalPayment) + '）。');
    } else if (withPre.payments.length > 1) {
      withPre.payments.slice(1, 13).forEach(function (x) { items.push(ymLabel(x.from) + 'から ' + yen(x.payment)); });
      if (withPre.payments.length > 13) items.push('ほか ' + (withPre.payments.length - 13) + ' 回変わります（返済表を参照）');
    }
    var lastRegular = withPre.payments[withPre.payments.length - 1].payment;
    if (!varying && Math.abs(withPre.finalPayment - lastRegular) > lastRegular * 0.5) {
      items.push('最終回（' + ymLabel(withPre.months) + '）は ' + yen(withPre.finalPayment) + '（残りをまとめて精算）');
    }
    items.forEach(function (t) { var li = document.createElement('li'); li.textContent = t; ch.appendChild(li); });

    renderEffect(none, withPre, hasPre);
    renderChart(withPre, hasPre ? none : null);
    renderYearTable(withPre);
    renderCompare();
  }

  // --- 「くわしく入れる」の summary（SCREEN.md 1.1 の 4）に今の状態を出す ---
  var setText = window.ScreenParts.setText, optText = window.ScreenParts.optText;
  function updateSummaries() {
    setText('sum-costs', num(state.costs).toLocaleString('ja-JP') + ' ' + optText($('costs-unit')));
    var s = startYM();
    setText('sum-method', optText($('method')) + '・' + s.y + '年' + s.m + '月');
    setText('sum-rate', state.rates.length ? state.rates.length + ' 回変わる' : '変わらない');
    var rules = [];
    if (state.rule5) rules.push('5 年ルール');
    if (state.rule125) rules.push('125% ルール');
    setText('sum-rules', rules.length ? rules.join('・') : 'なし');
    setText('sum-pre', state.prepays.length ? state.prepays.length + ' 回' : 'なし');
  }

  // --- 固定バー（SCREEN.md 1.1・D59）: 結果が画面の外にあるときだけ上端に出す（screen.js）。
  // 読み込み時から既定の条件で結果が出ているので、スクロールか入力をするまでは出さない
  var setBar = window.ScreenParts.fixbar({ waitForUser: true });

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function renderEffect(none, withPre, hasPre) {
    $('effect').hidden = !hasPre;
    if (!hasPre) return;
    var rows = [
      ['利息の総額', man(none.totalInterest), man(withPre.totalInterest), diffMan(withPre.totalInterest - none.totalInterest)],
      ['総返済額<small>（手数料込み）</small>', man(none.totalPaid), man(withPre.totalPaid), diffMan(withPre.totalPaid - none.totalPaid)],
      ['完済', ymLabel(none.months), ymLabel(withPre.months), withPre.months === none.months ? '同じ' : (none.months - withPre.months) + ' か月早い'],
      ['毎月の返済額<small>（最後の通常回）</small>', yen(none.payments[none.payments.length - 1].payment), yen(withPre.payments[withPre.payments.length - 1].payment), ''],
      ['繰上返済の合計', '—', man(withPre.totalPrepay), ''],
    ];
    $('effect-body').innerHTML = rows.map(function (r) {
      return '<tr><th scope="row">' + r[0] + '</th><td>' + r[1] + '</td><td>' + r[2] + '</td><td class="diff">' + r[3] + '</td></tr>';
    }).join('');
  }
  function diffMan(v) {
    if (Math.abs(v) < 500) return '±0';
    return (v < 0 ? '−' : '＋') + man(Math.abs(v));
  }

  // --- グラフ（SVG の折れ線。ライブラリは使わない） ---
  var SVGNS = 'http://www.w3.org/2000/svg';
  function renderChart(a, b) {
    var W = 640, H = 340, L = 96, R = 14, T = 16, Bm = 44;
    var maxM = Math.max(a.months, b ? b.months : 0);
    var maxB = Math.max(a.rows[0].balance + a.rows[0].principal + a.rows[0].prepay, b ? b.rows[0].balance + b.rows[0].principal : 0);
    var yStep = niceStep(maxB / MAN / 4);
    var yMax = Math.ceil(maxB / MAN / yStep) * yStep;
    var x = function (k) { return L + (W - L - R) * k / maxM; };
    var y = function (v) { return T + (H - T - Bm) * (1 - v / MAN / yMax); };

    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '残高の推移。' + ymLabel(a.months) + 'に完済' + (b ? '（繰上返済なしなら ' + ymLabel(b.months) + '）' : '') + '。');

    function el(name, attrs, text) {
      var e = document.createElementNS(SVGNS, name);
      Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      if (text !== undefined) e.textContent = text;
      svg.appendChild(e);
      return e;
    }
    for (var v = 0; v <= yMax + 1e-9; v += yStep) {
      el('line', { x1: L, x2: W - R, y1: y(v * MAN), y2: y(v * MAN), class: 'grid' });
      el('text', { x: L - 6, y: y(v * MAN) + 8, 'text-anchor': 'end', class: 'axis' }, v.toLocaleString('ja-JP') + '万');
    }
    var years = Math.ceil(maxM / 12);
    var xStep = years > 30 ? 10 : years > 12 ? 5 : years > 5 ? 2 : 1;
    for (var yr = 0; yr <= years; yr += xStep) {
      el('text', { x: x(Math.min(yr * 12, maxM)), y: H - 10, 'text-anchor': 'middle', class: 'axis' }, yr + '年');
    }
    function line(res, cls) {
      var pts = [[x(0), y(res.rows[0].balance + res.rows[0].principal + res.rows[0].prepay)]];
      res.rows.forEach(function (r) { pts.push([x(r.month), y(r.balance)]); });
      el('polyline', { points: pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '), class: cls });
    }
    if (b) line(b, 'line-b');
    line(a, 'line-a');

    var box = $('chart');
    box.textContent = '';
    box.appendChild(svg);
    $('lg-b').hidden = !b;
    $('lg-b-text').hidden = !b;
  }
  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
    var n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }

  function renderYearTable(res) {
    var s = startYM();
    var rows = Calc.yearly(res.rows, s.y, s.m);
    var n = function (v) { return Math.round(v).toLocaleString('ja-JP'); };
    $('year-body').innerHTML = rows.map(function (r) {
      return '<tr><th scope="row">' + r.year + '</th><td>' + n(r.paid) + '</td><td>' + n(r.principal) + '</td><td>' + n(r.interest) + '</td><td>' + n(r.balance) + '</td></tr>';
    }).join('');
  }

  // --- タブ ---
  var tabs = [$('tab-chart'), $('tab-table')];
  function selectTab(t) {
    tabs.forEach(function (x) {
      var on = x === t;
      x.setAttribute('aria-selected', on);
      x.tabIndex = on ? 0 : -1;
      $(x.getAttribute('aria-controls')).hidden = !on;
    });
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { selectTab(t); });
    t.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        var n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        selectTab(n); n.focus();
      }
    });
  });

  // --- CSV ---
  $('csv').addEventListener('click', function () {
    if (!last || last.errors.length) return;
    var s = startYM();
    var blob = new Blob([Calc.toCSV(last.rows, s.y, s.m)], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'loan-sim-schedule.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  // --- シナリオの保存・比較（最大 10 件） ---
  var MAX_SCN = 10;
  var scenarios = store.get('scenarios', []);
  if (!Array.isArray(scenarios)) scenarios = [];
  var compareIds = {};

  function saveScenarios() {
    if (!store.set('scenarios', scenarios)) $('scn-msg').textContent = 'このブラウザでは保存できませんでした（プライベートモードなど）。';
  }
  $('scn-save').addEventListener('click', function () {
    var name = $('scn-name').value.trim() || ('条件 ' + (scenarios.length + 1));
    if (scenarios.length >= MAX_SCN) { $('scn-msg').textContent = '保存できるのは ' + MAX_SCN + ' 件までです。いらないものを消してください。'; return; }
    var id = Date.now().toString(36);
    scenarios.push({ id: id, name: name, state: JSON.parse(JSON.stringify(state)) });
    compareIds[id] = true;
    saveScenarios();
    $('scn-name').value = '';
    $('scn-msg').textContent = '「' + name + '」を保存しました。';
    renderScenarios();
    renderCompare();
  });
  function renderScenarios() {
    var ul = $('scn-list');
    ul.textContent = '';
    scenarios.forEach(function (sc, i) {
      var li = document.createElement('li');
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.id = 'cmp-' + sc.id; cb.checked = !!compareIds[sc.id];
      cb.addEventListener('change', function () { compareIds[sc.id] = cb.checked; renderCompare(); });
      var lb = document.createElement('label'); lb.htmlFor = cb.id; lb.textContent = sc.name;
      var load = document.createElement('button'); load.type = 'button'; load.className = 'link-btn'; load.textContent = '読み込む';
      load.addEventListener('click', function () {
        state = normalize(sc.state); fromShare = false; fillForm(); update();
        $('scn-msg').textContent = '「' + sc.name + '」を読み込みました。';
      });
      var del = removeButton('「' + sc.name + '」を消す', function () {
        scenarios.splice(i, 1); delete compareIds[sc.id]; saveScenarios(); renderScenarios(); renderCompare();
      });
      li.appendChild(cb); li.appendChild(lb); li.appendChild(load); li.appendChild(del);
      ul.appendChild(li);
    });
  }
  function renderCompare() {
    var cols = [{ name: '今の条件', state: state }].concat(scenarios.filter(function (s) { return compareIds[s.id]; }));
    $('compare-wrap').hidden = cols.length < 2;
    if (cols.length < 2) return;
    var res = cols.map(function (c) { return { c: c, r: Calc.simulate(toInput(normalize(c.state), true)) }; });
    $('compare-head').innerHTML = '<tr><th scope="col"></th>' + res.map(function (x) { return '<th scope="col">' + esc(x.c.name) + '</th>'; }).join('') + '</tr>';
    var ok = function (x) { return !x.r.errors.length; };
    var lines = [
      ['借入額', function (x) { return man(principalOf(normalize(x.c.state))); }],
      ['当初の金利', function (x) { return num(normalize(x.c.state).rate0) + '%'; }],
      ['毎月の返済額（初回）', function (x) { return ok(x) ? yen(x.r.payments[0].payment) : '入力エラー'; }],
      ['総返済額', function (x) { return ok(x) ? man(x.r.totalPaid) : '—'; }],
      ['利息の総額', function (x) { return ok(x) ? man(x.r.totalInterest) : '—'; }],
      ['完済までの期間', function (x) { return ok(x) ? termLabel(x.r.months) : '—'; }],
    ];
    $('compare-body').innerHTML = lines.map(function (l) {
      return '<tr><th scope="row">' + l[0] + '</th>' + res.map(function (x) { return '<td>' + l[1](x) + '</td>'; }).join('') + '</tr>';
    }).join('');
  }

  // --- 共有リンク ---
  $('share').addEventListener('click', function () {
    var url = location.href.split('#')[0] + toShareHash(state);
    history.replaceState(null, '', url);
    var done = function () { $('share-msg').textContent = 'リンクをコピーしました。条件はリンクの「#」以降に入っていて、サーバーには送信されません。'; };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { $('share-msg').textContent = 'アドレスバーのリンクをコピーしてください。'; });
    else $('share-msg').textContent = 'アドレスバーのリンクをコピーしてください。';
  });

  // --- ファイルへの書き出し・読み込み（README「ツールを追加するとき」20。決定 D31） ---
  // 中身はこの端末の中で作り、どこにも送信しない。機種変更のときはファイルを移して読み込む
  var TOOL = 'loan-sim';
  $('backup-export').addEventListener('click', function () {
    var data = { draft: state, scenarios: scenarios };
    var blob = new Blob([JSON.stringify(Calc.buildBackup(TOOL, data), null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = Calc.backupFileName(TOOL);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    $('share-msg').textContent = 'ファイルに書き出しました。機種変更のときは、このファイルを新しい端末に移して「ファイルから読み込む」を押してください。';
  });
  $('backup-import').addEventListener('click', function () { $('backup-file').click(); });
  $('backup-file').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    if (file.size > 1024 * 1024) { $('share-msg').textContent = 'ファイルが大きすぎます。このツールで書き出したファイルを選んでください。'; return; }
    file.text().then(function (text) {
      var r = Calc.parseBackup(text, TOOL, ['draft']);
      if (!r.ok) { $('share-msg').textContent = r.error; return; }
      if (!window.confirm('ファイルの内容で、今の条件と保存した条件を置き換えます。よろしいですか？')) return;
      var list = Array.isArray(r.data.scenarios) ? r.data.scenarios : [];
      scenarios = list.filter(function (sc) { return sc && typeof sc === 'object'; }).slice(0, MAX_SCN).map(function (sc, i) {
        return { id: String(sc.id || Date.now().toString(36) + i).slice(0, 20), name: String(sc.name || ('条件 ' + (i + 1))).slice(0, 30), state: normalize(sc.state) };
      });
      compareIds = {};
      state = normalize(r.data.draft); fromShare = false;
      saveScenarios(); fillForm(); renderScenarios(); update();
      $('share-msg').textContent = 'ファイルから読み込みました（保存した条件 ' + scenarios.length + ' 件）。';
    }, function () { $('share-msg').textContent = 'ファイルを読み取れませんでした。'; });
  });

  // --- 前提の時点（確認日から一定期間たったら注意） ---
  (function () {
    var d = K.CHECKED.split('-');
    $('asof-date').textContent = d[0] + '年' + (+d[1]) + '月';
    var months = (new Date().getFullYear() - d[0]) * 12 + (new Date().getMonth() + 1 - d[1]);
    if (months >= K.STALE_MONTHS) {
      $('asof').classList.add('is-stale');
      $('asof').appendChild(document.createTextNode('。前提の確認から時間がたっています。最新の情報は金融機関にご確認ください'));
    }
  })();

  // 共有リンクから開いたときは、保存中の下書きを上書きしない（編集したら下書きとして保存し直す）
  document.addEventListener('input', function () { if (fromShare) { fromShare = false; } }, { once: true });

  fillForm();
  renderScenarios();
  update();
})();
