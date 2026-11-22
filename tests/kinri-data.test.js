// 金利の今と昔（K245、Q-805・Q-840）: repo に持つ月末の値の写し（kinri/data/*.json）と、写しを作る道具（tools/kinri-data.js）の読む所
// 写しのテストは、道具が書いた実の JSON を読む（外の口には何も送らない）。道具の読む所のテストの値は作った物（形だけ）
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../kinri/series.js');
const T = require('../tools/kinri-data.js');
const JGB = require('../kinri/data/jgb.json');
const CPI = require('../kinri/data/cpi.json');

function ymNum(ym) { return Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1; }
function at(months, ym) { return months.find((m) => m.ym === ym); }

test('写し: 出典の名前・URL・規約の名前・取った日・「加工して作成」が在る', () => {
  for (const d of [JGB, CPI]) {
    assert.ok(d.source.name && /^https:\/\//.test(d.source.url) && /^https:\/\//.test(d.source.page), d.source.name);
    assert.ok(d.source.license, d.source.name);
    assert.match(d.fetched, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(d.credit.startsWith(d.source.name) && /を加工して作成(（[^（）]+）)?$/.test(d.credit), d.credit);
  }
  // 規約の名前は出どころが名乗る名前のまま（D659）: 財務省は PDL1.0、e-Stat は e-Stat の利用規約（PDL1.0 と書かない）
  assert.match(JGB.source.license, /PDL1\.0/);
  assert.equal(CPI.source.license, '政府統計の総合窓口（e-Stat）利用規約');
  assert.equal(CPI.source.terms, 'https://www.e-stat.go.jp/terms-of-use');
  assert.doesNotMatch(JSON.stringify(CPI.source) + CPI.credit, /PDL|公共データ利用規約/);
  assert.ok(CPI.credit.includes(CPI.source.table), CPI.credit);
  // 表に前年同月比の項目が無いので、前年同月比は指数から計算し、出典の行にそう書く（Q-903、D694）。金利の側には足さない
  assert.ok(CPI.credit.endsWith('を加工して作成（前年同月比は指数から計算）'), CPI.credit);
  assert.ok(JGB.credit.endsWith('を加工して作成'), JGB.credit);
  assert.equal(JGB.kind, 'rate');
  assert.equal(CPI.kind, 'index');
});

test('README の出典の行は、写しの「加工して作成」の字と規約の名前と同じ', () => {
  const readme = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'README.md'), 'utf8');
  for (const d of [JGB, CPI]) {
    assert.ok(readme.includes(d.credit + '。' + d.source.license), d.source.name);
  }
});

test('国債金利: 配る年限は 3 つ（10 年・2 年・30 年）で、並びは道具の TENORS', () => {
  assert.deepEqual(T.TENORS, ['10年', '2年', '30年']);
  assert.deepEqual(JGB.series.map((s) => s.name), T.TENORS);
});

test('国債金利: 年限ごとに最初に値の在る月から、取った月の前の月あたりまで、月が欠けず並ぶ（10 年は 1986-07、2 年は 1974-09、30 年は 1999-09）', () => {
  const fetched = ymNum(JGB.fetched.slice(0, 7));
  const first = { '10年': '1986-07', '2年': '1974-09', '30年': '1999-09' };
  for (const s of JGB.series) {
    assert.equal(s.months[0].ym, first[s.name], s.name);
    assert.equal(typeof s.months[0].value, 'number', s.name);
    s.months.forEach((m, i) => assert.equal(ymNum(m.ym), ymNum(first[s.name]) + i, s.name + ' ' + m.ym));
    const last = ymNum(s.months.at(-1).ym);
    assert.ok(last <= fetched && last >= fetched - 2, s.name + ' の最後の月 ' + s.months.at(-1).ym);   // jgbcm_all.csv は前の月の末までを持つ
    assert.equal(s.months.at(-1).ym, JGB.series[0].months.at(-1).ym, s.name);
    for (const m of s.months) assert.ok(m.value === null || Number.isFinite(m.value), s.name + ' ' + m.ym);
  }
});

test('国債金利: 値の無い年を渡すと、値でなく「無い」が返る（10 年の 1985 年・30 年の 1998 年）', () => {
  const ten = { name: '10年', kind: 'rate', months: JGB.series[0].months };
  const thirty = { name: '30年', kind: 'rate', months: JGB.series[2].months };
  assert.deepEqual(K.yearMark([ten], 1985)[0], { name: '10年', kind: 'rate', none: true, from: '1986-07' });
  assert.deepEqual(K.yearMark([thirty], 1998)[0], { name: '30年', kind: 'rate', none: true, from: '1999-09' });
  assert.equal(typeof K.yearMark([ten], 1986)[0].then, 'number');
});

test('国債金利: 年を渡すと、その年で最後に値の在る月の値が返る（12 月が欠けた年は前の月）', () => {
  const ten = { name: '10年', kind: 'rate', months: JGB.series[0].months };
  const r = K.yearMark([ten], 2021)[0];
  assert.equal(r.then, at(ten.months, '2021-12').value);
  assert.equal(r.now, ten.months.at(-1).value);
  // 2 年の 1978-06〜1979-07 は CSV が - だけ（間の値の無い月は null で残す）。1978 年の値は 1978-05 の値
  const two = { name: '2年', kind: 'rate', months: JGB.series[1].months };
  assert.equal(at(two.months, '1978-12').value, null);
  assert.equal(at(two.months, '1979-07').value, null);
  assert.equal(K.yearMark([two], 1978)[0].then, at(two.months, '1978-05').value);
  assert.equal(K.yearMark([two], 1979)[0].then, at(two.months, '1979-12').value);
  assert.equal(K.yearMark([two], 1978)[0].thenYm, '1978-05');
});

