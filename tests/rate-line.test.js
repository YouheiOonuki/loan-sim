// 当初の金利と毎月の返済額の線（Q-558）: 線の点 ＝ simulate の payments[0].payment、印の位置 ＝ 欄の値、範囲は欄の属性から
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../calc.js');
const RL = require('../rate-line.js');

const MAN = 10000;
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
// 欄 #rate0 の属性（数を写さない）
const tag = /<input[^>]*id="rate0"[^>]*>/.exec(html)[0];
const attr = (n) => new RegExp(n + '="([^"]*)"').exec(tag)[1];
const MIN = attr('min'), MAX = attr('max'), FIELD_STEP = attr('step');

// main.js の toInput と同じ形（rates の 1 行目が当初の金利）
function input(o) {
  return Object.assign({
    principal: 3000 * MAN, months: 420, method: 'annuity', rates: [{ from: 1, rate: 1.0 }],
    rule5: true, rule125: true, prepayments: [], prepayFee: 0,
  }, o);
}
const near = (a, b) => Math.abs(a - b) < 1e-6;

test('印の所の線の高さ ＝ 結果の毎月の返済額（借入額 3 × 期間 2 × 繰上返済の有無 2 の 12 通り）', () => {
  let n = 0;
  for (const loan of [1500, 3000, 6000]) {
    for (const years of [25, 35]) {
      for (const pre of [[], [{ month: 120, amount: 300 * MAN, type: 'shorten' }]]) {
        for (const rate of [0.5, 1.23]) {
          const inp = input({ principal: loan * MAN, months: years * 12, prepayments: pre, rates: [{ from: 1, rate }] });
          const res = C.simulate(inp);
          assert.deepEqual(res.errors, []);
          const f = RL.frame(C, inp, rate, MIN, MAX);
          const pt = f.line.find((p) => p.rate === rate);
          assert.ok(pt, '今の金利の点が線に在る');
          assert.equal(pt.pay, res.payments[0].payment, loan + ' 万円・' + years + ' 年・繰上 ' + pre.length);
          assert.equal(RL.payAt(C, inp, rate), res.payments[0].payment);
        }
        n++;
      }
    }
  }
  assert.equal(n, 12);
});

test('線の点はほかの欄のまま当初の金利だけを変えた simulate（金利の行・元金均等も）', () => {
  const inp = input({ method: 'principal', rates: [{ from: 1, rate: 0.8 }, { from: 61, rate: 2.0 }] });
  const f = RL.frame(C, inp, 0.8, MIN, MAX);
  for (const p of f.line) {
    const want = C.simulate(input({ method: 'principal', rates: [{ from: 1, rate: p.rate }, { from: 61, rate: 2.0 }] })).payments[0].payment;
    assert.equal(p.pay, want, p.rate + '%');
  }
  // 後の行は変えない（呼んだ側の入力も書き換えない）
  assert.deepEqual(inp.rates, [{ from: 1, rate: 0.8 }, { from: 61, rate: 2.0 }]);
});

test('印の位置 ＝ 欄の値（10 通り）: 横の位置から金利へ戻すと同じ値', () => {
  const rates = [0, 0.05, 0.5, 0.95, 1, 1.25, 1.5, 2, 2.35, 3];
  const f = RL.frame(C, input(), 1.5, MIN, MAX, 3);
  for (const r of rates) {
    const t = (f.x(r) - f.L) / (f.W - f.L - f.R);
    assert.equal(RL.rateAtRatio(t, f), r, r + '%');
  }
});

test('横の端: 0%（欄の min）から、今の金利の 2 倍と 3% の大きいほうまで。欄の max を超えない', () => {
  assert.equal(RL.frame(C, input(), 1, MIN, MAX).x0, Number(MIN));
  assert.equal(RL.autoEnd(1, MAX), 3);
  assert.equal(RL.autoEnd(2.4, MAX), 4.8);
  assert.equal(RL.autoEnd(15, MAX), Number(MAX));
  const f = RL.frame(C, input({ rates: [{ from: 1, rate: 15 }] }), 15, MIN, MAX);
  assert.equal(f.xMax, Number(MAX));
  assert.equal(f.line[f.line.length - 1].rate, Number(MAX));
});

