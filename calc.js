// ===========================
// 住宅ローン 返済シミュレーター — 計算ロジック（画面から切り離した純粋関数）
// 金額はすべて円、金利は年利の %。内部は小数のまま計算し、丸めは表示側で行う
// ブラウザでは window.Calc、Node（テスト）では module.exports で使う
// ===========================
(function (root) {
  'use strict';

  var EPS = 1e-6;          // 残高 0 とみなす誤差
  var MAX_MONTHS = 1200;   // 100 年。ループの安全弁
  var REVIEW_MONTHS = 60;  // 5 年ルール: 返済額の見直しは 5 年ごと
  var CAP = 1.25;          // 125% ルール

  /** 元利均等の毎月の返済額。r は月利、n は回数。金利 0% なら残高 ÷ 回数 */
  function annuityPayment(balance, r, n) {
    if (n <= 0) return balance;
    if (r === 0) return balance / n;
    var f = Math.pow(1 + r, n);
    return balance * r * f / (f - 1);
  }

  /** 返済額 payment のままで残高を返し終えるまでの回数（最後の回は端数）。返しきれないなら Infinity */
  function monthsToRepay(balance, r, payment) {
    if (balance <= EPS) return 0;
    if (r === 0) return Math.ceil(balance / payment - 1e-9);
    var x = 1 - balance * r / payment;
    if (x <= 0) return Infinity;
    return Math.ceil(-Math.log(x) / Math.log(1 + r) - 1e-9);
  }

  /** 物件価格・頭金・諸費用から借入額を出す（諸費用も借りる前提。自己資金で払う分は頭金に含める） */
  function loanFromPurchase(price, down, costs) {
    return Math.max(0, num(price) + num(costs) - num(down));
  }

  function num(v) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function yen(v) { return Math.round(v).toLocaleString('ja-JP'); }

  /** 入力の検査。問題があれば日本語のメッセージの配列を返す */
  function validate(input) {
    var e = [];
    if (!(input.principal > 0)) e.push('借入額を 0 より大きくしてください。');
    if (!(input.months >= 1 && input.months <= 600)) e.push('返済期間は 1〜50 年にしてください。');
    var rates = input.rates || [];
    if (!rates.length) e.push('金利を入れてください。');
    rates.forEach(function (x, i) {
      if (!(x.rate >= 0 && x.rate <= 20)) e.push('金利は 0〜20% にしてください（' + (i + 1) + ' 行目）。');
      if (i > 0 && !(x.from >= 2 && x.from <= input.months)) e.push('金利を変える時期は、2 か月目から返済期間の中までにしてください（' + (i + 1) + ' 行目）。');
    });
    (input.prepayments || []).forEach(function (p, i) {
      if (!(p.amount > 0)) e.push('繰上返済の金額を 0 より大きくしてください（' + (i + 1) + ' 行目）。');
      if (!(p.month >= 1 && p.month <= input.months)) e.push('繰上返済の時期を返済期間の中にしてください（' + (i + 1) + ' 行目）。');
    });
    return e;
  }

  /**
   * 返済のシミュレーション
   * input = {
   *   principal: 借入額（円）, months: 返済回数,
   *   method: 'annuity'（元利均等）| 'principal'（元金均等）,
   *   rates: [{ from: 何か月目から（1 始まり。1 行目は常に 1 として扱う）, rate: 年利 % }],
   *   rule5, rule125: 5 年ルール・125% ルール（元利均等のときだけ有効）,
   *   prepayments: [{ month: 何か月目の返済のあとに, amount: 円, type: 'shorten'（期間短縮）| 'reduce'（返済額軽減） }],
   *   prepayFee: 繰上返済 1 回あたりの手数料（円）
   * }
   */
  function simulate(input) {
    var errors = validate(input);
    if (errors.length) return { errors: errors, warnings: [], rows: [] };

    var annuity = input.method !== 'principal';
    var rule5 = annuity && !!input.rule5;
    var rule125 = annuity && !!input.rule125;
    var fee = Math.max(0, num(input.prepayFee));

    var rates = input.rates.map(function (x, i) { return { from: i === 0 ? 1 : x.from, rate: x.rate }; })
      .sort(function (a, b) { return a.from - b.from; });
    function rateOf(k) {
      var pct = rates[0].rate;
      for (var i = 0; i < rates.length; i++) if (rates[i].from <= k) pct = rates[i].rate;
      return pct;
    }

    var pre = {};
    (input.prepayments || []).forEach(function (p) { (pre[p.month] = pre[p.month] || []).push(p); });

    var B = input.principal;
    var nEnd = input.months;       // 最終回（期間短縮で前に動く）
    var unpaid = 0;                // 未払利息（最終回にまとめて精算）
    var P = 0;                     // 元利均等の毎月の返済額
    var PP = B / nEnd;             // 元金均等の毎月の元金
    var rows = [];
    var warnings = [];
    var caps = [];                 // 125% ルールで抑えた回
    var maxUnpaid = 0, unpaidFrom = 0;
    var ignored = [];

    for (var k = 1; k <= MAX_MONTHS && (B > EPS || unpaid > EPS); k++) {
      var pct = rateOf(k);
      var r = pct / 100 / 12;
      var remaining = Math.max(1, nEnd - k + 1);

      if (annuity) {
        var changed = k > 1 && pct !== rateOf(k - 1);
        var review = rule5 ? (k > 1 && (k - 1) % REVIEW_MONTHS === 0) : changed;
        if (k === 1) {
          P = annuityPayment(B, r, remaining);
        } else if (review) {
          var np = annuityPayment(B, r, remaining);
          if (rule125 && np > P * CAP) { np = P * CAP; caps.push(k); }
          P = np;
        }
      }

      var interest = B * r;
      var pay, prin;
      if (k >= nEnd) {                               // 最終回: 残りをすべて精算
        prin = B; pay = B + interest + unpaid; unpaid = 0;
      } else if (annuity) {
        if (P >= interest) {
          prin = Math.min(P - interest, B); pay = prin + interest;
        } else {                                     // 利息が返済額を上回った: 足りない分を未払利息に積む
          prin = 0; pay = P; unpaid += interest - P;
          if (!unpaidFrom) unpaidFrom = k;
        }
      } else {
        prin = Math.min(PP, B); pay = prin + interest;
      }
      B -= prin;
      if (B < EPS) B = 0;
      maxUnpaid = Math.max(maxUnpaid, unpaid);

      var preAmount = 0, preFee = 0;
      (pre[k] || []).forEach(function (p) {
        if (B <= EPS) { ignored.push(p.month); return; }
        if (p.amount > B + 0.5) {
          errors.push(k + ' か月目の繰上返済 ' + yen(p.amount) + ' 円が、その時点の残高 ' + yen(B) + ' 円を超えています。');
          return;
        }
        var a = Math.min(p.amount, B);
        B -= a; preAmount += a; preFee += fee;
        if (B < 0.5) {                                // 繰上返済で完済: 残りの端数と未払利息もここで精算
          preAmount += B; B = 0;
          pay += unpaid; unpaid = 0;
          nEnd = k;
          return;
        }
        if (p.type === 'reduce') {
          var rest = nEnd - k;
          if (annuity) P = annuityPayment(B, r, rest);
          else PP = B / rest;
        } else if (annuity) {
          var n = monthsToRepay(B, r, P);
          if (isFinite(n)) nEnd = Math.min(nEnd, k + n);
        } else {
          nEnd = Math.min(nEnd, k + Math.ceil(B / PP - 1e-9));
        }
      });

      rows.push({
        month: k, rate: pct, payment: pay, interest: interest, principal: prin,
        prepay: preAmount, fee: preFee, balance: B, unpaid: unpaid,
      });
    }

    if (errors.length) return { errors: errors, warnings: [], rows: [] };

    // 完済したあとの繰上返済
    (input.prepayments || []).forEach(function (p) { if (p.month > rows.length) ignored.push(p.month); });
    if (ignored.length) warnings.push({ type: 'ignored', text: '完済したあとの繰上返済（' + ignored.join('・') + ' か月目）は計算に入れていません。' });
    if (maxUnpaid > 0.5) {
      warnings.push({
        type: 'unpaid', from: unpaidFrom, max: maxUnpaid,
        text: unpaidFrom + ' か月目から、利息が毎月の返済額を上回り、返しきれない利息（未払利息）が出ています。最大 ' +
          yen(maxUnpaid) + ' 円で、最終回にまとめて支払う計算です。',
      });
    }
    if (caps.length) warnings.push({ type: 'cap', months: caps, text: '125% ルールで返済額の上がり方を抑えた回があります（' + caps.join('・') + ' か月目）。' });

    return Object.assign({ errors: errors, warnings: warnings, rows: rows }, summarize(rows));
  }

  /** 合計と、毎月の返済額の推移（最終回の精算は除く） */
  function summarize(rows) {
    var s = { totalPaid: 0, totalInterest: 0, totalPrepay: 0, totalFees: 0, months: rows.length, payments: [], finalPayment: 0 };
    rows.forEach(function (x, i) {
      s.totalPaid += x.payment + x.prepay + x.fee;
      s.totalInterest += x.interest;
      s.totalPrepay += x.prepay;
      s.totalFees += x.fee;
      if (i < rows.length - 1) {
        var last = s.payments[s.payments.length - 1];
        if (!last || Math.round(last.payment) !== Math.round(x.payment)) s.payments.push({ from: x.month, payment: x.payment });
      }
    });
    if (rows.length) {
      s.finalPayment = rows[rows.length - 1].payment;
      if (!s.payments.length) s.payments.push({ from: 1, payment: rows[0].payment });
    }
    return s;
  }

  /** 開始年月（startMonth は 1〜12）から数えて k か月目の年月 */
  function ymOf(startYear, startMonth, k) {
    var idx = startYear * 12 + (startMonth - 1) + (k - 1);
    return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
  }

  /** 暦年ごとの集計: 支払額（繰上返済・手数料を含む）／元金（繰上返済を含む）／利息／年末残高 */
  function yearly(rows, startYear, startMonth) {
    var out = [], cur = null;
    rows.forEach(function (x) {
      var y = ymOf(startYear, startMonth, x.month).year;
      if (!cur || cur.year !== y) { cur = { year: y, paid: 0, principal: 0, interest: 0, prepay: 0, balance: 0 }; out.push(cur); }
      cur.paid += x.payment + x.prepay + x.fee;
      cur.principal += x.principal + x.prepay;
      cur.interest += x.payment - x.principal;   // 実際に支払った利息（未払利息の精算を含む）
      cur.prepay += x.prepay;
      cur.balance = x.balance;
    });
    return out;
  }

  /** 毎月の返済表の CSV（Excel で開けるよう BOM 付き・円未満は四捨五入） */
  function toCSV(rows, startYear, startMonth) {
    var lines = ['回,年月,金利(%),返済額,うち元金,うち利息,繰上返済,手数料,残高,未払利息'];
    rows.forEach(function (x) {
      var ym = ymOf(startYear, startMonth, x.month);
      lines.push([
        x.month, ym.year + '/' + String(ym.month).padStart(2, '0'), x.rate,
        Math.round(x.payment), Math.round(x.principal), Math.round(x.payment - x.principal),
        Math.round(x.prepay), Math.round(x.fee), Math.round(x.balance), Math.round(x.unpaid),
      ].join(','));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  // --- バックアップファイル（README「ツールを追加するとき」20。決定 D31） ---
  // 形式: { tool, version, exportedAt, data }。data はブラウザに保存しているものと同じ形
  var BACKUP_VERSION = 1;

  /** 書き出すファイル名: <ツール名>-backup-YYYYMMDD.json（日付は端末の時計） */
  function backupFileName(tool, date) {
    var d = date || new Date();
    return tool + '-backup-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.json';
  }

  /** 書き出す中身 */
  function buildBackup(tool, data, date) {
    return { tool: tool, version: BACKUP_VERSION, exportedAt: (date || new Date()).toISOString(), data: data };
  }

  /**
   * 読み込んだファイルの文字列を確かめる。中身の正規化は画面側の既存の関数で行う
   * @returns {{ok: true, data: object} | {ok: false, error: string}} error は画面にそのまま出す文
   */
  function parseBackup(text, tool, requiredKeys) {
    var o;
    try { o = JSON.parse(text); } catch (e) { o = null; }
    if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.tool !== 'string') {
      return { ok: false, error: 'ファイルを読み取れませんでした。このツールの「ファイルに書き出す」で作った .json ファイルを選んでください。' };
    }
    if (o.tool !== tool) {
      return { ok: false, error: 'ほかのツール（' + o.tool.slice(0, 40) + '）のファイルです。このツールで書き出したファイルを選んでください。' };
    }
    if (o.version !== BACKUP_VERSION) {
      return { ok: false, error: typeof o.version === 'number' && o.version > BACKUP_VERSION
        ? '新しい版のツールで書き出したファイルのため読み込めません。ページを再読み込みしてから、もう一度お試しください。'
        : 'ファイルの形式が正しくないため読み込めません。' };
    }
    var data = o.data;
    var missing = !data || typeof data !== 'object' || Array.isArray(data) ||
      (requiredKeys || []).some(function (k) { return data[k] === undefined || data[k] === null; });
    if (missing) return { ok: false, error: 'ファイルの中身が足りないため読み込めません。' };
    return { ok: true, data: data };
  }

  var Calc = {
    annuityPayment: annuityPayment, monthsToRepay: monthsToRepay, loanFromPurchase: loanFromPurchase,
    validate: validate, simulate: simulate, summarize: summarize, ymOf: ymOf, yearly: yearly, toCSV: toCSV,
    backupFileName: backupFileName, buildBackup: buildBackup, parseBackup: parseBackup,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
  else root.Calc = Calc;
})(this);
