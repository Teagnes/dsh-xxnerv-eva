import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  amountToReadout,
  percentToReadout,
  readoutFontSize,
  SEGMENT_MASKS,
  SEGMENT_ORDER,
  segmentPlan,
} from '../src/segments.js';

/** Which segments a named set of bars maps to, for readable assertions. */
function on(cell) {
  return SEGMENT_ORDER.filter((_, bit) => cell.segments[bit]).join('');
}

test('every renderable character has a seven-bit mask', () => {
  for (const [char, mask] of Object.entries(SEGMENT_MASKS)) {
    assert.ok(mask >= 0 && mask < 128, `${char} mask out of range`);
  }
  assert.equal(Object.keys(SEGMENT_MASKS).length, 12, '0-9 plus dash and blank');
});

test('the digit masks match the standard seven-segment shapes', () => {
  const expected = {
    '0': 'abcdef',
    '1': 'bc',
    '2': 'abdeg',
    '3': 'abcdg',
    '4': 'bcfg',
    '5': 'acdfg',
    '6': 'acdefg',
    '7': 'abc',
    '8': 'abcdefg',
    '9': 'abcdfg',
  };
  for (const [char, segments] of Object.entries(expected)) {
    const cell = segmentPlan(char)[0];
    assert.equal(cell.kind, 'digit');
    assert.equal(on(cell), segments, `digit ${char}`);
  }
});

test('a dash lights only the middle bar and a blank lights nothing', () => {
  assert.equal(on(segmentPlan('-')[0]), 'g');
  assert.equal(on(segmentPlan(' ')[0]), '');
});

test('segmentPlan keeps the order of the cells it is given', () => {
  const plan = segmentPlan('15:91');
  assert.equal(plan.length, 5);
  assert.deepEqual(plan.map(cell => cell.char), ['1', '5', ':', '9', '1']);
  assert.deepEqual(plan.map(cell => cell.kind), ['digit', 'digit', 'punct', 'digit', 'digit']);
});

test('segmentPlan classifies the punctuation the readouts use', () => {
  assert.equal(segmentPlan('.')[0].kind, 'punct');
  assert.equal(segmentPlan('%')[0].kind, 'punct');
  assert.equal(segmentPlan(':')[0].kind, 'punct');
});

test('segmentPlan drops characters it cannot draw rather than inventing a digit', () => {
  const plan = segmentPlan('1¥5');
  assert.deepEqual(plan.map(cell => cell.char), ['1', '5']);
  assert.deepEqual(segmentPlan(''), []);
  assert.deepEqual(segmentPlan(null), []);
});

test('amountToReadout drops the currency mark and turns the decimal point into a colon', () => {
  assert.equal(amountToReadout('\u00a515.91'), '15:91');
  assert.equal(amountToReadout('\u00a50.00'), '0:00');
  assert.equal(amountToReadout('\u00a51,234.50'), '1234:50');
  assert.equal(amountToReadout('<\u00a50.01'), '0:01');
  assert.equal(amountToReadout('-\u00a52.50'), '-2:50');
  assert.equal(amountToReadout(null), '--');
  assert.equal(amountToReadout(''), '--');
  assert.equal(amountToReadout('--'), '--');
});

test('percentToReadout keeps the ratio as a measurement', () => {
  assert.equal(percentToReadout('92.7'), '92.7%');
  assert.equal(percentToReadout('100'), '100%');
  assert.equal(percentToReadout(null), '--');
  assert.equal(segmentPlan(percentToReadout('92.7')).map(cell => cell.char).join(''), '92.7%');
});

test('the readouts survive a full round trip into cells', () => {
  const balance = segmentPlan(amountToReadout('\u00a515.91'));
  assert.equal(balance.filter(cell => cell.kind === 'digit').length, 4);
  assert.equal(balance.filter(cell => cell.char === ':').length, 1);
});

test('long balances retain every digit and shrink only the rendered size', () => {
  const text = amountToReadout('¥123,456,789.01');
  assert.equal(text, '123456789:01');
  assert.equal(segmentPlan(text).filter(cell => cell.kind === 'digit').length, 11);
  const size = readoutFontSize(text, 334, 76);
  assert.ok(size > 40 && size < 50, 'eleven digits must remain legible in the balance column');
  assert.ok(size < readoutFontSize('12345:67', 334, 76));
});

test('a shorter balance regains its normal size, including after a long reading', () => {
  readoutFontSize('123456789012345:67', 334, 76);
  assert.equal(readoutFontSize('14:36', 334, 76), 76);
  assert.equal(readoutFontSize('--', 334, 76), 76);
  assert.equal(readoutFontSize('', 334, 76), 76);
});

test('the compact sync column retains hundredths and the full-hit reading', () => {
  assert.ok(readoutFontSize('99.99%', 195, 58) >= 56, 'hundredths remain near the normal size');
  assert.equal(readoutFontSize('100%', 195, 58), 58);
  assert.equal(percentToReadout('99.99'), '99.99%');
});
