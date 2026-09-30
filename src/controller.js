/**
 * Wiring between DSH and the unit.
 *
 * Everything here is ordinary client-side subscription work — no Host plugin,
 * no RPC of our own, no DOM outside the widget:
 *   - the session catalog says which session the main view is showing;
 *   - that session's retained binding serves the `tokenUsage` projection, whose
 *     cache-read share is the sync ratio;
 *   - `remote.account.getBalance` serves the remaining balance;
 *   - the connection state decides whether the unit is linked or offline.
 */
import { deriveView } from './view.js';
import { BalanceChannel, BALANCE_RETRY_MS, BALANCE_TIMEOUT_MS } from './account.js';

/** Retain source label; DSH counts retentions per source, and this one is ours. */
const RETAIN_SOURCE = 'evaCompanion';

/** Shortest gap between two balance refreshes driven by session activity. */
const ACTIVITY_REFRESH_FLOOR_MS = 15000;
/** Coalescing delay between a session-activity burst and the balance refresh. */
const ACTIVITY_REFRESH_DELAY_MS = 5000;

/** The session the main view is showing, from a `ctx.sessions.list` snapshot. */
export function selectedSessionId(snapshot) {
  const byId = snapshot?.byId;
  if (byId === null || typeof byId !== 'object') return undefined;
  for (const row of Object.values(byId)) {
    if ((row?.retainedBy?.mainView ?? 0) > 0 && typeof row.id === 'string') return row.id;
  }
  return undefined;
}

export class EvaController {
  constructor(ctx, widget, { now = () => Date.now(), locale, balanceIntervalMs = 60000, balanceRetryMs = BALANCE_RETRY_MS, balanceTimeoutMs = BALANCE_TIMEOUT_MS } = {}) {
    this.ctx = ctx;
    this.widget = widget;
    this.now = now;
    this.locale = locale;
    this.balanceIntervalMs = balanceIntervalMs;
    this.balanceRetryMs = balanceRetryMs;
    this.balanceTimeoutMs = balanceTimeoutMs;
    this.connected = ctx.connection.state.getSnapshot() === 'connected';
    this.catalog = undefined;
    this.sessionId = undefined;
    this.reference = undefined;
    this.usage = undefined;
    this.pressure = undefined;
    this.updatedAt = undefined;
    this.balanceResult = undefined;
    this.balanceStatus = 'pending';
    this.channel = undefined;
    this.lastBalanceAt = 0;
    this.activityTimer = undefined;
    this.stopConnection = () => {};
    this.stopProjection = () => {};
    this.disposed = false;
  }

  start() {
    this.stopConnection = this.ctx.connection.state.subscribe(() => {
      const connected = this.ctx.connection.state.getSnapshot() === 'connected';
      if (connected === this.connected) return;
      this.connected = connected;
      if (connected) this.refreshBalance();
      this.publish();
    });
    this.publish();
  }

  /** Called from the slot component whenever the session catalog snapshot changes. */
  setCatalog(snapshot) {
    if (this.disposed) return;
    this.catalog = snapshot;
    const next = selectedSessionId(snapshot);
    const row = next === undefined ? undefined : snapshot?.byId?.[next];
    this.updatedAt = row?.updatedAt;
    if (next === this.sessionId) {
      this.publish();
      return;
    }
    this.sessionId = next;
    this.watchSession(next);
  }

  /** Retain the shown session and follow the projections the panel reads. */
  watchSession(sessionId) {
    this.stopProjection();
    this.releaseReference();
    this.usage = undefined;
    this.pressure = undefined;
    if (sessionId === undefined) {
      this.publish();
      return;
    }
    let reference;
    try {
      reference = this.ctx.sessions.retain(sessionId, { source: RETAIN_SOURCE });
    } catch {
      this.publish();
      return;
    }
    this.reference = reference;
    let projections;
    try {
      projections = reference.binding.session.projections;
    } catch {
      this.publish();
      return;
    }

    const stops = [this.follow(projections, 'tokenUsage', value => { this.usage = value; })];
    stops.push(this.follow(projections, 'contextPressure', value => { this.pressure = value; }));
    this.stopProjection = () => { for (const stop of stops.reverse()) stop(); };

    Promise.resolve(reference.ready).then(
      () => {
        if (this.disposed) return;
        const usage = projections.faceOf('tokenUsage').getSnapshot();
        if (usage !== undefined) this.usage = usage;
        const pressure = projections.faceOf('contextPressure').getSnapshot();
        if (pressure !== undefined) this.pressure = pressure;
        this.publish();
      },
      () => {},
    );
    this.publish();
  }

