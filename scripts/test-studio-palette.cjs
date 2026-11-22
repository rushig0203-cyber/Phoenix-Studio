const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../src/app/globals.css'), 'utf8');
const studio = fs.readFileSync(path.join(__dirname, '../src/app/dashboard/studio.module.css'), 'utf8');
function declaration(source, selector, property) {
  const rule = [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(match => selector(match[1].trim()));
  assert.ok(rule, `Missing palette rule for ${property}`);
  const value = new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`).exec(rule[2])?.[1].trim();
  assert.ok(value, `Missing palette value for ${property}`);
  return value;
}
const token = name => declaration(css, selector => selector === ':root, .dark', `--${name}`);
const night = name => declaration(studio, selector => selector === '.shell', `--night${name ? '-' + name : ''}`);
const dashboardToken = name => declaration(css, selector => selector === '[data-studio-theme="night"]', `--${name}`);
function resolved(value, palette = token) {
  value = value.replace(/\s*!important$/, '');
  for (let depth = 0; /^var\(--[a-z-]+\)$/.test(value) && depth < 5; depth++) value = palette(value.slice(6, -1));
  return value;
}
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

test('soft light surfaces retain readable body, secondary and action text', () => {
  for (const surface of ['background', 'card', 'popover', 'muted']) {
    assert.ok(luminance(token(surface)) > .65 && luminance(token(surface)) < .98, `${surface} should remain soft and light`);
    for (const foreground of ['foreground', 'muted-foreground']) contrast(token(foreground), token(surface), 4.5, `${foreground} on ${surface}`);
  }
  for (const surface of ['primary', 'secondary', 'accent', 'sidebar']) contrast(token(`${surface}-foreground`), token(surface), 4.5, surface);
});

test('night surfaces keep progress and attention text readable', () => {
  const shellColor = name => resolved(night(name), dashboardToken);
  for (const surface of ['', 'panel']) {
    for (const role of ['text', 'muted', 'error']) contrast(shellColor(role), shellColor(surface), 4.5, role + ' on night ' + surface);
  }
  const scope = selector => selector.includes('[data-template-progress]') && selector.endsWith(', .jobs');
  assert.equal(declaration(studio, scope, '--muted-foreground'), 'var(--night-muted)');
  assert.equal(declaration(studio, scope, '--destructive'), 'var(--night-error)');
});

test('the complete dashboard palette keeps text, fields, status messages and focus readable on Night surfaces', () => {
  assert.equal(declaration(css, selector => selector === '[data-studio-theme="night"]', 'color-scheme'), 'dark');
  for (const surface of ['background', 'card', 'popover', 'muted', 'field']) {
    const hex = dashboardToken(surface);
    const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16));
    assert.ok(Math.max(...channels) - Math.min(...channels) <= 8 && luminance(hex) < .035, surface + ' must stay close to neutral black');
    for (const foreground of ['foreground', 'muted-foreground', 'link-foreground', 'destructive']) contrast(dashboardToken(foreground), dashboardToken(surface), 4.5, foreground + ' on Night ' + surface);
    contrast(dashboardToken('ring'), dashboardToken(surface), 3, 'Night keyboard focus on ' + surface);
  }
  contrast(dashboardToken('input'), dashboardToken('field'), 3, 'Night field boundary');
  for (const surface of ['primary', 'secondary', 'accent', 'positive', 'warning', 'danger']) contrast(dashboardToken(surface + '-foreground'), dashboardToken(surface), 4.5, 'Night ' + surface);
  assert.doesNotMatch(studio, /--(?:muted-foreground|destructive|border):\s*#(?:52616a|803c31|cbd2d1)/i, 'Nested work areas cannot reset the inherited Night palette to light colors');
});

test('native fields, placeholders and keyboard focus remain visible on light surfaces', () => {
  const fieldRule = selector => selector.startsWith(':is(main, dialog) input:not');
  const field = resolved(declaration(css, fieldRule, 'background-color'));
  const placeholder = resolved(declaration(css, selector => selector.startsWith(':is(main, dialog) input::placeholder'), 'color'));
  contrast(token('foreground'), field, 4.5, 'input text');
  contrast(placeholder, field, 4.5, 'placeholder');
  contrast(token('input'), field, 3, 'input boundary');
  contrast(token('ring'), token('card'), 3, 'keyboard focus');
  contrast(dashboardToken('foreground'), resolved(declaration(css, fieldRule, 'background-color'), dashboardToken), 4.5, 'Night dialog input text');
  contrast(dashboardToken('muted-foreground'), dashboardToken('field'), 4.5, 'Night dialog placeholder');
  const dashboardField = selector => selector.startsWith('[data-studio-theme="night"] :is(input:not');
  assert.equal(resolved(declaration(css, dashboardField, 'background-color'), dashboardToken), dashboardToken('field'));
  assert.equal(resolved(declaration(css, dashboardField, 'border-color'), dashboardToken), dashboardToken('input'));
});

test('selected navigation, brand mark and warning/error messages remain readable', () => {
  for (const [source, selector] of [[css, '.studio-brand-mark'], [studio, '.navLink[aria-current="page"]']]) {
    const read = property => resolved(declaration(source, rule => rule === selector, property),
      name => name.startsWith('night-') ? night(name.slice(6)) : dashboardToken(name));
    contrast(read('color'), read('background'), 4.5, selector);
  }
  for (const [backgroundClass, foregroundClass] of [['bg-amber-100', 'text-amber-900'], ['bg-red-100', 'text-red-700'], ['bg-green-100', 'text-[#245b2e]']]) {
    const background = resolved(declaration(css, selector => selector.includes(`"${backgroundClass}"`), 'background-color'));
    const foreground = resolved(declaration(css, selector => selector.includes(`"${foregroundClass}"`), 'color'));
    contrast(foreground, background, 4.5, backgroundClass);
  }
});

test('legacy Library and Insights surface colors follow the dashboard scope without recoloring video pixels', () => {
  for (const color of ['#e9eff1', '#f3f6f6', '#e8eef0', '#dde7e8', '#e6edef', '#ebf1f3']) {
    const value = declaration(css, selector => selector.startsWith('[data-studio-theme="night"]') && selector.includes(`"bg-[${color}]"`), 'background-color');
    assert.equal(resolved(value, dashboardToken), dashboardToken('muted'));
  }
  for (const color of ['#233743', '#233e4b', '#315264', '#315f7b', '#52616a', '#465e69']) {
    const value = declaration(css, selector => selector.startsWith('[data-studio-theme="night"]') && selector.includes(`"text-[${color}]"`), 'color');
    contrast(resolved(value, dashboardToken), dashboardToken('card'), 4.5, color + ' legacy text on Night');
  }
  assert.doesNotMatch(css, /\[data-studio-theme="night"\][^{}]*\[class[~*]?="(?:text-white|bg-black)/, 'Media blacks and white video overlays keep their own colors');
});
