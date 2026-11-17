// グラフの上の繰上返済の印（Q-406）: 印の位置 ＝ 行の時期、動かせる範囲は calc.js の simulate から
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calc.js');
const G = require('../chart-geom.js');

const MAN = 10000;
function input(prepays) {
  return {
    principal: 3000 * MAN, months: 420, method: 'annuity', rates: [{ from: 1, rate: 1.0 }],
    rule5: false, rule125: false, prepayFee: 0,
    prepayments: prepays.map((p) => ({ month: G.monthIndex(p.y, p.m), amount: p.amount * MAN, type: p.type || 'shorten' })),
  };
}
function chart(prepays) {
  const inp = input(prepays);
  const a = C.simulate(inp);
  const b = C.simulate(Object.assign({}, inp, { prepayments: [] }));
  const sc = G.scale(a, prepays.length ? b : null);
  return { inp, a, b, sc, marks: G.marks(a, prepays, sc) };
}

test('印の位置 ＝ 行の時期: 横は行の月、縦はその月の繰上返済の直前の残高', () => {
  const pre = [{ y: 5, m: 12, amount: 300 }, { y: 10, m: 1, amount: 100, type: 'reduce' }];
  const { a, sc, marks } = chart(pre);
  assert.equal(marks.length, 2);
  marks.forEach((mk, i) => {
    const k = G.monthIndex(pre[i].y, pre[i].m);
    assert.equal(mk.month, k);
    assert.equal(mk.x, sc.x(k));
    assert.equal(mk.y, sc.y(a.rows[k - 1].balance + a.rows[k - 1].prepay));
    assert.equal(G.monthAtX(mk.x, sc), k);
  });
  assert.equal(marks[0].month, 60);
  assert.equal(marks[1].month, 109);
});

test('月の境: 12 か月目の次は次の年の 1 か月目、1 か月目の前は前の年の 12 か月目', () => {
  assert.deepEqual(G.yearMonthOf(G.monthIndex(5, 12) + 1), { y: 6, m: 1 });
  assert.deepEqual(G.yearMonthOf(G.monthIndex(6, 1) - 1), { y: 5, m: 12 });
  assert.deepEqual(G.yearMonthOf(G.monthIndex(5, 12) + 12), { y: 6, m: 12 });
  for (let k = 1; k <= 600; k++) {
    const ym = G.yearMonthOf(k);
    assert.equal(G.monthIndex(ym.y, ym.m), k);
    assert.ok(ym.m >= 1 && ym.m <= 12);
  }
});

test('範囲の端: 返済の始めの月から、その行が無いときの完済の月まで（simulate の結果から）', () => {
  const pre = [{ y: 5, m: 12, amount: 300 }, { y: 20, m: 1, amount: 500 }];
  const inp = input(pre);
  const r0 = G.markRange(C, inp, 0);
  const r1 = G.markRange(C, inp, 1);
  assert.equal(r0.min, 1);
  // 0 行目を外すと、1 行目（20 年目に 500 万円）だけの完済の月
  assert.equal(r0.max, C.simulate(input([pre[1]])).months);
  assert.equal(r1.max, C.simulate(input([pre[0]])).months);
  assert.ok(r1.max < 420);
  // 端で止まる
  assert.equal(G.clamp(0, r0), 1);
  assert.equal(G.clamp(r0.max + 12, r0), r0.max);
  assert.equal(G.clamp(r0.max, r0), r0.max);
  // 行が 1 つなら、その行が無いときは返済期間の最後まで
  assert.equal(G.markRange(C, input([pre[0]]), 0).max, 420);
  // 範囲の両端に置いた計算は通る（calc の検査が受ける範囲の中）
  [1, r1.max].forEach((k) => {
    const ym = G.yearMonthOf(k);
    const r = C.simulate(input([pre[0], { y: ym.y, m: ym.m, amount: 100 }]));
    assert.deepEqual(r.errors, []);
  });
});

test('行が 0 のときは印を出さない', () => {
  const { marks } = chart([]);
  assert.deepEqual(marks, []);
});

test('2 つの印が同じ月: 横の位置は同じで、段（stack）で縦にずらす', () => {
  const pre = [{ y: 5, m: 12, amount: 100 }, { y: 5, m: 12, amount: 200, type: 'reduce' }, { y: 8, m: 1, amount: 100 }];
  const { marks } = chart(pre);
  assert.equal(marks[0].month, marks[1].month);
  assert.equal(marks[0].x, marks[1].x);
  assert.equal(marks[0].y, marks[1].y);
  assert.deepEqual(marks.map((m) => m.stack), [0, 1, 0]);
});

test('完済のあとの月にある行の印は、残高 0 の高さ', () => {
  const pre = [{ y: 3, m: 1, amount: 2000 }, { y: 30, m: 1, amount: 100 }];
  const { a, sc, marks } = chart(pre);
  assert.ok(a.months < G.monthIndex(30, 1));
  assert.equal(marks[1].y, sc.y(0));
  assert.ok(marks[1].x <= sc.x(sc.maxM));
});
