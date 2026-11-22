// 金利の今と昔の画面（K245、Q-806）: 年を入れた時に出す物（D645・D627）、字の形、外の口・評価の語が無いこと
// 値は repo の写し（kinri/data/*.json）から読む。期待する値も写しから引き、字に直書きしない
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../kinri/app.js');

const JGB = JSON.parse(fs.readFileSync(path.join(__dirname, '../kinri/data/jgb.json'), 'utf8'));
const CPI = JSON.parse(fs.readFileSync(path.join(__dirname, '../kinri/data/cpi.json'), 'utf8'));
const at = (months, ym) => months.find((m) => m.ym === ym);
const first = (name) => JGB.series.find((s) => s.name === name).months.find((m) => m.value !== null).ym;
const lastYm = JGB.series[0].months.at(-1).ym;

test('年限の名前と年月の字', () => {
  assert.equal(A.tenorLabel('10年'), '10 年');
  assert.equal(A.ymText('1986-07'), '1986 年 7 月');
  assert.equal(A.num(-0.265, 3), '−0.265');
  assert.equal(A.num(-0.0001, 3), '0.000');
  assert.equal(A.signed(1.3, 1), '+1.3');
  assert.equal(A.signed(-3.802, 3), '−3.802');
  assert.equal(A.signed(0, 3), '0.000');
});

test('年を入れると、その年の値（その年で最後に値の在る月）・いま（最後の月末）・差が出る', () => {
  const v = A.yearView(JGB, CPI, '10年', 1990);
  const ten = JGB.series[0].months;
  assert.equal(v.rate.label, '10 年');
  assert.equal(v.rate.thenYm, '1990-12');
  assert.equal(v.rate.then, at(ten, '1990-12').value.toFixed(3));
  assert.equal(v.rate.nowYm, lastYm);
  assert.equal(v.rate.now, ten.at(-1).value.toFixed(3));
  const diff = Number(ten.at(-1).value.toFixed(3)) - Number(at(ten, '1990-12').value.toFixed(3));
  assert.equal(v.rate.diff, A.signed(diff, 3));
  const c = CPI.series[0].months;
  assert.equal(v.cpi.then, A.num(at(c, '1990-12').yoy, 1));
  assert.equal(v.cpi.nowYm, c.at(-1).ym);
  // 差は字に出した値どうしの差（字と食い違わない）
  assert.equal(v.cpi.diff, A.signed(Number(v.cpi.now.replace('−', '-')) - Number(v.cpi.then.replace('−', '-')), 1));
});

test('選んだ年限に値の無い年は、値と差を出さず、始まりの月（写しから）だけ。物価は在れば出す', () => {
  for (const [tenor, year] of [['10年', 1980], ['30年', 1990], ['2年', 1970]]) {
    const v = A.yearView(JGB, CPI, tenor, year);
    assert.deepEqual(Object.keys(v.rate).sort(), ['from', 'label'], tenor);
    assert.equal(v.rate.from, first(tenor), tenor);
    assert.equal(A.fromLine(v.rate), A.tenorLabel(tenor) + 'の値は ' + A.ymText(first(tenor)) + 'から');
  }
  assert.equal(A.fromLine(A.yearView(JGB, CPI, '10年', 1980).rate), '10 年の値は 1986 年 7 月から');   // 行の文の例と同じ形
  assert.ok(A.yearView(JGB, CPI, '10年', 1980).cpi.then);
});

test('物価の前年比の無い年（写しの 1 年目より前・1 年目）には物価を出さない', () => {
  const y0 = Number(CPI.series[0].months[0].ym.slice(0, 4));
  assert.equal(A.yearView(JGB, CPI, '10年', y0).cpi, null);
  assert.equal(A.yearView(JGB, CPI, '10年', y0 - 5).cpi, null);
  assert.ok(A.yearView(JGB, CPI, '10年', y0 + 1).cpi);
});

