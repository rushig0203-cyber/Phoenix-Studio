const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.join(__dirname, '../tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { postingCaption, postingText, postingHashtags, stripFootageProvenance } = require('../src/lib/posting');
const first = 'https://www.pexels.com/video/forest-41/';
const second = 'https://pixabay.com/videos/forest-42/';
function fixture(postCopy = 'Trees move in the breeze.') {
  return { title: 'Forest reel', source: { kind: 'pexels', providerUrl: first, licence: 'Pexels License · First creator · verify reuse rights before posting' }, quality: {
    postCopy, hashtags: ['#Forest', '#Nature'], visualSources: [
      { provider: 'pexels', creator: 'First creator', providerUrl: first, licence: 'Pexels License' },
      { provider: 'pixabay', creator: 'Second creator', providerUrl: second, licence: 'Pixabay Content License' },
    ],
  } };
}
test('generated footage URL blocks disappear from copy for all targets, never from saved provenance', () => {
  const file = fixture(`Trees move in the breeze.\nFootage sources: ${first}\n${second}`);
  const original = JSON.stringify(file);
  for (const target of [undefined, 'instagram', 'youtube']) {
    assert.equal(postingText(file, target), 'Trees move in the breeze.\n\n#Forest #Nature');
  }
  assert.equal(postingCaption(file), 'Trees move in the breeze.');
  assert.equal(JSON.stringify(file), original);
});
test('legacy one-source generated creator footer is removed only for its saved creator/provider', () => {
  const file = fixture('Trees move in the breeze.\nFootage: First creator / pexels.');
  assert.equal(postingCaption(file), 'Trees move in the breeze.');
  file.quality.visualSources = [];
  assert.equal(postingCaption(file), 'Trees move in the breeze.', 'Older single-source creator survives in licence metadata');
  file.quality.postCopy = 'Owner description.\nFootage: Unknown creator / pexels.';
  assert.match(postingCaption(file), /Unknown creator/);
});
test('old assembled Shot N credit lines are removed only when their complete ordered provenance matches', () => {
  const file = fixture(`Trees move in the breeze.\nShot 1: First creator / pexels — ${first}\nShot 2: Second creator / pixabay — ${second}`);
  const original = JSON.stringify(file);
  assert.equal(postingCaption(file), 'Trees move in the breeze.');
  assert.equal(JSON.stringify(file), original, 'Saved creator, source and licence metadata stays intact');
  for (const text of [
    'Shot 1: trees move as the wind passes through the forest.',
    `Shot 1: Another creator / pexels — ${first}`,
    `Shot 1: First creator / pixabay — ${first}`,
    `Shot 2: First creator / pexels — ${first}`,
    'Shot 1: First creator / pexels — https://www.pexels.com.evil.example/video/forest-41/',
    `${first} is the source I chose for this shot.`,
  ]) assert.equal(stripFootageProvenance(text, file), text);
});
test('generated publishing stock credits are omitted while report and non-stock credits remain', () => {
  const file = fixture(`Trees move in the breeze.\n\nSource credits:\npexels · First creator · ${first} · Pexels License\npixabay · Second creator · ${second} · Pixabay Content License\nReport source: BBC https://www.bbc.com/news/fixture\nSingle report; illustrative visuals.`);
  const caption = postingCaption(file);
  assert.doesNotMatch(caption, /Source credits:|pexels\.com|pixabay\.com/);
  assert.match(caption, /Report source: BBC https:\/\/www\.bbc\.com\/news\/fixture/);
  assert.match(caption, /Single report; illustrative visuals/);
  file.quality.postCopy = `Owner caption.\nSource credits:\npexels · First creator · ${first} · Pexels License\nOwner photographer · https://example.com/own-work`;
  assert.equal(postingCaption(file), 'Owner caption.\nSource credits:\nOwner photographer · https://example.com/own-work');
});
test('owner captions, ordinary source links, arbitrary URL blocks and lookalike hosts are not rewritten', () => {
  for (const text of [
    'My own caption. Credit: my photographer. #OwnerTag',
    `My footage notes: ${first}\nRead more: https://example.com/news`,
    'Footage source: https://example.com/owner-film\nReport source: https://example.com/report',
    'Footage source: https://www.pexels.com.evil.example/video/41/',
    'Footage source: https://token@www.pexels.com/video/41/',
    'Footage source: a guide to choosing Pexels and Pixabay clips',
    'Pexels and Pixabay are useful resources.\nhttps://www.pexels.com/video/forest-41/',
  ]) assert.equal(stripFootageProvenance(text, fixture(text)), text);
});
test('recognized provenance removal stops at unrelated links or report citations rather than deleting the rest', () => {
  const file = fixture(`Owner caption.\nFootage sources:\n${first}\n${second}\nhttps://example.com/owner-story\nReport source: BBC https://www.bbc.com/news/fixture`);
  assert.equal(postingCaption(file), 'Owner caption.\nhttps://example.com/owner-story\nReport source: BBC https://www.bbc.com/news/fixture');
});
test('a provenance-only old caption uses its title; empty captions keep the existing title fallback', () => {
  const file = fixture(`Footage source: ${first}`);
  assert.equal(postingCaption(file), 'Forest reel');
  file.quality.postCopy = ''; assert.equal(postingCaption(file), 'Forest reel');
});
test('automatically appended hashtag banks omit stock-catalogue provenance without rewriting owner tags', () => {
  const tags = ['#Pexels', '#Pixabay', '#PexelsVideo', '#PixabayVideos', '#PexelsFootage', '#Ｐｉｘａｂａｙ', '#Forest', '#Nature', '#Viral'];
  assert.deepEqual(postingHashtags(tags), ['#Forest', '#Nature']);
  assert.equal(postingHashtags(['#Pexels', '#Pixabay', ...Array.from({length:20},(_,index)=>`#Subject${index}`)]).length,20,'Discarded provenance does not consume relevant bank slots');
  const file = fixture('Owner caption #OwnerTag'); file.quality.hashtags = tags;
  assert.equal(postingText(file, 'instagram'), 'Owner caption #OwnerTag\n\n#Forest #Nature');
  file.quality.postCopy = 'Owner caption #Pexels';
  assert.match(postingText(file, 'instagram'), /Owner caption #Pexels/, 'Embedded owner tags are not silently removed');
});
