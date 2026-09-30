/**
 * Remaining-balance reading for the "active time" readout.
 *
 * The source is `ctx.remote.account.getBalance()`, whose result is one of:
 *   - `null`                     signed out, or the account grant changed;
 *   - `{ status: 'ready', value: Wallet[], bonusWallets: Wallet[] }`;
 *   - `{ status: 'failed' }`.
 * Amounts stay decimal strings. This module adds and formats them with exact
 * integer arithmetic so the number matches DeepSeek Harness's own account page
 * instead of drifting through floating point.
 */

const SYMBOLS = { CNY: '\u00a5', USD: '$' };

/** Balances at or below this amount raise the low-reserve alert. */
export const LOW_BALANCE = 5;

/** Truncate a decimal string to cents. Grouping matches the host account page. */
function parseDecimal(text) {
  if (typeof text !== 'string') return null;
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text.trim());
  if (match === null) return null;
  const integer = match[2] ?? '';
  const fraction = match[3] ?? '';
  if (integer === '' && fraction === '') return null;
  return {
    negative: match[1] === '-',
    digits: BigInt(`${integer === '' ? '0' : integer}${fraction}`),
    scale: fraction.length,
  };
}

/** Signed magnitude of one parsed decimal, scaled to the same exponent as `scale`. */
function scaledValue(parsed, scale) {
  const magnitude = parsed.digits * 10n ** BigInt(scale - parsed.scale);
  return parsed.negative ? -magnitude : magnitude;
}

/** Exact sum of decimal strings; returns a decimal string, or null when none parses. */
export function addAmounts(amounts) {
  let total = 0n;
  let scale = 0;
  let seen = false;
  for (const amount of amounts) {
    const parsed = typeof amount === 'string' ? parseDecimal(amount) : amount;
    if (parsed === null) continue;
    if (!seen) {
      total = parsed.negative ? -parsed.digits : parsed.digits;
      scale = parsed.scale;
      seen = true;
      continue;
    }
    const next = Math.max(scale, parsed.scale);
    total = total * 10n ** BigInt(next - scale) + scaledValue(parsed, next);
    scale = next;
  }
  if (!seen) return null;
  return decimalsToText({ digits: total, scale });
}

function decimalsToText({ digits, scale }) {
  const negative = digits < 0n;
  const text = (negative ? -digits : digits).toString().padStart(scale + 1, '0');
  const body = scale === 0 ? text : `${text.slice(0, text.length - scale)}.${text.slice(text.length - scale)}`;
  return negative ? `-${body}` : body;
}

function group(integer) {
  const digits = String(integer);
  const groups = [];
  for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
  return groups.join(',');
}

/**
 * Format one amount exactly like DeepSeek Harness's account page: two decimals,
 * truncation rather than rounding, `<symbol>0.01` below one cent, and grouped
 * whole digits.
 * @param amount - validated decimal balance string.
 * @param symbol - currency symbol.
 * @returns display text, or null when the amount is not parsable.
 */
export function formatBalance(amount, symbol) {
  const parsed = typeof amount === 'string' ? parseDecimal(amount) : amount;
  if (parsed === null) return null;
  const zero = parsed.digits === 0n;
  const cents = (parsed.digits * 100n) / 10n ** BigInt(parsed.scale);
  if (zero) return `${symbol}0.00`;
  if (parsed.negative) return cents === 0n ? `-${symbol}0.01` : `-${symbol}${group(cents / 100n)}.${String(cents % 100n).padStart(2, '0')}`;
  if (cents === 0n) return `<${symbol}0.01`;
  return `${symbol}${group(cents / 100n)}.${String(cents % 100n).padStart(2, '0')}`;
}

export function symbolOf(currency) {
  return SYMBOLS[currency] ?? '';
}

function walletsOf(value) {
  return Array.isArray(value) ? value.filter(wallet => wallet !== null && typeof wallet === 'object') : [];
}

