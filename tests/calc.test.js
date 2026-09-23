// 計算ロジックのテスト: node --test tests/*.test.js
// （.github/workflows/test.yml で push・PR のたびに自動実行される）
// 受け入れテストは企画書（yorozu-plans 01_住宅ローン.md の 6 章）の値
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calc.js');

const MAN = 10000;
function base(over) {
  return Object.assign({
    principal: 3000 * MAN, months: 35 * 12, method: 'annuity',
    rates: [{ from: 1, rate: 1.0 }], rule5: false, rule125: false, prepayments: [], prepayFee: 0,
  }, over);
}
const round = Math.round;

test('受け入れ: 3,000万円・35年・1.0%・元利均等 → 毎月 84,686 円、利息の総額 約 556.8 万円', () => {
  const r = C.simulate(base());
  assert.deepEqual(r.errors, []);
  assert.equal(round(r.payments[0].payment), 84686);
  assert.equal(r.payments.length, 1);
  assert.equal(round(r.totalInterest / 1000) / 10, 556.8);
  assert.equal(r.months, 420);
});

test('受け入れ: 2,000万円・25年・0.5%・元利均等 → 毎月 70,934 円、利息の総額 約 128.0 万円', () => {
  const r = C.simulate(base({ principal: 2000 * MAN, months: 300, rates: [{ from: 1, rate: 0.5 }] }));
  assert.equal(round(r.payments[0].payment), 70934);
  assert.equal(round(r.totalInterest / 1000) / 10, 128.0);
});

test('受け入れ: 金利 0% → 毎月の返済額は P/n、利息 0', () => {
  const r = C.simulate(base({ principal: 1200 * MAN, months: 120, rates: [{ from: 1, rate: 0 }] }));
  assert.equal(round(r.payments[0].payment), 100000);
  assert.equal(round(r.totalInterest), 0);
  assert.equal(r.months, 120);
});

test('受け入れ: 期間短縮の繰上返済 → 完済が前倒しになり、利息の総額が減る', () => {
  const none = C.simulate(base());
  const r = C.simulate(base({ prepayments: [{ month: 60, amount: 300 * MAN, type: 'shorten' }] }));
  assert.ok(r.months < none.months, `${r.months} < ${none.months}`);
  assert.ok(r.totalInterest < none.totalInterest);
  assert.equal(round(r.payments[0].payment), 84686);           // 返済額はそのまま
  assert.equal(r.payments.length, 1);
});

test('受け入れ: 返済額軽減の繰上返済 → 毎月の返済額が下がり、完済年月は変わらない', () => {
  const none = C.simulate(base());
  const r = C.simulate(base({ prepayments: [{ month: 60, amount: 300 * MAN, type: 'reduce' }] }));
  assert.equal(r.months, none.months);
  assert.equal(r.payments.length, 2);
  assert.equal(r.payments[1].from, 61);
  assert.ok(r.payments[1].payment < r.payments[0].payment);
  assert.ok(r.totalInterest < none.totalInterest);
});

test('受け入れ: 125% ルール ON で急に金利を上げると、未払利息の警告が出る', () => {
  const r = C.simulate(base({
    rates: [{ from: 1, rate: 0.5 }, { from: 13, rate: 6.0 }], rule5: true, rule125: true,
  }));
  assert.deepEqual(r.errors, []);
  const w = r.warnings.find((x) => x.type === 'unpaid');
  assert.ok(w, '未払利息の警告');
  assert.equal(w.from, 13);
  assert.ok(r.rows[r.rows.length - 1].unpaid === 0, '最終回で精算して 0');
  // 元金 + 利息 = 支払の合計
  assert.ok(Math.abs(r.totalPaid - r.totalInterest - 3000 * MAN) < 1);
});

test('受け入れ: 繰上返済額が残高を超える入力はエラー', () => {
  const r = C.simulate(base({ prepayments: [{ month: 12, amount: 5000 * MAN, type: 'shorten' }] }));
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /残高/);
});

test('5 年ルール: 金利が上がっても 5 年目までは返済額が変わらず、61 か月目に見直す', () => {
  const r = C.simulate(base({ rates: [{ from: 1, rate: 1 }, { from: 25, rate: 2 }], rule5: true }));
  assert.equal(round(r.rows[23].payment), round(r.rows[24].payment));
  assert.ok(r.rows[24].principal < r.rows[23].principal, '利息が増えたぶん元金が減る');
  assert.equal(r.payments[1].from, 61);
});

