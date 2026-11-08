const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../src/app/globals.css'), 'utf8');
const studio = fs.readFileSync(path.join(__dirname, '../src/app/dashboard/studio.module.css'), 'utf8');
function declaration(source, selector, property) {
  const rule = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(match => selector(match[1].trim()));
  assert.ok(rule, `Missing palette rule for ${property}`);
  const value = new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`).exec(rule[2])?.[1].trim();
  assert.ok(value, `Missing palette value for ${property}`);
  return value;
}
const token = name => declaration(css, selector => selector === ':root, .dark', `--${name}`);
function luminance(hex) {
  assert.match(hex, /^#[a-f\d]{6}$/i);
  const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(foreground, background, minimum, description) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  const ratio = (values[0] + .05) / (values[1] + .05);
  assert.ok(ratio >= minimum, `${description}: ${ratio.toFixed(2)}:1 must be at least ${minimum}:1`);
}

test('dim surfaces retain readable body, secondary and action text', () => {
  for (const surface of ['background', 'card', 'popover', 'muted']) {
    assert.ok(luminance(token(surface)) < .08, `${surface} should stay dim`);
    for (const foreground of ['foreground', 'muted-foreground']) contrast(token(foreground), token(surface), 4.5, `${foreground} on ${surface}`);
  }
  for (const surface of ['primary', 'secondary', 'accent', 'sidebar']) contrast(token(`${surface}-foreground`), token(surface), 4.5, surface);
});

test('native fields, placeholders and keyboard focus remain visible on dim surfaces', () => {
  const field = declaration(css, selector => selector.startsWith('main input:not'), 'background-color').replace(/\s*!important$/, '');
  const placeholder = declaration(css, selector => selector.startsWith('main input::placeholder'), 'color');
  contrast(token('foreground'), field, 4.5, 'input text');
  contrast(placeholder, field, 4.5, 'placeholder');
  contrast(token('input'), field, 3, 'input boundary');
  contrast(token('ring'), token('card'), 3, 'keyboard focus');
});

test('selected navigation, brand mark and warning/error messages remain readable', () => {
  for (const selector of ['.brandMark', '.navLink[aria-current="page"]']) {
    const read = property => declaration(studio, rule => rule === selector, property);
    contrast(read('color'), read('background'), 4.5, selector);
  }
  for (const [backgroundClass, foregroundClass] of [['bg-amber-100', 'text-amber-900'], ['bg-red-100', 'text-red-700'], ['bg-green-100', 'text-[#245b2e]']]) {
    const background = declaration(css, selector => selector.includes(`"${backgroundClass}"`), 'background-color').replace(/\s*!important$/, '');
    const foreground = declaration(css, selector => selector.includes(`"${foregroundClass}"`), 'color').replace(/\s*!important$/, '');
    contrast(foreground, background, 4.5, backgroundClass);
  }
});
