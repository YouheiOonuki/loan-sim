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

// Q-413: 図で動かした 1 歩の先で simulate がエラーなら、その 1 歩を取り消す（印・欄・保存・結果は 1 歩前のまま）
const fs = require('node:fs');
const path = require('node:path');
function inputAt(rate, pre) {
  return {
    principal: 3000 * MAN, months: 420, method: 'annuity', rates: [{ from: 1, rate }],
    rule5: false, rule125: false, prepayFee: 0,
    prepayments: pre.map((p) => ({ month: p.k, amount: p.a * MAN, type: p.t })),
  };
}
// main.js の moveMark と同じ順: 範囲で止めてから、今の月から 1 か月ずつたどって通る所まで（Q-433）
function moveTo(rate, pre, i, target) {
  const inp = inputAt(rate, pre);
  const k0 = G.clamp(target, G.markRange(C, inp, i));
  if (k0 === pre[i].k) return false;
  const k = G.reach(C, inp, i, k0);
  if (k === pre[i].k) return false;
  pre[i] = Object.assign({}, pre[i], { k });
  return true;
}
// markKey と同じ: 今の月 ± 1 か月（Shift は 12 か月）
function press(rate, pre, i, step) { return moveTo(rate, pre, i, pre[i].k + step); }
const CASES = [
  // 前の行（60 か月目 500 万円）を後ろへ: 240 か月目の行を越えた先で、自分の額が残高を超える
  { name: '前の行を後ろへ', rate: 1, pre: [{ k: 60, a: 500, t: 'shorten' }, { k: 240, a: 800, t: 'shorten' }], i: 0, dir: 1, stop: 254 },
  // 後ろの行（260 か月目 938 万円・期間短縮）を前へ: 219 か月目の行の額が、その時点の残高を超える
  { name: '後ろの行を前へ', rate: 2, pre: [{ k: 219, a: 444, t: 'reduce' }, { k: 260, a: 938, t: 'shorten' }], i: 1, dir: -1, stop: 46 },
  // 印の行そのもの（60 か月目 2,000 万円）を後ろへ: 自分の額が残高を超える
  { name: '印の行の額が残高を超える', rate: 1, pre: [{ k: 60, a: 2000, t: 'shorten' }, { k: 240, a: 100, t: 'shorten' }], i: 0, dir: 1, stop: 156 },
];

test('止まる月 ＝ エラーにならない最後の月（3 通り、キーの 1 か月ずつ）', () => {
  for (const c of CASES) {
    const pre = c.pre.map((p) => Object.assign({}, p));
    assert.deepEqual(C.simulate(inputAt(c.rate, pre)).errors, [], c.name);
    let n = 0;
    while (press(c.rate, pre, c.i, c.dir) && n < 500) n++;
    assert.equal(pre[c.i].k, c.stop, c.name);
    // 止まった月は通り、その 1 か月先はエラー（止まったのは範囲の端でなく、エラーの手前）
    assert.deepEqual(C.simulate(inputAt(c.rate, pre)).errors, [], c.name);
    const over = pre.map((p, j) => (j === c.i ? Object.assign({}, p, { k: c.stop + c.dir }) : p));
    assert.equal(C.simulate(inputAt(c.rate, over)).errors.length, 1, c.name);
    assert.ok(G.markRange(C, inputAt(c.rate, pre), c.i).max > c.stop, c.name);
    // 止まった後に押しても動かない
    assert.equal(press(c.rate, pre, c.i, c.dir), false, c.name);
    assert.equal(pre[c.i].k, c.stop, c.name);
  }
});

test('Shift の 12 か月の間にエラーの月が在れば、その手前で止まる（Q-433）', () => {
  const c = CASES[2];
  const pre = c.pre.map((p) => Object.assign({}, p, { k: p.k === 60 ? 150 : p.k }));
  assert.equal(press(c.rate, pre, 0, 12), true);    // 162 か月目へ向けて、157 か月目がエラー
  assert.equal(pre[0].k, 156);                        // その手前の 156 で止まる
  assert.equal(press(c.rate, pre, 0, 12), false);   // 止まる月から先へは動かない
  assert.equal(pre[0].k, 156);
});

test('引いて指を範囲の端まで動かしても、印は止まる月を超えない。途中の月はどれもエラーにならない（3 通り、Q-433）', () => {
  for (const c of CASES) {
    // 止まる月から、指を 1 か月ずつ範囲の端まで動かす
    const pre = c.pre.map((p, j) => Object.assign({}, p, j === c.i ? { k: c.stop } : {}));
    const range = G.markRange(C, inputAt(c.rate, pre), c.i);
    const end = c.dir > 0 ? range.max : range.min;
    let errors = 0;
    for (let x = c.stop + c.dir; c.dir > 0 ? x <= end : x >= end; x += c.dir) {
      moveTo(c.rate, pre, c.i, x);
      errors += C.simulate(inputAt(c.rate, pre)).errors.length;
    }
    assert.equal(pre[c.i].k, c.stop, c.name);
    assert.equal(errors, 0, c.name);
    // 前から一気に端へ引いても、止まる月まで
    const far = c.pre.map((p) => Object.assign({}, p));
    moveTo(c.rate, far, c.i, end);
    assert.equal(far[c.i].k, c.stop, c.name + '（一気に端へ）');
    // Shift ＋ 矢印でも止まる月を超えない
    const sh = c.pre.map((p, j) => Object.assign({}, p, j === c.i ? { k: c.stop - c.dir * 3 } : {}));
    press(c.rate, sh, c.i, c.dir * 12);
    assert.equal(sh[c.i].k, c.stop, c.name + '（Shift）');
  }
});

test('reach: 間にエラーの月が無ければ、行き先まで動く（引き返す向きも）', () => {
  const inp = inputAt(1, [{ k: 60, a: 500, t: 'shorten' }, { k: 240, a: 800, t: 'shorten' }]);
  assert.equal(G.reach(C, inp, 0, 120), 120);
  assert.equal(G.reach(C, inp, 0, 1), 1);
  assert.equal(G.reach(C, inp, 0, 60), 60);
});

test('欄に手で入れた値のエラーは今のまま（calc.js の文）', () => {
  const r = C.simulate(inputAt(1, [{ k: 157, a: 2000, t: 'shorten' }, { k: 240, a: 100, t: 'shorten' }]));
  assert.deepEqual(r.errors, ['157 か月目の繰上返済 20,000,000 円が、その時点の残高 19,993,163 円を超えています。']);
});

test('main.js: 書き換えの前に reach を通す。印を指の下に付いてこさせない', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const body = main.slice(main.indexOf('function moveMark('), main.indexOf('function rangeOf('));
  const check = body.indexOf('Geom.reach(Calc, toInput(state, true), i, k)');
  assert.ok(check > 0 && check < body.indexOf('row.y = ym.y'), 'reach が書き換えより前');
  // 通るかの判定は chart-geom.js の canMove の 1 か所（main.js に simulate の判定を書かない）
  assert.ok(!/canMove/.test(body), 'moveMark に canMove の 2 か所目がある');
  assert.ok(!/style\.left[^\n]*drag\.sc/.test(main), '引いている間に印だけを動かす行が残っている');
});
