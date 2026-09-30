import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EvaWidget } from '../src/widget.js';
import { MAX_SCALE, MIN_SCALE, MAX_PERCENT, MIN_PERCENT, anchorPosition, resolvePosition } from '../src/prefs.js';

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

/**
 * `setScaleFromField` reaches only for the frame's box, the preferences and the
 * viewport, so a stub on the real prototype can drive a whole size change — the
 * anchoring rule gets pinned down without a DOM. Only `measure`, which needs a
 * laid-out shadow root, and the two side effects are faked.
 */
function settingsFrame(x, y, scale = 1) {
  const frame = Object.create(EvaWidget.prototype);
  frame.preferences = { x, y, scale };
  frame.position = { x, y };
  frame.dock = undefined;
  frame.measure = () => ({ width: 660 * frame.preferences.scale, height: 300 * frame.preferences.scale });
  // The real `applyPreferences` -> `reposition` chain, minus the DOM writes: it
  // is the clamp at the end of it that used to slide the frame, so the test has
  // to run through it rather than around it.
  frame.applyPreferences = () => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    frame.position = resolvePosition(frame.preferences, frame.measure(), viewport, frame.topClearance());
    anchorPosition(frame.preferences, frame.position);
  };
  frame.save = () => {};
  return frame;
}

const setSize = (frame, scale) => EvaWidget.prototype.setScaleFromField.call(frame, scale);

test('a typed size holds the docked edges and is reversible', () => {
  withViewport(1400, 900, () => {
    const frame = settingsFrame(716, 510); // the 1400x900 bottom-right default
    const right = () => frame.position.x + 660 * frame.preferences.scale;
    const bottom = () => frame.position.y + 300 * frame.preferences.scale;
    for (const scale of [1.05, 1.15, 1.3, 1.5]) {
      setSize(frame, scale);
      assert.equal(right(), 1376, `the right edge moved at ${scale}`);
      assert.equal(bottom(), 810, `the bottom edge moved at ${scale}`);
    }
    setSize(frame, 1.2);
    setSize(frame, 1);
    assert.deepEqual(frame.position, { x: 716, y: 510 }, 'grow then shrink returns to the original spot');
  });
});

test('a mid-window frame does not flip sides part way through a size change', () => {
  withViewport(1400, 900, () => {
    const frame = settingsFrame(400, 300);
    setSize(frame, 1.1);
    const right = frame.position.x + 660 * frame.preferences.scale;
    assert.equal(right, 1060);
    // 792px wide, so a fresh derivation would now pick the left edge instead.
    setSize(frame, 1.2);
    assert.equal(frame.position.x + 660 * frame.preferences.scale, right, 'the latched dock held');
  });
});

test('the size field clamps what is typed and repairs what is not a number', () => {
  withViewport(1400, 900, () => {
    const frame = settingsFrame(716, 510);
    frame.scale = { value: '20', setAttribute() {} };
    const commit = () => EvaWidget.prototype.commitScaleFromField.call(frame);

    commit();
    assert.equal(frame.preferences.scale, MIN_SCALE);
    assert.equal(frame.scale.value, '20');

    frame.scale.value = '999';
    commit();
    assert.equal(frame.preferences.scale, MAX_SCALE);
    assert.equal(frame.scale.value, '150', 'the box shows the size actually in force');

    frame.scale.value = 'abc';
    commit();
    assert.equal(frame.preferences.scale, MAX_SCALE, 'junk leaves the frame alone');
    assert.equal(frame.scale.value, '150', 'and the box is put back');

    frame.scale.value = '';
    commit();
    assert.equal(frame.preferences.scale, MAX_SCALE, 'an empty box is not zero');
    assert.equal(frame.scale.value, '150');
  });
});

test('the size bounds shown to the user are whole percentages', () => {
  assert.equal(MIN_PERCENT, 20, 'the minimum is reachable on a Mac without a magnifier');
  assert.equal(MAX_PERCENT, 150);
  assert.ok(Number.isInteger(MIN_PERCENT) && Number.isInteger(MAX_PERCENT), 'a bound must never print as a fraction');
});

