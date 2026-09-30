import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/**
 * Minimal React stand-in: builds a walkable element tree, and records the refs
 * and effects a component creates so the mount effect can be RUN here. Effects
 * are never executed automatically — the test decides when.
 */
function createReact(record = { refs: [], effects: [] }) {
  return {
    record,
    createElement(type, props, ...children) {
      const next = { ...(props ?? {}) };
      if (children.length === 1) next.children = children[0];
      else if (children.length > 1) next.children = children;
      return { type, props: next, children };
    },
    useRef(initial) {
      const ref = { current: initial ?? null };
      record.refs.push(ref);
      return ref;
    },
    useEffect(callback) {
      record.effects.push(callback);
      return () => {};
    },
    useState: initial => [initial, () => {}],
    Component: class { constructor(props) { this.props = props; } },
    Fragment: Symbol('Fragment'),
  };
}

function loadBundle() {
  const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8');
  const registered = [];
  const fakeWindow = { __ModuleLoader__: { load: spec => registered.push(spec) } };
  // The bundle is a browser artifact; evaluating it against a stub window is the
  // only way to exercise the factory without a page.
  new Function('window', source)(fakeWindow);
  return registered;
}

/** Walk an element tree, calling function components (effects are not run here). */
function walk(node, React, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out;
  if (Array.isArray(node)) { for (const child of node) walk(child, React, out); return out; }
  const { type, props, children } = node;
  if (typeof type === 'function') {
    if (React.Component.prototype.isPrototypeOf(type.prototype)) {
      walk(new type(props).render(), React, out);
      return out;
    }
    walk(children.length > 0 ? type({ ...props, children: children[0] }) : type(props), React, out);
    return out;
  }
  out.push(node);
  for (const child of children) walk(child, React, out);
  return out;
}

function loadPlugin(React = createReact()) {
  const registered = loadBundle();
  assert.equal(registered.length, 1, 'the bundle registers exactly one module factory');
  const spec = registered[0];
  const plugin = spec.factory(id => {
    if (id === 'react') return React;
    throw new Error(`the bundle must not require anything but react; asked for ${id}`);
  });
  return { spec, plugin, React };
}

/** A client context with just the surfaces the adapter and controller touch. */
function fakeCtx() {
  const subscriptions = [];
  const ctx = {
    connection: {
      state: {
        getSnapshot: () => 'connected',
        subscribe(listener) {
          subscriptions.push(listener);
          return () => { subscriptions.splice(subscriptions.indexOf(listener), 1); };
        },
      },
    },
    sessions: {
      retained: [],
      retain(id, options) {
        ctx.sessions.retained.push({ id, options });
        const face = { getSnapshot: () => undefined, subscribe: () => () => {} };
        return {
          binding: { session: { projections: { faceOf: () => face } } },
          ready: Promise.resolve(),
          release: () => {},
        };
      },
    },
    locale: { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {} },
    // Stands in for the `remote.account` namespace the plugin-level inject
    // declaration guarantees; there is deliberately no `ctx.inject` and no
    // `ctx.get` here, so a regression to either would fail loudly.
    balances: [],
    remote: {
      account: {
        getBalance(metadata) {
          ctx.balances.push(metadata);
          // A Direct Remote method answers with an operation envelope, not the payload.
          return { ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '42.30' }], bonusWallets: [] } };
        },
      },
    },
    subscriptionCount: () => subscriptions.length,
  };
  return ctx;
}

function applyPlugin(plugin, ctx) {
  const registered = [];
  const injected = [];
  ctx.slots = {
    inject(ownerKey, callback) { injected.push({ ownerKey, callback }); return () => {}; },
    register(options, component) { registered.push({ options, component }); return () => {}; },
  };
  plugin.apply(ctx);
  assert.equal(injected.length, 1);
  assert.equal(injected[0].ownerKey, 'shell.overlay');
  injected[0].callback();
  assert.equal(registered.length, 1);
  return registered[0];
}

function stubWidget() {
  return {
    updates: [],
    languages: [],
    disposed: false,
    update(view) { this.updates.push(view); },
    setLanguage(language) { this.languages.push(language); },
    dispose() { this.disposed = true; },
  };
}

test('the bundle registers exactly one factory under the package name', () => {
  const { spec } = loadPlugin();
  assert.equal(spec.id, pkg.name);
  assert.equal(typeof spec.factory, 'function');
});

test('the plugin declares every client service and Remote namespace it reads', () => {
  const { plugin } = loadPlugin();
  assert.deepEqual([...plugin.inject].sort(),
    ['connection', 'locale', 'remote', 'remote.account', 'sessions', 'slots'],
    'a Remote namespace is read only when the same fiber declares it');
  assert.equal(typeof plugin.apply, 'function');
});

test('apply registers one entry in the frame-wide overlay slot', () => {
  const { plugin } = loadPlugin();
  const entry = applyPlugin(plugin, fakeCtx());
  assert.deepEqual(entry.options, { name: 'shell.overlay', id: 'xxnerv-eva', order: 90 });
  assert.equal(typeof entry.component, 'function');
});

