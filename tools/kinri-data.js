#!/usr/bin/env node
// ===========================
// 金利の今と昔（K245）のデータの写しを作る（yorozu-plans Q-805、D612・D627）
// 財務省の国債金利（jgbcm_all.csv）と、e-Stat の消費者物価指数の長期時系列（全国・月次の中分類指数、1970 年 1 月から）を 1 回ずつ取り、
// 国債金利は kinri/series.js の parseMofCsv・toMonthEnd で年限ごとの月末の値に、物価指数は「総合」の列の月の値と前年同月比にして、
// kinri/data/jgb.json・kinri/data/cpi.json に書く。CSV そのものは保存しない（yorozu-plans Q-840、D659）。
// 使い方（月 1 回）: node tools/kinri-data.js  → kinri/data/*.json が書き換わる。
//   物価だけ: node tools/kinri-data.js cpi（金利の側は取りに行かない）。金利だけ: node tools/kinri-data.js jgb
// テスト: node --test tests/*.test.js
// ===========================
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Kinri = require('../kinri/series.js');

// 規約の名前は、出どころが名乗る名前をそのまま書く（D659。e-Stat の系列に PDL1.0 と書かない）
const SOURCES = {
  jgb: {
    url: 'https://www.mof.go.jp/jgbs/reference/interest_rate/data/jgbcm_all.csv',
    name: '財務省「国債金利情報」',
    page: 'https://www.mof.go.jp/jgbs/reference/interest_rate/index.htm',
    license: '公共データ利用規約（第1.0版）（PDL1.0）',
  },
  cpi: {
    url: 'https://www.e-stat.go.jp/stat-search/file-download?statInfId=000032103842&fileKind=1',
    name: '政府統計の総合窓口（e-Stat）',
    table: '総務省統計局「2020年基準消費者物価指数 長期時系列 品目別価格指数 全国 月次 中分類指数（1970年1月～最新月）」',
    page: 'https://www.e-stat.go.jp/',
    license: '政府統計の総合窓口（e-Stat）利用規約',
    terms: 'https://www.e-stat.go.jp/terms-of-use',
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
  const bare = (c) => c.replace(/\s/g, '');
  for (const line of lines) {
    const row = cells(line);
    if (col < 0) { col = row.map(bare).indexOf(name); continue; }
    const ym = cpiYm(row[0]) || cpiYm(row[1]);   // 1 列目が符号で 2 列目が年月の形も読む
    if (!ym) continue;
    const c = row[col] === undefined ? '' : row[col];
    const v = c === '' || c === '-' ? null : Number(c);
    pts.push({ date: ym + '-01', value: v !== null && isFinite(v) ? v : null });
  }
  if (col < 0 || pts.length === 0) return null;
  return Kinri.toMonthEnd(pts);
}

function attribution(src) { return src.name + (src.table ? src.table : '') + '（' + src.page + '）を加工して作成'; }

/** 月の値に前年同月比（%）を足す。12 か月前の値が無い月（系列の 1 年目を含む）は null */
function withYoy(months) {
  return months.map((m, i) => {
    const prev = i >= 12 ? months[i - 12].value : null;
    const ok = typeof m.value === 'number' && typeof prev === 'number' && prev !== 0;
    return { ym: m.ym, value: m.value, yoy: ok ? Math.round((m.value / prev - 1) * 100 * 1000) / 1000 : null };
  });
}

/** 財務省の CSV の文字列 → jgb.json の中身。読めなければ null */
function buildJgb(text, fetched) {
  const series = Kinri.parseMofCsv(text);
  if (series.length === 0) return null;
  return {
    source: { name: SOURCES.jgb.name, url: SOURCES.jgb.url, page: SOURCES.jgb.page, license: SOURCES.jgb.license },
    credit: attribution(SOURCES.jgb),
    fetched,
    processing: '営業日ごとの値を月末の値に直した（その月で最後に値の在る日の値。値の無い月は null）',
    kind: 'rate',
    unit: '%',
    series: series.map((s) => ({ name: s.name, months: Kinri.toMonthEnd(s.points) })),
  };
}

/** e-Stat の CSV の文字列 → cpi.json の中身。読めない・月が欠けている（値の無い月が在る）時は null */
function buildCpi(text, fetched) {
  const months = parseCpiCsv(text, '総合');
  if (!months || months.some((m) => m.value === null)) return null;
  const s = SOURCES.cpi;
  return {
    source: { name: s.name, table: s.table, url: s.url, page: s.page, license: s.license, terms: s.terms },
    credit: attribution(s),
    fetched,
    processing: '全国・月次の「総合」の列だけを取り出し、前年同月比（%。指数の値から計算し、小数 3 桁に丸めた。系列の 1 年目は null）を足した',
    kind: 'index',
    unit: '2020年=100',
    series: [{ name: '総合', months: withYoy(months) }],
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

/** UTF-8 として正しく読めれば UTF-8、読めなければ Shift_JIS として読む */
function decode(buf) {
  const b = new Uint8Array(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { return new TextDecoder('shift_jis').decode(b); }
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'yorozu-craft data copy (monthly)' } });
  if (!res.ok) throw new Error(url + ' → ' + res.status);
  return decode(await res.arrayBuffer());
}

const BUILDERS = { jgb: buildJgb, cpi: buildCpi };

/** 引数（無し・jgb・cpi）→ 作り直す写しの並び。知らない引数は null */
function planOf(arg) {
  if (arg === undefined) return ['jgb', 'cpi'];
  return Object.prototype.hasOwnProperty.call(BUILDERS, arg) ? [arg] : null;
}

async function main() {
  const outDir = path.join(__dirname, '..', 'kinri', 'data');
  const fetched = today();
  const keys = planOf(process.argv[2]);
  if (!keys) { console.error('引数は無し・jgb・cpi のどれか'); process.exitCode = 1; return; }
  const plan = keys.map((k) => [k, BUILDERS[k]]);
  fs.mkdirSync(outDir, { recursive: true });
  for (const [key, build] of plan) {
    const text = await getText(SOURCES[key].url);   // 1 回だけ。失敗しても取り直さない
    const sh = shape(text);
    console.log('# ' + SOURCES[key].url + '（' + sh.lines + ' 行）');
    sh.head.forEach((l) => console.log('  ' + l));
    console.log('  …');
    sh.tail.forEach((l) => console.log('  ' + l));
    const obj = build(text, fetched);
    if (!obj) {
      const months = key === 'cpi' ? parseCpiCsv(text, '総合') : null;
      const gaps = months ? months.filter((m) => m.value === null).map((m) => m.ym) : [];
      console.error('読めない形: ' + key + (gaps.length ? '（値の無い月 ' + gaps.length + ': ' + gaps.slice(0, 12).join('・') + '）' : '（上の行を見る）') + '。このファイルは書き出さない');
      process.exitCode = 1; continue;
    }
    const file = path.join(outDir, key + '.json');
    fs.writeFileSync(file, stringify(obj), 'utf8');
    console.log(file + ': 系列 ' + obj.series.length + '（' + obj.series.map((s) => s.name).join('・') + '）、' + obj.series[0].months[0].ym + '〜' + obj.series[0].months.at(-1).ym);
  }
}

module.exports = { SOURCES, cpiYm, parseCpiCsv, withYoy, buildJgb, buildCpi, decode, planOf, stringify };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