test('a handle grab never forces a frame smaller than it already is', () => {
  withViewport(900, 700, () => {
    // Parked hard against the bottom-right there is no room to grow, which used
    // to hand the drag a ceiling of MIN_SCALE and snap the frame down to it.
    const frame = settingsFrame(870, 640);
    const event = {
      button: 0, isPrimary: true, pointerId: 1, clientX: 0, clientY: 0,
      preventDefault() {}, stopPropagation() {}, currentTarget: { setPointerCapture() {} },
    };
    EvaWidget.prototype.resizeDown.call(frame, event);
    assert.ok(maxScaleAt({ x: 870, y: 640 }) < 1, 'the raw fit really is below the current size');
    assert.equal(frame.resize.ceiling, 1, 'so the cap must only limit growth');
  });
});

test('a handle resize re-derives the dock instead of reusing the latched one', () => {
  withViewport(1400, 900, () => {
    const frame = settingsFrame(100, 100);
    frame.dock = { horizontal: 'right', vertical: 'bottom' };
    EvaWidget.prototype.setScale.call(frame, 1.1);
    assert.equal(frame.dock, undefined, 'the frame it left is not the frame it docked to');
  });
});

/** `template()` hands its markup to `innerHTML`, so one stub reads the panel the
 * widget will actually install, rather than a copy of the markup kept in a test. */
function templateMarkup() {
  const saved = globalThis.document;
  let markup = '';
  globalThis.document = {
    createElement(tag) {
      if (tag !== 'template') return { style: {}, textContent: '' };
      return { set innerHTML(value) { markup = value; }, content: { cloneNode: () => ({}) } };
    },
  };
  try {
    EvaWidget.prototype.template.call({ art: '', version: '1.2.3' });
    return markup;
  } finally {
    globalThis.document = saved;
  }
}

test('the settings panel drops the readouts block and leads with collapse', () => {
  const markup = templateMarkup();
  assert.ok(!markup.includes('sync-detail'), 'the readouts list is gone');
  assert.ok(!markup.includes('panel.detail'), 'and so is its heading');
  assert.match(markup, /class="detail account-detail"/, 'the balance block stays');
  assert.match(markup, /class="detail rows"/, 'and so does the activity block');
  const actions = markup.match(/<div class="panel-actions">([\s\S]*?)<\/div>/)[1];
  assert.match(actions, /class="action hide primary"[^>]*data-i18n="action\.hide"/, 'collapse is the primary action');
  assert.ok(actions.indexOf('action.hide') < actions.indexOf('action.refresh'), 'and it leads the row');
  assert.ok(!actions.includes('action.reset'), 'the reset-position action is gone');
  assert.equal(actions.match(/<button/g).length, 2, 'collapse and refresh are the whole row');
});

/** `renderPanel` builds its rows with `document.createElement`, so the same kind
 * of stub runs it for real. Worth running: a leftover reference to the removed
 * readouts element would otherwise surface only as a crash on opening the panel. */
function panelRows(view) {
  const saved = globalThis.document;
  globalThis.document = {
    createElement: tag => ({ tag, className: '', textContent: '', children: [], append(...nodes) { this.children.push(...nodes); } }),
  };
  const target = { replaceChildren(...nodes) { this.nodes = nodes; } };
  try {
    EvaWidget.prototype.renderPanel.call({ view, language: 'en', accountDetail: target });
    return target.nodes;
  } finally {
    globalThis.document = saved;
  }
}

test('the balance block renders with no readouts element left to paint', () => {
  const ready = panelRows({ balance: { kind: 'ready', display: '12.00', recharge: '10.00', bonus: '2.00', others: [] } });
  assert.deepEqual(ready.filter(node => node.tag === 'dt').map(node => node.textContent),
    ['Total remaining', 'Topped-up balance', 'Granted balance']);
  assert.deepEqual(ready.filter(node => node.tag === 'dd').map(node => node.textContent), ['12.00', '10.00', '2.00']);

  // A failure still gets its concrete reason, which is the block's whole job.
  const failed = panelRows({ balance: { kind: 'failed', detail: 'HTTP 503' } });
  assert.equal(failed.length, 1);
  assert.equal(failed[0].className, 'note');
  assert.match(failed[0].textContent, /HTTP 503/);
});
