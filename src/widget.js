/**
 * The unit's surface: a framework-free shadow-DOM panel.
 *
 * It owns no DSH API and folds no session data — the adapter paints it through
 * `update(view)`. Keeping it plain DOM means the readouts, the segment cells and
 * the geometry can all be exercised with a stub host, and React never
 * re-renders the panel on every token.
 */
import { cleanPreferences, resolvePosition, anchorPosition, clampPosition, STORAGE_KEY, MIN_SCALE, MAX_SCALE } from './prefs.js';
import { normalizeLanguage, translate, bubbleLine } from './i18n.js';
import { barFill, formatCount } from './view.js';
import { readoutFontSize, segmentPlan } from './segments.js';

/** Panel geometry at scale 1, matching the stylesheet. */
const PANEL_WIDTH = 660;
const PANEL_HEIGHT = 300;
const BUBBLE_MS = 4200;

export class EvaWidget {
  constructor(host, options = {}) {
    this.host = host;
    this.art = options.art ?? '';
    this.version = options.version ?? '';
    this.language = normalizeLanguage(options.language);
    this.now = options.now ?? (() => Date.now());
    this.onRequestBalance = options.onRequestBalance ?? (() => Promise.resolve());
    this.originalLang = host.getAttribute('lang');
    this.cleanups = [];
    this.disposed = false;
    this.view = undefined;
    this.bubbleStep = 0;
    this.bubbleTimer = undefined;
    this.digitCache = new Map();
    this.storage = options.storage;
    if (options.storage === undefined && typeof window !== 'undefined') {
      try { this.storage = window.localStorage; } catch { this.storage = null; }
    }
    let saved;
    try { saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? 'null'); } catch { /* corrupt storage is optional */ }
    this.preferences = cleanPreferences(saved);

    this.root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    this.root.replaceChildren();
    const sheet = document.createElement('style');
    sheet.textContent = options.css ?? '';
    this.root.append(sheet);
    this.root.append(this.template());

    this.eva = this.query('.eva');
    this.hud = this.query('.hud');
    this.plate = this.query('.plate');
    this.bubble = this.query('.bubble');
    this.bubbleText = this.query('.bubble-message');
    this.panel = this.query('.panel');
    this.syncDetail = this.query('.sync-detail');
    this.accountDetail = this.query('.account-detail');
    this.scale = this.query('#eva-scale');
    this.scaleValue = this.query('.scale-value');
    this.motion = this.query('#eva-motion');
    this.refresh = this.query('.refresh');
    this.restore = this.query('.restore');
    this.linkState = this.query('.link-state');
    this.digits = { sync: this.query('[data-digits="sync"]'), active: this.query('[data-digits="active"]') };
    this.syncCell = this.query('.cell.sync');
    this.activeCell = this.query('.cell.active');
    this.syncBar = this.query('.bar');
    this.barSegments = [...this.root.querySelectorAll('.bar-fill > i')];
    this.rows = this.query('.rows');
    this.versionEl = this.query('.version');

    // The plate drags; only the corner handle resizes.
    this.listen(this.plate, 'pointerdown', event => this.pointerDown(event));
    this.listen(window, 'pointermove', event => this.pointerMove(event));
    this.listen(window, 'pointerup', event => this.pointerEnd(event));
    this.listen(window, 'pointercancel', event => this.pointerEnd(event, true));
    this.listen(this.query('.resize'), 'pointerdown', event => this.resizeDown(event));
    this.listen(this.plate, 'click', () => { if (this.suppressClick !== true) this.greet(); this.suppressClick = false; });
    this.listen(this.plate, 'contextmenu', event => { event.preventDefault(); this.openPanel(); });
    // Hover shows the quoted line; clicking still rotates the original
    // state-aware copy through `greet()`.
    this.listen(this.plate, 'pointerenter', () => this.showBubble(translate(this.language, 'bubble.quote')));
    this.listen(this.plate, 'pointerleave', () => this.hideBubble());
    this.listen(this.plate, 'keydown', event => this.nudge(event));
    this.listen(this.query('.close'), 'click', () => this.closePanel());
    this.listen(this.root, 'keydown', event => {
      if (event.key !== 'Escape' || this.panel.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      this.closePanel();
    });
    this.listen(document, 'pointerdown', event => {
      if (!this.panel.hidden && !event.composedPath().includes(this.host)) this.closePanel(false);
    });
    this.listen(this.scale, 'input', () => this.setScale(Number(this.scale.value) / 100));
    this.listen(this.motion, 'change', () => {
      this.preferences.motion = this.motion.checked;
      this.applyPreferences();
      this.save();
    });
    this.listen(this.refresh, 'click', () => this.requestBalance());
    this.listen(this.query('.reset'), 'click', () => {
      this.preferences.x = null;
      this.preferences.y = null;
      this.preferences.scale = 1;
      this.digitCache.clear();
      this.applyPreferences();
      this.save();
    });
    this.listen(this.query('.hide'), 'click', () => {
      this.preferences.hidden = true;
      this.closePanel(false);
      this.applyPreferences();
      this.save();
      this.restore.focus();
    });
    this.listen(this.restore, 'click', () => {
      this.preferences.hidden = false;
      this.applyPreferences();
      this.save();
      this.greet();
    });
    this.listen(window, 'resize', () => this.reposition());
    this.listen(document, 'visibilitychange', () => { this.visibility(); });

    this.applyPreferences();
    this.setLanguage(this.language);
  }