test('物価の線は、最初に前年比の在る月から', () => {
  const y = A.cpiYoy(CPI);
  assert.equal(y.months[0].ym, CPI.series[0].months.find((m) => typeof m.yoy === 'number').ym);
  assert.equal(y.months.at(-1).ym, CPI.series[0].months.at(-1).ym);
});

test('2 年の欠け（1978-06〜1979-07）: 1978 年は 5 月末の値で、欠けた月を埋めない', () => {
  const v = A.yearView(JGB, CPI, '2年', 1978);
  assert.equal(v.rate.thenYm, '1978-05');
});

test('年でない・最後の年より後は印を付けない', () => {
  const ly = Number(lastYm.slice(0, 4));
  assert.equal(A.yearView(JGB, CPI, '10年', ly + 1), null);
  assert.equal(A.yearView(JGB, CPI, '10年', 199), null);
  assert.equal(A.yearView(JGB, CPI, '10年', 1990.5), null);
  assert.ok(A.yearView(JGB, CPI, '10年', ly));
  assert.equal(A.yearView(JGB, CPI, '40年', 1990), null);
});

test('縦の目盛りは最小と最大を含む', () => {
  const t = A.ticks(-2.5, 24.9, 6);
  assert.ok(t[0] <= -2.5 && t.at(-1) >= 24.9);
  assert.deepEqual(t, [-5, 0, 5, 10, 15, 20, 25]);
});

test('画面: 外の口へ読みに行かない・評価の語と商品の名前が無い・年の欄は 1 つで既定は空', () => {
  const html = fs.readFileSync(path.join(__dirname, '../kinri/index.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../kinri/app.js'), 'utf8');
  const fetches = [...js.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(fetches, ["'./data/jgb.json'", "'./data/cpi.json'"]);
  assert.ok(!/XMLHttpRequest|sendBeacon|WebSocket/.test(js));
  for (const w of ['おすすめ', '買い時', '割安', '割高', '予測', '高い', '低い', 'お得']) assert.ok(!html.includes(w) && !js.includes("'" + w), w);
  const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(inputs.length, 1);
  assert.ok(!/\svalue=/.test(inputs[0]));
  // 日本銀行はリンクだけ
  assert.ok(html.includes('https://www.stat-search.boj.or.jp/'));
});

test('出典の行: 物価は写しの credit と同じく「…を加工して作成（前年同月比は指数から計算）」で終わる（Q-903）', () => {
  assert.ok(A.creditNote(CPI).length > 0);
  assert.ok(CPI.credit.endsWith('を加工して作成' + A.creditNote(CPI)), CPI.credit);
  assert.equal(A.creditNote(JGB), '');
  const html = fs.readFileSync(path.join(__dirname, '../kinri/index.html'), 'utf8');
  assert.ok(html.includes('を加工して作成<span id="src-note"></span>（確認日'));
});

test('図の線: 2 年の値が欠けた月（写しで null の月）で線を切り、欠けた月を選ぶと値の所が「—」（D694・Q-910）', () => {
  const K = require('../kinri/series.js');
  const two = A.rateSeries(JGB, '2年');
  const gap = two.months.filter((m) => m.value === null).map((m) => m.ym);
  // 写しの欠けは 1 か所の続いた月（期待する月は写しから引く）
  assert.ok(gap.length > 0);
  assert.equal(gap[0], '1978-06');
  assert.equal(gap.at(-1), '1979-07');
  const cp = K.chartPoints([two]);
  const d = A.linePath(cp.series[0].points, (x) => x, (v) => v);
  // 線は欠けの前と後の 2 本（M が 2 つ）。欠けた月の x は線に出ない
  assert.equal((d.match(/M/g) || []).length, 2);
  const gx = cp.series[0].points.filter((p) => p.value === null).map((p) => p.x.toFixed(1));
  for (const x of gx) assert.ok(!new RegExp('[ML]' + x.replace('.', '\.') + ' ').test(d), x);
  assert.equal(A.pointText(null, 3), '—');
  assert.equal(A.pointText(7.735, 3), '7.735%');
  assert.equal(A.pointText(-0.2, 1), '−0.2%');
});
