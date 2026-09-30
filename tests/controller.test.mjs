import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EvaController, selectedSessionId } from '../src/controller.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

function createFace() {
  let value;
  const listeners = new Set();
  return {
    key: undefined,
    getSnapshot: () => value,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit(next) { value = next; for (const listener of [...listeners]) listener(); },
  };
}

function harness({ connected = true, remote } = {}) {
  let state = connected ? 'connected' : 'disconnected';
  const stateListeners = new Set();
  const retained = [];
  const released = [];
  // One identity-stable face per projection key, as the real store provides.
  const faces = {};
  const faceOf = key => (faces[key] ??= createFace());
  const ctx = {
    connection: {
      state: {
        getSnapshot: () => state,
        subscribe: listener => { stateListeners.add(listener); return () => stateListeners.delete(listener); },
      },
    },
    sessions: {
      retain(id, options) {
        retained.push({ id, options });
        return {
          binding: { session: { projections: { faceOf } } },
          ready: Promise.resolve(),
          release: () => released.push(id),
        };
      },
    },
    get: () => remote,
  };
  const views = [];
  const widget = { update: view => views.push(view) };
  return {
    ctx,
    widget,
    views,
    retained,
    released,
    faces,
    last: () => views[views.length - 1],
    disconnect() { state = 'disconnected'; for (const listener of [...stateListeners]) listener(); },
    connect() { state = 'connected'; for (const listener of [...stateListeners]) listener(); },
  };
}

const catalogWith = id => ({ byId: { [id]: { id, retainedBy: { mainView: 1 } } } });

test('selectedSessionId reads the session the main view retains', () => {
  assert.equal(selectedSessionId(undefined), undefined);
  assert.equal(selectedSessionId({ byId: {} }), undefined);
  assert.equal(selectedSessionId({ byId: { a: { id: 'a', retainedBy: {} } } }), undefined);
  assert.equal(selectedSessionId({ byId: { a: { id: 'a', retainedBy: { mainView: 2 } }, b: { id: 'b' } } }), 'a');
});

test('the controller retains the shown session and follows its tokenUsage projection', async () => {
  const h = harness();
  const controller = new EvaController(h.ctx, h.widget, { balanceIntervalMs: 10_000_000 });
  controller.start();

  assert.equal(h.last().balance.kind, 'pending');
  assert.equal(h.last().state, 'standby');

  controller.setCatalog(catalogWith('s1'));
  await flush();

  assert.equal(h.retained.length, 1);
  assert.deepEqual(h.retained[0], { id: 's1', options: { source: 'evaCompanion' } });
  assert.ok(h.faces.tokenUsage, 'the tokenUsage projection is followed');
  assert.ok(h.faces.contextPressure, 'the contextPressure projection is followed too');

  h.faces.tokenUsage.emit({ uncachedInputTokens: 250, cacheReadTokens: 750, outputTokens: 10 });
  assert.equal(h.last().sync.text, '75');
  assert.equal(h.last().state, 'linked');

  controller.dispose();
  assert.deepEqual(h.released, ['s1']);
});

test('the controller releases the previous session when the shown session changes', async () => {
  const h = harness();
  const controller = new EvaController(h.ctx, h.widget, { balanceIntervalMs: 10_000_000 });
  controller.start();
  controller.setCatalog(catalogWith('s1'));
  await flush();
  controller.setCatalog(catalogWith('s2'));
  await flush();

  assert.equal(h.retained.length, 2);
  assert.deepEqual(h.released, ['s1']);
  assert.equal(h.last().state, 'standby');

  controller.dispose();
  assert.deepEqual(h.released, ['s1', 's2']);
});

test('the controller goes offline when the host connection drops and recovers', async () => {
  const h = harness();
  const controller = new EvaController(h.ctx, h.widget, { balanceIntervalMs: 10_000_000 });
  controller.start();
  controller.setCatalog(catalogWith('s1'));
  await flush();
  h.faces.tokenUsage.emit({ uncachedInputTokens: 100, cacheReadTokens: 900 });

  h.disconnect();
  assert.equal(h.last().state, 'offline');
  h.connect();
  assert.equal(h.last().state, 'linked');
  controller.dispose();
});

test('the controller surfaces a session that reports no prompt-side usage', async () => {
  const h = harness();
  const controller = new EvaController(h.ctx, h.widget, { balanceIntervalMs: 10_000_000 });
  controller.start();
  controller.setCatalog(catalogWith('s1'));
  await flush();
  h.faces.tokenUsage.emit({ uncachedInputTokens: 0, cacheReadTokens: 0, outputTokens: 5 });
  assert.equal(h.last().sync.text, null);
  assert.equal(h.last().state, 'standby');
  controller.dispose();
});

test('attachBalance reads the remote account namespace and paints the remaining balance', async () => {
  const calls = [];
  const remote = {
    account: {
      getBalance(metadata) {
        calls.push(metadata);
        return Promise.resolve({ ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '42.30' }], bonusWallets: [] } });
      },
    },
  };
  const h = harness();
  const controller = new EvaController(h.ctx, h.widget, {
    balanceIntervalMs: 10_000_000,
    locale: { getSnapshot: () => ({ active: 'zh-CN' }) },
  });
  controller.start();
  controller.setCatalog(catalogWith('s1'));
  await flush();
  h.faces.tokenUsage.emit({ uncachedInputTokens: 100, cacheReadTokens: 900 });

  const detach = controller.attachBalance(remote);
  await flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].locale, 'zh-CN');
  assert.equal(typeof calls[0].version, 'string');
  assert.equal(calls[0].timezoneOffsetSeconds, -new Date().getTimezoneOffset() * 60);
  assert.equal(h.last().active.display, '\u00a542.30');
  assert.equal(h.last().state, 'linked');

  detach();
  controller.dispose();
});

