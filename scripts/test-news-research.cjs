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
  assert.match(prompt, /do not read publication dates or the source URL aloud/);
  assert.match(prompt, /one short takeaway or important uncertainty/);
  assert.match(prompt, /short disclosure "Visuals are illustrative stock footage\." once/);
  assert.match(prompt, /Full provenance remains in the saved research and posting copy/);
  assert.equal(news.newsWritingContext(), '');
  assert.throws(() => news.newsWritingContext({ ...research, fetchedAt: '2020-01-01' }));
});

test('a concise news brief preserves source qualifications and a complete ending', () => {
  const research = { ...news.parseNewsFeed(item(), now)[0], fetchedAt: new Date().toISOString(), text: 'Officials alleged a breach. The operator denied responsibility. The cause remains unverified.', limitation: 'Single source, not independently verified' };
  const prompt = news.newsWritingContext(research);
  assert.ok(prompt.includes(JSON.stringify(research)), 'The original source and its denial remain available to the writer.');
  assert.match(prompt, /news bulletin, not political advocacy, outrage bait, a fictional story or a practical-advice lesson/);
  assert.match(prompt, /one main development/);
  assert.match(prompt, /Normally use no more than two supporting facts/);
  assert.match(prompt, /one main idea each/);
  assert.match(prompt, /never append background details or repeat information to fill a runtime/);
  assert.match(prompt, /Brevity must not remove attribution, a material denial or the uncertainty/);
  assert.match(prompt, /complete qualified sentence rather than cutting it mid-claim/);
  assert.match(prompt, /Simplify the narration itself rather than dropping spoken claims or qualifications from subtitles/);
  assert.equal(research.text, 'Officials alleged a breach. The operator denied responsibility. The cause remains unverified.');
});

test('headline shorthand cannot remove material current-status qualifications from the article body', () => {
  const research = { ...news.parseNewsFeed(item(), now)[0], title: 'Court rules candidate cannot stand', fetchedAt: new Date().toISOString(), text: 'The court invalidated the nomination. The party will appeal. The electoral commission final list still includes the candidate.', limitation: 'Single source' };
  const prompt = news.newsWritingContext(research);
  assert.ok(prompt.includes(research.text));
  assert.match(prompt, /Read the complete article body, not only its headline or summary/);
  assert.match(prompt, /electoral list still includes them/);
  assert.match(prompt, /consistentFacts editorial check, compare every narrated assertion with this source body/);
  assert.match(prompt, /what is actually decided and what remains unresolved at the end/);
  assert.match(prompt, /final substantive sentence remains the actual conclusion/);
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