test('物価指数: 総合の月の値が 1970-01 から取った月の前の月あたりまで欠けず並ぶ（出どころは e-Stat の 1 つ）', () => {
  assert.equal(CPI.unit, '2020年=100');
  assert.match(CPI.source.url, /^https:\/\/www\.e-stat\.go\.jp\//);
  assert.deepEqual(CPI.series.map((s) => s.name), ['総合']);
  const m = CPI.series[0].months, fetched = ymNum(CPI.fetched.slice(0, 7));
  assert.equal(m[0].ym, '1970-01');
  m.forEach((x, i) => { assert.equal(ymNum(x.ym), ymNum('1970-01') + i, x.ym); assert.ok(Number.isFinite(x.value), x.ym); });
  const last = ymNum(m.at(-1).ym);
  assert.ok(last <= fetched && last >= fetched - 2, '最後の月 ' + m.at(-1).ym);
});

test('物価指数: 前年同月比は 1971-01 から（1970 年は null）、12 か月前の値との比', () => {
  const m = CPI.series[0].months;
  assert.equal(m.find((x) => x.yoy !== null).ym, '1971-01');
  m.slice(0, 12).forEach((x) => assert.equal(x.yoy, null, x.ym));
  m.slice(12).forEach((x, i) => {
    assert.ok(Number.isFinite(x.yoy), x.ym);
    assert.ok(Math.abs(x.yoy - (x.value / m[i].value - 1) * 100) < 0.001, x.ym);
  });
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

test('道具: 読めない CSV と、値の無い月が在る CSV からは写しを作らない', () => {
  assert.equal(T.buildJgb('表題だけ\n', '2026-01-01'), null);
  assert.equal(T.buildJgb('表,,\n基準日,1年,10年\nS49.9.24,8.1,7.8\n', '2026-01-01'), null);   // 2 年・30 年の列が無い
  assert.equal(T.buildCpi('表題だけ\n', '2026-01-01'), null);
  assert.equal(T.buildCpi(CPI_CSV, '2026-01-01'), null);   // 2020-03・2020-04 が欠けている
});

test('道具: 物価の CSV から写しを作ると、前年同月比は 13 か月目から', () => {
  const rows = [];
  for (let i = 0; i < 14; i++) rows.push((2020 + Math.floor(i / 12)) + String(i % 12 + 1).padStart(2, '0') + ',' + (100 + i));
  const d = T.buildCpi('類・品目,総　合\n' + rows.join('\n') + '\n', '2026-01-01');
  const m = d.series[0].months;
  assert.equal(m.length, 14);
  assert.equal(m[11].yoy, null);
  assert.equal(m[12].ym, '2021-01');
  assert.equal(m[12].yoy, 12);   // 112 / 100
  assert.equal(m[13].yoy, Math.round((113 / 101 - 1) * 100 * 1000) / 1000);
  assert.equal(d.credit, CPI.credit);   // 道具が書く出典の行と、写しの出典の行は同じ字（Q-903）
});

test('道具: 引数は無し（両方）・jgb・cpi（物価だけ。金利の側は取りに行かない）', () => {
  assert.deepEqual(T.planOf(undefined), ['jgb', 'cpi']);
  assert.deepEqual(T.planOf('cpi'), ['cpi']);
  assert.deepEqual(T.planOf('jgb'), ['jgb']);
  assert.equal(T.planOf('all'), null);
});

test('道具: 文字コードは UTF-8 で読めれば UTF-8、読めなければ Shift_JIS', () => {
  assert.equal(T.decode(new TextEncoder().encode('総合')), '総合');
  assert.equal(T.decode(Uint8Array.from([0x91, 0x8d, 0x8d, 0x87])), '総合');   // Shift_JIS の「総合」
});

// 実の CSV と同じ並び（表題 → 基準日と年限の見出し → 和暦の行、欠けは -）。値は作った物
const JGB_CSV = [
  '表,,,,',
  '基準日,1年,2年,10年,30年',
  'S49.9.24,8.1,8.2,-,-',
  'S49.11.1,8.3,-,7.8,-',
  'S49.12.2,8.4,8.5,7.7,9.1',
].join('\n') + '\n';

test('道具: 金利の CSV から写しを作ると、TENORS の年限だけ、その順に、年限ごとに最初に値の在る月から', () => {
  const d = T.buildJgb(JGB_CSV, '2026-01-01');
  assert.deepEqual(d.series.map((s) => s.name), ['10年', '2年', '30年']);
  assert.deepEqual(d.series[0].months, [{ ym: '1974-11', value: 7.8 }, { ym: '1974-12', value: 7.7 }]);
  assert.deepEqual(d.series[1].months, [{ ym: '1974-09', value: 8.2 }, { ym: '1974-10', value: null }, { ym: '1974-11', value: null }, { ym: '1974-12', value: 8.5 }]);
  assert.deepEqual(d.series[2].months, [{ ym: '1974-12', value: 9.1 }]);
});

test('道具: 書く JSON は 1 か月 1 行で、読み戻すと同じ', () => {
  const d = T.buildJgb(JGB_CSV, '2026-01-01');
  const s = T.stringify(d);
  assert.deepEqual(JSON.parse(s), d);
  assert.ok(s.includes('\n        {"ym":"1974-10","value":null}'));
});
