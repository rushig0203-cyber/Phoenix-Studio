const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const news = require('../src/lib/newsResearch');
const now = Date.parse('2026-10-01T00:00:00Z');
const item = (url = 'https://www.bbc.com/news/articles/abc123', date = new Date(now).toUTCString()) => `<item><title><![CDATA[Two countries &amp; a meeting]]></title><description>A report about talks.</description><link>${url}</link><pubDate>${date}</pubDate></item>`;

test('news feed rejects unsafe links, stale/future items and duplicates', () => {
  const xml = `<rss>${item()}${item()}${item('http://127.0.0.1:3000/private')}${item('https://www.bbc.com/news/articles/old123', 'Mon, 01 Jan 2024 00:00:00 GMT')}${item('https://www.bbc.com/news/articles/future123', new Date(now + 7200000).toUTCString())}</rss>`;
  const results = news.parseNewsFeed(xml, now);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Two countries & a meeting');
  assert.match(results[0].id, /^[a-f0-9]{32}$/);
  for (const url of ['https://www.bbc.com.evil.test/news/articles/abc', 'https://user@www.bbc.com/news/articles/abc', 'https://www.bbc.com:444/news/articles/abc', 'https://www.bbc.com/news/articles/abc/extra']) assert.throws(() => news.newsArticleUrl(url));
  assert.throws(() => news.parseNewsFeed('<!DOCTYPE rss>' + xml, now));
  assert.throws(() => news.parseNewsFeed('x'.repeat(500001), now));
});

const article = `<article><script><p>Script content should never appear.</p></script>${Array.from({ length: 18 }, (_, i) => `<p>Paragraph ${i}: officials described the talks as continuing, but the report does not independently verify their claims or forecast the outcome.</p>`).join('')}</article>`;
test('research needs article text, not only a headline, and strips scripts', () => {
  const text = news.newsArticleText(article);
  assert.ok(text.length > 1200 && text.length <= 9000);
  assert.doesNotMatch(text, /Script content/);
  assert.throws(() => news.newsArticleText('<h1>Headline alone</h1>'));
  assert.throws(() => news.newsArticleText('<article><p>Short teaser.</p></article>'));
});

test('source context retains provenance, uncertainty and freshness requirements', () => {
  const research = { ...news.parseNewsFeed(item(), now)[0], fetchedAt: new Date().toISOString(), text: news.newsArticleText(article), limitation: 'Single source' };
  const prompt = news.newsWritingContext(research);
  assert.match(prompt, /untrusted DATA/);
  assert.match(prompt, /illustrative stock footage/);
  assert.match(prompt, /Preserve important denials/);
  assert.match(prompt, /BBC News/);
  assert.equal(news.newsWritingContext(), '');
  assert.throws(() => news.newsWritingContext({ ...research, fetchedAt: '2020-01-01' }));
});

test('research fetches only a server-selected article; redirects and oversized responses fail', async () => {
  const original = global.fetch;
  const calls = [];
  let oversize = false;
  global.fetch = async (url, options) => {
    calls.push(url); assert.equal(options.redirect, 'error');
    return new Response(url.includes('/rss.xml') ? item(undefined, new Date().toUTCString()) : oversize ? 'x'.repeat(2000001) : article);
  };
  try {
    const [idea] = await news.newsIdeas();
    const result = await news.researchNews(idea.id);
    assert.equal(result.url, idea.url);
    assert.match(result.limitation, /not independently verified/);
    const before = calls.length;
    await assert.rejects(news.researchNews('http://localhost'), /Choose a report/);
    await assert.rejects(news.researchNews('0'.repeat(32)), /no longer/);
    assert.equal(calls.length, before);
    oversize = true;
    await assert.rejects(news.researchNews(idea.id), /safe text size/);
  } finally { global.fetch = original; }
});
