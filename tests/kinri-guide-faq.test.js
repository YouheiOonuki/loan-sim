// 金利の今と昔の使い方（kinri/guide.html）のよくある質問（Q-1021、yorozu-plans ROADMAP 続き 50 の答えの 3）
// (1) 画面の問いと JSON-LD の FAQPage の問いが、数も字も同じ
// (2) 「公表の前年同月比と、小数第1位で違う場合があります」を写しのデータで確かめる:
//     指数は小数 1 桁に丸めてあるので、丸める前の指数がその幅（±0.05）のどこに在っても前年同月比が同じ小数 1 桁になるとは限らない。
//     幅の両端で計算した前年同月比を、画面と同じ toFixed(1) にして、字が違う月が 1 つでも在れば文は成り立つ
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'kinri', 'guide.html'), 'utf8');
const cpi = require('../kinri/data/cpi.json');

const strip = s => s.replace(/<[^>]+>/g, '').trim();

test('画面の「よくある質問」と JSON-LD の FAQPage の問いが、数も字も同じ', () => {
  const faq = html.slice(html.indexOf('id="faq"'));
  const screen = [...faq.slice(0, faq.indexOf('</dl>')).matchAll(/<dt>([\s\S]*?)<\/dt>/g)].map(m => strip(m[1]));
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(m => JSON.parse(m[1])).flatMap(b => (b['@graph'] || [b])).filter(b => b['@type'] === 'FAQPage');
  assert.equal(ld.length, 1);
  const names = ld[0].mainEntity.map(q => q.name);
  assert.ok(screen.length > 0);
  assert.deepEqual(names, screen);
});

test('丸めた指数から出す前年同月比は、丸める前の指数からの値と小数第1位で違いうる月が在る（FAQ の文の裏付け）', () => {
  const months = cpi.series[0].months;
  let n = 0;
  for (let i = 12; i < months.length; i++) {
    const v = months[i].value, p = months[i - 12].value;
    if (typeof v !== 'number' || typeof p !== 'number' || typeof months[i].yoy !== 'number') continue;
    const lo = ((v - 0.05) / (p + 0.05) - 1) * 100, hi = ((v + 0.05) / (p - 0.05) - 1) * 100;
    if (lo.toFixed(1) !== hi.toFixed(1)) n++;
  }
  assert.ok(n > 0, n + ' 月');
  assert.ok(html.includes('公表の前年同月比と、小数第1位で違う場合があります。'));
});
