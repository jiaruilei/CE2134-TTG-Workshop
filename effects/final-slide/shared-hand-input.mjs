/** Reuse the embedded lab's hand landmarks. This page never opens a camera. */
import {HandSweep} from './hand-sweep.mjs?v=3ffced2492a1';

const CHANNEL = 'ce2134-hand-tracking', VERSION = 1;
const HEARTBEAT_MS = 2000, STALE_MS = 400;
const READY = 'Hold both open hands apart briefly, then clap them together.';
const STATES = new Set(['requesting', 'loading', 'ready', 'error', 'stopped']);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finiteBetween = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;

function validFrame(data) {
  return Number.isSafeInteger(data.seq) && data.seq >= 0 &&
    finiteBetween(data.timestamp, 0, 1e15) &&
    Number.isInteger(data.width) && Number.isInteger(data.height) &&
    finiteBetween(data.width, 1, 8192) && finiteBetween(data.height, 1, 8192) &&
    Array.isArray(data.landmarks) && data.landmarks.length <= 2 &&
    data.landmarks.every(hand => Array.isArray(hand) && hand.length === 21 && hand.every(point =>
      isRecord(point) && finiteBetween(point.x, -.5, 1.5) && finiteBetween(point.y, -.5, 1.5) &&
      (point.z === undefined || finiteBetween(point.z, -5, 5)) &&
      (point.visibility === undefined || finiteBetween(point.visibility, 0, 1)) &&
      (point.presence === undefined || finiteBetween(point.presence, 0, 1))));
}

export class SharedHandInput {
  constructor({frame, onStatus = () => {}, onProgress = () => {}, onTrigger = () => {}} = {}) {
    if (!frame?.contentWindow || !frame.ownerDocument) throw new TypeError('SharedHandInput requires the lab iframe.');
    this.frame = frame;
    this._document = frame.ownerDocument;
    this._window = this._document.defaultView;
    const url = new URL(frame.dataset?.webSrc || frame.getAttribute('src'), this._document.baseURI);
    if (!['https:', 'http:'].includes(url.protocol)) throw new TypeError('The lab must use HTTP or HTTPS.');
    this.origin = url.origin;
    this.onStatus = onStatus; this.onProgress = onProgress; this.onTrigger = onTrigger;
    this._session = null; this._enabled = true; this._disposed = false;
    this._onMessage = event => this._receive(event);
    this._onLoad = () => { if (this.active) this._handshake(); };
    this._onHidden = () => { if (this._document.hidden) this.stop(); };
    this._onPageHide = () => this.stop();
    this._window.addEventListener('message', this._onMessage);
    frame.addEventListener('load', this._onLoad);
    this._document.addEventListener('visibilitychange', this._onHidden);
    this._window.addEventListener('pagehide', this._onPageHide);
  }

  get active() { return !!this._session && !this._disposed; }

  async start() {
    if (this._disposed || this._document.hidden) return false;
    if (!this.active) this._handshake();
    return this.active;
  }

  setEnabled(enabled) {
    this._enabled = !!enabled;
    const session = this._session;
    if (!session) return;
    this._reset(session);
    if (session.state === 'ready') this._status(session,
      this._enabled ? READY : 'Lab camera on. Wave gesture detection paused.',
      this._enabled ? 'ready' : 'paused');
  }

  stop() {
    const session = this._session;
    if (!session) return;
    this._session = null;
    this._window.clearInterval(session.heartbeat);
    this._window.clearInterval(session.staleCheck);
    this._send('stop', session.id);
    this._notify(this.onProgress, 0);
    this._notify(this.onStatus, 'Lab camera stopped.', 'stopped');
  }

  dispose() {
    if (this._disposed) return;
    this.stop(); this._disposed = true;
    this._window.removeEventListener('message', this._onMessage);
    this.frame.removeEventListener('load', this._onLoad);
    this._document.removeEventListener('visibilitychange', this._onHidden);
    this._window.removeEventListener('pagehide', this._onPageHide);
  }

