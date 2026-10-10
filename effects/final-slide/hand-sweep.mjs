/** Hand-only horizontal-to-upright clap gesture. No body landmarks are used. */
const HOLD_MS = 400, END_HOLD_MS = 150, MAX_GAP_MS = 400;
const READY = 'Hold both hands horizontally, then turn them upright and bring them closer.';
const clamp = value => Math.max(0, Math.min(1, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class HandSweep {
  constructor() { this.reset(); }
  reset() {
    this.phase = 'idle'; this.progress = 0;
    this.lastSampleAt = this.lastValidAt = null;
    this.holdElapsed = this.endElapsed = 0;
    this.lastHorizontal = this.lastUpright = false;
    this.baseline = this.previous = null;
    this.armedAt = this.sweepAt = null;
    this.peaks = [0, 0]; this.passedMiddle = [false, false];
  }
  result(message = READY, triggered = false) {
    return {phase: this.phase, progress: this.progress, message, triggered};
  }
  restart(message = READY) { this.reset(); return this.result(message); }
  update(landmarks, now, {width = 1, height = 1} = {}) {
    if (this.phase === 'complete') return this.result('Hand clap gesture confirmed.');
    if (!Number.isFinite(now)) return this.restart();
    let previousAt = this.lastSampleAt;
    if (previousAt !== null && (now <= previousAt || now - previousAt > MAX_GAP_MS)) {
      this.reset(); previousAt = null;
    }
    this.lastSampleAt = now;
    const measured = measureHands(landmarks, width, height);
    if (!measured) {
      this.holdElapsed = this.endElapsed = 0;
      this.lastHorizontal = this.lastUpright = false;
      if (this.lastValidAt !== null && now - this.lastValidAt > MAX_GAP_MS) this.reset();
      return this.result('Keep both hands visible and slightly apart.');
    }
    // Model output order and handedness labels can change from frame to frame.
    const hands = matchHands(measured, this.previous);
    const dt = previousAt !== null && previousAt === this.lastValidAt ? now - previousAt : 0;
    this.lastValidAt = now;
    const gap = distance(hands[0].center, hands[1].center);
    const horizontal = hands.every(hand => Math.abs(hand.angle) <= 25 && hand.open) &&
      gap > Math.max(.075, (hands[0].size + hands[1].size) * 1.2);
    if (this.phase === 'idle') {
      this.holdElapsed = horizontal ? this.holdElapsed + (this.lastHorizontal ? dt : 0) : 0;
      this.lastHorizontal = horizontal;
      this.progress = .18 * clamp(this.holdElapsed / HOLD_MS);
      this.previous = hands;
      if (this.holdElapsed < HOLD_MS) return this.result(horizontal ? 'Hold both hands horizontally…' : READY);
      this.phase = 'armed'; this.armedAt = now;
      this.baseline = {hands, gap};
      this.peaks = hands.map(hand => hand.angle);
      return this.result('Turn both hands upright and bring them closer, like clapping.');
    }

    const angles = hands.map(hand => hand.angle);
    const ratio = gap / this.baseline.gap;
    if (angles.some(angle => angle < -30) || Math.abs(angles[0] - angles[1]) > 38 || ratio > 1.6 ||
        hands.some((hand, i) => {
          const scale = hand.size / this.baseline.hands[i].size;
          return scale < .5 || scale > 1.8;
        })) return this.restart('Start again with both hands horizontal.');

    for (let i = 0; i < 2; i++) {
      // Reject abrupt jumps and large reversals but permit ordinary tracking jitter.
      const maxAngleStep = Math.max(32, (dt || 100) * .4 + 5);
      const maxTravel = this.baseline.gap * Math.max(.24, (dt || 100) / 500);
      if (Math.abs(angles[i] - this.previous[i].angle) > maxAngleStep ||
          this.peaks[i] - angles[i] > 25 || distance(hands[i].center, this.previous[i].center) > maxTravel) {
        return this.restart('Turn both hands upward smoothly, then bring them closer.');
      }
      this.peaks[i] = Math.max(this.peaks[i], angles[i]);
      if (angles[i] >= 30 && angles[i] <= 65) this.passedMiddle[i] = true;
    }
    this.previous = hands;
    if (this.phase === 'armed') {
      if (now - this.armedAt > 4000) return this.restart();
      if (Math.max(...angles) <= 28) return this.result('Turn both hands upright together.');
      this.phase = 'sweeping'; this.sweepAt = now;
    }
    if (now - this.sweepAt > 3500) return this.restart('Start again and make one continuous clap gesture.');
    // Convergence prevents ordinary palm rotation while manipulating the lab from firing.
    // Trigger before actual contact, where the hands can occlude one another.
    const upright = hands.every(hand => hand.angle >= 65 && hand.open) && ratio <= .78;
    this.endElapsed = upright ? this.endElapsed + (this.lastUpright ? dt : 0) : 0;
    this.lastUpright = upright;
    this.progress = .18 + .66 * clamp(Math.min(...angles) / 75);
    if (upright) this.progress = .84 + .16 * clamp(this.endElapsed / END_HOLD_MS);
    if (upright && this.endElapsed >= END_HOLD_MS && now - this.sweepAt >= 300 && this.passedMiddle.every(Boolean)) {
      this.phase = 'complete'; this.progress = 1;
      return this.result('Hand clap gesture confirmed.', true);
    }
    return this.result(upright ? 'Hold both hands upright briefly…' : 'Turn both hands upright and bring them closer.');
  }
}

function matchHands(hands, previous) {
  if (!previous) return hands.sort((a, b) => a.center.x - b.center.x);
  const direct = distance(hands[0].center, previous[0].center) + distance(hands[1].center, previous[1].center);
  const swapped = distance(hands[1].center, previous[0].center) + distance(hands[0].center, previous[1].center);
  return swapped < direct ? [hands[1], hands[0]] : hands;
}

function measureHands(landmarks, width, height) {
  if (!Array.isArray(landmarks) || landmarks.length !== 2 ||
      !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const aspect = width / height;
  const hands = [landmarks[0], landmarks[1]].map(points => {
    if (!Array.isArray(points) || points.length < 21) return null;
    const core = [0, 5, 9, 13, 17].map(i => points[i]);
    if (core.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
        p.x < .005 || p.x > .995 || p.y < .005 || p.y > .995)) return null;
    const palm = core.map(p => ({x: p.x * aspect, y: p.y}));
    const [wrist, , middle] = palm;
    const dx = middle.x - wrist.x, dy = middle.y - wrist.y;
    const size = Math.hypot(dx, dy);
    if (size < .018 || size > .45) return null;
    const center = palm.reduce((c, p) => ({x: c.x + p.x / 5, y: c.y + p.y / 5}), {x: 0, y: 0});
    // Two visible extended fingers distinguish an open-handed clap from a grab.
    // Fingers may flex during rotation; only starting and finishing holds use this.
    const extended = [5, 9, 13, 17].filter(i => {
      const base = points[i], tip = points[i + 3];
      if (!tip || !Number.isFinite(tip.x) || !Number.isFinite(tip.y)) return false;
      const b = {x: base.x * aspect, y: base.y}, t = {x: tip.x * aspect, y: tip.y};
      return distance(wrist, t) >= distance(wrist, b) * 1.3;
    }).length;
    return {center, size, open: extended >= 2, angle: Math.atan2(-dy, Math.abs(dx)) * 180 / Math.PI};
  });
  if (hands.some(hand => !hand)) return null;
  if (distance(hands[0].center, hands[1].center) < Math.min(hands[0].size, hands[1].size) * .45) return null;
  return hands;
}
