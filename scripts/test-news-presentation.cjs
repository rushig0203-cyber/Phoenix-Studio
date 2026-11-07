const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { newsPresentation, supportsNewsPresentation, NEWS_CAPTION_STYLE } = require('../src/lib/newsPresentation.ts');

test('news keeps natural unboxed captions above social controls and clear natural-rate speech', () => {
  for (const [aspect, size] of [['9:16', 34], ['16:9', 28]]) {
    const style = newsPresentation(aspect);
    assert.equal(style.font_size, size);
    assert.equal(style.subtitle_position, 'custom');
    assert.equal(style.custom_position, 78);
    assert.equal(style.rounded_subtitle_background, false);
    assert.equal(style.text_background_color, false);
    assert.equal(style.text_fore_color, '#FFFFFF');
    assert.equal(style.stroke_width, 1);
    assert.equal(style.voice_rate, 1.08);
    assert.equal(style.bgm_type, '');
    assert.equal(style.bgm_volume, 0);
    assert.equal(style.phoenix_news_caption_style, NEWS_CAPTION_STYLE);
  }
});

test('old or ambiguous renderer capability cannot silently ignore measured news captions', () => {
  for (const field of [undefined, {}, { type: 'string' }, { enum: [NEWS_CAPTION_STYLE, 'other'] }, { anyOf: [{ const: NEWS_CAPTION_STYLE }, { type: 'string' }] }]) {
    assert.equal(supportsNewsPresentation({ phoenix_news_caption_style: field }), false);
  }
  for (const field of [{ const: NEWS_CAPTION_STYLE }, { anyOf: [{ enum: [NEWS_CAPTION_STYLE] }, { type: 'null' }] }]) {
    assert.equal(supportsNewsPresentation({ phoenix_news_caption_style: field }), true);
  }
});

test('only researched news overrides the shared render defaults', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/generation.ts'), 'utf8');
  assert.match(source, /\.\.\.\(prepared\.research \? newsPresentation\(prepared\.aspect\) : \{\}\)/);
  assert.match(source, /bgm_volume: 0\.06/);
  assert.match(source, /voice_rate: prepared\.autoDuration \? 1 : stockVoiceRate/);
});