test('the registered component renders the unit mount point with and without a session catalog', () => {
  const { plugin, React } = loadPlugin();
  const entry = applyPlugin(plugin, fakeCtx());

  const withCatalog = walk(entry.component({ useSessions: selector => selector({ byId: {} }) }), React);
  assert.ok(withCatalog.some(element => element.props?.['data-eva-unit'] === 'mounted'), 'linked path mounts the unit');

  const detached = walk(entry.component({}), React);
  assert.ok(detached.some(element => element.props?.['data-eva-unit'] === 'mounted'), 'detached path still mounts the unit');
});

/**
 * Effects own a 60s polling interval, so a cleanup skipped by a failed
 * assertion would keep the test process alive forever. Every test that runs an
 * effect disposes it in a `finally`.
 */
function mountUnit({ plugin, ctx, React, widget, componentProps = {} }) {
  const entry = applyPlugin(plugin, ctx);
  walk(entry.component({ createWidget: () => widget, ...componentProps }), React);
  React.record.refs[0].current = { id: 'host' };
  const cleanup = React.record.effects[0]();
  return { entry, cleanup };
}

test('the mount effect builds the unit, wires the controller, and tears everything down', async () => {
  const React = createReact();
  const { plugin } = loadPlugin(React);
  const ctx = fakeCtx();
  const entry = applyPlugin(plugin, ctx);
  const catalog = { byId: { s1: { id: 's1', retainedBy: { mainView: 1 } } } };
  const widget = stubWidget();

  walk(entry.component({
    useSessions: selector => selector(catalog),
    createWidget: (host, options) => {
      assert.equal(host, React.record.refs[0].current);
      assert.equal(options.language, 'zh', 'the unit starts in the DSH language');
      assert.equal(typeof options.css, 'string');
      assert.ok(options.art.includes('<svg'));
      return widget;
    },
  }), React);

  assert.equal(React.record.refs.length, 2, 'the host ref and the controller ref');
  assert.equal(React.record.effects.length, 2, 'the mount effect and the catalog effect');

  // Give the host ref a value, as React does before effects run.
  React.record.refs[0].current = { id: 'host' };
  const cleanup = React.record.effects[0]();
  try {
    assert.equal(typeof cleanup, 'function');
    assert.ok(widget.updates.length > 0, 'the controller publishes the first view');
    assert.equal(ctx.subscriptionCount(), 1, 'the connection state is observed');

    // The catalog effect hands the snapshot to the controller, which retains the shown session.
    React.record.effects[1]();
    assert.deepEqual(ctx.sessions.retained, [{ id: 's1', options: { source: 'evaCompanion' } }]);

    // The namespace is read on the next microtask, not synchronously.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ctx.balances.length, 1, 'the declared namespace is read without any injection scope');
    assert.equal(ctx.balances[0].locale, 'zh');
    assert.equal(widget.updates[widget.updates.length - 1].active.display, '\u00a542.30');
  } finally {
    cleanup();
  }
  assert.equal(widget.disposed, true, 'the unit is disposed with the entry');
  assert.equal(ctx.subscriptionCount(), 0, 'no subscription survives the cleanup');
});

test('a namespace without a usable getBalance degrades instead of breaking the entry', () => {
  const React = createReact();
  const { plugin } = loadPlugin(React);
  const ctx = fakeCtx();
  ctx.remote.account = {};
  const widget = stubWidget();
  const { cleanup } = mountUnit({ plugin, ctx, React, widget });

  try {
    assert.equal(widget.updates[widget.updates.length - 1].balance.kind, 'unsupported');
    assert.equal(widget.updates[widget.updates.length - 1].active.display, null);
  } finally {
    cleanup();
  }
});

test('the balance readout follows the published view into the widget', async () => {
  const React = createReact();
  const { plugin } = loadPlugin(React);
  const ctx = fakeCtx();
  const widget = stubWidget();
  const { cleanup } = mountUnit({ plugin, ctx, React, widget });

  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(widget.updates[widget.updates.length - 1].active.display, '\u00a542.30');
  } finally {
    cleanup();
  }
});

test('a throwing session hook is contained by the entry boundary', () => {
  const { plugin, React } = loadPlugin();
  const entry = applyPlugin(plugin, fakeCtx());
  const boom = () => { throw new Error('catalog unavailable'); };

  const tree = entry.component({ useSessions: boom });
  const Boundary = tree.type;
  assert.equal(Boundary.getDerivedStateFromError().failed, true);

  const instance = new Boundary(tree.props);
  assert.equal(instance.state.failed, false);
  instance.state = { failed: true };
  assert.equal(instance.render(), null, 'a failed entry renders nothing instead of blanking the overlay');

  assert.throws(() => walk(tree, React), /catalog unavailable/);
});

test('the bundle carries the validated artwork, the stylesheet and the plugin factory', () => {
  const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8');
  assert.match(source, /^\/\/ Generated by tools\/build\.mjs/);
  assert.ok(source.includes('<svg'), 'the unit artwork is inlined');
  assert.ok(source.includes(':host'), 'the HUD stylesheet is inlined');
  assert.ok(source.includes('return createPlugin(require, ASSETS, CSS);'));
  assert.ok(!/^\s*(?:import|export)\s/m.test(source), 'no module statements survive bundling');
  assert.ok(!/\bimport\.meta\b/.test(source), 'no import.meta in a classic bundle');
});
