/** Local display preferences. DSH stores none of these; they never leave the browser. */

export const STORAGE_KEY = 'dsh-xxnerv-eva:preferences';

/** The panel is 660×300 logical pixels, so these bounds are also pixel bounds. */
export const MIN_SCALE = 0.2;
export const MAX_SCALE = 1.5;

/**
 * The same bounds as the whole percentages the settings field speaks in.
 *
 * Rounded rather than scaled directly: the two bounds in force happen to come
 * out clean, but their neighbours do not — `0.29 * 100` is 28.999999999999996 —
 * and a bound like that would go straight into the field and the hint.
 */
export const MIN_PERCENT = Math.round(MIN_SCALE * 100);
export const MAX_PERCENT = Math.round(MAX_SCALE * 100);

export const DEFAULT_PREFERENCES = Object.freeze({
  scale: 1,
  motion: true,
  hidden: false,
  x: null,
  y: null,
});

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Accept only well-formed stored values; anything else falls back to a default. */
export function cleanPreferences(value) {
  if (value === null || typeof value !== 'object') return { ...DEFAULT_PREFERENCES };
  const scale = Number(value.scale);
  return {
    scale: Number.isFinite(scale) ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)) : DEFAULT_PREFERENCES.scale,
    motion: value.motion !== false,
    hidden: value.hidden === true,
    x: finiteOrNull(value.x),
    y: finiteOrNull(value.y),
  };
}

/** Keep the unit fully on screen, below the frame's reserved top strip. */
export function clampPosition(x, y, width, height, viewportWidth, viewportHeight, topClearance) {
  const maxX = Math.max(0, viewportWidth - width);
  const maxY = Math.max(topClearance, viewportHeight - height);
  return {
    x: Math.min(Math.max(0, Number.isFinite(x) ? x : maxX), maxX),
    y: Math.min(Math.max(topClearance, Number.isFinite(y) ? y : maxY), maxY),
  };
}

/**
 * Resolve the panel's top-left for one size.
 *
 * The stored position wins whenever the user has placed the panel. Only an
 * unplaced panel falls back to the bottom-right default, and that default is
 * derived from the CURRENT size — which is exactly why a size change must
 * anchor the position first: otherwise every step of a resize drag recomputes
 * the default from the growing panel and the frame crawls across the window.
 *
 * @param preferences - `{ x, y }`; null means "never placed".
 * @param size - `{ width, height }` at the scale being applied.
 * @param viewport - `{ width, height }`.
 */
export function resolvePosition(preferences, size, viewport, topClearance) {
  const x = preferences.x ?? viewport.width - size.width - 24;
  const y = preferences.y ?? viewport.height - size.height - 90;
  return clampPosition(x, y, size.width, size.height, viewport.width, viewport.height, topClearance);
}

/** Freeze the current top-left into the preferences so a size change cannot move it. */
export function anchorPosition(preferences, position) {
  if (position === undefined) return preferences;
  preferences.x = position.x;
  preferences.y = position.y;
  return preferences;
}

/**
 * Which edges the frame is nearest, i.e. the corner it is docked to.
 *
 * A frame sitting on the bottom-right default is docked bottom-right; one the
 * user dragged up to the top-left is docked top-left.
 */
export function dockOf(rect, viewport) {
  const leftGap = rect.x;
  const rightGap = viewport.width - (rect.x + rect.width);
  const topGap = rect.y;
  const bottomGap = viewport.height - (rect.y + rect.height);
  return {
    horizontal: rightGap < leftGap ? 'right' : 'left',
    vertical: bottomGap < topGap ? 'bottom' : 'top',
  };
}

/**
 * Place `size` so that the docked edges of `rect` do not move.
 *
 * Freezing the top-left (what {@link anchorPosition} does) only holds while the
 * frame has room to the right and below. Past that, {@link resolvePosition}
 * clamps the frame back into view: the frame jumps, and because the clamped
 * value is written back into the preferences the jump outlives the gesture —
 * grow to 150% in the bottom-right default and the frame slides 306px left on a
 * 1400px window and never comes back. Spending the change on the free sides
 * instead leaves the docked edges exactly where they were, which keeps the whole
 * 50–150% range usable and makes a grow-then-shrink round trip land back on the
 * original spot.
 *
 * @param rect - the frame's box before the change.
 * @param size - the box it is about to take.
 * @param dock - `{ horizontal, vertical }` from {@link dockOf}, latched for the
 *   whole placement: re-deriving it from the live frame lets a frame sitting
 *   mid-window flip sides between steps and hesitate.
 */
export function growFromDock(rect, size, dock, viewport, topClearance) {
  const x = dock.horizontal === 'right' ? rect.x + rect.width - size.width : rect.x;
  const y = dock.vertical === 'bottom' ? rect.y + rect.height - size.height : rect.y;
  return clampPosition(x, y, size.width, size.height, viewport.width, viewport.height, topClearance);
}
