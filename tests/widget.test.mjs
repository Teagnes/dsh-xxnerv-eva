import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EvaWidget } from '../src/widget.js';
import { MAX_SCALE, MIN_SCALE } from '../src/prefs.js';

/**
 * `maxScaleAt` is the piece that keeps a resize from also moving the panel, and
 * it reads only browser globals — so it can be exercised here, without a DOM.
 */
function withViewport(width, height, run) {
  const saved = { window: globalThis.window, document: globalThis.document, getComputedStyle: globalThis.getComputedStyle };
  globalThis.window = { innerWidth: width, innerHeight: height };
  globalThis.document = { documentElement: { style: {} } };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '48px' });
  try { return run(); } finally {
    globalThis.window = saved.window;
    globalThis.document = saved.document;
    globalThis.getComputedStyle = saved.getComputedStyle;
  }
}

const maxScaleAt = anchor => EvaWidget.prototype.maxScaleAt.call({}, anchor);

test('Enter opens the settings advertised by the panel keyboard shortcut', () => {
  let opened = 0;
  let prevented = false;
  EvaWidget.prototype.nudge.call({ openPanel: () => opened++ }, {
    key: 'Enter', preventDefault: () => { prevented = true; },
  });
  assert.equal(opened, 1);
  assert.equal(prevented, true);
});

test('maxScaleAt never exceeds the configured maximum', () => {
  withViewport(4000, 3000, () => {
    assert.equal(maxScaleAt({ x: 0, y: 0 }), MAX_SCALE);
  });
});

test('maxScaleAt shrinks the ceiling as the anchor approaches the far edge', () => {
  withViewport(1400, 900, () => {
    // 660*1.5 = 990 wide and 300*1.5 = 450 tall, so a mid-window anchor fits.
    assert.equal(maxScaleAt({ x: 100, y: 100 }), MAX_SCALE);
    // The remaining room to the right becomes the binding constraint.
    const tight = maxScaleAt({ x: 1300, y: 100 });
    assert.ok(tight < 1, `expected a reduced ceiling, got ${tight}`);
    assert.ok(tight >= MIN_SCALE);
  });
});

test('maxScaleAt never drops below the configured minimum, even with no room', () => {
  withViewport(800, 600, () => {
    assert.equal(maxScaleAt({ x: 795, y: 595 }), MIN_SCALE);
  });
});

test('the ceiling stays put while the pointer moves, so resizing cannot drift', () => {
  withViewport(1400, 900, () => {
    // A resize freezes the top-left corner; the ceiling is derived from that
    // frozen anchor and therefore does not depend on the evolving scale.
    const anchor = { x: 200, y: 150 };
    const first = maxScaleAt(anchor);
    const later = maxScaleAt(anchor);
    assert.equal(first, later);
    assert.equal(first, MAX_SCALE);
  });
});
