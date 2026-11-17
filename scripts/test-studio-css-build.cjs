const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lightning = require('lightningcss');
const postcss = require('postcss');
const nano = require('next/dist/compiled/cssnano-simple');
const parser = require('next/dist/compiled/postcss-scss');

for (const name of ['src/app/globals.css', 'src/app/dashboard/studio.module.css']) {
  test(`${name} survives production selector optimization and Next minification`, async () => {
    const filename = path.resolve(__dirname, '..', name);
    // Parsing alone misses escaped attribute-value spaces emitted by optimization.
    const optimized = lightning.transform({ filename, code: fs.readFileSync(filename), minify: true,
      cssModules: name.endsWith('.module.css') }).code.toString();
    const result = await postcss([nano({ colormin: false }, postcss)]).process(optimized, { from: filename, to: filename, parser });
    assert.ok(result.css.length > 0);
  });
}