  /**
   * Follow one projection key and repaint on change.
   * @param projections - the session's projection store.
   * @param key - projection key; a key this composition never registers yields
   *   an undefined snapshot, which the panel renders as "no data" rather than
   *   as a zero.
   * @returns an unsubscribe function.
   */
  follow(projections, key, assign) {
    let face;
    try {
      face = projections.faceOf(key);
    } catch {
      return () => {};
    }
    assign(face.getSnapshot());
    return face.subscribe(() => {
      const next = face.getSnapshot();
      assign(next);
      this.scheduleActivityRefresh();
      this.publish();
    });
  }

  scheduleActivityRefresh() {
    if (this.channel === undefined || this.activityTimer !== undefined) return;
    if (this.now() - this.lastBalanceAt < ACTIVITY_REFRESH_FLOOR_MS) return;
    this.activityTimer = setTimeout(() => {
      this.activityTimer = undefined;
      this.refreshBalance();
    }, ACTIVITY_REFRESH_DELAY_MS);
  }

  /**
   * Install the balance channel for the `remote` service. The channel resolves
   * `remote.account.getBalance` per call, so an unavailable namespace degrades
   * to "unsupported" instead of throwing.
   * @returns a disposer the caller owns.
   */
  attachBalance(remote) {
    this.detachBalance();
    if (this.disposed) return () => {};
    this.balanceStatus = 'pending';
    this.balanceResult = undefined;
    const channel = new BalanceChannel({
      remote,
      getLocale: () => this.locale?.getSnapshot?.().active,
      intervalMs: this.balanceIntervalMs,
      retryMs: this.balanceRetryMs,
      timeoutMs: this.balanceTimeoutMs,
      onResult: result => {
        this.balanceResult = result;
        this.lastBalanceAt = this.now();
        this.publish();
      },
      onStatus: status => {
        if (status === 'unsupported') this.setBalanceStatus('unsupported');
        else if (status === 'failed') this.setBalanceStatus('failed');
      },
    });
    this.channel = channel;
    channel.start();
    // Only the channel this call installed may be disposed by its own disposer:
    // a second attach (a later injection scope) replaces it.
    return () => {
      if (this.channel !== channel) return;
      this.detachBalance();
    };
  }

  detachBalance() {
    this.channel?.dispose();
    this.channel = undefined;
  }

  /** A capability answer from the composition, not a failed query. */
  setBalanceStatus(status) {
    if (this.disposed) return;
    this.balanceStatus = status;
    if (status === 'unsupported') this.balanceResult = undefined;
    this.publish();
  }

  refreshBalance() {
    if (this.channel === undefined) return Promise.resolve();
    this.lastBalanceAt = this.now();
    return this.channel.refresh();
  }

  publish() {
    if (this.disposed) return;
    this.widget.update(deriveView({
      connected: this.connected,
      usage: this.usage,
      pressure: this.pressure,
      updatedAt: this.updatedAt,
      balanceResult: this.balanceStatus === 'unsupported' ? { unsupported: true } : this.balanceResult,
    }));
  }

  releaseReference() {
    const reference = this.reference;
    this.reference = undefined;
    if (reference === undefined) return;
    try { reference.release(); } catch { /* already released by the controller */ }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.activityTimer);
    this.activityTimer = undefined;
    this.stopProjection();
    this.stopConnection();
    this.detachBalance();
    this.releaseReference();
  }
}
