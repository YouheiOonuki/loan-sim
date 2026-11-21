#!/usr/bin/env node
// ===========================
// 金利の今と昔（K245）のデータの写しを作る（yorozu-plans Q-805、D612・D627）
// 財務省の国債金利（jgbcm_all.csv）と統計局の消費者物価指数（zmi2020aa.csv）を 1 回ずつ取り（Shift_JIS）、
// 国債金利は kinri/series.js の parseMofCsv・toMonthEnd で年限ごとの月末の値に、物価指数は「総合」の列の月の値にして、
// kinri/data/jgb.json・kinri/data/cpi.json に書く。CSV そのものは保存しない。
// 使い方（月 1 回）: node tools/kinri-data.js  → kinri/data/*.json が書き換わる。テスト: node --test tests/*.test.js
// ===========================
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Kinri = require('../kinri/series.js');

const LICENSE = '公共データ利用規約（第1.0版）（PDL1.0）';
const SOURCES = {
  jgb: {
    url: 'https://www.mof.go.jp/jgbs/reference/interest_rate/data/jgbcm_all.csv',
    name: '財務省「国債金利情報」',
    page: 'https://www.mof.go.jp/jgbs/reference/interest_rate/index.htm',
  },
  cpi: {
    url: 'https://www.stat.go.jp/data/cpi/2020/csv/zmi2020aa.csv',
    name: '総務省統計局「2020年基準 消費者物価指数」',
    page: 'https://www.stat.go.jp/data/cpi/1.html',
  },
};

function cells(line) { return line.split(',').map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim()); }
function pad(n) { return (n < 10 ? '0' : '') + n; }

/** 物価指数の CSV の年月の欄（202001・2020年1月・2020/1・2020-01・2020.1）を 'YYYY-MM' に。読めなければ null */
function cpiYm(s) {
  const m = /^\s*(\d{4})\s*(?:年\s*|[\/.-]\s*)?(\d{1,2})\s*月?\s*$/.exec(String(s));
  if (!m) return null;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? m[1] + '-' + pad(mo) : null;
}

/**
 * 統計局の物価指数の CSV（文字列）から、見出しが name の列の月の値を返す。
 * 見出しの行 = その名前の欄を持つ最初の行。データの行 = 1 列目が年月で読める行。'-' と空は null。
 * 返す形: [{ ym: 'YYYY-MM', value: number|null }]（年月の順、切れ目は null で埋める）。見出しかデータの行が無ければ null
 */
function parseCpiCsv(text, name) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  let col = -1;
  const pts = [];
  for (const line of lines) {
    const row = cells(line);
    if (col < 0) { col = row.indexOf(name); continue; }
    const ym = cpiYm(row[0]);
    if (!ym) continue;
    const c = row[col] === undefined ? '' : row[col];
    const v = c === '' || c === '-' ? null : Number(c);
    pts.push({ date: ym + '-01', value: v !== null && isFinite(v) ? v : null });
  }
  if (col < 0 || pts.length === 0) return null;
  return Kinri.toMonthEnd(pts);
}

function attribution(src) { return src.name + '（' + src.page + '）を加工して作成'; }

/** 財務省の CSV の文字列 → jgb.json の中身。読めなければ null */
function buildJgb(text, fetched) {
  const series = Kinri.parseMofCsv(text);
  if (series.length === 0) return null;
  return {
    source: { name: SOURCES.jgb.name, url: SOURCES.jgb.url, page: SOURCES.jgb.page, license: LICENSE },
    credit: attribution(SOURCES.jgb),
    fetched,
    processing: '営業日ごとの値を月末の値に直した（その月で最後に値の在る日の値。値の無い月は null）',
    kind: 'rate',
    unit: '%',
    series: series.map((s) => ({ name: s.name, months: Kinri.toMonthEnd(s.points) })),
  };
}

/** 統計局の CSV の文字列 → cpi.json の中身。読めなければ null */
function buildCpi(text, fetched) {
  const months = parseCpiCsv(text, '総合');
  if (!months) return null;
  return {
    source: { name: SOURCES.cpi.name, url: SOURCES.cpi.url, page: SOURCES.cpi.page, license: LICENSE },
    credit: attribution(SOURCES.cpi),
    fetched,
    processing: '全国・月次の「総合」の列だけを取り出した',
    kind: 'index',
    unit: '2020年=100',
    series: [{ name: '総合', months }],
  };
}

/** 1 か月 1 行の JSON（月ごとの差が読める形） */
function stringify(obj) {
  const months = obj.series.map((s) => s.months);
  const json = JSON.stringify(obj, (k, v) => (k === 'months' ? '\u0000M' + months.indexOf(v) : v), 2);
  return json.replace(/"\\u0000M(\d+)"/g, (_, i) => '[\n' + months[Number(i)].map((m) => '        ' + JSON.stringify(m)).join(',\n') + '\n      ]') + '\n';
}

function today() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()); }

function shape(text) {
  const lines = String(text).split(/\r\n|\r|\n/).filter((l) => l.trim() !== '');
  const cut = (l) => (l.length > 160 ? l.slice(0, 160) + '…' : l);
  return { head: lines.slice(0, 6).map(cut), tail: lines.slice(-2).map(cut), lines: lines.length };
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'yorozu-craft data copy (monthly)' } });
  if (!res.ok) throw new Error(url + ' → ' + res.status);
  return new TextDecoder('shift_jis').decode(await res.arrayBuffer());
}

async function main() {
  const outDir = path.join(__dirname, '..', 'kinri', 'data');
  const fetched = today();
  const plan = [['jgb', buildJgb], ['cpi', buildCpi]];
  fs.mkdirSync(outDir, { recursive: true });
  for (const [key, build] of plan) {
    const text = await getText(SOURCES[key].url);   // 1 回だけ。失敗しても取り直さない
    const sh = shape(text);
    console.log('# ' + SOURCES[key].url + '（' + sh.lines + ' 行）');
    sh.head.forEach((l) => console.log('  ' + l));
    console.log('  …');
    sh.tail.forEach((l) => console.log('  ' + l));
    const obj = build(text, fetched);
    if (!obj) { console.error('読めない形: ' + key + '（上の行を見る。このファイルは書き出さない）'); process.exitCode = 1; continue; }
    const file = path.join(outDir, key + '.json');
    fs.writeFileSync(file, stringify(obj), 'utf8');
    console.log(file + ': 系列 ' + obj.series.length + '（' + obj.series.map((s) => s.name).join('・') + '）、' + obj.series[0].months[0].ym + '〜' + obj.series[0].months.at(-1).ym);
  }
}

module.exports = { SOURCES, cpiYm, parseCpiCsv, buildJgb, buildCpi, stringify };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
