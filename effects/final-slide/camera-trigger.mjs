/**
 * Two-hand gesture trigger for the presentation's final slide.
 * The presentation starts/stops this on slide entry/exit. No frames are saved,
 * recorded, or uploaded: the video is passed directly to local WASM inference.
 * First use needs internet for these pinned library/model downloads.
 *
 * API: onStatus(message, code), onProgress(fraction 0..1), onTrigger().
 * start() resolves true when ready, false after cancellation or an expected error.
 * active includes permission/loading. setEnabled(false) suspends inference while
 * leaving camera video on; setEnabled(true) requires a fresh gesture sequence.
 * A trigger disables inference before calling onTrigger and keeps tracks alive.
 * stop() permits a new session; dispose() permanently disables this instance.
 *
 * Verified 2026-10-10 against Google's guide, API, and maintained example:
 * https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js
 * https://developers.google.com/edge/api/mediapipe/js/tasks-vision.handlandmarker
 * https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/workers/hand-landmarker.worker.ts
 * https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/package.json
 */

import { HandSweep } from './hand-sweep.mjs?v=b77d94e5ba45';

const VERSION = "1.1.0";
const LIBRARY_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const FRAME_INTERVAL_MS = 1000 / 12;
const STARTUP_GRACE_MS = 600;
const MAX_HAND_GAP_MS = 350;
const FRAME_TIMEOUT_MS = 8000;
const LOAD_TIMEOUT_MS = 60000;

const abortError = () => new DOMException("Camera session cancelled", "AbortError");
const stopTracks = stream => stream?.getTracks().forEach(track => track.stop());
const closeRecognizer = recognizer => {
  try { recognizer?.close(); } catch { /* Cleanup must not block camera release. */ }
};

export class CameraTrigger {
  constructor({ video, onStatus = () => {}, onProgress = () => {}, onTrigger = () => {} } = {}) {
    if (!video || typeof video.play !== "function") {
      throw new TypeError("CameraTrigger requires a video element.");
    }
    this.video = video;
    this.onStatus = onStatus;
    this.onProgress = onProgress;
    this.onTrigger = onTrigger;
    this._document = video.ownerDocument;
    this._window = this._document.defaultView;
    this._session = null;
    this._disposed = false;
    this._enabled = true;
  }

  get active() {
    return !!this._session && !this._session.cancelled;
  }

  setEnabled(enabled) {
    this._enabled = !!enabled;
    const session = this._session;
    if (!session) return;
    session.detector.reset();
    session.triggered = false;
    session.graceUntil = this._window.performance.now() + STARTUP_GRACE_MS;
    this._progress(session, 0);
    if (session.phase === 'tracking') this._status(session,
      this._enabled ? 'Hold both hands horizontally, then turn them upright and bring them closer.' : 'Camera on. Gesture detection paused.',
      this._enabled ? 'ready' : 'paused');
  }

  async start() {
    if (this._disposed) return false;
    if (this.active) return this._session.startPromise;
    if (this._window.isSecureContext === false) {
      this._notify(this.onStatus, "Camera access needs localhost or HTTPS. You can still continue without the camera.", "error");
      return false;
    }
    if (!this._window.navigator.mediaDevices?.getUserMedia) {
      this._notify(this.onStatus, "This browser cannot open a camera. Try Chrome or Edge, or continue without it.", "error");
      return false;
    }
    if (this._document.hidden) {
      this._notify(this.onStatus, "Return to this page before starting the camera.", "stopped");
      return false;
    }

    const session = {
      controller: new AbortController(), cancelled: false, triggered: false,
      stream: null, recognizer: null, raf: null, trackListeners: [],
      progress: -1, lastStatus: "", phase: "permission", detector: new HandSweep(),
      lastInferenceAt: -Infinity, lastVideoTime: -1,
    };
    this._session = session;
    session.onHidden = () => {
      if (this._document.hidden) this._finish(session, "Camera stopped because the page is hidden. Start it again when ready.", "stopped");
    };
    session.onPageHide = () => this._finish(session, "Camera stopped.", "stopped");
    session.onVideoError = () => this._finish(session, "The camera preview could not play. Try again, or continue without the camera.", "error");
    this._document.addEventListener("visibilitychange", session.onHidden);
    this._window.addEventListener("pagehide", session.onPageHide);
    this.video.addEventListener("error", session.onVideoError);
    session.startPromise = this._startSession(session);
    return session.startPromise;
  }

