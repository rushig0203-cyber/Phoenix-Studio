const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/instagramTags.ts');
const moduleObject = { exports: {} };
new vm.Script(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { filename }).runInNewContext({
  module: moduleObject, exports: moduleObject.exports,
  require() { throw new Error('Instagram tag validation must remain dependency-free'); },
});
const tags = moduleObject.exports;
const plain = value => JSON.parse(JSON.stringify(value));

test('explicit usernames normalize one leading @ and case, deduplicate, and preserve owner order', () => {
  assert.deepEqual(plain(tags.instagramUserTags([' @NASA ', 'Nasa', 'Second.Account', '@second.account', 'a_1'])), ['nasa', 'second.account', 'a_1']);
  assert.equal(tags.instagramUsername('a'), 'a');
  assert.equal(tags.instagramUsername('A'.repeat(30)), 'a'.repeat(30));
  assert.equal(tags.INSTAGRAM_USERNAME_LIMIT, 30);
  assert.deepEqual(plain(tags.instagramUserTags([])), []);
});

test('profile URLs, unknown objects, controls and malformed usernames cannot become media tags', () => {
  for (const value of [null, {}, '@nasa', { username: 'nasa' }, { id: '12345' }, [{ username: 'nasa' }], [12345]]) assert.equal(tags.instagramUserTags(value), null);
  for (const username of ['', ' ', '@', '@@nasa', 'https://instagram.com/nasa/', 'instagram.com/nasa', 'nasa?x=1', '.nasa', 'nasa.', 'na..sa',
    'nas a', 'na-sa', 'násá', 'ＮＡＳＡ', 'Kelvin', 'a'.repeat(31), 'nasa\n', 'nasa\r', 'nasa\t', 'nasa\u0000', 'nasa\u007f']) {
    assert.equal(tags.instagramUserTags([username]), null, JSON.stringify(username));
  }
});

test('the application tag limit rejects excess entries without truncating even duplicate input', () => {
  const maximum = Array.from({ length: tags.INSTAGRAM_USER_TAG_LIMIT }, (_, index) => `account_${index}`);
  assert.equal(tags.INSTAGRAM_USER_TAG_LIMIT, 20);
  assert.deepEqual(plain(tags.instagramUserTags(maximum)), maximum);
  assert.equal(tags.instagramUserTags([...maximum, 'extra_account']), null);
  assert.equal(tags.instagramUserTags(Array(21).fill('nasa')), null);
  assert.equal(tags.instagramUserTags(['nasa', 'invalid/user']), null);
});

test('saved metadata must already contain a canonical unique list and public copies are independent', () => {
  const saved = ['nasa', 'second.account'];
  const publicTags = tags.publicInstagramUserTags(saved);
  assert.deepEqual(plain(publicTags), saved);
  publicTags.push('later_edit');
  assert.deepEqual(saved, ['nasa', 'second.account']);
  assert.deepEqual(plain(tags.publicInstagramUserTags([])), []);
  for (const value of [null, {}, ['NASA'], ['@nasa'], [' nasa '], ['nasa', 'nasa'], ['nasa', 'invalid/user'], [{ username: 'nasa' }]]) {
    assert.equal(tags.publicInstagramUserTags(value), null);
  }
});
