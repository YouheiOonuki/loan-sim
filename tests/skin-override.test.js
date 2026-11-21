// 共通の皮のページはボタンの角丸と h1 の大きさを皮に任せる（yorozu-plans D637・Q-819）。
// 前はグラフ・返済表のタブのボタンを角丸 0 に上書きしていた。皮の後ろ（yorozu-common:end の後）に戻さない
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
const own = css.slice(css.indexOf('/* yorozu-common:end */'));

test('皮の後ろに border-radius: 0 と h1 の font-size の上書きが無い', () => {
  assert.ok(own.length < css.length);
  assert.doesNotMatch(own, /border-radius:\s*0[;\s}]/);
  assert.doesNotMatch(own, /h1\s*\{[^}]*font-size/);
});
