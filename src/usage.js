/**
 * Cache-hit accounting for the sync readout.
 *
 * The numerator and denominator mirror DSH's own conversation stats so the
 * companion agrees with the host's cache-hit pill:
 *   prompt side = uncachedInputTokens + cacheReadTokens + cacheWriteTokens
 *   sync ratio  = cacheReadTokens / prompt side
 *
 * `roundedPercentUnits` and `displayPercentUnits` are a faithful port of the
 * rounding used by the shipped chat stats (`dsh-client-ui-chat`, MIT), kept
 * because a partial hit must never be rounded up to a flat "100%".
 */

/** Sum the three disjoint prompt-side billing buckets of a `tokenUsage` value. */
export function billedInputTokens(usage) {
  if (usage === undefined || usage === null) return 0;
  const uncached = count(usage.uncachedInputTokens);
  const read = count(usage.cacheReadTokens);
  const write = count(usage.cacheWriteTokens);
  return uncached + read + write;
}

function count(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/**
 * Round a cache-read ratio to exact percentage units, with positive ties rounded up.
 * @param cacheReadTokens - exact prompt tokens served from cache.
 * @param denominator - exact prompt-side tokens.
 * @param decimalPlaces - 0 gives integer units, 1 gives tenths.
 */
export function roundedPercentUnits(cacheReadTokens, denominator, decimalPlaces) {
  const scale = (decimalPlaces === 0 ? 1 : 10) * 100;
  const doubledScale = scale * 2;
  const denominatorQuotient = Math.floor(denominator / doubledScale);
  const denominatorRemainder = denominator % doubledScale;
  let lower = 0;
  let upper = scale;
  while (lower < upper) {
    const candidate = Math.floor((lower + upper + 1) / 2);
    const factor = candidate * 2 - 1;
    if (cacheReadTokens >= factor * denominatorQuotient + Math.ceil(factor * denominatorRemainder / doubledScale)) lower = candidate;
    else upper = candidate - 1;
  }
  return lower;
}

export function displayPercentUnits(units, decimalPlaces) {
  if (decimalPlaces === 0) return String(units);
  const whole = Math.floor(units / 10);
  const tenths = units % 10;
  return tenths === 0 ? String(whole) : `${whole}.${tenths}`;
}

/**
 * Display text for the sync ratio, without the `%` sign.
 *
 * One decimal place is the ordinary precision. A partial hit that would round
 * to a flat 100 instead gains just enough extra digits to stay honest — the
 * same rule the host's own cache-hit readout uses, so the two agree.
 * @param cacheReadTokens - exact prompt tokens served from cache.
 * @param promptTokens - exact prompt-side tokens.
 * @returns display text, or null when nothing prompt-side was billed yet.
 */
export function syncPercentText(cacheReadTokens, promptTokens) {
  if (!Number.isSafeInteger(promptTokens) || promptTokens <= 0) return null;
  const read = Number.isSafeInteger(cacheReadTokens) && cacheReadTokens > 0 ? Math.min(cacheReadTokens, promptTokens) : 0;
  const missedInputTokens = promptTokens - read;
  if (missedInputTokens <= 0) return '100';

  const decimalPlaces = 1;
  const roundedUnits = roundedPercentUnits(read, promptTokens, decimalPlaces);
  if (roundedUnits < 1000) return displayPercentUnits(roundedUnits, decimalPlaces);

  let distinguishingPlaces = 1;
  let scaledDoubleGap = missedInputTokens * 200;
  const denominatorTens = Math.floor(promptTokens / 10);
  while (scaledDoubleGap <= denominatorTens) {
    scaledDoubleGap *= 10;
    distinguishingPlaces += 1;
  }
  const denominatorOnes = promptTokens % 10;
  let roundedLoss = 5;
  for (let loss = 1; loss < 5; loss += 1) {
    const factor = loss * 2 + 1;
    const threshold = factor * denominatorTens + Math.floor(factor * denominatorOnes / 10);
    if (scaledDoubleGap <= threshold) {
      roundedLoss = loss;
      break;
    }
  }
  return `99.${'9'.repeat(distinguishingPlaces - 1)}${10 - roundedLoss}`;
}

/**
 * Read the sync ratio out of one `tokenUsage` projection value.
 * @param usage - the session's token-usage projection value, or undefined.
 * @returns `{ available, percent, text, tone, tokens }`; `text` is null while
 * no prompt-side token was billed, which the widget renders as a standby dash.
 */
export function syncReading(usage) {
  const promptTokens = billedInputTokens(usage);
  const cacheReadTokens = count(usage?.cacheReadTokens);
  const outputTokens = count(usage?.outputTokens);
  const text = syncPercentText(cacheReadTokens, promptTokens);
  return {
    available: text !== null,
    text,
    percent: text === null ? null : text === '<100' ? 99.99 : Number(text),
    tone: syncTone(text),
    tokens: {
      prompt: promptTokens,
      cacheRead: cacheReadTokens,
      uncached: count(usage?.uncachedInputTokens),
      cacheWrite: count(usage?.cacheWriteTokens),
      output: outputTokens,
    },
  };
}

/** Sync-ratio bands: at or above HIGH is nominal, below MID raises the alert state. */
export const SYNC_HIGH = 60;
export const SYNC_MID = 30;

/** Three-band tone for the sync bar and the unit's visor color. */
export function syncTone(text) {
  if (text === null) return 'none';
  if (text === '100') return 'high';
  const value = text === '<100' ? 99.99 : Number(text);
  if (!Number.isFinite(value)) return 'none';
  if (value >= SYNC_HIGH) return 'high';
  if (value >= SYNC_MID) return 'mid';
  return 'low';
}
