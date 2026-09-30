/** Local display preferences. DSH stores none of these; they never leave the browser. */

export const STORAGE_KEY = 'dsh-plugin-xxnerv-eva:preferences';

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 1.5;

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