  _notify(callback, ...args) {
    try { callback(...args); } catch (error) { console.warn('Shared hand input callback failed:', error); }
  }

  _send(type, session) {
    this.frame.contentWindow.postMessage({channel: CHANNEL, version: VERSION, type, session}, this.origin);
  }

  _current(session) { return this._session === session && !this._disposed; }

  _handshake() {
    if (this._disposed || this._document.hidden) return;
    this.stop();
    if (this._disposed || this._document.hidden) return;
    const session = {
      id: this._window.crypto.randomUUID(), state: 'requesting', detector: new HandSweep(),
      seq: -1, timestamp: -1, receivedAt: null, progress: -1, status: '', triggered: false,
    };
    this._session = session;
    session.heartbeat = this._window.setInterval(() => {
      if (this._current(session)) this._send('heartbeat', session.id);
    }, HEARTBEAT_MS);
    session.staleCheck = this._window.setInterval(() => {
      if (this._current(session) && session.receivedAt !== null &&
          this._window.performance.now() - session.receivedAt > STALE_MS) {
        this._reset(session);
        session.receivedAt = null;
        if (this._enabled && session.state === 'ready') this._status(session, 'Keep both hands visible to the lab camera.', 'ready');
      }
    }, 250);
    this._progress(session, 0);
    this._status(session, 'Connecting to the lab camera. Allow camera access when prompted.', 'requesting');
    if (this._current(session)) this._send('start', session.id);
  }

  _reset(session) {
    session.detector.reset(); session.triggered = false;
    this._progress(session, 0);
  }

  _status(session, message, code) {
    const status = `${code}:${message}`;
    if (!this._current(session) || session.status === status) return;
    session.status = status;
    this._notify(this.onStatus, message, code);
  }

  _progress(session, value) {
    if (!this._current(session) || session.progress === value) return;
    session.progress = value;
    this._notify(this.onProgress, value);
  }

  _receive(event) {
    const session = this._session, data = event.data;
    if (!session || event.source !== this.frame.contentWindow || event.origin !== this.origin ||
        !isRecord(data) || data.channel !== CHANNEL || data.version !== VERSION ||
        typeof data.session !== 'string') return;
    if (data.type === 'hello') {
      if (data.session === '' || data.session === session.id) this._handshake();
      return;
    }
    if (data.session !== session.id) return;
    if (data.type === 'status') {
      if (!STATES.has(data.state) || typeof data.message !== 'string' || data.message.length > 500) return;
      session.state = data.state;
      if (data.state !== 'ready') this._reset(session);
      this._status(session, data.state === 'ready'
        ? (this._enabled ? READY : 'Lab camera on. Wave gesture detection paused.') : data.message,
      data.state === 'ready' && !this._enabled ? 'paused' : data.state);
      return;
    }
    if (data.type !== 'frame' || session.state !== 'ready' || !validFrame(data) ||
        data.seq <= session.seq || data.timestamp <= session.timestamp) return;
    const now = this._window.performance.now();
    if (session.receivedAt !== null && now - session.receivedAt > STALE_MS) this._reset(session);
    session.seq = data.seq; session.timestamp = data.timestamp; session.receivedAt = now;
    if (!this._enabled) return;
    // Child timestamps only reject replays. Gesture timing uses our own clock.
    const result = session.detector.update(data.landmarks, now, {width: data.width, height: data.height});
    this._status(session, result.message, result.phase);
    this._progress(session, result.progress);
    if (result.triggered && this._enabled && this._current(session) && !session.triggered) {
      session.triggered = true; this._enabled = false; session.detector.reset();
      this._status(session, 'Clap detected. The lab camera stays on.', 'triggered');
      if (this._current(session) && session.triggered) this._notify(this.onTrigger);
    }
  }
}