  stop() {
    const session = this._session;
    if (!session) return;
    const message = session.phase === "permission"
      ? "Camera cancelled. You can dismiss any remaining permission prompt and continue without it."
      : "Camera stopped. You can continue without it.";
    this._finish(session, message, "stopped");
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.stop();
  }

  _isCurrent(session) {
    return this._session === session && !session.cancelled;
  }

  // UI callback failures must not leave a camera running or break cleanup.
  _notify(callback, ...args) {
    try { callback(...args); } catch (error) {
      console.warn("Camera trigger UI callback failed:", error);
    }
  }

  _status(session, message, code) {
    if (!this._isCurrent(session) || session.lastStatus === message) return;
    session.lastStatus = message;
    this._notify(this.onStatus, message, code);
  }

  _progress(session, fraction) {
    if (!this._isCurrent(session) || session.progress === fraction) return;
    session.progress = fraction;
    this._notify(this.onProgress, fraction);
  }

  // Permission prompts and dynamic imports cannot be aborted by the browser API.
  // Resolve cancellation immediately; late resources are closed by their owners.
  _wait(session, promise, timeoutMs = 0) {
    const signal = session.controller.signal;
    const observed = Promise.resolve(promise);
    if (signal.aborted) {
      observed.catch(() => {});
      return Promise.reject(abortError());
    }
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => { cleanup(); reject(abortError()); };
      signal.addEventListener("abort", onAbort, { once: true });
      if (timeoutMs) timer = setTimeout(() => {
        cleanup();
        reject(new DOMException("Camera setup timed out", "TimeoutError"));
      }, timeoutMs);
      observed.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
  }

