/**
 * DSH binding for the unit.
 *
 * This is the only file that knows the client contract: it registers one entry
 * in the frame-wide `shell.overlay` list slot, mounts the shadow-DOM widget
 * inside that entry, and hands every DSH fact to the controller.
 *
 * Every component is declared INSIDE `apply(ctx)`. That is deliberate: the
 * mount effect needs the client context, and a component declared at factory
 * scope would reference `ctx` as a free variable — a ReferenceError that no
 * syntax check and no render-only test can see.
 */
import { EvaWidget } from './widget.js';
import { EvaController } from './controller.js';
import { normalizeLanguage } from './i18n.js';
import { clientVersion } from './account.js';

/** Slot entry id, unique among this profile's `shell.overlay` entries. */
export const ENTRY_ID = 'xxnerv-eva';

export function readDshLanguage(locale) {
  try { return normalizeLanguage(locale?.getSnapshot?.().active); } catch { return 'en'; }
}

export function observeDshLanguage(locale, onLanguage) {
  let alive = true;
  let previous;
  const publish = () => {
    if (!alive) return;
    const next = readDshLanguage(locale);
    if (next !== previous) { previous = next; onLanguage(next); }
  };
  let unsubscribe = () => {};
  try { unsubscribe = locale?.subscribe?.(publish) ?? (() => {}); } catch { unsubscribe = () => {}; }
  publish();
  return () => { if (!alive) return; alive = false; unsubscribe(); };
}

/** Default unit construction, shared by every entry occurrence. */
function createUnit(host, options) {
  return new EvaWidget(host, options);
}

export function createPlugin(require, assets, css) {
  const React = require('react');
  const h = React.createElement;

  return {
    // DSH registers every Remote namespace as its own Cordis service, so
    // `remote.account` is declared here exactly as every shipped consumer
    // (`dsh-client-ui-settings-account`, `dsh-client-ui-commands`,
    // `dsh-client-ui-sidebar-documentpreview`) declares it. Declaring `remote`
    // alone is not enough: Cordis refuses the nested read without the namespace
    // in this fiber's `inject`.
    inject: ['slots', 'sessions', 'connection', 'locale', 'remote', 'remote.account'],
    apply(ctx) {
      /**
       * One mounted unit.
       * @param props.catalog - the session catalog snapshot, or undefined.
       * @param props.createWidget - unit constructor override; the entry never
       *   sets it, and it lets the mount effect run without a browser.
       */
      function Mount({ catalog, createWidget = createUnit }) {
        const hostRef = React.useRef(null);
        const controllerRef = React.useRef(null);

        React.useEffect(() => {
          const host = hostRef.current;
          if (host === null) return undefined;
          const instance = createWidget(host, {
            art: assets.unit,
            css,
            version: `Ver.${clientVersion()}`,
            language: readDshLanguage(ctx.locale),
            onRequestBalance: () => controllerRef.current?.refreshBalance(),
          });
          const controller = new EvaController(ctx, instance, { locale: ctx.locale });
          controllerRef.current = controller;
          controller.start();

          const stopLanguage = observeDshLanguage(ctx.locale, language => instance.setLanguage(language));

          // `remote.account` is declared, so the service exists. The channel
          // re-reads `remote.account.getBalance` on every call, because the
          // gateway binds that method to its caller at property-access time.
          let stopBalance = () => {};
          try {
            stopBalance = controller.attachBalance(ctx.remote);
          } catch (error) {
            console.error('[xxnerv-eva] could not reach the remote service; the sync readout still works', error);
            controller.setBalanceStatus('unsupported');
          }

          return () => {
            stopBalance();
            stopLanguage();
            controller.dispose();
            instance.dispose();
            if (controllerRef.current === controller) controllerRef.current = null;
          };
        }, []);

        React.useEffect(() => {
          controllerRef.current?.setCatalog(catalog);
        }, [catalog]);

        return h('div', { ref: hostRef, 'data-eva-unit': 'mounted' });
      }

      function LinkedUnit({ useSessions, createWidget }) {
        const catalog = useSessions(snapshot => snapshot);
        return h(Mount, { catalog, createWidget });
      }

      /** Without the session catalog the unit still shows its balance readout. */
      function DetachedUnit({ createWidget }) {
        return h(Mount, { catalog: undefined, createWidget });
      }

      class Boundary extends React.Component {
        constructor(props) {
          super(props);
          this.state = { failed: false };
        }
        static getDerivedStateFromError() {
          return { failed: true };
        }
        componentDidCatch(error) {
          console.error('[xxnerv-eva] unit failed to mount; the overlay entry renders nothing', error);
        }
        render() {
          return this.state.failed ? null : this.props.children;
        }
      }

      function UnitRoot(props) {
        const linked = typeof props.useSessions === 'function';
        return h(Boundary, null, linked
          ? h(LinkedUnit, { useSessions: props.useSessions, createWidget: props.createWidget })
          : h(DetachedUnit, { createWidget: props.createWidget }));
      }

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: ENTRY_ID,
        order: 90,
      }, UnitRoot));
    },
  };
}
