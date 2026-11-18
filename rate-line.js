// ===========================
// 住宅ローン 返済シミュレーター — 当初の金利と毎月の返済額の線（Q-558）と、金利の印の位置・動かせる範囲（画面から切り離した純粋関数）
// 線の点は calc.js の simulate を、今の入力のまま当初の金利（rates の 1 行目）だけを変えて呼んだ payments[0].payment（結果の「毎月の返済額」と同じ欄）。
// 返済額の式はここに書かない。範囲の端は欄（#rate0）の min・max の属性を受け取る（数を写さない）
// ブラウザでは window.RateLine、Node（テスト）では module.exports で使う
// ===========================
(function (root) {
  'use strict';

  var STEP = 0.05, BIG = 0.5;   // ← → で 0.05%、Shift と ← → で 0.5%。引いたときも 0.05% きざみ
  var LINE = 0.1;               // 線の点は 0.1% ずつ
  var MIN_END = 3;              // 横の端は、今の金利の 2 倍と 3% の大きいほう（欄の max を超えない）
  var W = 640, H = 300, L = 96, R = 14, T = 16, Bm = 44;

  function r2(v) { return Math.round(v * 100) / 100; }
  function bound(v) { return v === '' || v === null || v === undefined ? null : Number(v); }

  /** 今の入力のまま、当初の金利だけを rate にした simulate の結果（後の行はそのまま） */
  function run(Calc, input, rate) {
    var rates = input.rates.map(function (x, i) { return i === 0 ? Object.assign({}, x, { rate: rate }) : x; });
    return Calc.simulate(Object.assign({}, input, { rates: rates }));
  }
  /** 当初の金利が rate のときの毎月の返済額（結果に出す数と同じ欄）。計算がエラーなら null */
  function payAt(Calc, input, rate) {
    var r = run(Calc, input, rate);
    return r.errors.length ? null : r.payments[0].payment;
  }

  /** 動かしてよい金利か。min・max は欄の属性（空なら端なし）。計算がエラーになる金利へは動かさない（Q-413） */
  function allowed(Calc, input, rate, min, max) {
    var lo = bound(min), hi = bound(max);
    if (lo !== null && rate < lo - 1e-9) return false;
    if (hi !== null && rate > hi + 1e-9) return false;
    return payAt(Calc, input, rate) !== null;
  }

  /** 横の端（何も保っていないとき）。今の金利の 2 倍と 3% の大きいほうで、欄の max を超えない */
  function autoEnd(rate, max) {
    var e = Math.max(rate * 2, MIN_END), hi = bound(max);
    return r2(hi !== null ? Math.min(e, hi) : e);
  }
  /** 引いている間・フォーカスがある間に保つ横の端（Q-489）。金利が端を超えた時（印が端に着いた時）だけ広げる */
  function growEnd(xMax, rate, max) {
    if (!(xMax > 0)) return xMax;
    return rate > xMax + 1e-9 ? autoEnd(rate, max) : xMax;
  }

  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  /**
   * 図の枠と線。rate = 今の当初の金利、min・max = 欄の属性、xMax を渡すとその端のまま（引いている間と、印にフォーカスがある間）。
   * 線の点は 0.1% ずつと横の端と今の金利。エラーになる金利の点は pay が null（線を切る）
   */
  function frame(Calc, input, rate, min, max, xMax) {
    var x0 = bound(min) !== null ? bound(min) : 0;
    if (!xMax) xMax = autoEnd(rate, max);
    var pts = [];
    for (var i = 0; ; i++) { var v = r2(x0 + LINE * i); if (v >= xMax - 1e-9) break; pts.push(v); }
    pts.push(xMax);
    if (rate >= x0 && rate <= xMax && pts.indexOf(r2(rate)) < 0) pts.push(r2(rate));
    pts.sort(function (a, b) { return a - b; });
    var line = pts.map(function (v) { return { rate: v, pay: payAt(Calc, input, v) }; });
    var top = 1;
    line.forEach(function (p) { if (p.pay !== null && p.pay > top) top = p.pay; });
    var yStep = niceStep(top / 4), yMax = Math.ceil(top / yStep) * yStep;
    var xStep = niceStep((xMax - x0) / 5);
    return {
      W: W, H: H, L: L, R: R, T: T, Bm: Bm, x0: x0, xMax: xMax, xStep: xStep, yMax: yMax, yStep: yStep, line: line,
      x: function (v) { return L + (W - L - R) * (v - x0) / (xMax - x0); },
      y: function (v) { return T + (H - T - Bm) * (1 - v / yMax); },
    };
  }

  /** 横の位置の割合（0〜1）→ 金利（0.05% きざみ） */
  function rateAtRatio(t, f) {
    var v = f.x0 + (f.xMax - f.x0) * Math.max(0, Math.min(1, t));
    return r2(f.x0 + Math.round((v - f.x0) / STEP) * STEP);
  }

  /** キーの 1 歩。← → で 0.05%、Shift と ← → で 0.5%。ほかのキーは 0 */
  function keyStep(key, shift) {
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return 0;
    return (shift ? BIG : STEP) * (key === 'ArrowRight' ? 1 : -1);
  }

  /** 欄の min・max で止めた金利 */
  function clampRate(v, min, max) {
    var lo = bound(min), hi = bound(max);
    if (lo !== null) v = Math.max(lo, v);
    if (hi !== null) v = Math.min(hi, v);
    return r2(v);
  }

  /**
   * 今の金利 from から to へ向けて 0.05% ずつたどり、動かしてよい金利が続く最後の金利（Q-413・Q-433 と同じ）。
   * 動かせない金利が間に 1 つでも在れば、その手前で止まる（またいで先へは飛ばない）
   */
  function reach(Calc, input, from, to, min, max) {
    var at = r2(from);
    to = clampRate(to, min, max);
    while (Math.abs(to - at) > 1e-9) {
      var next = Math.abs(to - at) <= STEP + 1e-9 ? to : r2(at + (to > at ? STEP : -STEP));
      if (!allowed(Calc, input, next, min, max)) break;
      at = next;
    }
    return at;
  }

  var RateLine = {
    STEP: STEP, BIG: BIG, LINE: LINE, payAt: payAt, allowed: allowed, autoEnd: autoEnd, growEnd: growEnd,
    frame: frame, rateAtRatio: rateAtRatio, keyStep: keyStep, clampRate: clampRate, reach: reach,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = RateLine;
  else root.RateLine = RateLine;
})(this);
