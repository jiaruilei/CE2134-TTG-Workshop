/**
 * A temporal, two-arm gesture detector; no camera, DOM, or model dependency.
 * PoseLandmarker normalized image landmarks 11..16 must be visible in frame.
 * Horizontal hold 600ms -> coordinated outward arc 0.7..4.5s -> overhead 300ms.
 * Angles are measured in an aspect-corrected shoulder frame (roll <=30 degrees).
 * This recognizes a projected upper-body gesture, not anatomical 3D motion.
 */
const HOLD_MS = 600, END_HOLD_MS = 300, MAX_GAP_MS = 350;
const MIN_SWEEP_MS = 700, MAX_SWEEP_MS = 4500, MAX_WAIT_MS = 4000;
const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
const dot = (a, b) => a.x * b.x + a.y * b.y;
const sub = (a, b) => ({x: a.x - b.x, y: a.y - b.y});
const length = a => Math.hypot(a.x, a.y);
const READY = 'Stretch both arms out horizontally and hold briefly.';

export class ArmSweep {
  constructor() { this.reset(); }

  reset() {
    this.phase = 'idle';
    this.lastSampleAt = this.lastValidAt = null;
    this.holdElapsed = this.endElapsed = 0;
    this.lastHorizontal = this.lastOverhead = false;
    this.baseline = this.previous = null;
    this.peaks = [0, 0]; this.checkpoints = [0, 0];
    this.armedAt = this.sweepAt = null;
    this.progress = 0;
  }

  _result(message = READY, triggered = false) {
    return {phase: this.phase, progress: this.progress, message, triggered};
  }

  _restart(message = READY) { this.reset(); return this._result(message); }

  update(landmarks, now, {width = 1, height = 1} = {}) {
    if (this.phase === 'complete') return this._result('Arm sweep confirmed.');
    if (!Number.isFinite(now)) return this._restart();
    let previousAt = this.lastSampleAt;
    if (previousAt !== null && (now <= previousAt || now - previousAt > MAX_GAP_MS)) {
      this.reset(); previousAt = null;
    }
    this.lastSampleAt = now;
    const pose = measure(landmarks, width, height);
    if (!pose) {
      this.holdElapsed = this.endElapsed = 0;
      this.lastHorizontal = this.lastOverhead = false;
      if (this.lastValidAt !== null && now - this.lastValidAt > MAX_GAP_MS) this.reset();
      return this._result('Step back so both shoulders, elbows and wrists are visible.');
    }
    // No hold time is credited across an invalid/dropped inference sample.
    const dt = previousAt !== null && previousAt === this.lastValidAt ? now - previousAt : 0;
    this.lastValidAt = now;
    const horizontal = pose.arms.every(arm => Math.abs(arm.angle) <= 18 && arm.outward >= 0.8);
    if (this.phase === 'idle') {
      this.holdElapsed = horizontal ? this.holdElapsed + (this.lastHorizontal ? dt : 0) : 0;
      this.lastHorizontal = horizontal;
      this.progress = 0.18 * clamp(this.holdElapsed / HOLD_MS, 0, 1);
      if (this.holdElapsed < HOLD_MS) return this._result(horizontal ? 'Hold both arms horizontally…' : READY);
      this.phase = 'armed'; this.armedAt = now;
      this.baseline = pose; this.previous = pose;
      this.peaks = pose.arms.map(arm => arm.angle);
      return this._result('Now sweep both straight arms upward in a wide arc.');
    }

    const scale = pose.span / this.baseline.span;
    const moved = length(sub(pose.center, this.baseline.center)) / this.baseline.span;
    const angles = pose.arms.map(arm => arm.angle);
    const lengthsStable = pose.arms.every((arm, i) => {
      const ratio = arm.length / this.baseline.arms[i].length;
      return ratio >= 0.7 && ratio <= 1.35;
    });
    if (scale < 0.7 || scale > 1.35 || moved > 0.55 || !lengthsStable ||
        angles.some(angle => angle < -22 || angle > 110) || Math.abs(angles[0] - angles[1]) > 30) {
      return this._restart('Reset: keep both arms straight and sweep them up together.');
    }
    if (this.phase === 'armed') {
      if (now - this.armedAt > MAX_WAIT_MS) return this._restart('Start again with both arms horizontal.');
      if (Math.max(...angles) <= 22) { this.previous = pose; return this._result('Sweep both arms upward together.'); }
      this.phase = 'sweeping'; this.sweepAt = now;
    }
    if (now - this.sweepAt > MAX_SWEEP_MS) return this._restart('Start again, then sweep up in one continuous motion.');
    for (let i = 0; i < 2; i++) {
      // Reject teleporting poses and large reversals, while tolerating tracking jitter.
      const maxStep = Math.max(27, (dt || 100) * 0.26 + 8);
      if (Math.abs(angles[i] - this.previous.arms[i].angle) > maxStep || this.peaks[i] - angles[i] > 20) {
        return this._restart('Start again with a smooth upward sweep.');
      }
      this.peaks[i] = Math.max(this.peaks[i], angles[i]);
      if (angles[i] >= 22 && angles[i] <= 45) this.checkpoints[i] |= 1;
      if (angles[i] >= 42 && angles[i] <= 66) this.checkpoints[i] |= 2;
      if (angles[i] >= 65 && angles[i] <= 87) this.checkpoints[i] |= 4;
    }
    this.previous = pose;
    this.progress = 0.18 + 0.66 * clamp(Math.min(...angles) / 80, 0, 1);
    const overhead = angles.every(angle => angle >= 75 && angle <= 105) &&
      pose.arms.every((arm, i) => arm.up - this.baseline.arms[i].up >= this.baseline.arms[i].length * 0.7);
    this.endElapsed = overhead ? this.endElapsed + (this.lastOverhead ? dt : 0) : 0;
    this.lastOverhead = overhead;
    if (overhead) this.progress = 0.84 + 0.16 * clamp(this.endElapsed / END_HOLD_MS, 0, 1);
    if (overhead && this.endElapsed >= END_HOLD_MS && now - this.sweepAt >= MIN_SWEEP_MS &&
        this.checkpoints.every(mask => mask === 7)) {
      this.phase = 'complete'; this.progress = 1;
      return this._result('Arm sweep confirmed.', true);
    }
    return this._result(overhead ? 'Hold both arms overhead…' : 'Keep sweeping both arms upward.');
  }
}

