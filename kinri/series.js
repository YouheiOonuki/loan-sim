// ===========================
// 金利の今と昔（K245）— 系列を月にそろえる・年の印・図に渡す点・財務省の国債金利の CSV を読む（画面から切り離した純粋関数）
// 使う値は財務省の国債金利と統計局の消費者物価指数だけ（yorozu-plans D612）。予測・平均への回帰・「高い・低い」の評価は出さない（D592）
// 外の口には何も送らない。文字コードの変換はこの外で行い、ここが受けるのは文字列
// ブラウザでは window.Kinri、Node（テスト）では module.exports で使う
// ===========================
(function (root) {
  'use strict';

  // 和暦の元年の前の年（元年 = ここ + 1）
  var ERA = { S: 1925, H: 1988, R: 2018, '昭和': 1925, '平成': 1988, '令和': 2018 };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymOf(date) { return date.slice(0, 7); }
  function ymNum(ym) { return Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1; }
  function numYm(n) { return Math.floor(n / 12) + '-' + pad(n % 12 + 1); }
  function has(v) { return typeof v === 'number' && isFinite(v); }

  /** 和暦の日付（S49.9.24・H1.1.4・令和元.5.7・平成元年1月8日 など）を 'YYYY-MM-DD' に。読めなければ null */
  function wareki(s) {
    var m = /^\s*(S|H|R|昭和|平成|令和)\s*(元|\d{1,2})\s*[.\/年]\s*(\d{1,2})\s*[.\/月]\s*(\d{1,2})\s*日?\s*$/.exec(String(s));
    if (!m) return null;
    var y = ERA[m[1]] + (m[2] === '元' ? 1 : Number(m[2]));
    var mo = Number(m[3]), d = Number(m[4]);
    if (y <= ERA[m[1]] || mo < 1 || mo > 12 || d < 1) return null;
    if (d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
    return y + '-' + pad(mo) + '-' + pad(d);
  }

  function cells(line) { return line.split(',').map(function (c) { return c.trim().replace(/^"(.*)"$/, '$1').trim(); }); }

  /** 欄の値: '-' と空は null、数でなければ null */
  function cellValue(c) {
    if (c === '' || c === '-') return null;
    var v = Number(c);
    return isFinite(v) ? v : null;
  }

  /**
   * 財務省の国債金利の CSV（文字列）を、年限ごとの系列に。
   * 日付の欄が和暦で読める行をデータの行とし、その直前の行を見出し（年限の名前）とする。読めない行（表題・注記）は飛ばす。
   * 返す形: [{ name: '10年', unit: '%', points: [{ date: 'YYYY-MM-DD', value: number|null }] }]
   */
  function parseMofCsv(text) {
    var lines = String(text).replace(/^﻿/, '').split(/\r\n|\r|\n/);
    var head = null, series = null;
    for (var i = 0; i < lines.length; i++) {
      var row = cells(lines[i]);
      var date = wareki(row[0]);
      if (!date) { if (!series) head = row; continue; }
      if (!series) {
        series = [];
        var names = head || [];
        for (var c = 1; c < row.length; c++) {
          var name = names[c] || '';
          if (name !== '') series.push({ col: c, name: name, unit: '%', points: [] });
        }
      }
      for (var k = 0; k < series.length; k++) series[k].points.push({ date: date, value: cellValue(row[series[k].col] === undefined ? '' : row[series[k].col]) });
    }
    return (series || []).map(function (s) { return { name: s.name, unit: s.unit, points: s.points }; });
  }

  /**
   * 営業日ごとの系列（{ date: 'YYYY-MM-DD', value }。欠けた日が在ってよい）を、月の終わりの値にそろえる。
   * 月の値はその月の最後の値の在る日の値。値の無い月は埋めずに null で残す（最初の月から最後の月まで切れ目なく並べる）
   */
  function toMonthEnd(points) {
    var byYm = {}, first = null, last = null;
    (points || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }).forEach(function (p) {
      var n = ymNum(ymOf(p.date));
      if (first === null || n < first) first = n;
      if (last === null || n > last) last = n;
      if (has(p.value)) byYm[n] = p.value;
    });
    var out = [];
    if (first === null) return out;
    for (var n = first; n <= last; n++) out.push({ ym: numYm(n), value: has(byYm[n]) ? byYm[n] : null });
    return out;
  }

  /** その年（year を省くと系列全体）で最後に値の在る月 { ym, value }。無ければ null */
  function lastIn(months, year) {
    var v = null;
    (months || []).forEach(function (m) { if ((year === undefined || Number(m.ym.slice(0, 4)) === year) && has(m.value)) v = m; });
    return v;
  }
  function r(v) { return Math.round(v * 1e9) / 1e9; }

  /**
   * 入れた年の、各系列の値と、今の値との差。
   * 系列: { name, kind: 'rate'（差はポイント）| 'index'（差は比）, months: toMonthEnd の結果 }
   * その年の値 ＝ その年の最後の値の在る月の値（その月が thenYm）。今の値 ＝ 系列の最後の値の在る月の値（その月が nowYm）。
   * その年の値が無い系列は { name, kind, none: true, from: 系列で最初に値の在る月（無ければ null） }
   */
  function yearMark(list, year) {
    return (list || []).map(function (s) {
      var then = lastIn(s.months, year), now = lastIn(s.months);
      if (then === null || now === null) {
        var first = null;
        (s.months || []).some(function (m) { if (has(m.value)) { first = m.ym; return true; } return false; });
        return { name: s.name, kind: s.kind, none: true, from: first };
      }
      var out = { name: s.name, kind: s.kind, then: then.value, thenYm: then.ym, now: now.value, nowYm: now.ym };
      if (s.kind === 'index') out.ratio = then.value === 0 ? null : r(now.value / then.value);
      else out.points = r(now.value - then.value);
      return out;
    });
  }

  /**
   * 図に渡す点の並び。横は年月（全系列の最初の月から数えた番号 x）、縦は系列ごとの単位のまま。
   * 系列の始まりと終わりはそろえない（その系列の月だけを返す）。値の無い月は value: null（線を切る所）
   */
  function chartPoints(list) {
    var start = null, end = null;
    (list || []).forEach(function (s) {
      (s.months || []).forEach(function (m) {
        var n = ymNum(m.ym);
        if (start === null || n < start) start = n;
        if (end === null || n > end) end = n;
      });
    });
    return {
      from: start === null ? null : numYm(start),
      to: end === null ? null : numYm(end),
      series: (list || []).map(function (s) {
        return {
          name: s.name, kind: s.kind, unit: s.unit,
          points: (s.months || []).map(function (m) { return { ym: m.ym, x: ymNum(m.ym) - start, value: has(m.value) ? m.value : null }; }),
        };
      }),
    };
  }

  var Kinri = { wareki: wareki, parseMofCsv: parseMofCsv, toMonthEnd: toMonthEnd, yearMark: yearMark, chartPoints: chartPoints };
  if (typeof module !== 'undefined' && module.exports) module.exports = Kinri;
  else root.Kinri = Kinri;
})(this);
