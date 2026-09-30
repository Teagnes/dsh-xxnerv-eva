/**
 * Pure view model: every fact the panel renders is derived here, so the panel
 * stays a dumb painter and the whole readout can be unit-tested without a DOM.
 */
import { syncReading } from './usage.js';
import { walletSummary } from './balance.js';
import { amountToReadout, percentToReadout } from './segments.js';

/** Badge copy key per unit state. */
const STATUS_KEYS = Object.freeze({
  linked: 'hud.state.normal',
  alert: 'hud.state.caution',
  standby: 'hud.state.standby',
  offline: 'hud.state.offline',
});

/**
 * @param input - `{ connected, usage, pressure, balanceResult, balanceUnsupported, updatedAt }`.
 *   `usage` is the session's `tokenUsage` projection value;
 *   `pressure` is its `contextPressure` projection value;
 *   `updatedAt` is the catalog row's durable activity timestamp.
 * @returns the complete panel view.
 */
export function deriveView(input) {
  const connected = input.connected !== false;
  const sync = syncReading(input.usage);
  const balance = walletSummary(input.balanceUnsupported === true ? { unsupported: true } : input.balanceResult);
  const power = powerReading(input.pressure);
  const activeTone = balanceTone(balance);

  let state;
  if (!connected) state = 'offline';
  else if (sync.text === null) state = 'standby';
  else if (sync.tone === 'low' || balance.low) state = 'alert';
  else state = 'linked';

  return {
    state,
    status: { key: STATUS_KEYS[state], tone: state },
    sync: { text: sync.text, tone: sync.tone, tokens: sync.tokens, cells: percentToReadout(sync.text) },
    active: { display: balance.display, tone: activeTone, kind: balance.kind, cells: amountToReadout(balance.display) },
    balance,
    power,
    info: {
      updated: formatStamp(input.updatedAt),
      tokens: formatCount(billedTotal(sync.tokens)),
    },
  };
}

/** Prompt-side tokens plus output: what this session has actually billed. */
export function billedTotal(tokens) {
  if (tokens === undefined || tokens === null) return 0;
  return tokens.prompt + tokens.output;
}

/**
 * Occupancy of the model's context window, from the `contextPressure` projection.
 * @param pressure - `{ pressureTokens?, projectedTokens?, contextWindow? }`.
 * @returns `{ percent, remaining, text, remainingText, tone }`; every field is
 *   null when the composition reports no window, so the panel says so instead
 *   of drawing a made-up bar.
 */
export function powerReading(pressure) {
  const window = pressure?.contextWindow;
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens;
  if (!Number.isFinite(window) || window <= 0 || !Number.isFinite(used) || used < 0) {
    return { percent: null, remaining: null, text: null, remainingText: null, tone: 'none' };
  }
  const occupancy = Math.min(1, used / window);
  const percent = occupancy * 100;
  const remaining = (1 - occupancy) * 100;
  return {
    percent,
    remaining,
    text: `${formatTenths(percent)}%`,
    remainingText: `${formatTenths(remaining)}%`,
    tone: percent >= 85 ? 'low' : percent >= 60 ? 'mid' : 'ok',
  };
}

/** One decimal, without a trailing `.0`. */
export function formatTenths(value) {
  if (!Number.isFinite(value)) return '--';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** `2025.09.30 10:25`, matching the panel's clock-style stamps. */
export function formatStamp(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const date = new Date(ms);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function balanceTone(balance) {
  if (balance.display === null || balance.display === undefined) return 'none';
  if (balance.low) return 'low';
  if (balance.kind === 'ready') return 'ok';
  return 'none';
}

/**
 * Context-bar fill as a 0–100 number for CSS, or 0 when the window is unknown.
 *
 * The bar under the sync readout carries this rather than a second copy of the
 * sync ratio: the ratio is already the seven-segment readout directly above it,
 * so the bar is the one spare surface on the panel, and context occupancy has no
 * other home outside the settings panel.
 */
export function contextFill(power) {
  if (!Number.isFinite(power?.percent)) return 0;
  return Math.min(100, Math.max(0, power.percent));
}

/** Integers with grouped digits for the detail rows. */
export function formatCount(value) {
  const number = Number.isSafeInteger(value) && value > 0 ? value : 0;
  const digits = String(number);
  const groups = [];
  for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
  return groups.join(',');
}
