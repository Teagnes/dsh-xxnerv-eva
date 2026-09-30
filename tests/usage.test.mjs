import { test } from 'node:test';
import assert from 'node:assert/strict';

import { billedInputTokens, roundedPercentUnits, syncPercentText, syncReading, syncTone } from '../src/usage.js';

test('billedInputTokens sums the three disjoint prompt-side buckets', () => {
  assert.equal(billedInputTokens({ uncachedInputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 0 }), 1000);
  assert.equal(billedInputTokens({ uncachedInputTokens: 1, cacheReadTokens: 2, cacheWriteTokens: 3 }), 6);
});

test('billedInputTokens treats absent and malformed buckets as zero', () => {
  assert.equal(billedInputTokens(undefined), 0);
  assert.equal(billedInputTokens({}), 0);
  assert.equal(billedInputTokens({ cacheReadTokens: -5, uncachedInputTokens: 1.5, cacheWriteTokens: Number.NaN }), 0);
});

test('syncPercentText reports nothing before any prompt-side token is billed', () => {
  assert.equal(syncPercentText(0, 0), null);
  assert.equal(syncPercentText(10, 0), null);
  assert.equal(syncReading(undefined).text, null);
  assert.equal(syncReading(undefined).available, false);
});

test('syncPercentText reports a full hit as exactly 100', () => {
  assert.equal(syncPercentText(1000, 1000), '100');
  assert.equal(syncPercentText(5000, 5000), '100');
});

test('syncPercentText never rounds a partial hit up to 100', () => {
  assert.equal(syncPercentText(999, 1000), '99.9');
  assert.equal(syncPercentText(9999, 10000), '99.99');
  assert.equal(syncPercentText(999999, 1000000), '99.9999');
  assert.equal(syncPercentText(999999999, 1000000000), '99.9999999');
  for (const [read, prompt] of [[999, 1000], [9999, 10000], [999999, 1000000]]) {
    assert.notEqual(syncPercentText(read, prompt), '100');
  }
});

test('syncPercentText keeps partial hits honest in the tenths band', () => {
  assert.equal(syncPercentText(873, 1000), '87.3');
  assert.equal(syncPercentText(0, 1000), '0');
  assert.equal(syncPercentText(1, 3), '33.3');
});

test('roundedPercentUnits rounds positive ties up and stays within scale', () => {
  // 1/8 = 12.5% -> 125 tenth-units exactly.
  assert.equal(roundedPercentUnits(125, 1000, 1), 125);
  // Exact half unit rounds up: 0.05% of 20000 is 10 tokens.
  assert.equal(roundedPercentUnits(10, 20000, 1), 1);
  assert.equal(roundedPercentUnits(0, 1000, 1), 0);
  assert.equal(roundedPercentUnits(1000, 1000, 1), 1000);
});

test('syncTone bands the readout', () => {
  assert.equal(syncTone(null), 'none');
  assert.equal(syncTone('100'), 'high');
  assert.equal(syncTone('60'), 'high');
  assert.equal(syncTone('59.9'), 'mid');
  assert.equal(syncTone('30'), 'mid');
  assert.equal(syncTone('29.9'), 'low');
  assert.equal(syncTone('0'), 'low');
});

test('syncReading exposes the token detail the panel prints', () => {
  const reading = syncReading({ uncachedInputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 5, outputTokens: 42 });
  assert.equal(reading.text, '89.6');
  assert.equal(reading.tone, 'high');
  assert.deepEqual(reading.tokens, { prompt: 1005, cacheRead: 900, uncached: 100, cacheWrite: 5, output: 42 });

  // Cache writes are prompt-side input too, so they belong in the denominator.
  assert.equal(syncReading({ uncachedInputTokens: 100, cacheReadTokens: 900 }).text, '90');
});

test('syncReading clamps a cache read that exceeds the prompt side', () => {
  const reading = syncReading({ uncachedInputTokens: 0, cacheReadTokens: 5000, cacheWriteTokens: 0 });
  assert.equal(reading.text, '100');
});
