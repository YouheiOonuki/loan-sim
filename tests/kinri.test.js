// 金利の今と昔（K245、Q-766）: 日 → 月、欠けた月、年の印、始まりの違う 2 系列、値が負の月、系列 0 個、和暦の日付、'-' の欄
// 値はすべて作った物（形だけの fixture。相手のページの文・値は写さない）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../kinri/series.js');

test('wareki: 昭和 49 年・平成元年・令和元年を西暦に', () => {
  assert.equal(K.wareki('S49.9.24'), '1974-09-24');
  assert.equal(K.wareki('H1.1.9'), '1989-01-09');
  assert.equal(K.wareki('平成元.1.9'), '1989-01-09');
  assert.equal(K.wareki('R1.5.7'), '2019-05-07');
  assert.equal(K.wareki('令和元年5月7日'), '2019-05-07');
  assert.equal(K.wareki('昭和64年1月6日'), '1989-01-06');
  assert.equal(K.wareki('R6.12.30'), '2024-12-30');
});

test('wareki: 読めない日付は null', () => {
  for (const s of ['基準日', '', '2024/1/4', 'H0.1.1', 'R5.13.1', 'R5.2.30', 'X1.1.1', '注: 単位は%']) assert.equal(K.wareki(s), null, s);
});

// 並びは実の jgbcm_all.csv と同じ（Q-805 で確かめた）: 表題の行（最後の欄に単位）→ 基準日と年限の見出し → S49.9.24 の形の和暦の行、欠けは -
const CSV = [
  '国債金利の表（作った見本）,,,(単位 見本)',
  '基準日,1年,10年,40年',
  'S49.9.24,8.1,7.9,-',
  'S49.9.25,8.2,-,-',
  'H1.1.9,4.5,5.2,',
  'R1.5.7,-0.15,-0.05,0.4',
  '注: 作った注記',
  '',
].join('\r\n');

test('parseMofCsv: 年限の列を系列に、和暦を西暦に、- と空を null に、表題と注記を飛ばす', () => {
  const s = K.parseMofCsv('﻿' + CSV);
  assert.deepEqual(s.map((x) => x.name), ['1年', '10年', '40年']);
  assert.ok(s.every((x) => x.unit === '%'));
  assert.deepEqual(s[1].points, [
    { date: '1974-09-24', value: 7.9 },
    { date: '1974-09-25', value: null },
    { date: '1989-01-09', value: 5.2 },
    { date: '2019-05-07', value: -0.05 },
  ]);
  assert.deepEqual(s[2].points.map((p) => p.value), [null, null, null, 0.4]);
});

test('parseMofCsv: データの行が無ければ系列 0 個', () => {
  assert.deepEqual(K.parseMofCsv(''), []);
  assert.deepEqual(K.parseMofCsv('基準日,1年,10年\n'), []);
});

test('toMonthEnd: 営業日 → 月の終わりの値（最後の値の在る日）', () => {
  const m = K.toMonthEnd([
    { date: '2024-01-04', value: 0.6 },
    { date: '2024-01-31', value: 0.7 },
    { date: '2024-02-28', value: 0.71 },
    { date: '2024-02-29', value: null },   // 月の最後の日が欠け → その前の日の値
  ]);
  assert.deepEqual(m, [{ ym: '2024-01', value: 0.7 }, { ym: '2024-02', value: 0.71 }]);
});

test('toMonthEnd: 並びが前後しても日付で並べる', () => {
  const m = K.toMonthEnd([{ date: '2024-01-31', value: 2 }, { date: '2024-01-05', value: 1 }]);
  assert.deepEqual(m, [{ ym: '2024-01', value: 2 }]);
});

test('toMonthEnd: 欠けた月は埋めずに null で残す（年をまたいでも）', () => {
  const m = K.toMonthEnd([
    { date: '2023-11-30', value: 0.6 },
    { date: '2023-12-15', value: null },
    { date: '2024-02-29', value: 0.7 },
  ]);
  assert.deepEqual(m, [
    { ym: '2023-11', value: 0.6 },
    { ym: '2023-12', value: null },
    { ym: '2024-01', value: null },
    { ym: '2024-02', value: 0.7 },
  ]);
});

test('toMonthEnd: 値が負の月はそのまま、空の入力は空', () => {
  assert.deepEqual(K.toMonthEnd([{ date: '2016-03-31', value: -0.05 }]), [{ ym: '2016-03', value: -0.05 }]);
  assert.deepEqual(K.toMonthEnd([]), []);
});

