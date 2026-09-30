/**
 * Account-balance channel.
 *
 * Reads the remaining balance through the Host's authenticated Remote endpoint,
 * exactly as DSH's own account page does: `remote.account.getBalance(metadata)`.
 * No credential, token, or HTTP route of our own is involved, and the value is
 * only ever used to paint the readout.
 *
 * The call resolves to an **operation envelope**, never to the payload:
 * `{ ok: true, value }` on success and `{ ok: false, error }` on failure, which
 * is also where a transport fault folds. `unwrapRemoteResult` lifts it.
 */

/**
 * The `x-client-version` the Host reports for this UI. DSH's own account page
 * carries its build version as a constant, and the browser boot payload exposes
 * no version field, so this tracks the installed client release and can be
 * overridden by a shell that publishes one.
 */
export const CLIENT_VERSION_FALLBACK = '0.2.0-rc.2';

export function clientVersion() {
  const override = globalThis.__DSH_CLIENT_VERSION__;
  return typeof override === 'string' && override !== '' ? override : CLIENT_VERSION_FALLBACK;
}

/** The calling UI's metadata: what Platform is told about the requester. */
export function accountClientMetadata(locale, version = clientVersion()) {
  return {
    version,
    locale: typeof locale === 'string' && locale.trim() !== '' ? locale : 'en',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  };
}

/**
 * Unwrap one Direct Remote answer.
 *
 * A Direct Remote method never resolves to its payload: the gateway returns an
 * operation envelope — `{ ok: true, value }` or `{ ok: false, error }` — and a
 * transport fault folds into the same failed branch. DSH's own account page
 * unwraps it (`if (!result.ok) throw …; return result.value`) and so must any
 * other caller; reading `.status` off the envelope silently yields `undefined`.
 * A value without an `ok` boolean is passed through, so a change in transport
 * degrades into the readout instead of into a blank.
 *
 * @param envelope - whatever the Remote method resolved to.
 * @returns `{ ok: true, value }` or `{ ok: false, error }`.
 */
export function unwrapRemoteResult(envelope) {
  if (envelope !== null && typeof envelope === 'object' && typeof envelope.ok === 'boolean') {
    return envelope.ok ? { ok: true, value: envelope.value } : { ok: false, error: envelope.error };
  }
  return { ok: true, value: envelope };
}

/**
 * Polls the remaining balance while the unit is mounted.
 *
 * `account` is the `remote.account` namespace, and the plugin declares it, so a
 * missing namespace is impossible here. Requests never overlap, a hidden
 * document is not polled, and a query that never answers is abandoned by a
 * watchdog instead of leaving the readout saying "reading" forever.
 */

/** A Remote query that has not answered by then is reported as a failure. */
export const BALANCE_TIMEOUT_MS = 12000;
/** Retry gap while no balance has ever been read (the first call can race the RPC transport). */
export const BALANCE_RETRY_MS = 5000;

export class BalanceChannel {
  constructor({ remote, getLocale, onResult, onStatus = () => {}, intervalMs = 60000, retryMs = BALANCE_RETRY_MS, timeoutMs = BALANCE_TIMEOUT_MS, isVisible = defaultVisibility }) {
    this.remote = remote;
    this.getLocale = getLocale;
    this.onResult = onResult;
    this.onStatus = onStatus;
    this.intervalMs = intervalMs;
    this.retryMs = retryMs;
    this.timeoutMs = timeoutMs;
    this.isVisible = isVisible;
    this.disposed = false;
    this.pending = undefined;
    this.timer = undefined;
    this.watchdog = undefined;
    this.retryTimer = undefined;
    this.answered = false;
  }

  /** The namespace's method, re-read per call: the gateway binds it to the caller at property access. */
  method() {
    const call = this.remote?.account?.getBalance;
    return typeof call === 'function' ? call : undefined;
  }

  start() {
    if (this.disposed) return;
    if (this.method() === undefined) {
      this.onStatus('unsupported');
      return;
    }
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.refresh();
  }

  tick() {
    if (this.disposed || this.pending !== undefined) return;
    if (!this.isVisible()) return;
    this.refresh();
  }

  refresh() {
    if (this.disposed) return Promise.resolve();
    if (this.pending !== undefined) return this.pending;
    if (this.method() === undefined) return Promise.resolve();
    const timeoutMs = this.timeoutMs;
    this.pending = Promise.resolve()
      // Re-resolve the method inside the call, exactly as the shipped account page
      // does (`ctx.remote.account.getBalance(...)`), so the invocation binds to
      // this access rather than to a namespace object captured earlier.
      .then(() => this.method()(accountClientMetadata(this.getLocale())))
      .then(
        envelope => {
          if (this.disposed) return;
          // Any answer — success or failure — means the query came back, so the
          // quick retry stops and the ordinary poll takes over.
          this.answered = true;
          const outcome = unwrapRemoteResult(envelope);
          if (!outcome.ok) {
            console.warn('[xxnerv-eva] account/getBalance failed', outcome.error);
            this.onStatus('failed');
            this.onResult({ status: 'failed', error: outcome.error });
            return;
          }
          const value = outcome.value;
          if (value !== null && value?.status !== 'ready' && value?.status !== 'failed') {
            console.warn('[xxnerv-eva] unexpected account/getBalance payload', describeResult(value));
          }
          this.onStatus('ready');
          this.onResult(value);
        },
        error => {
          if (this.disposed) return;
          console.warn('[xxnerv-eva] account/getBalance rejected', error);
          this.onStatus('failed');
          this.onResult({ status: 'failed', error });
          this.scheduleRetry();
        },
      )
      .then(
        () => { this.pending = undefined; this.clearWatchdog(); },
        () => { this.pending = undefined; this.clearWatchdog(); },
      );

    // Abandon a query that never answers. Without this the readout would sit on
    // "reading the balance" forever AND every later poll would be skipped,
    // because a pending promise blocks the next one.
    this.armWatchdog(timeoutMs);
    return this.pending;
  }

  /**
   * Retry quickly while no balance has ever been read. The unit mounts at boot,
   * when the RPC transport may not be open yet, so the very first call can fail
   * or hang; once one answer lands the ordinary poll takes over.
   */
  scheduleRetry() {
    if (this.disposed || this.answered || this.retryTimer !== undefined) return;
    if (!(this.retryMs > 0)) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (this.disposed || this.answered) return;
      if (!this.isVisible()) return;
      this.refresh();
    }, this.retryMs);
  }

  disposeRetry() {
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  /** Race the in-flight query against the watchdog. */
  armWatchdog(timeoutMs) {
    this.clearWatchdog();
    if (!(timeoutMs > 0)) return;
    const started = Date.now();
    this.watchdog = setTimeout(() => {
      this.watchdog = undefined;
      if (this.disposed || this.pending === undefined) return;
      const error = new Error(`account/getBalance did not answer within ${timeoutMs}ms`);
      console.warn('[xxnerv-eva] account/getBalance timed out; the query is abandoned', { elapsedMs: Date.now() - started });
      this.pending = undefined;
      this.onStatus('failed');
      this.onResult({ status: 'failed', error });
      this.scheduleRetry();
    }, timeoutMs);
  }

  clearWatchdog() {
    if (this.watchdog !== undefined) clearTimeout(this.watchdog);
    this.watchdog = undefined;
  }

  dispose() {
    this.disposed = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.clearWatchdog();
    this.disposeRetry();
    this.timer = undefined;
  }
}

function defaultVisibility() {
  return typeof document === 'undefined' || document.hidden !== true;
}