test('attachBalance reports a remote without a usable namespace as unsupported', () => {
  const h = harness();
  const controller = new EvaController(h.ctx, h.widget, { balanceIntervalMs: 10_000_000 });
  controller.start();

  const detach = controller.attachBalance(undefined);
  assert.equal(h.last().balance.kind, 'unsupported', 'the capability answer is immediate, not a retry loop');
  assert.equal(h.last().active.display, null);

  controller.attachBalance({ account: { getBalance: 'not a function' } });
  assert.equal(h.last().balance.kind, 'unsupported');

  detach();
  controller.dispose();
});

test('a later attach replaces the earlier channel instead of stacking one', async () => {
  const h = harness();
  const controller = new EvaController(h.ctx, h.widget, { balanceIntervalMs: 10_000_000 });
  controller.start();
  const first = controller.attachBalance({});
  assert.equal(h.last().balance.kind, 'unsupported');

  controller.attachBalance({ account: { getBalance: () => ({ ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '7.00' }], bonusWallets: [] } }) } });
  await flush();
  assert.equal(h.last().balance.kind, 'ready');
  assert.equal(h.last().active.display, '\u00a57.00');

  // The superseded disposer must not tear down the live channel.
  first();
  assert.equal(controller.channel === undefined, false);
  controller.dispose();
});

test('attachBalance reports a failed balance query without losing the sync readout', async () => {
  const remote = { account: { getBalance: () => ({ ok: true, value: { status: 'failed' } }) } };
  const h = harness();
  const controller = new EvaController(h.ctx, h.widget, { balanceIntervalMs: 10_000_000 });
  controller.start();
  controller.setCatalog(catalogWith('s1'));
  await flush();
  h.faces.tokenUsage.emit({ uncachedInputTokens: 100, cacheReadTokens: 900 });
  controller.attachBalance(remote);
  await flush();

  assert.equal(h.last().balance.kind, 'failed');
  assert.equal(h.last().sync.text, '90');
  controller.dispose();
});

test('a failed envelope becomes a failure readout carrying the gateway error', async () => {
  const remote = {
    account: {
      getBalance: () => ({ ok: false, error: { code: 'gateway/internal', message: 'account balance failed' } }),
    },
  };
  const h = harness();
  const controller = new EvaController(h.ctx, h.widget, { balanceIntervalMs: 10_000_000 });
  controller.start();
  controller.attachBalance(remote);
  await flush();

  assert.equal(h.last().balance.kind, 'failed');
  assert.equal(h.last().balance.detail, 'gateway/internal: account balance failed');
  controller.dispose();
});

test('a query that never answers is abandoned by the watchdog, not left pending', async () => {
  const h = harness();
  const never = { account: { getBalance: () => new Promise(() => {}) } };
  const controller = new EvaController(h.ctx, h.widget, { balanceIntervalMs: 10_000_000, balanceRetryMs: 10_000_000, balanceTimeoutMs: 5 });
  controller.start();
  controller.attachBalance(never);
  assert.equal(h.last().balance.kind, 'pending', 'pending until the watchdog decides');

  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(h.last().balance.kind, 'failed');
  assert.match(h.last().balance.detail, /did not answer within 5ms/);
  controller.dispose();
});

test('a failed first call retries quickly instead of waiting for the next poll', async () => {
  const h = harness();
  let attempts = 0;
  const flaky = {
    account: {
      getBalance() {
        attempts += 1;
        if (attempts === 1) throw new Error('transport not open yet');
        return { ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '9.99' }], bonusWallets: [] } };
      },
    },
  };
  const controller = new EvaController(h.ctx, h.widget, {
    balanceIntervalMs: 10_000_000,
    balanceRetryMs: 5,
    balanceTimeoutMs: 50,
  });
  controller.start();
  controller.attachBalance(flaky);
  await flush();
  assert.equal(h.last().balance.kind, 'failed', 'the first attempt fails');

  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(attempts, 2, 'the quick retry ran without waiting for the 60s poll');
  assert.equal(h.last().balance.kind, 'ready');
  assert.equal(h.last().active.display, '\u00a59.99');
  controller.dispose();
});

test('refreshBalance is a no-op without a channel and forwards with one', async () => {
  const h = harness();
  const controller = new EvaController(h.ctx, h.widget, { balanceIntervalMs: 10_000_000 });
  controller.start();
  await controller.refreshBalance();

  let calls = 0;
  const remote = { account: { getBalance: () => { calls += 1; return { ok: true, value: null }; } } };
  controller.attachBalance(remote);
  await flush();
  await controller.refreshBalance();
  assert.equal(calls, 2);
  assert.equal(h.last().balance.kind, 'signed-out');
  controller.dispose();
});

test('a disposed controller ignores later work', async () => {
  const h = harness();
  const controller = new EvaController(h.ctx, h.widget, { balanceIntervalMs: 10_000_000 });
  controller.start();
  const before = h.views.length;
  controller.dispose();
  controller.setCatalog(catalogWith('s1'));
  controller.publish();
  assert.equal(h.retained.length, 0);
  assert.equal(h.views.length, before);
});