  async _startSession(session) {
    try {
      this._progress(session, 0);
      this._status(session, "Allow camera access. First use needs internet; video stays on this device.", "requesting");
      if (!this._isCurrent(session)) return false;
      const pendingStream = this._window.navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 30 } },
      }).then(stream => {
        // A user can cancel while the browser's permission prompt is still open.
        if (!this._isCurrent(session)) stopTracks(stream);
        return stream;
      });
      const stream = await this._wait(session, pendingStream);
      if (!this._isCurrent(session)) { stopTracks(stream); return false; }
      session.stream = stream;
      for (const track of stream.getVideoTracks()) {
        const ended = () => this._finish(session, "The camera disconnected. Try again, or continue without it.", "error");
        track.addEventListener("ended", ended);
        session.trackListeners.push([track, ended]);
      }
      session.phase = "preview";
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.srcObject = stream;
      await this._wait(session, this.video.play(), 15000);
      await this._wait(session, this._videoReady(session), 15000);
      if (!this._isCurrent(session)) return false;

      session.phase = "model";
      this._status(session, "Loading hand tracking. First use needs internet; video stays local.", "loading");
      const recognizer = await this._wait(session, this._loadRecognizer(session), LOAD_TIMEOUT_MS);
      if (!this._isCurrent(session)) { closeRecognizer(recognizer); return false; }
      session.recognizer = recognizer;
      session.phase = "tracking";
      const now = this._window.performance.now();
      session.graceUntil = now + STARTUP_GRACE_MS;
      session.lastFreshFrameAt = now;
      this._status(session,
        this._enabled ? 'Hold both hands horizontally, then turn them upright and bring them closer.' : 'Camera on. Gesture detection paused.',
        this._enabled ? 'ready' : 'paused');
      if (this._isCurrent(session)) this._schedule(session);
      return this._isCurrent(session);
    } catch (error) {
      if (!this._isCurrent(session)) return false;
      this._finish(session, this._errorMessage(error, session.phase), "error");
      return false;
    }
  }

  _videoReady(session) {
    return new Promise((resolve, reject) => {
      const events = ["loadeddata", "canplay", "playing", "resize"];
      const cleanup = () => {
        events.forEach(event => this.video.removeEventListener(event, check));
        session.controller.signal.removeEventListener("abort", cancel);
      };
      const cancel = () => { cleanup(); reject(abortError()); };
      const check = () => {
        if (this.video.readyState >= 2 && this.video.videoWidth > 0) { cleanup(); resolve(); }
      };
      if (session.controller.signal.aborted) { cancel(); return; }
      session.controller.signal.addEventListener("abort", cancel, { once: true });
      events.forEach(event => this.video.addEventListener(event, check));
      check();
    });
  }

  async _loadRecognizer(session) {
    const { FilesetResolver, HandLandmarker } = await import(LIBRARY_URL);
    if (!this._isCurrent(session)) throw abortError();
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    if (!this._isCurrent(session)) throw abortError();
    const recognizer = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
      runningMode: "VIDEO", numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    if (!this._isCurrent(session)) {
      closeRecognizer(recognizer);
      throw abortError();
    }
    return recognizer;
  }

  _schedule(session) {
    if (this._isCurrent(session)) {
      session.raf = this._window.requestAnimationFrame(now => this._tick(session, now));
    }
  }

  _resetSequence(session) {
    session.detector.reset();
    this._progress(session, 0);
  }

  _tick(session, now) {
    if (!this._isCurrent(session)) return;
    session.raf = null;
    try {
      if (now - session.lastFreshFrameAt > FRAME_TIMEOUT_MS) {
        this._finish(session, "The camera stopped sending frames. Try again, or continue without it.", "error");
        return;
      }
      if (now - session.lastFreshFrameAt > MAX_HAND_GAP_MS) this._resetSequence(session);
      if (now - session.lastInferenceAt >= FRAME_INTERVAL_MS &&
          this.video.readyState >= 2 && this.video.currentTime !== session.lastVideoTime) {
        session.lastInferenceAt = now;
        session.lastVideoTime = this.video.currentTime;
        session.lastFreshFrameAt = now;
        if (this._enabled && now >= session.graceUntil) {
          const result = session.recognizer.detectForVideo(this.video, now);
          const sweep = session.detector.update(result.landmarks, now,
            {width: this.video.videoWidth, height: this.video.videoHeight});
          this._status(session, sweep.message, sweep.phase);
          this._progress(session, sweep.progress);
          if (sweep.triggered && this._enabled && this._isCurrent(session) && !session.triggered) {
            session.triggered = true;
            // Keep the preview alive while the effect runs. The host re-enables
            // recognition afterwards; reset requires a new hand gesture.
            this._enabled = false;
            session.detector.reset();
            this._status(session, 'Hand gesture confirmed. Camera stays on.', 'triggered');
            if (this._isCurrent(session) && session.triggered) this._notify(this.onTrigger);
          }
        }
      }
      this._schedule(session);
    } catch (error) {
      console.warn("Hand tracking inference failed:", error);
      this._finish(session, "Hand tracking stopped. Reload the page or continue without the camera.", "error");
    }
  }

  _finish(session, message, code, resetProgress = true) {
    if (!this._isCurrent(session)) return;
    session.cancelled = true;
    this._session = null;
    session.controller.abort();
    if (session.raf !== null) this._window.cancelAnimationFrame(session.raf);
    session.raf = null;
    this._document.removeEventListener("visibilitychange", session.onHidden);
    this._window.removeEventListener("pagehide", session.onPageHide);
    this.video.removeEventListener("error", session.onVideoError);
    session.trackListeners.forEach(([track, ended]) => track.removeEventListener("ended", ended));
    session.trackListeners.length = 0;
    stopTracks(session.stream);
    if (session.stream && this.video.srcObject === session.stream) {
      this.video.pause();
      this.video.srcObject = null;
    }
    closeRecognizer(session.recognizer);
    session.recognizer = null;
    session.stream = null;
    if (resetProgress) this._notify(this.onProgress, 0);
    this._notify(this.onStatus, message, code);
  }

  _errorMessage(error, phase) {
    if (phase === "permission") {
      if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "Camera access was not allowed. You can enable it in browser settings or continue without it.";
      if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") return "No camera was found. Connect one and try again, or continue without it.";
      if (error?.name === "NotReadableError" || error?.name === "TrackStartError") return "The camera is busy or unavailable. Close other camera apps and try again, or continue without it.";
      return "The camera could not start. Try again, or continue without it.";
    }
    if (phase === "model") return "Hand tracking could not load. Check your internet connection and reload, or continue without the camera.";
    return "The camera preview could not start. Try again, or continue without it.";
  }
}
