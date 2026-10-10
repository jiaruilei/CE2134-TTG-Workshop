import test from 'node:test';
import assert from 'node:assert/strict';
import {WaveField, WAVE_MODES, WAVE_GLSL, GRAVITY, FLOOR_Y,
  dispersion, sampleWave, sampleFlow, waterLevel, surge} from './wave-physics.mjs';

const close = (actual, expected, tolerance = 1e-5) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

test('dispersion has the shallow and deep water limits and increases with depth', () => {
  const k = 0.8;
  close(dispersion(k, 1e-5) / k, Math.sqrt(GRAVITY * 1e-5), 1e-8);
  close(dispersion(k, 100), Math.sqrt(GRAVITY * k), 1e-10);
  assert.ok(dispersion(k, 0.3) < dispersion(k, 2));
  assert.ok(dispersion(k, 2) < dispersion(k, 6));
  close(dispersion(0, 4), 0);
});

test('at fixed depth phase advances by the physical frequency', () => {
  const field = new WaveField();
  const first = field.update({time: 12, progress: 0.4});
  const next = field.update({time: 12.25, progress: 0.4});
  for (let i = 0; i < 4; i++) {
    close(angleDifference(next.phases[i], first.phases[i]),
      dispersion(WAVE_MODES[i].k, first.depth) * 0.25, 5e-7);
  }
});

test('changing depth does not reset phase or multiply new frequency by elapsed time', () => {
  const field = new WaveField();
  const before = field.update({time: 800, progress: 0.2});
  const after = field.update({time: 800, progress: 0.6});
  assert.deepEqual(after.phases, before.phases);
  const reset = field.update({time: 801, progress: 0});
  WAVE_MODES.forEach((mode, i) => close(reset.phases[i], mode.phase, 3e-7));
  close(reset.fillVelocity, 0);
});

test('phase integration converges while depth rises', () => {
  function run(fps) {
    const field = new WaveField();
    for (let n = 0; n <= fps * 6; n++) field.update({time: n / fps, progress: n / (fps * 6)});
    return field.previous;
  }
  const normal = run(60), fine = run(600);
  normal.phases.forEach((phase, i) => close(angleDifference(phase, fine.phases[i]), 0, 0.002));
});

test('surface is bounded, remains above the floor and has exact spatial derivatives', () => {
  const field = new WaveField();
  for (let n = 0; n <= 160; n++) {
    const frame = field.update({time: n / 10, progress: Math.min(1, n / 70)});
    assert.ok(frame.totalAmplitude <= 0.18 * frame.depth + 1e-7);
    for (let i = 0; i < 13; i++) {
      const x = -9 + i * 1.5, z = -8.5 + i;
      const wave = sampleWave(x, z, frame), epsilon = 1e-4;
      assert.ok(Math.abs(wave.height - frame.level) <= frame.totalAmplitude + 1e-8);
      assert.ok(wave.height > FLOOR_Y);
      close(wave.dx, (sampleWave(x + epsilon, z, frame).height
        - sampleWave(x - epsilon, z, frame).height) / (2 * epsilon), 1e-7);
      close(wave.dz, (sampleWave(x, z + epsilon, frame).height
        - sampleWave(x, z - epsilon, frame).height) / (2 * epsilon), 1e-7);
    }
  }
});

test('orbital and filling flow satisfy no bed penetration and interior continuity', () => {
  const field = new WaveField();
  field.update({time: 0, progress: 0.3});
  const frame = field.update({time: 0.05, progress: 0.31});
  close(sampleFlow(1, FLOOR_Y, -3, frame).y, 0, 1e-12);
  const x = 1, y = FLOOR_Y + frame.depth * 0.45, z = -3, e = 1e-4;
  const divergence = (sampleFlow(x + e, y, z, frame).x - sampleFlow(x - e, y, z, frame).x
    + sampleFlow(x, y + e, z, frame).y - sampleFlow(x, y - e, z, frame).y
    + sampleFlow(x, y, z + e, frame).z - sampleFlow(x, y, z - e, frame).z) / (2 * e);
  close(divergence, 0, 1e-7);
  assert.deepEqual(sampleFlow(1, frame.level + 2, -3, frame), {x: 0, y: 0, z: 0});
});

test('orbital surface velocity satisfies the linear kinematic boundary condition', () => {
  const field = new WaveField();
  const frame = field.update({time: 0, progress: 0.5});
  // Choose a crest so the mean surface is submerged and sampler clipping is inactive.
  const x = 1, z = -3;
  const sample = {...frame, phases: new Float32Array(WAVE_MODES.map(m => m.kx * x + m.kz * z - 0.15))};
  const flow = sampleFlow(x, frame.level, z, sample);
  const expected = WAVE_MODES.reduce((sum, mode, i) => sum + frame.amplitudes[i]
    * frame.frequencies[i] * Math.sin(mode.kx * x + mode.kz * z - sample.phases[i]), 0);
  close(flow.y, expected, 1e-7);
});

test('holding a full tank damps waves and filling current continuously', () => {
  const field = new WaveField();
  for (let i = 0; i <= 70; i++) field.update({time: i / 10, progress: i / 70});
  const start = field.previous;
  const end = field.update({time: 13, progress: 1});
  assert.ok(end.totalAmplitude < start.totalAmplitude);
  assert.ok(end.fillVelocity < start.fillVelocity * 0.01);
  assert.ok(end.totalAmplitude > 0);
});

test('invalid and boundary inputs remain finite and safe', () => {
  const field = new WaveField();
  for (const input of [{}, {time: NaN, progress: Infinity, intensity: NaN},
    {time: -5, progress: -3, intensity: -1}, {time: 1e5, progress: 4, intensity: 8},
    {time: 0, progress: 0}]) {
    const frame = field.update(input);
    const numbers = [frame.level, frame.depth, frame.front, frame.fillVelocity, frame.totalAmplitude,
      ...frame.phases, ...frame.amplitudes, ...frame.frequencies,
      ...Object.values(sampleWave(NaN, Infinity, frame)),
      ...Object.values(sampleFlow(NaN, Infinity, NaN, frame))];
    assert.ok(numbers.every(Number.isFinite));
  }
  assert.equal(waterLevel(-2), waterLevel(0));
  assert.equal(surge(3), surge(1));
});

test('GLSL coefficients are generated from every CPU wave mode', () => {
  assert.equal((WAVE_GLSL.match(/float theta=/g) || []).length, WAVE_MODES.length);
  for (const mode of WAVE_MODES) {
    assert.ok(WAVE_GLSL.includes(mode.kx.toPrecision(12)));
    assert.ok(WAVE_GLSL.includes(mode.kz.toPrecision(12)));
  }
});
