/**
 * Seven-segment rendering.
 *
 * The big readouts are drawn, not typeset: each character becomes one cell of
 * seven absolutely-positioned bars, and a bit mask says which bars light. That
 * keeps the HUD free of any font asset and lets the whole thing be recoloured
 * and unit-tested without a browser.
 *
 * Bit order is a b c d e f g, matching {@link SEGMENT_ORDER} top-left to middle:
 *
 *       a a a
 *     f       b
 *     f       b
 *       g g g
 *     e       c
 *     e       c
 *       d d d
 */

/** Segment order as emitted into the DOM; the index is the bit position. */
export const SEGMENT_ORDER = Object.freeze(['a', 'b', 'c', 'd', 'e', 'f', 'g']);

/** Which segments each renderable character lights. */
export const SEGMENT_MASKS = Object.freeze({
  '0': 0b0111111,
  '1': 0b0000110,
  '2': 0b1011011,
  '3': 0b1001111,
  '4': 0b1100110,
  '5': 0b1101101,
  '6': 0b1111101,
  '7': 0b0000111,
  '8': 0b1111111,
  '9': 0b1101111,
  '-': 0b1000000,
  ' ': 0b0000000,
});

/** Characters that are not seven-segment cells but still occupy a slot. */
export const PUNCTUATION = Object.freeze({ ':': 'colon', '.': 'dot', '%': 'percent' });

/**
 * Split text into renderable cells.
 * @param text - anything; it is stringified.
 * @returns one entry per character: `{ kind: 'digit' | 'punct' | 'none', char, segments }`.
 *   `segments` is a 7-element boolean array in {@link SEGMENT_ORDER} order.
 */
export function segmentPlan(text) {
  const cells = [];
  for (const char of String(text ?? '')) {
    if (Object.hasOwn(SEGMENT_MASKS, char)) {
      const mask = SEGMENT_MASKS[char];
      cells.push({
        kind: 'digit',
        char,
        segments: SEGMENT_ORDER.map((_, bit) => (mask & (1 << bit)) !== 0),
      });
      continue;
    }
    if (Object.hasOwn(PUNCTUATION, char)) {
      cells.push({ kind: 'punct', char, segments: SEGMENT_ORDER.map(() => false) });
      continue;
    }
    // Unknown glyphs are dropped rather than rendered as a wrong digit.
  }
  return cells;
}

/**
 * Present an amount as the big readout: no currency symbol, and the decimal
 * point becomes a colon so the number reads like the panel's clock-style digits.
 * @param display - a `formatBalance()` string, or null.
 * @returns the digit text, or `--` when there is nothing to show.
 */
export function amountToReadout(display) {
  if (typeof display !== 'string' || display === '') return '--';
  const cleaned = display.replace(/[^\d.,-]/g, '');
  if (cleaned === '' || !/\d/.test(cleaned)) return '--';
  return cleaned.replace(/,/g, '').replace('.', ':');
}

/**
 * Present a sync ratio as the big readout: the ratio keeps its own decimal
 * point (it is a measurement, not a clock) and gains a percent mark.
 * @param text - `syncPercentText()` output, or null.
 * @returns the cell text, or `--` when no ratio is known.
 */
export function percentToReadout(text) {
  return typeof text === 'string' && text !== '' ? `${text}%` : '--';
}

/**
 * Fit every character without truncating the balance. Widths and gaps are in
 * em, matching hud.css; measuring from the plan also works while hidden.
 */
export function readoutFontSize(text, width, maximum) {
  const cells = segmentPlan(text);
  const advance = cells.reduce((sum, cell) => sum + (cell.char === '%' ? .55 : cell.kind === 'punct' ? .16 : .63), 0)
    + Math.max(0, cells.length - 1) * .035;
  return advance === 0 ? maximum : Math.floor(Math.min(maximum, width / advance) * 10) / 10;
}
