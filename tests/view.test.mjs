import { test } from 'node:test';
import assert from 'node:assert/strict';

import { billedTotal, contextFill, deriveView, formatCount, formatStamp, formatTenths, powerReading } from '../src/view.js';

const ready = balance => ({ status: 'ready', value: [{ currency: 'CNY', balance }], bonusWallets: [] });

test('deriveView goes offline before anything else when the host connection drops', () => {
  const view = deriveView({ connected: false, usage: { uncachedInputTokens: 10, cacheReadTokens: 90 }, balanceResult: ready('10') });
  assert.equal(view.state, 'offline');
});

test('deriveView stands by until the session bills a prompt token', () => {
  assert.equal(deriveView({ connected: true, usage: undefined, balanceResult: undefined }).state, 'standby');
  assert.equal(deriveView({ connected: true, usage: {}, balanceResult: ready('10') }).state, 'standby');
});

test('deriveView links once a sync ratio exists', () => {
  const view = deriveView({ connected: true, usage: { uncachedInputTokens: 100, cacheReadTokens: 900 }, balanceResult: ready('10') });
  assert.equal(view.state, 'linked');
  assert.equal(view.sync.text, '90');
  assert.equal(view.sync.tone, 'high');
  assert.equal(view.active.display, '\u00a510.00');
  assert.equal(view.active.tone, 'ok');
});

test('deriveView alerts on a low sync ratio', () => {
  const view = deriveView({ connected: true, usage: { uncachedInputTokens: 800, cacheReadTokens: 200 }, balanceResult: ready('99') });
  assert.equal(view.sync.text, '20');
  assert.equal(view.sync.tone, 'low');
  assert.equal(view.state, 'alert');
});

test('deriveView alerts on a low reserve even at a high sync ratio', () => {
  const view = deriveView({ connected: true, usage: { uncachedInputTokens: 10, cacheReadTokens: 990 }, balanceResult: ready('0.20') });
  assert.equal(view.sync.tone, 'high');
  assert.equal(view.active.tone, 'low');
  assert.equal(view.state, 'alert');
});

test('deriveView keeps a missing balance from breaking the sync readout', () => {
  const signedOut = deriveView({ connected: true, usage: { uncachedInputTokens: 10, cacheReadTokens: 990 }, balanceResult: null });
  assert.equal(signedOut.state, 'linked');
  assert.equal(signedOut.active.display, null);
  assert.equal(signedOut.balance.kind, 'signed-out');

  const unsupported = deriveView({ connected: true, usage: undefined, balanceResult: undefined, balanceUnsupported: true });
  assert.equal(unsupported.balance.kind, 'unsupported');
  assert.equal(unsupported.active.tone, 'none');
});

test('contextFill maps context occupancy onto a 0-100 CSS width', () => {
  // An unreported window must leave the bar empty rather than draw a guess.
  assert.equal(contextFill(powerReading(undefined)), 0);
  assert.equal(contextFill(powerReading({ contextWindow: 0, projectedTokens: 10 })), 0);
  assert.equal(contextFill(powerReading({ contextWindow: 1000, projectedTokens: 0 })), 0);
  assert.equal(contextFill(powerReading({ contextWindow: 1000, projectedTokens: 873 })), 87.3);
  // Occupancy is capped, so an over-full window cannot overflow the bar.
  assert.equal(contextFill(powerReading({ contextWindow: 1000, projectedTokens: 4000 })), 100);
  assert.equal(contextFill({}), 0);
});

test('formatCount groups token counts and never prints a negative', () => {
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(1234567), '1,234,567');
  assert.equal(formatCount(-5), '0');
  assert.equal(formatCount(undefined), '0');
});

test('powerReading turns context pressure into a remaining-power reading', () => {
  const reading = powerReading({ contextWindow: 128000, projectedTokens: 32000 });
  assert.equal(reading.percent, 25);
  assert.equal(reading.remaining, 75);
  assert.equal(reading.text, '25%');
  assert.equal(reading.remainingText, '75%');
  assert.equal(reading.tone, 'ok');
});

test('powerReading prefers the projected prompt and bands the load', () => {
  assert.equal(powerReading({ contextWindow: 100, projectedTokens: 70, pressureTokens: 10 }).percent, 70);
  assert.equal(powerReading({ contextWindow: 100, pressureTokens: 62 }).tone, 'mid');
  assert.equal(powerReading({ contextWindow: 100, pressureTokens: 90 }).tone, 'low');
  assert.equal(powerReading({ contextWindow: 100, pressureTokens: 150 }).percent, 100, 'clamped');
});

test('powerReading reports nothing rather than inventing a bar', () => {
  for (const input of [undefined, {}, { contextWindow: 0 }, { contextWindow: 1000 }, { projectedTokens: 10 }]) {
    const reading = powerReading(input);
    assert.equal(reading.percent, null);
    assert.equal(reading.text, null);
    assert.equal(reading.tone, 'none');
  }
});

test('formatStamp prints the panel clock format', () => {
  const stamp = formatStamp(new Date(2025, 8, 30, 10, 5, 0).getTime());
  assert.equal(stamp, '2025.09.30 10:05');
  assert.equal(formatStamp(undefined), null);
  assert.equal(formatStamp(0), null);
});

test('formatTenths drops a trailing zero', () => {
  assert.equal(formatTenths(25), '25');
  assert.equal(formatTenths(25.04), '25');
  assert.equal(formatTenths(36.85), '36.9');
  assert.equal(formatTenths(Number.NaN), '--');
});

test('billedTotal adds the prompt side to the output side', () => {
  assert.equal(billedTotal({ prompt: 1000, output: 250 }), 1250);
  assert.equal(billedTotal(undefined), 0);
});

test('deriveView exposes the segment cells, the badge key and the info rows', () => {
  const view = deriveView({
    connected: true,
    usage: { uncachedInputTokens: 100, cacheReadTokens: 900, outputTokens: 40 },
    pressure: { contextWindow: 1000, projectedTokens: 250 },
    updatedAt: new Date(2025, 8, 30, 9, 30, 0).getTime(),
    balanceResult: { status: 'ready', value: [{ currency: 'CNY', balance: '15.91' }], bonusWallets: [] },
  });
  assert.equal(view.state, 'linked');
  assert.equal(view.status.key, 'hud.state.normal');
  assert.equal(view.sync.cells, '90%');
  assert.equal(view.active.cells, '15:91', 'no currency mark, decimal point reads as a clock separator');
  assert.equal(view.power.remaining, 75);
  assert.equal(view.info.updated, '2025.09.30 09:30');
  assert.equal(view.info.tokens, '1,040');
});

test('deriveView names each state for the badge', () => {
  const base = { balanceResult: { status: 'ready', value: [{ currency: 'CNY', balance: '99' }], bonusWallets: [] } };
  assert.equal(deriveView({ ...base, usage: { uncachedInputTokens: 1, cacheReadTokens: 99 } }).status.key, 'hud.state.normal');
  assert.equal(deriveView({ ...base, usage: { uncachedInputTokens: 90, cacheReadTokens: 10 } }).status.key, 'hud.state.caution');
  assert.equal(deriveView({ ...base, usage: undefined }).status.key, 'hud.state.standby');
  assert.equal(deriveView({ ...base, connected: false, usage: undefined }).status.key, 'hud.state.offline');
});