  query(selector) { return this.root.querySelector(selector); }

  template() {
    const template = document.createElement('template');
    template.innerHTML = `
      <div class="eva" data-state="standby" data-motion="true" data-bubble="false">
        <div class="hud">
          <div class="plate" tabindex="0" role="group" aria-keyshortcuts="Enter ArrowUp ArrowDown ArrowLeft ArrowRight">
            <div class="frame-shell" aria-hidden="true"><div class="frame-black"></div></div>
            <span class="frame-rail" aria-hidden="true"></span><span class="top-hazard" aria-hidden="true"></span>
            <span class="frame-left" aria-hidden="true"></span><span class="frame-right" aria-hidden="true"></span>
            <span class="bottom-stripe" aria-hidden="true"></span>
            <span class="corner tl" aria-hidden="true"></span><span class="corner tr" aria-hidden="true"></span>
            <span class="corner bl" aria-hidden="true"></span><span class="corner br" aria-hidden="true"></span>

            <header class="strip">
              <span class="mark" aria-hidden="true">${this.art}<span>NERV</span></span>
              <div class="strip-group">
                <span class="jp" data-i18n="hud.title"></span>
                <span class="en">ACTIVITY STATUS</span>
              </div>
              <div class="strip-group right">
                <span class="link-state"></span>
                <span class="chevrons" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
              </div>
            </header>
            <span class="header-line" aria-hidden="true"></span><span class="vertical-line" aria-hidden="true"></span>

            <div class="body">
              <section class="cell readout sync" data-tone="none">
                <span class="cap"><span class="jp" data-i18n="hud.sync"></span><span class="en">SYNC RATE</span></span>
                <span class="digits" data-digits="sync" aria-hidden="true"></span>
                <span class="bar" role="progressbar" data-i18n-aria="hud.sync" aria-valuemin="0" aria-valuemax="100">
                  <span class="bar-fill" aria-hidden="true">${'<i></i>'.repeat(20)}</span>
                </span>
                <span class="bar-scale" aria-hidden="true"><span>0%</span><span>50%</span><span>100%</span></span>
              </section>

              <section class="cell readout active" data-tone="none">
                <span class="cap"><span class="jp" data-i18n="hud.active"></span><span class="en">ACTIVITY TIME</span></span>
                <span class="digits" data-digits="active" aria-hidden="true"></span>
              </section>
            </div>
            <span class="calibration c1" aria-hidden="true">+</span><span class="calibration c2" aria-hidden="true">+</span>
            <span class="calibration c3" aria-hidden="true">+</span><span class="calibration c4" aria-hidden="true">+</span>
          </div>
          <button class="resize" type="button" data-i18n-aria="hud.resize"></button>
        </div>
        <div class="bubble" aria-hidden="true"><span class="bubble-message"></span></div>
      </div>
      <section class="panel" role="dialog" data-i18n-aria="panel.title" hidden>
        <div class="panel-head">
          <strong data-i18n="panel.title"></strong>
          <button class="close" type="button" data-i18n-aria="panel.close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </div>
        <p class="subtitle" data-i18n="panel.subtitle"></p>
        <div class="section">
          <h4 data-i18n="panel.detail"></h4>
          <dl class="detail sync-detail"></dl>
        </div>
        <div class="section">
          <h4 data-i18n="panel.accounts"></h4>
          <dl class="detail account-detail"></dl>
        </div>
        <div class="section">
          <h4 data-i18n="hud.info"></h4>
          <dl class="detail rows"></dl>
        </div>
        <div class="setting">
          <label for="eva-scale"><span data-i18n="setting.scale"></span> <output class="scale-value"></output></label>
          <input id="eva-scale" type="range" min="50" max="150" step="5" />
        </div>
        <div class="setting">
          <label for="eva-motion" data-i18n="setting.motion"></label>
          <input id="eva-motion" type="checkbox" role="switch" />
        </div>
        <div class="panel-actions">
          <button class="action refresh" type="button" data-i18n="action.refresh"></button>
          <button class="action reset" type="button" data-i18n="action.reset"></button>
          <button class="action hide" type="button" data-i18n="action.hide"></button>
        </div>
        <div class="panel-version">NERV TYPE INTERFACE <span class="version"></span></div>
      </section>
      <button class="restore" type="button" data-i18n-aria="action.restoreAria" data-i18n="action.restore" hidden></button>`;
    return template.content.cloneNode(true);
  }