/**
 * Reduce one `getBalance` result into the readout the HUD shows.
 * @param result - the remote result, or undefined before the first answer.
 * @returns `{ kind, symbol, currency, display, recharge, bonus, others, low, detail }`.
 *   `kind` is `pending | ready | empty | signed-out | failed | unsupported | unrecognized`.
 *   `detail` is a short human-readable discriminator the panel prints, so an
 *   unexpected answer is visible instead of being folded into "still reading".
 */
export function walletSummary(result) {
  const blank = kind => ({ kind, display: null, symbol: null, currency: null, recharge: null, bonus: null, others: [], low: false, detail: null });
  if (result === undefined) return blank('pending');
  if (result === null) return blank('signed-out');
  if (result.unsupported === true) return blank('unsupported');
  if (result.status === 'failed') return { ...blank('failed'), detail: describeFailure(result.error) };
  if (result.status !== 'ready') return { ...blank('unrecognized'), detail: describeResult(result) };

  const recharge = walletsOf(result.value);
  const bonus = walletsOf(result.bonusWallets);
  const byCurrency = new Map();
  for (const [bucket, list] of [['recharge', recharge], ['bonus', bonus]]) {
    for (const wallet of list) {
      const currency = typeof wallet.currency === 'string' ? wallet.currency : '';
      const entry = byCurrency.get(currency) ?? { currency, recharge: [], bonus: [] };
      if (typeof wallet.balance === 'string') entry[bucket].push(wallet.balance);
      byCurrency.set(currency, entry);
    }
  }
  if (byCurrency.size === 0) return { ...blank('empty'), detail: describeResult(result) };

  const ranked = [...byCurrency.values()]
    .map(entry => {
      const rechargeTotal = addAmounts(entry.recharge);
      const bonusTotal = addAmounts(entry.bonus);
      return { ...entry, rechargeTotal, bonusTotal, total: addAmounts([rechargeTotal ?? '0', bonusTotal ?? '0']) };
    })
    .sort((left, right) => compareAmounts(right.total, left.total));

  const primary = ranked[0];
  const symbol = symbolOf(primary.currency);
  const display = formatBalance(primary.total ?? '0', symbol);
  const others = ranked.slice(1).map(entry => formatBalance(entry.total ?? '0', symbolOf(entry.currency)));
  return {
    kind: 'ready',
    currency: primary.currency,
    symbol,
    display,
    recharge: formatBalance(primary.rechargeTotal ?? '0', symbol),
    bonus: formatBalance(primary.bonusTotal ?? '0', symbol),
    others: others.filter(text => text !== null),
    low: isLow(primary.total),
    detail: null,
  };
}

/**
 * Short discriminator for an answer we did not expect, so the panel reports the
 * shape it actually received instead of hiding it behind "still reading".
 * Only structural facts and the status string are used; no amount is copied.
 */
export function describeResult(result) {
  if (result === null) return 'null';
  if (result === undefined) return 'undefined';
  if (typeof result !== 'object') return typeof result;
  const keys = Object.keys(result).slice(0, 6).join(',');
  const status = typeof result.status === 'string' ? result.status : typeof result.status;
  return `keys[${keys}] status=${status}`;
}

/** Short discriminator for a rejected query. */
export function describeFailure(error) {
  if (error === undefined || error === null) return 'no error detail';
  if (typeof error === 'string') return error.slice(0, 120);
  const message = typeof error.message === 'string' && error.message !== '' ? error.message : String(error);
  const code = typeof error.code === 'string' ? `${error.code}: ` : '';
  return `${code}${message}`.slice(0, 120);
}

/** Compare two decimal strings by value. Unparsable input ranks lowest. */
export function compareAmounts(left, right) {
  const a = typeof left === 'string' ? parseDecimal(left) : left;
  const b = typeof right === 'string' ? parseDecimal(right) : right;
  if (a === null) return b === null ? 0 : -1;
  if (b === null) return 1;
  const scale = Math.max(a.scale, b.scale);
  const x = scaledValue(a, scale);
  const y = scaledValue(b, scale);
  if (x === y) return 0;
  return x < y ? -1 : 1;
}

function isLow(total) {
  if (typeof total !== 'string') return false;
  return compareAmounts(total, String(LOW_BALANCE)) <= 0;
}