function measure(points, width, height) {
  if (!points || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const aspect = width / height, ids = [11, 12, 13, 14, 15, 16];
  const selected = ids.map(i => points[i]);
  if (selected.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
      !Number.isFinite(p.visibility) || p.visibility < 0.65 || (p.presence !== undefined && p.presence < 0.65) ||
      p.x < 0.015 || p.x > 0.985 || p.y < 0.015 || p.y > 0.985)) return null;
  const [left, right, leftElbow, rightElbow, leftWrist, rightWrist] = selected.map(p => ({x: p.x * aspect, y: p.y}));
  const across = sub(left, right), span = length(across);
  if (span < 0.055 || span > 0.75 || Math.abs(across.y) / span > 0.5) return null;
  const axis = {x: across.x / span, y: across.y / span};
  const up = axis.x > 0 ? {x: axis.y, y: -axis.x} : {x: -axis.y, y: axis.x};
  const arms = [[left, leftElbow, leftWrist, 1], [right, rightElbow, rightWrist, -1]].map(([shoulder, elbow, wrist, sign]) => {
    const upper = sub(elbow, shoulder), lower = sub(wrist, elbow), full = sub(wrist, shoulder);
    const upperLength = length(upper), lowerLength = length(lower), armLength = length(full) / span;
    if (upperLength < span * 0.25 || lowerLength < span * 0.25 || armLength < 0.85 || armLength > 2.8 ||
        dot(upper, lower) / (upperLength * lowerLength) < Math.cos(35 * Math.PI / 180)) return null;
    const outward = dot(full, axis) * sign / span, upward = dot(full, up) / span;
    return {outward, up: upward, length: armLength, angle: Math.atan2(upward, outward) * 180 / Math.PI};
  });
  if (arms.some(arm => !arm)) return null;
  return {arms, span, center: {x: (left.x + right.x) / 2, y: (left.y + right.y) / 2}};
}