  listen(target, event, callback, options) {
    target.addEventListener(event, callback, options);
    this.cleanups.push(() => target.removeEventListener(event, callback, options));
  }

  save() {
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.preferences)); } catch { /* storage denial must not break the panel */ }
  }

  setLanguage(language) {
    if (this.disposed) return;
    this.language = normalizeLanguage(language);
    this.host.setAttribute('lang', this.language);
    for (const element of this.root.querySelectorAll('[data-i18n]')) {
      element.textContent = translate(this.language, element.dataset.i18n);
    }
    for (const element of this.root.querySelectorAll('[data-i18n-aria]')) {
      element.setAttribute('aria-label', translate(this.language, element.dataset.i18nAria));
    }
    if (this.versionEl !== null) this.versionEl.textContent = this.version;
    this.paint();
    if (!this.panel.hidden) this.renderPanel();
  }

  applyPreferences() {
    this.scale.value = String(Math.round(this.preferences.scale * 100));
    this.scaleValue.textContent = `${this.scale.value}%`;
    this.scale.setAttribute('aria-valuetext', `${this.scale.value}%`);
    const span = MAX_SCALE - MIN_SCALE;
    this.scale.style.setProperty('--range-progress', `${span === 0 ? 0 : ((this.preferences.scale - MIN_SCALE) / span) * 100}%`);
    this.motion.checked = this.preferences.motion;
    this.eva.dataset.motion = String(this.preferences.motion);
    this.hud.style.setProperty('--hud-scale', String(this.preferences.scale));
    this.eva.hidden = this.preferences.hidden;
    this.restore.hidden = !this.preferences.hidden;
    if (this.preferences.hidden) this.closePanel(false);
    this.visibility();
    this.reposition();
  }

  visibility() {
    if (typeof document === 'undefined') return;
    this.host.dataset.paused = String(document.hidden || this.preferences.hidden);
  }

  /**
   * Measured panel size. `getBoundingClientRect` is used rather than
   * `offsetWidth` because CSS `zoom` makes the two disagree, and the rect is
   * what the user actually sees.
   */
  measure() {
    const rect = this.hud.getBoundingClientRect();
    return { width: rect.width || PANEL_WIDTH, height: rect.height || PANEL_HEIGHT };
  }

  reposition() {
    if (this.disposed) return;
    const { width, height } = this.measure();
    this.position = resolvePosition(
      this.preferences,
      { width, height },
      { width: window.innerWidth, height: window.innerHeight },
      this.topClearance(),
    );
    // Keep a chosen anchor authoritative: once the user has placed the panel,
    // a clamp must not leave the stored position disagreeing with the frame.
    if (this.preferences.x !== null) anchorPosition(this.preferences, this.position);
    this.eva.style.left = `${this.position.x}px`;
    this.eva.style.top = `${this.position.y}px`;
    if (!this.panel.hidden) this.positionPanel();
  }

  positionBubble() {
    if (this.disposed || !this.position || this.preferences.hidden) return;
    const { width, height } = this.measure();
    const bubbleWidth = this.bubble.offsetWidth;
    const bubbleHeight = this.bubble.offsetHeight;
    const topClearance = Math.max(56, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-frame-top-clearance')) || 0);
    let top = -bubbleHeight - 10;
    if (this.position.y + top < topClearance) top = height + 10;
    const left = Math.min(Math.max(0, (width - bubbleWidth) / 2), Math.max(0, window.innerWidth - this.position.x - bubbleWidth - 8));
    this.bubble.style.top = `${top}px`;
    this.bubble.style.left = `${left}px`;
  }

  positionPanel() {
    const width = this.panel.offsetWidth || 300;
    const height = this.panel.offsetHeight || 420;
    const { width: monitorWidth } = this.measure();
    const anchor = this.position ?? { x: 24, y: 24 };
    const position = clampPosition(
      anchor.x + monitorWidth / 2 - width / 2,
      anchor.y - height - 10,
      width,
      height,
      window.innerWidth,
      window.innerHeight,
      Math.max(56, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-frame-top-clearance')) || 0),
    );
    this.panel.style.left = `${position.x}px`;
    this.panel.style.top = `${position.y}px`;
  }

  openPanel() {
    this.panel.hidden = false;
    this.renderPanel();
    this.positionPanel();
    this.query('.close').focus();
  }

  closePanel(focus = true) {
    this.panel.hidden = true;
    if (focus) this.plate.focus();
  }

  pointerDown(event) {
    if (event.button !== 0 || event.isPrimary !== true) return;
    this.suppressClick = false;
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, originX: this.position.x, originY: this.position.y, moved: false };
    this.plate.setPointerCapture(event.pointerId);
  }

  resizeDown(event) {
    if (event.button !== 0 || event.isPrimary !== true) return;
    event.preventDefault();
    event.stopPropagation();
    this.resize = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scale: this.preferences.scale,
      ceiling: this.maxScaleAt(this.position),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  /** The frame's reserved top strip, below which the panel must stay. */
  topClearance() {
    return Math.max(56, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-frame-top-clearance')) || 0);
  }

  /**
   * Apply a new scale, anchoring the position first.
   *
   * Both the settings control and the corner handle go through here, because a
   * size change without an anchor recomputes the default position from the new
   * size and drags the panel across the window.
   * @param next - requested scale.
   * @param ceiling - upper bound for this change (the corner drag caps it to
   *   what still fits below and to the right of the current anchor).
   */
  setScale(next, ceiling = MAX_SCALE) {
    anchorPosition(this.preferences, this.position);
    this.preferences.scale = Math.max(MIN_SCALE, Math.min(ceiling, MAX_SCALE, next));
    this.applyPreferences();
    this.save();
  }

  /**
   * Largest scale whose panel still fits to the right of and below `anchor`.
   * Capping the drag at this value is what keeps a resize from also moving the
   * panel: the frame never has to be pulled back into view.
   */
  maxScaleAt(anchor) {
    const byWidth = (window.innerWidth - anchor.x - 8) / PANEL_WIDTH;
    const byHeight = (window.innerHeight - anchor.y - 8) / PANEL_HEIGHT;
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, byWidth, byHeight));
  }

  pointerMove(event) {
    if (this.resize !== undefined && this.resize.id === event.pointerId) {
      const dx = event.clientX - this.resize.startX;
      const dy = event.clientY - this.resize.startY;
      // The visual width at scale s is PANEL_WIDTH * s, so dragging the corner
      // by `travel` visual pixels adds exactly travel / PANEL_WIDTH to the
      // scale. Deriving it this way keeps the math independent of how the
      // engine reports geometry inside a CSS `zoom` subtree.
      const travel = Math.max(dx, dy);
      this.setScale(this.resize.scale + travel / PANEL_WIDTH, this.resize.ceiling);
      return;
    }
    if (this.drag === undefined || this.drag.id !== event.pointerId) return;
    const dx = event.clientX - this.drag.x;
    const dy = event.clientY - this.drag.y;
    if (Math.hypot(dx, dy) > 4) this.drag.moved = true;
    if (!this.drag.moved) return;
    this.eva.dataset.dragging = 'true';
    this.preferences.x = this.drag.originX + dx;
    this.preferences.y = this.drag.originY + dy;
    this.reposition();
  }

  pointerEnd(event, cancelled = false) {
    if (this.resize !== undefined && this.resize.id === event.pointerId) {
      this.resize = undefined;
      this.save();
      return;
    }
    if (this.drag === undefined || this.drag.id !== event.pointerId) return;
    const moved = this.drag.moved;
    this.suppressClick = moved || cancelled;
    if (moved) {
      this.preferences.x = this.position.x;
      this.preferences.y = this.position.y;
      this.save();
    }
    this.drag = undefined;
    delete this.eva.dataset.dragging;
  }

  nudge(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.openPanel();
      return;
    }
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const delta = directions[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    const step = event.shiftKey ? 20 : 5;
    this.preferences.x = this.position.x + delta[0] * step;
    this.preferences.y = this.position.y + delta[1] * step;
    this.reposition();
    this.save();
  }

  greet() {
    this.bubbleStep += 1;
    this.showBubble(bubbleLine(this.language, this.view?.state ?? 'standby', this.bubbleStep), { timed: true });
  }

  showBubble(text, { timed = false } = {}) {
    if (this.preferences.hidden) return;
    this.bubbleText.textContent = text ?? bubbleLine(this.language, this.view?.state ?? 'standby', this.bubbleStep);
    this.eva.dataset.bubble = 'true';
    this.positionBubble();
    clearTimeout(this.bubbleTimer);
    if (timed) this.bubbleTimer = setTimeout(() => this.hideBubble(), BUBBLE_MS);
  }

  hideBubble() {
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = undefined;
    this.eva.dataset.bubble = 'false';
  }

  async requestBalance() {
    this.refresh.disabled = true;
    this.refresh.textContent = translate(this.language, 'detail.refreshing');
    try { await this.onRequestBalance(); } finally {
      this.refresh.disabled = false;
      this.refresh.textContent = translate(this.language, 'action.refresh');
    }
  }

  update(view) {
    if (this.disposed) return;
    this.view = view;
    this.paint();
  }

  paint() {
    if (this.disposed) return;
    const view = this.view;
    const state = view?.state ?? 'standby';
    this.eva.dataset.state = state;

    this.paintDigits(this.digits.sync, view?.sync?.cells ?? '--');
    this.syncCell.dataset.tone = view?.sync?.tone ?? 'none';
    this.paintDigits(this.digits.active, view?.active?.cells ?? '--');
    this.activeCell.dataset.tone = view?.active?.tone ?? 'none';

    this.linkState.textContent = translate(this.language, state === 'offline' ? 'hud.offline' : 'hud.online');
    const sync = view?.sync ?? { text: null };
    const fill = barFill(sync);
    const barKey = sync.text ?? 'unknown';
    if (this.syncBar.dataset.value !== barKey) {
      this.syncBar.dataset.value = barKey;
      this.barSegments.forEach((segment, index) => {
        segment.style.setProperty('--fill', `${Math.max(0, Math.min(100, (fill / 5 - index) * 100))}%`);
      });
    }
    if (sync.text === null) this.syncBar.removeAttribute('aria-valuenow');
    else this.syncBar.setAttribute('aria-valuenow', String(fill));
    this.syncBar.setAttribute('aria-valuetext', sync.text === null ? translate(this.language, 'detail.none') : `${sync.text}%`);

    this.renderRows(view);
    this.plate.setAttribute('aria-label', translate(this.language, 'hud.aria', {
      state: translate(this.language, view?.status?.key ?? 'hud.state.standby'),
      sync: view?.sync?.text === null || view?.sync?.text === undefined ? '--' : `${view.sync.text}%`,
      active: view?.active?.display ?? '--',
      link: translate(this.language, state === 'offline' ? 'hud.offline' : 'hud.online'),
    }));

    if (this.eva.dataset.bubble === 'true' && this.bubbleTimer === undefined) this.positionBubble();
    if (!this.panel.hidden) this.renderPanel();
  }

  /** Paint one readout as seven-segment cells, rebuilding only when the text changes. */
  paintDigits(container, text) {
    if (container === null) return;
    if (this.digitCache.get(container) === text) return;
    this.digitCache.set(container, text);
    // Fixed logical geometry; CSS zoom scales the whole panel afterward.
    const active = container === this.digits.active;
    container.style.fontSize = `${readoutFontSize(text, active ? 334 : 195, active ? 76 : 58)}px`;
    const cells = [];
    for (const cell of segmentPlan(text)) {
      const element = document.createElement('b');
      element.className = cell.kind === 'digit' ? 'd' : `d ${cell.char === ':' ? 'colon' : cell.char === '.' ? 'dot' : 'pct'}`;
      for (let bit = 0; bit < 7; bit += 1) {
        const bar = document.createElement('i');
        const punctuationOn = (cell.char === '.' && bit === 0) || (cell.char === ':' && bit < 2);
        if ((cell.kind === 'digit' && cell.segments[bit]) || punctuationOn) bar.dataset.on = '1';
        element.append(bar);
      }
      cells.push(element);
    }
    container.replaceChildren(...cells);
  }

  renderRows(view) {
    if (this.rows === null) return;
    const rows = [];
    const add = (labelKey, value) => {
      const dt = document.createElement('dt');
      dt.textContent = translate(this.language, labelKey);
      const dd = document.createElement('dd');
      dd.textContent = value;
      rows.push(dt, dd);
    };
    add('hud.status', translate(this.language, view?.status?.key ?? 'hud.state.standby'));
    add('hud.link', translate(this.language, view?.state === 'offline' ? 'hud.offline' : 'hud.online'));
    add('hud.info.updated', view?.info?.updated ?? '--');
    add('hud.info.tokens', view?.info?.tokens ?? '0');
    add('hud.power', view?.power?.remainingText ?? '--');
    add('hud.load', view?.power?.text ?? '--');
    this.rows.replaceChildren(...rows);
  }

  renderPanel() {
    const view = this.view;
    const syncRows = [];
    const balanceRows = [];
    const push = (target, labelKey, value) => {
      const [dt, dd] = row(translate(this.language, labelKey), value);
      target.push(dt, dd);
    };

    if (view?.sync?.text !== null && view?.sync?.text !== undefined) {
      push(syncRows, 'detail.sync', `${view.sync.text}%`);
      push(syncRows, 'detail.cacheRead', formatCount(view.sync.tokens.cacheRead));
      push(syncRows, 'detail.uncached', formatCount(view.sync.tokens.uncached));
      if (view.sync.tokens.cacheWrite > 0) push(syncRows, 'detail.cacheWrite', formatCount(view.sync.tokens.cacheWrite));
      push(syncRows, 'detail.output', formatCount(view.sync.tokens.output));
    } else {
      syncRows.push(note(translate(this.language, 'detail.none')));
    }
    this.syncDetail.replaceChildren(...syncRows);

    const kind = view?.balance?.kind ?? 'pending';
    if (kind === 'ready') {
      push(balanceRows, 'detail.balance', view.balance.display ?? '--');
      push(balanceRows, 'detail.recharge', view.balance.recharge ?? '--');
      push(balanceRows, 'detail.bonus', view.balance.bonus ?? '--');
      for (const other of view.balance.others) balanceRows.push(note(other));
    } else {
      // Every kind gets its own sentence, and a failure or an unexpected answer
      // carries the concrete reason, so the panel never hides what happened.
      const detail = view?.balance?.detail ?? '';
      const key = kind === 'signed-out' ? 'detail.signedOut'
        : kind === 'failed' ? (detail === '' || detail === null ? 'detail.failed' : 'detail.failedDetail')
          : kind === 'empty' ? 'detail.empty'
            : kind === 'unsupported' ? 'detail.unsupported'
              : kind === 'unrecognized' ? 'detail.unrecognized'
                : 'detail.balancePending';
      balanceRows.push(note(translate(this.language, key, { detail: String(detail) })));
    }
    this.accountDetail.replaceChildren(...balanceRows);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.bubbleTimer);
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
    this.root.replaceChildren();
    delete this.host.dataset.paused;
    if (this.originalLang === null) this.host.removeAttribute('lang');
    else this.host.setAttribute('lang', this.originalLang);
  }
}

function row(label, value) {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  return [dt, dd];
}

function note(text) {
  const dd = document.createElement('dd');
  dd.className = 'note';
  dd.textContent = text;
  return dd;
}