const RATE = { name: '10年', kind: 'rate', unit: '%', months: [
  { ym: '2015-11', value: 0.3 }, { ym: '2015-12', value: 0.27 },
  { ym: '2016-01', value: 0.1 }, { ym: '2016-02', value: -0.06 }, { ym: '2016-03', value: null },
  { ym: '2024-12', value: 1.1 },
] };
const CPI = { name: '消費者物価指数', kind: 'index', unit: '2020年=100', months: [
  { ym: '2016-01', value: 98 }, { ym: '2016-12', value: 98.5 }, { ym: '2024-12', value: 110.84 },
] };

test('yearMark: 金利はポイントの差、指数は比、その年の最後の値の在る月の値', () => {
  const r = K.yearMark([RATE, CPI], 2016);
  assert.deepEqual(r[0], { name: '10年', kind: 'rate', then: -0.06, thenYm: '2016-02', now: 1.1, nowYm: '2024-12', points: 1.16 });
  assert.deepEqual(r[1], { name: '消費者物価指数', kind: 'index', then: 98.5, thenYm: '2016-12', now: 110.84, nowYm: '2024-12', ratio: Math.round(110.84 / 98.5 * 1e9) / 1e9 });
});

test('yearMark: その年の値が無い系列は「無い」と返す（始まりの違う 2 系列）', () => {
  const r = K.yearMark([RATE, CPI], 2015);
  assert.deepEqual(r[0], { name: '10年', kind: 'rate', then: 0.27, thenYm: '2015-12', now: 1.1, nowYm: '2024-12', points: 0.83 });
  assert.deepEqual(r[1], { name: '消費者物価指数', kind: 'index', none: true, from: '2016-01' });
  assert.ok(K.yearMark([RATE], 1990)[0].none);
  assert.equal(K.yearMark([RATE], 1990)[0].from, '2015-11');   // 始まりの月は、最初に値の在る月
  assert.equal(K.yearMark([{ name: 'x', kind: 'rate', months: [{ ym: '2020-01', value: null }, { ym: '2020-02', value: 1 }] }], 2019)[0].from, '2020-02');
  assert.equal(K.yearMark([{ name: 'x', kind: 'rate', months: [] }], 2019)[0].from, null);
});

test('yearMark: 系列 0 個は空', () => {
  assert.deepEqual(K.yearMark([], 2016), []);
});

test('chartPoints: 横は全系列の最初の月からの番号、始まりの違いをそのまま、欠けた月は null', () => {
  const c = K.chartPoints([RATE, CPI]);
  assert.equal(c.from, '2015-11');
  assert.equal(c.to, '2024-12');
  assert.deepEqual(c.series[0].points.slice(0, 5).map((p) => [p.ym, p.x, p.value]), [
    ['2015-11', 0, 0.3], ['2015-12', 1, 0.27], ['2016-01', 2, 0.1], ['2016-02', 3, -0.06], ['2016-03', 4, null],
  ]);
  assert.deepEqual(c.series[1].points[0], { ym: '2016-01', x: 2, value: 98 });   // 指数は 2 か月遅れで始まる
  assert.equal(c.series[1].unit, '2020年=100');
  assert.equal(c.series[0].points.at(-1).x, 109);
});

test('chartPoints: 系列 0 個', () => {
  assert.deepEqual(K.chartPoints([]), { from: null, to: null, series: [] });
});

test('CSV → 月 → 図の通し', () => {
  const s = K.parseMofCsv(CSV)[1];
  const months = K.toMonthEnd(s.points);
  assert.equal(months[0].ym, '1974-09');
  assert.equal(months[0].value, 7.9);
  assert.equal(months.at(-1).ym, '2019-05');
  assert.equal(months.length, (2019 - 1974) * 12 + (5 - 9) + 1);
  assert.equal(months.filter((m) => m.value !== null).length, 3);
});

test('外の口に送らない・予測と評価の関数を持たない', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'kinri', 'series.js'), 'utf8');
  for (const w of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'boj']) assert.ok(!src.includes(w), w);
  assert.deepEqual(Object.keys(K).sort(), ['chartPoints', 'parseMofCsv', 'toMonthEnd', 'wareki', 'yearMark']);
});