test('きざみ: 0.05 は欄の step で割り切れ、0.5 は 0.05 の倍。キーは ← → で 0.05、Shift で 0.5', () => {
  const k = RL.STEP / Number(FIELD_STEP);
  assert.ok(Math.abs(k - Math.round(k)) < 1e-9, '0.05 ÷ 欄の step');
  const b = RL.BIG / RL.STEP;
  assert.ok(Math.abs(b - Math.round(b)) < 1e-9);
  assert.equal(RL.keyStep('ArrowRight', false), RL.STEP);
  assert.equal(RL.keyStep('ArrowLeft', false), -RL.STEP);
  assert.equal(RL.keyStep('ArrowRight', true), RL.BIG);
  assert.equal(RL.keyStep('ArrowUp', false), 0);
  // 範囲は欄の属性で止める
  assert.equal(RL.clampRate(-0.05, MIN, MAX), Number(MIN));
  assert.equal(RL.clampRate(Number(MAX) + 0.5, MIN, MAX), Number(MAX));
  assert.equal(RL.reach(C, input({ rates: [{ from: 1, rate: 0.02 }] }), 0.02, -0.03, MIN, MAX), Number(MIN));
});

test('印を保っている間（→ を 5 回）は目盛りが変わらない。端に着いた時だけ広げる', () => {
  let rate = 1, held = RL.autoEnd(rate, MAX);
  const f0 = RL.frame(C, input(), rate, MIN, MAX, held);
  for (let i = 0; i < 5; i++) {
    rate = RL.reach(C, input(), rate, rate + RL.keyStep('ArrowRight', false), MIN, MAX);
    held = RL.growEnd(held, rate, MAX);
    const f = RL.frame(C, input({ rates: [{ from: 1, rate }] }), rate, MIN, MAX, held);
    assert.deepEqual([f.x0, f.xMax, f.xStep, f.yMax, f.yStep], [f0.x0, f0.xMax, f0.xStep, f0.yMax, f0.yStep]);
  }
  assert.equal(rate, 1.25);
  assert.equal(RL.growEnd(3, 2.95, MAX), 3);
  assert.equal(RL.growEnd(3, 3.05, MAX), 6.1);
});

test('計算がエラーになる金利の手前で止まる（またいで先へ飛ばない）', () => {
  // 120 か月目の繰上返済の額を、金利 1% と 0.5% のときの残高の間にする。金利を下げると残高が減り、額が残高を超える
  const bal = (rate) => C.simulate(input({ rates: [{ from: 1, rate }] })).rows[119].balance;
  const inp = input({ prepayments: [{ month: 120, amount: Math.round((bal(1) + bal(0.5)) / 2), type: 'shorten' }] });
  assert.deepEqual(C.simulate(inp).errors, []);
  const stop = RL.reach(C, inp, 1, Number(MIN), MIN, MAX);
  assert.ok(stop < 1 && stop > Number(MIN), '途中で止まる: ' + stop);
  assert.ok(RL.allowed(C, inp, stop, MIN, MAX));
  assert.equal(RL.allowed(C, inp, Math.round((stop - RL.STEP) * 100) / 100, MIN, MAX), false);
  // 止まった所から先へは動かない
  assert.equal(RL.reach(C, inp, stop, stop - RL.STEP, MIN, MAX), stop);
  // エラーになる金利の点は線を切る（null）
  const f = RL.frame(C, inp, 1, MIN, MAX);
  assert.ok(f.line.some((p) => p.pay === null));
  assert.ok(f.line.filter((p) => p.rate >= stop).every((p) => p.pay !== null));
});

test('main.js: 欄の属性で範囲を取り、reach を通してから欄・状態を書き換え、同じ update() で出し直す。空なら図を出さない', () => {
  const body = main.slice(main.indexOf('function moveRate('), main.indexOf("rateBtn.addEventListener('keydown'"));
  const r = body.indexOf('RL.reach(Calc, toInput(state, true), cur, v, ri.min, ri.max)');
  assert.ok(r > 0 && r < body.indexOf('state.rate0 = k'), 'reach が書き換えより前');
  assert.ok(body.indexOf('ri.value = String(k)') > 0 && body.indexOf('update()') > body.indexOf('ri.value'));
  assert.ok(!/rates\.forEach|rates\.map/.test(body), '動かすのは当初の金利だけ');
  // 返済額の式を main.js・rate-line.js に写さない
  const rl = fs.readFileSync(path.join(__dirname, '..', 'rate-line.js'), 'utf8');
  for (const s of [main, rl]) assert.ok(!/annuityPayment|Math\.pow\(\s*1\s*\+/.test(s));
  assert.ok(/String\(state\.rate0\)\.trim\(\) === ''\) \{ hideRateLine\(\)/.test(main), '空なら図を隠す');
  assert.ok(!/['"]20['"]|max\s*=\s*20/.test(body), '範囲の数を写さない');
});

test('図は画面だけ（紙に出さない）・字は図の名前だけ', () => {
  const fig = /<div id="rate-fig"[^>]*>[\s\S]*?<\/div>\s*<\/div>/.exec(html)[0];
  assert.ok(/class="[^"]*no-print/.test(fig));
  assert.deepEqual(fig.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').trim().split(/\s+/).filter(Boolean), ['金利と毎月の返済額']);
  assert.ok(!/得|損|おすすめ/.test(fig));
});