test('ルール OFF: 金利が変わった月に、残高と残りの回数で返済額を計算し直す', () => {
  const r = C.simulate(base({ rates: [{ from: 1, rate: 1 }, { from: 25, rate: 2 }] }));
  const B = r.rows[23].balance;
  assert.equal(round(r.rows[24].payment), round(C.annuityPayment(B, 0.02 / 12, 420 - 24)));
  assert.equal(r.payments[1].from, 25);
});

test('125% ルール: 見直し後の返済額は前回の 1.25 倍まで', () => {
  const r = C.simulate(base({ rates: [{ from: 1, rate: 0.5 }, { from: 2, rate: 5 }], rule5: true, rule125: true }));
  assert.ok(round(r.rows[60].payment) <= round(r.rows[0].payment * 1.25) + 1);
  assert.ok(r.warnings.some((x) => x.type === 'cap'));
});

test('元金均等: 毎月の元金は一定、返済額は少しずつ減る。ルールの指定は無視', () => {
  const r = C.simulate(base({ method: 'principal', rule5: true, rule125: true }));
  assert.equal(round(r.rows[0].principal), round(3000 * MAN / 420));
  assert.equal(round(r.rows[100].principal), round(3000 * MAN / 420));
  assert.ok(r.rows[1].payment < r.rows[0].payment);
  assert.equal(r.months, 420);
  assert.ok(Math.abs(r.totalPaid - r.totalInterest - 3000 * MAN) < 1);
});

test('元金均等の期間短縮・返済額軽減', () => {
  const s = C.simulate(base({ method: 'principal', prepayments: [{ month: 12, amount: 300 * MAN, type: 'shorten' }] }));
  assert.equal(s.months, 420 - 42);                                // 300万 ÷ 毎月の元金（約 7.14 万）= 42 回分
  const d = C.simulate(base({ method: 'principal', prepayments: [{ month: 12, amount: 300 * MAN, type: 'reduce' }] }));
  assert.equal(d.months, 420);
  assert.ok(d.rows[12].principal < d.rows[11].principal);
});

test('繰上返済で残高ちょうどを返すと、その月で完済', () => {
  const pre = C.simulate(base());
  const B = pre.rows[119].balance;
  const r = C.simulate(base({ prepayments: [{ month: 120, amount: B, type: 'shorten' }], prepayFee: 11000 }));
  assert.equal(r.months, 120);
  assert.equal(r.totalFees, 11000);
  assert.ok(Math.abs(r.totalPaid - r.totalInterest - r.totalFees - 3000 * MAN) < 1);
});

test('完済後の繰上返済は無視して警告', () => {
  const r = C.simulate(base({
    months: 120, principal: 100 * MAN,
    prepayments: [{ month: 10, amount: 100 * MAN, type: 'shorten' }, { month: 20, amount: 10 * MAN, type: 'shorten' }],
  }));
  assert.ok(r.errors.length === 1 || r.warnings.some((x) => x.type === 'ignored'));
});

test('入力の検査', () => {
  assert.ok(C.simulate(base({ principal: 0 })).errors.length);
  assert.ok(C.simulate(base({ months: 0 })).errors.length);
  assert.ok(C.simulate(base({ rates: [{ from: 1, rate: 25 }] })).errors.length);
  assert.ok(C.simulate(base({ rates: [{ from: 1, rate: 1 }, { from: 500, rate: 2 }] })).errors.length);
});

test('借入額: 物件価格 + 諸費用 − 頭金（マイナスにはしない）', () => {
  assert.equal(C.loanFromPurchase(4000 * MAN, 500 * MAN, 200 * MAN), 3700 * MAN);
  assert.equal(C.loanFromPurchase(1000, 2000, 0), 0);
});

test('年月・年ごとの集計・CSV', () => {
  assert.deepEqual(C.ymOf(2026, 11, 3), { year: 2027, month: 1 });
  const r = C.simulate(base());
  const y = C.yearly(r.rows, 2026, 11);
  assert.equal(y[0].year, 2026);
  assert.equal(y[y.length - 1].balance, 0);
  const sumPaid = y.reduce((a, x) => a + x.paid, 0);
  assert.ok(Math.abs(sumPaid - r.totalPaid) < 1);
  const csv = C.toCSV(r.rows, 2026, 11);
  assert.ok(csv.startsWith('﻿回,年月'));
  assert.equal(csv.trim().split('\r\n').length, 421);
  assert.match(csv.split('\r\n')[1], /^1,2026\/11,1,84686,/);
});

test('constants: 出典には URL があり、確認日は YYYY-MM-DD', () => {
  const K = require('../constants.js');
  assert.match(K.CHECKED, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(K.SOURCES.length >= 1);
  for (const s of K.SOURCES) assert.match(s.url, /^https:\/\//, s.key);
});
