// 金利の今と昔（K245、Q-805）: repo に持つ月末の値の写し（kinri/data/*.json）と、写しを作る道具（tools/kinri-data.js）の読む所
// 写しのテストは、道具が書いた実の JSON を読む（外の口には何も送らない）。道具の読む所のテストの値は作った物（形だけ）
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../kinri/series.js');
const T = require('../tools/kinri-data.js');
const JGB = require('../kinri/data/jgb.json');
const CPI = require('../kinri/data/cpi.json');

function ymNum(ym) { return Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1; }
function at(months, ym) { return months.find((m) => m.ym === ym); }
const TENORS = ['1年', '2年', '3年', '4年', '5年', '6年', '7年', '8年', '9年', '10年', '15年', '20年', '25年', '30年', '40年'];

test('写し: 出典の名前・URL・PDL1.0・取った日・「加工して作成」が在る', () => {
  for (const d of [JGB, CPI]) {
    assert.ok(d.source.name && /^https:\/\//.test(d.source.url) && /^https:\/\//.test(d.source.page), d.source.name);
    assert.match(d.source.license, /PDL1\.0/);
    assert.match(d.fetched, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(d.credit.startsWith(d.source.name) && d.credit.endsWith('を加工して作成'), d.credit);
  }
  assert.equal(JGB.kind, 'rate');
  assert.equal(CPI.kind, 'index');
});

test('国債金利: 年限は 15（1〜10 年・15・20・25・30・40 年）', () => {
  assert.deepEqual(JGB.series.map((s) => s.name), TENORS);
});

test('国債金利: どの年限も 1974-09 から取った月の前の月あたりまで、月が欠けず並ぶ', () => {
  const fetched = ymNum(JGB.fetched.slice(0, 7));
  for (const s of JGB.series) {
    assert.equal(s.months[0].ym, '1974-09', s.name);
    s.months.forEach((m, i) => assert.equal(ymNum(m.ym), ymNum('1974-09') + i, s.name + ' ' + m.ym));
    const last = ymNum(s.months.at(-1).ym);
    assert.ok(last <= fetched && last >= fetched - 2, s.name + ' の最後の月 ' + s.months.at(-1).ym);   // jgbcm_all.csv は前の月の末までを持つ
    assert.equal(s.months.length, JGB.series[0].months.length, s.name);
  }
});

test('国債金利: 欠けの - は null（10 年は 1986-07 から、40 年は 2007-11 から値が在る）', () => {
  const ten = JGB.series[9].months, forty = JGB.series[14].months;
  assert.equal(at(ten, '1986-06').value, null);
  assert.equal(typeof at(ten, '1986-07').value, 'number');
  assert.equal(at(forty, '1990-01').value, null);
  assert.equal(at(forty, '2007-10').value, null);
  assert.equal(typeof at(forty, '2007-11').value, 'number');
  for (const s of JGB.series) for (const m of s.months) assert.ok(m.value === null || Number.isFinite(m.value), s.name + ' ' + m.ym);
});

test('国債金利: 年を渡すと、その年で最後に値の在る月の値が返る（12 月が欠けた年は前の月）', () => {
  const ten = { name: '10年', kind: 'rate', months: JGB.series[9].months };
  const r = K.yearMark([ten], 2021)[0];
  assert.equal(r.then, at(ten.months, '2021-12').value);
  assert.equal(r.now, ten.months.at(-1).value);
  // 1 年の 1978-06〜1980-07 は CSV が - だけ。1978 年の値は 1978-05 の値
  const one = { name: '1年', kind: 'rate', months: JGB.series[0].months };
  assert.equal(at(one.months, '1978-12').value, null);
  assert.equal(K.yearMark([one], 1978)[0].then, at(one.months, '1978-05').value);
  assert.ok(K.yearMark([one], 1979)[0].none);
});

test('物価指数: 総合の月の値が 2020-01 から取った月の前の月あたりまで欠けず並ぶ', () => {
  assert.equal(CPI.unit, '2020年=100');
  assert.deepEqual(CPI.series.map((s) => s.name), ['総合']);
  const m = CPI.series[0].months, fetched = ymNum(CPI.fetched.slice(0, 7));
  assert.equal(m[0].ym, '2020-01');
  m.forEach((x, i) => { assert.equal(ymNum(x.ym), ymNum('2020-01') + i, x.ym); assert.ok(Number.isFinite(x.value), x.ym); });
  const last = ymNum(m.at(-1).ym);
  assert.ok(last <= fetched && last >= fetched - 2, '最後の月 ' + m.at(-1).ym);
});

test('道具: 物価指数の年月の欄を読む', () => {
  assert.equal(T.cpiYm('202001'), '2020-01');
  assert.equal(T.cpiYm('2020年1月'), '2020-01');
  assert.equal(T.cpiYm('2020/12'), '2020-12');
  for (const s of ['202013', 'ウエイト(Weight)', '', '0001', '2020']) assert.equal(T.cpiYm(s), null, s);
});

// 実の CSV と同じ並び（見出しの日本語と英語の行・符号の行・ウエイトの行の後に、1 列目が YYYYMM の行）。値は作った物
const CPI_CSV = [
  '類・品目,総合,食料,見本の品目',
  'Group/Item,All items,Food,"Sample, item"',
  '類・品目符号(Group/Item code),0001,0002,9999',
  'ウエイト(Weight),100,30,1',
  '202001,99.5,98.1,-',
  '202002,99.7,98.4,101',
  '202004,,98.0,101',
  '',
].join('\r\n');

test('道具: 物価指数の CSV から「総合」の列を月の値に（見出し・ウエイトの行を飛ばす、欠けた月は null）', () => {
  assert.deepEqual(T.parseCpiCsv('﻿' + CPI_CSV, '総合'), [
    { ym: '2020-01', value: 99.5 }, { ym: '2020-02', value: 99.7 }, { ym: '2020-03', value: null }, { ym: '2020-04', value: null },
  ]);
  assert.equal(T.parseCpiCsv(CPI_CSV, '無い列'), null);
  assert.equal(T.parseCpiCsv('類・品目,総合\n', '総合'), null);
});

test('道具: 読めない CSV からは写しを作らない', () => {
  assert.equal(T.buildJgb('表題だけ\n', '2026-01-01'), null);
  assert.equal(T.buildCpi('表題だけ\n', '2026-01-01'), null);
});

test('道具: 書く JSON は 1 か月 1 行で、読み戻すと同じ', () => {
  const d = T.buildJgb('表,,\n基準日,1年,10年\nS49.9.24,8.1,-\nS49.10.1,-,7.8\n', '2026-01-01');
  const s = T.stringify(d);
  assert.deepEqual(JSON.parse(s), d);
  assert.ok(s.includes('\n        {"ym":"1974-10","value":null}'));
});
