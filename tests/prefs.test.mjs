import { test } from 'node:test';
import assert from 'node:assert/strict';

import { anchorPosition, cleanPreferences, clampPosition, resolvePosition, DEFAULT_PREFERENCES, MAX_SCALE, MIN_SCALE } from '../src/prefs.js';
import { bubbleLine, MESSAGES, normalizeLanguage, translate } from '../src/i18n.js';

test('cleanPreferences clamps the scale and restores defaults for junk', () => {
  assert.deepEqual(cleanPreferences(null), { ...DEFAULT_PREFERENCES });
  assert.deepEqual(cleanPreferences('nonsense'), { ...DEFAULT_PREFERENCES });
  assert.equal(cleanPreferences({ scale: 99 }).scale, MAX_SCALE);
  assert.equal(cleanPreferences({ scale: 0.01 }).scale, MIN_SCALE);
  assert.equal(cleanPreferences({ scale: '1.2' }).scale, 1.2);
  assert.equal(cleanPreferences({ scale: Number.NaN }).scale, DEFAULT_PREFERENCES.scale);
});

test('cleanPreferences keeps only meaningful flags and finite positions', () => {
  const clean = cleanPreferences({ motion: false, hidden: 'yes', x: 12, y: Number.POSITIVE_INFINITY });
  assert.equal(clean.motion, false);
  assert.equal(clean.hidden, false);
  assert.equal(clean.x, 12);
  assert.equal(clean.y, null);
  assert.equal(cleanPreferences({}).motion, true);
  assert.equal(cleanPreferences({ hidden: true }).hidden, true);
});

test('clampPosition keeps the unit on screen below the frame top strip', () => {
  assert.deepEqual(clampPosition(-40, -40, 200, 100, 1000, 800, 48), { x: 0, y: 48 });
  assert.deepEqual(clampPosition(5000, 5000, 200, 100, 1000, 800, 48), { x: 800, y: 700 });
  assert.deepEqual(clampPosition(100, 100, 200, 100, 1000, 800, 48), { x: 100, y: 100 });
});

test('normalizeLanguage reads the DSH active language', () => {
  assert.equal(normalizeLanguage('zh'), 'zh');
  assert.equal(normalizeLanguage('zh-CN'), 'zh');
  assert.equal(normalizeLanguage('zh_Hant'), 'zh');
  assert.equal(normalizeLanguage('en'), 'en');
  assert.equal(normalizeLanguage('fr'), 'en');
  assert.equal(normalizeLanguage(undefined), 'en');
});

test('translate interpolates values and falls back to the key', () => {
  assert.equal(translate('zh', 'label.sync'), '同步率');
  assert.equal(translate('en', 'label.sync'), 'Synchro');
  assert.equal(translate('en', 'missing.key'), 'missing.key');
  assert.equal(translate('en', 'unit.aria', { state: 'S', sync: '1%', active: '2' }), 'S. Sync ratio 1%. Active time 2. Click for a line; right-click or press Enter for settings; arrow keys move.');
});

test('both dictionaries carry the same keys', () => {
  const en = Object.keys(MESSAGES.en).sort();
  const zh = Object.keys(MESSAGES.zh).sort();
  assert.deepEqual(zh, en);
});

test('bubbleLine rotates within a state and falls back for an unknown one', () => {
  assert.equal(bubbleLine('en', 'linked', 0), translate('en', 'bubble.linked.0'));
  assert.equal(bubbleLine('en', 'linked', 1), translate('en', 'bubble.linked.1'));
  assert.equal(bubbleLine('en', 'linked', 3), translate('en', 'bubble.linked.0'));
  assert.equal(bubbleLine('en', 'linked', -1), translate('en', 'bubble.linked.2'));
  assert.equal(bubbleLine('en', 'nonsense', 0), translate('en', 'bubble.standby.0'));
});

test('every state named by the view has copy in both languages', () => {
  for (const state of ['linked', 'standby', 'alert', 'offline']) {
    assert.notEqual(translate('en', `state.${state}`), `state.${state}`);
    assert.notEqual(translate('zh', `state.${state}`), `state.${state}`);
    for (let step = 0; step < 3; step += 1) {
      assert.notEqual(translate('en', `bubble.${state}.${step}`), `bubble.${state}.${step}`);
      assert.notEqual(translate('zh', `bubble.${state}.${step}`), `bubble.${state}.${step}`);
    }
  }
});

test('an unplaced panel defaults to the bottom-right of the CURRENT size', () => {
  const viewport = { width: 1400, height: 900 };
  const small = resolvePosition({ x: null, y: null }, { width: 660, height: 300 }, viewport, 48);
  const large = resolvePosition({ x: null, y: null }, { width: 990, height: 450 }, viewport, 48);
  assert.equal(small.x, 1400 - 660 - 24);
  assert.equal(large.x, 1400 - 990 - 24);
  // This difference is exactly what made a resize drag crawl: the default is
  // recomputed from the growing panel on every step.
  assert.notEqual(small.x, large.x);
});

test('a placed panel keeps its anchor across a size change', () => {
  const viewport = { width: 1400, height: 900 };
  const placed = { x: 300, y: 200 };
  const small = resolvePosition(placed, { width: 660, height: 300 }, viewport, 48);
  const large = resolvePosition(placed, { width: 990, height: 450 }, viewport, 48);
  assert.deepEqual(small, { x: 300, y: 200 });
  assert.deepEqual(large, { x: 300, y: 200 });
});

test('anchorPosition freezes the current frame into the preferences', () => {
  const preferences = { x: null, y: null, scale: 1 };
  anchorPosition(preferences, { x: 512, y: 344 });
  assert.equal(preferences.x, 512);
  assert.equal(preferences.y, 344);
  // Nothing to anchor before the first layout: the default stays in charge.
  const untouched = { x: null, y: null };
  anchorPosition(untouched, undefined);
  assert.equal(untouched.x, null);
});

test('a size change only ever moves a panel that is clamped by the viewport', () => {
  const viewport = { width: 900, height: 600 };
  const placed = { x: 400, y: 300 };
  // Growing past the right/bottom edge is the one case where the frame must
  // move, and the resize cap is what keeps that from happening during a drag.
  const grown = resolvePosition(placed, { width: 990, height: 450 }, viewport, 48);
  assert.equal(grown.x, 0, 'clamped back into view');
  assert.equal(grown.y, 150);
});

test('the hover quotation is present in both languages and stays Japanese', () => {
  const quote = translate('en', 'bubble.quote');
  assert.equal(quote, translate('zh', 'bubble.quote'), 'a quotation is not localised copy');
  assert.match(quote, /^[\u3040-\u30ff\u4e00-\u9faf]+$/u, 'kept in Japanese script');
  assert.ok(quote.length <= 12, 'a minimal excerpt, not a transcribed passage');
});
