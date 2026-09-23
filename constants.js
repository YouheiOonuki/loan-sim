// ===========================
// 住宅ローン 返済シミュレーター — 前提と出典（値・出典・確認日をセットで）
// このツールは税制などの制度の値を使わない。5 年ルール・125% ルール・未払利息の扱いは
// 金融機関の一般的な説明に合わせた。見直すときは CHECKED を更新する
// ブラウザでは window.Constants、Node（テスト）では module.exports で使う
// ===========================
(function (root) {
  'use strict';

  var CONSTANTS = {
    CHECKED: '2026-09-23',     // 下の出典を最後に確かめた日
    STALE_MONTHS: 12,          // 確認日からこの月数がたったら画面に注意を出す

    SOURCES: [
      {
        key: 'overview',
        label: '固定金利・変動金利など金利タイプの違い（金融商品なんでも百科）',
        publisher: '知るぽると（金融経済教育推進機構）',
        url: 'https://www.shiruporuto.jp/public/document/container/hyakka/part2/jutaku_loan/jutaku_loan005.html',
        note: '変動金利は半年ごとに金利を見直し、返済額の見直しは 5 年ごと・前回の 1.25 倍までとするのが一般的。超えた利息は繰り延べ（未払利息）',
      },
      {
        key: 'unpaid',
        label: '変動金利住宅ローンの未払利息とは？',
        publisher: '一般社団法人 全国銀行協会',
        url: 'https://www.zenginkyo.or.jp/article/tag-d/7824/',
        note: '未払利息が生じるしくみと、最終返済期日に元金とあわせて支払うのが一般的であること',
      },
      {
        key: 'rules',
        label: '住宅ローンの5年ルール・125%ルールについて知りたい。',
        publisher: '三菱UFJ銀行 よくあるご質問',
        url: 'https://faq01.bk.mufg.jp/faq/show/5787?site_domain=default',
        note: '返済額の見直しは 5 年ごと、見直し後の返済額は前回の 1.25 倍まで',
      },
      {
        key: 'principal',
        label: '変動金利ご利用時における金利見直しルール',
        publisher: '京都銀行',
        url: 'https://www.kyotobank.co.jp/kojin/loan/jyutaku/kiso/review.html',
        note: '5 年ルール・125% ルールは元利均等返済のもの。元金均等返済は金利の見直しのたびに返済額が変わる',
      },
    ],
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CONSTANTS;
  else root.Constants = CONSTANTS;
})(this);
