// ===========================
// 住宅ローン 返済シミュレーター — グラフの目盛りと、繰上返済の印の位置（画面から切り離した純粋関数）
// 計算はしない。範囲は calc.js の simulate を呼んで取る（Q-406）
// ブラウザでは window.ChartGeom、Node（テスト）では module.exports で使う
// ===========================
(function (root) {
  'use strict';

  var MAN = 10000;
  var W = 640, H = 340, L = 96, R = 14, T = 16, Bm = 44;

  /** 「◯年目◯か月目」→ 何か月目（1 始まり） */
  function monthIndex(y, m) { return (y - 1) * 12 + m; }
  /** 何か月目 → 「◯年目◯か月目」 */
  function yearMonthOf(k) { return { y: Math.floor((k - 1) / 12) + 1, m: (k - 1) % 12 + 1 }; }

  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
    var n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }

  /** 借入の最初の残高（1 か月目の返済の前） */
  function startBalance(res) { var r = res.rows[0]; return r.balance + r.principal + r.prepay; }

  /** グラフの目盛り。a = 今の条件の結果、b = 繰上返済なしの結果（無ければ null） */
  function scale(a, b) {
    var maxM = Math.max(a.months, b ? b.months : 0);
    var maxB = Math.max(startBalance(a), b ? startBalance(b) : 0);
    var yStep = niceStep(maxB / MAN / 4);
    var yMax = Math.ceil(maxB / MAN / yStep) * yStep;
    return {
      W: W, H: H, L: L, R: R, T: T, Bm: Bm, maxM: maxM, yStep: yStep, yMax: yMax,
      x: function (k) { return L + (W - L - R) * k / maxM; },
      y: function (v) { return T + (H - T - Bm) * (1 - v / MAN / yMax); },
    };
  }

  /** グラフの横の位置（viewBox の単位）→ いちばん近い月 */
  function monthAtX(px, sc) { return Math.round((px - sc.L) / (sc.W - sc.L - sc.R) * sc.maxM); }

  /**
   * i 行目の繰上返済を動かせる範囲。返済の始めの月から、その行が無いときの完済の月まで。
   * input は calc.js の simulate に渡す形。その行を外した計算が通らないときは、simulate が受ける範囲（返済回数まで）
   */
  function markRange(Calc, input, i) {
    var rest = Object.assign({}, input, { prepayments: input.prepayments.filter(function (_, j) { return j !== i; }) });
    var r = Calc.simulate(rest);
    return { min: 1, max: r.errors.length ? input.months : r.months };
  }

  function clamp(k, range) { return Math.min(range.max, Math.max(range.min, k)); }

  /**
   * 印の位置。res = 今の条件の結果、prepays = 画面の行（{ y, m }）、sc = scale の戻り値。
   * 印は線の上の、その月の繰上返済の直前の残高に置く。完済のあとの月なら残高 0 の高さ。
   * stack は、同じ月の前の行の数（重ならないように縦にずらす段）
   */
  function marks(res, prepays, sc) {
    var seen = {};
    return prepays.map(function (p, i) {
      var k = monthIndex(p.y, p.m);
      var row = res.rows[k - 1];
      var v = row ? row.balance + row.prepay : 0;
      var stack = seen[k] || 0;
      seen[k] = stack + 1;
      return { i: i, month: k, x: sc.x(Math.min(k, sc.maxM)), y: sc.y(v), stack: stack };
    });
  }

  var ChartGeom = {
    monthIndex: monthIndex, yearMonthOf: yearMonthOf, niceStep: niceStep, scale: scale,
    monthAtX: monthAtX, markRange: markRange, clamp: clamp, marks: marks,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = ChartGeom;
  else root.ChartGeom = ChartGeom;
})(this);
