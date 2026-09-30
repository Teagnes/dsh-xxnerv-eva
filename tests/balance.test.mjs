import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addAmounts, compareAmounts, formatBalance, symbolOf, walletSummary, LOW_BALANCE } from '../src/balance.js';
import { unwrapRemoteResult } from '../src/account.js';

test('formatBalance follows the host account page rules', () => {
  assert.equal(formatBalance('0', '\u00a5'), '\u00a50.00');
  assert.equal(formatBalance('0.00', '\u00a5'), '\u00a50.00');
  assert.equal(formatBalance('0.009', '\u00a5'), '<\u00a50.01');
  assert.equal(formatBalance('0.01', '\u00a5'), '\u00a50.01');
  assert.equal(formatBalance('42.3', '\u00a5'), '\u00a542.30');
  assert.equal(formatBalance('42.309', '\u00a5'), '\u00a542.30');
  assert.equal(formatBalance('1234567.899', '$'), '$1,234,567.89');
  assert.equal(formatBalance('-0.005', '\u00a5'), '-\u00a50.01');
  assert.equal(formatBalance('-2.5', '\u00a5'), '-\u00a52.50');
  assert.equal(formatBalance('not-a-number', '\u00a5'), null);
});

test('formatBalance truncates rather than rounds, like the host', () => {
  assert.equal(formatBalance('1.239', '\u00a5'), '\u00a51.23');
  assert.equal(formatBalance('9.999', '\u00a5'), '\u00a59.99');
});

test('addAmounts is exact where floating point is not', () => {
  assert.equal(addAmounts(['0.1', '0.2']), '0.3');
  assert.equal(addAmounts(['0.1', '0.2', '0.3']), '0.6');
  assert.equal(addAmounts(['1.005', '2.005']), '3.010');
  assert.equal(addAmounts(['999999999999.99', '0.01']), '1000000000000.00');
  assert.equal(addAmounts(['-1.5', '2']), '0.5');
  assert.equal(addAmounts([]), null);
  assert.equal(addAmounts(['bogus']), null);
});

test('compareAmounts orders decimal strings by value', () => {
  assert.equal(compareAmounts('0.09', '0.1'), -1);
  assert.equal(compareAmounts('10', '9.99'), 1);
  assert.equal(compareAmounts('1.50', '1.5'), 0);
  assert.equal(compareAmounts('bogus', '1'), -1);
});

test('symbolOf maps the two supported currencies', () => {
  assert.equal(symbolOf('CNY'), '\u00a5');
  assert.equal(symbolOf('USD'), '$');
  assert.equal(symbolOf('EUR'), '');
});

test('unwrapRemoteResult lifts the operation envelope a Direct Remote call returns', () => {
  const payload = { status: 'ready', value: [{ currency: 'CNY', balance: '1.00' }], bonusWallets: [] };
  assert.deepEqual(unwrapRemoteResult({ ok: true, value: payload }), { ok: true, value: payload });
  assert.deepEqual(unwrapRemoteResult({ ok: true, value: null }), { ok: true, value: null });
  const error = { code: 'gateway/internal', message: 'boom' };
  assert.deepEqual(unwrapRemoteResult({ ok: false, error }), { ok: false, error });
  // A bare payload still reaches the readout instead of being mistaken for a failure.
  assert.deepEqual(unwrapRemoteResult(payload), { ok: true, value: payload });
  assert.deepEqual(unwrapRemoteResult(null), { ok: true, value: null });
});

test('reading the envelope as if it were the payload is the bug this guards', () => {
  // What the transport actually resolves to; `.status` is not on it.
  const envelope = { ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '11.20' }], bonusWallets: [] } };
  assert.equal(walletSummary(envelope).kind, 'unrecognized');
  assert.equal(walletSummary(unwrapRemoteResult(envelope).value).kind, 'ready');
  assert.equal(walletSummary(unwrapRemoteResult(envelope).value).display, '\u00a511.20');
});

test('walletSummary reports an unexpected answer instead of hiding it', () => {
  const summary = walletSummary({ ok: true, value: 3 });
  assert.equal(summary.kind, 'unrecognized');
  assert.match(summary.detail, /status=undefined/);
  assert.match(summary.detail, /keys\[/);
  const scalar = walletSummary('nonsense');
  assert.equal(scalar.kind, 'unrecognized');
  assert.equal(scalar.detail, 'string');
});

test('walletSummary carries the reason a query failed', () => {
  assert.equal(walletSummary({ status: 'failed' }).detail, 'no error detail');
  assert.equal(walletSummary({ status: 'failed', error: new Error('boom') }).detail, 'boom');
  assert.equal(walletSummary({ status: 'failed', error: { code: 'network', message: 'offline' } }).detail, 'network: offline');
  assert.equal(walletSummary({ status: 'failed', error: 'plain' }).detail, 'plain');
});

test('walletSummary separates signed-out, failure and capability states', () => {
  assert.equal(walletSummary(undefined).kind, 'pending');
  assert.equal(walletSummary(null).kind, 'signed-out');
  assert.equal(walletSummary({ status: 'failed' }).kind, 'failed');
  assert.equal(walletSummary({ unsupported: true }).kind, 'unsupported');
  assert.equal(walletSummary({ status: 'ready', value: [], bonusWallets: [] }).kind, 'empty');
});

test('walletSummary totals the topped-up and granted wallets of one currency', () => {
  const summary = walletSummary({
    status: 'ready',
    value: [{ currency: 'CNY', balance: '10.00' }],
    bonusWallets: [{ currency: 'CNY', balance: '2.50' }],
  });
  assert.equal(summary.kind, 'ready');
  assert.equal(summary.currency, 'CNY');
  assert.equal(summary.display, '\u00a512.50');
  assert.equal(summary.recharge, '\u00a510.00');
  assert.equal(summary.bonus, '\u00a52.50');
  assert.deepEqual(summary.others, []);
  assert.equal(summary.low, false);
});

test('walletSummary makes the largest currency primary and lists the rest', () => {
  const summary = walletSummary({
    status: 'ready',
    value: [{ currency: 'CNY', balance: '1.00' }, { currency: 'USD', balance: '20.00' }],
    bonusWallets: [],
  });
  assert.equal(summary.currency, 'USD');
  assert.equal(summary.display, '$20.00');
  assert.deepEqual(summary.others, ['\u00a51.00']);
});

test('walletSummary flags a reserve at or below the alert threshold', () => {
  const wallet = balance => walletSummary({ status: 'ready', value: [{ currency: 'CNY', balance }], bonusWallets: [] });
  assert.equal(wallet(String(LOW_BALANCE)).low, true);
  assert.equal(wallet('0').low, true);
  assert.equal(wallet(String(LOW_BALANCE + 0.01)).low, false);
});

test('walletSummary ignores malformed wallet rows without losing the rest', () => {
  const summary = walletSummary({
    status: 'ready',
    value: [null, { currency: 'CNY' }, { currency: 'CNY', balance: '3.00' }, 'nope'],
    bonusWallets: [{ currency: 'CNY', balance: 'oops' }],
  });
  assert.equal(summary.display, '\u00a53.00');
});
