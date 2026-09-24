// ===========================
// 画面の骨組み（yorozu-plans の docs/SCREEN.md 1.1）の共通部品
//   - 「くわしく入れる」の summary に今の状態を出すときの小さな関数
//   - 上端の固定バー（SCREEN.md 0 章の 3・D59）。見た目は style.css の .fixbar
// seido-keisan の lib/screen.js と loan-sim の screen.js は同じ中身（直すときは両方）。計算にはかかわらない
// ===========================
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // 同じ文字なら書き換えない（aria-live の読み上げと描き直しを増やさない）
  function setText(id, t) { var e = $(id); if (e.textContent !== t) e.textContent = t; }
  // select の今の選択肢の文字
  function optText(sel) { return sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : ''; }

  // --- 固定バー: 結果が出たあと、結果の数字が画面の外にあるときだけ上端に出す ---
  // 読み込み時は hidden（位置は fixed なのでレイアウトはずれない）。スクリーンリーダーには最初に出たときの 1 回だけ読ませる
  // 使い方: var setBar = ScreenParts.fixbar();  結果を描くたびに setBar('所得税の還付 12,300円')。結果が無いときは setBar('')
  // 要素の id: バー #fixbar・文字 #fixbar-text・リンク #fixbar-link・見張る結果の数字 #result-main・飛び先 #result-card
  // opts.waitForUser: 読み込み時から結果が出ている画面（既定値で計算するもの）で、利用者がスクロールか入力をするまで出さない
  function fixbar(opts) {
    var bar = $('fixbar'), text = '', resultInView = true, announced = false, armed = !(opts && opts.waitForUser);
    function update() {
      var show = armed && !!text && !resultInView;
      if (show && !announced) {
        announced = true;
        setText('fixbar-text', '');
        bar.hidden = false;
        // 見えるようにしてから文字を入れると読み上げられる。そのあとは読み上げを止める（結果の aria-live と重ねない）
        setTimeout(function () { setText('fixbar-text', text); setTimeout(function () { bar.setAttribute('aria-live', 'off'); }, 1000); }, 50);
        return;
      }
      setText('fixbar-text', text);
      bar.hidden = !show;
    }
    if (!armed) {
      var arm = function () {
        armed = true;
        window.removeEventListener('scroll', arm); document.removeEventListener('input', arm); document.removeEventListener('change', arm);
        update();
      };
      window.addEventListener('scroll', arm, { passive: true });
      document.addEventListener('input', arm);
      document.addEventListener('change', arm);
    }
    if ('IntersectionObserver' in window) {
      // バーの高さ（44px）の分だけ上を狭めて、バーに隠れている結果は「画面の外」とみなす
      new IntersectionObserver(function (es) {
        resultInView = es[es.length - 1].isIntersecting;
        update();
      }, { rootMargin: '-44px 0px 0px 0px' }).observe($('result-main'));
    }
    $('fixbar-link').addEventListener('click', function (e) {
      e.preventDefault();
      var card = $('result-card');
      card.scrollIntoView({ block: 'start' });   // style.css の scroll-margin-top でバーの下に見出しが来る
      try { card.focus({ preventScroll: true }); } catch (err) { card.focus(); }
    });
    return function (t) { text = t; update(); };
  }

  window.ScreenParts = { setText: setText, optText: optText, fixbar: fixbar };
})();
