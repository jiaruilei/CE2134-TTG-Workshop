/**
 * A lightweight, finite-depth Airy gravity-wave approximation for the finale.
 * The rising mean level is a prescribed presentation transition, not a CFD
 * solution. Small, nonbreaking waves use omega^2 = g*k*tanh(k*h), phase
 * integration as depth changes, damped amplitudes and linear orbital flow.
 * Scene distances are treated as metres and animation time as seconds.
 * Reference: MIT 2.20 Marine Hydrodynamics, lecture 20, sections 6.2.2–6.2.4:
 * https://ocw.mit.edu/courses/2-20-marine-hydrodynamics-13-021-spring-2005/5d48a5937971d973fd8ca90c051a83f8_lecture20.pdf
 */
export const GRAVITY = 9.81;
export const FLOOR_Y = -4.75;
const TAU = 2 * Math.PI;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const smooth = (a, b, value) => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Direction, wavelength, relative amplitude and initial phase. Most energy
// travels toward the open front; a weaker crossed component adds interference.
export const WAVE_MODES = Object.freeze([
  [0.28, 0.96, 9.5, 0.56, 0.35],
  [-0.62, 0.78, 5.8, 0.28, 1.7],
  [0.88, 0.48, 3.0, 0.12, 3.1],
  [-0.78, -0.63, 1.45, 0.04, 4.5]
].map(([x, z, wavelength, weight, phase]) => {
  const length = Math.hypot(x, z), k = TAU / wavelength;
  return Object.freeze({x: x / length, z: z / length, k,
    kx: k * x / length, kz: k * z / length, wavelength, weight, phase});
}));

export function dispersion(k, depth, gravity = GRAVITY) {
  const waveNumber = Math.max(0, finite(k));
  return Math.sqrt(Math.max(0, finite(gravity, GRAVITY)) * waveNumber
    * Math.tanh(waveNumber * Math.max(0, finite(depth))));
}

export function waterLevel(progress) {
  const p = clamp(finite(progress), 0, 1);
  return -4.65 + 9.3 * p + 2 * smooth(0.7, 1, p);
}

export function surge(progress) {
  return 4.4 * smooth(0.42, 0.98, clamp(finite(progress), 0, 1));
}

/** One update per animation frame. The returned frame is shared by all renderers. */
export class WaveField {
  constructor() { this.reset(); }
  reset() { this.previous = null; }

  update({time = 0, progress = 0, intensity = 1} = {}) {
    const t = Math.max(0, finite(time));
    const p = clamp(finite(progress), 0, 1);
    const strength = clamp(finite(intensity, 1), 0, 1.5);
    const previous = this.previous;
    const restart = !previous || t < previous.time || p < previous.progress - 1e-5;
    const last = restart ? null : previous;
    const dt = last ? t - last.time : 0;
    const level = waterLevel(p), depth = level - FLOOR_Y;
    // The depth cap bounds the complete superposition, including shallow water.
    const cap = 0.18 * depth;
    const excitation = Math.min(cap, 0.56 * smooth(0.06, 0.8, depth)
      * (0.08 + 0.92 * Math.sin(Math.PI * p)) * strength);
    const frame = {time: t, progress: p, level, depth, front: surge(p),
      phases: new Float32Array(4), amplitudes: new Float32Array(4),
      frequencies: new Float32Array(4), fillVelocity: 0, totalAmplitude: 0};
    if (last && dt > 0) {
      // Low-pass the prescribed filling speed so grass does not receive an
      // impulsive acceleration from a large first frame or a minor timing jitter.
      const rate = (level - last.level) / dt;
      const blend = -Math.expm1(-dt / 0.18);
      frame.fillVelocity = last.fillVelocity + (rate - last.fillVelocity) * blend;
    } else if (last) frame.fillVelocity = last.fillVelocity;

    for (let i = 0; i < WAVE_MODES.length; i++) {
      const mode = WAVE_MODES[i], omega = dispersion(mode.k, depth);
      frame.frequencies[i] = omega;
      // Integrate frequency instead of using omega(current depth)*time, which
      // produces spurious acceleration whenever the water level changes.
      frame.phases[i] = last
        ? (last.phases[i] + 0.5 * (last.frequencies[i] + omega) * dt) % TAU
        : mode.phase;
      const target = excitation * mode.weight;
      const old = last ? last.amplitudes[i] : target;
      // Short ripples dissipate faster. Filling excites modes smoothly; after
      // filling, long waves settle gradually rather than stopping abruptly.
      const decay = target > old ? 2.2 : 0.25 + 0.06 * mode.k * mode.k;
      frame.amplitudes[i] = old + (target - old) * -Math.expm1(-decay * dt);
      frame.totalAmplitude += frame.amplitudes[i];
    }
    if (frame.totalAmplitude > cap) {
      const scale = cap / frame.totalAmplitude;
      frame.totalAmplitude = 0;
      for (let i = 0; i < 4; i++) {
        frame.amplitudes[i] *= scale;
        frame.totalAmplitude += frame.amplitudes[i];
      }
    }
    this.previous = frame;
    return frame;
  }
}

/** Exact analytic surface slopes; the shader below uses the same mode table. */
export function sampleWave(x, z, frame) {
  x = finite(x); z = finite(z);
  let height = frame.level, dx = 0, dz = 0;
  for (let i = 0; i < WAVE_MODES.length; i++) {
    const mode = WAVE_MODES[i];
    const theta = mode.kx * x + mode.kz * z - frame.phases[i];
    const a = frame.amplitudes[i], gradient = -a * Math.sin(theta);
    height += a * Math.cos(theta);
    dx += gradient * mode.kx;
    dz += gradient * mode.kz;
  }
  return {height, dx, dz};
}

/**
 * Linear wave orbital velocities plus a smooth prescribed filling current.
 * The vertical velocity is zero at the bed. Away from the free surface the
 * orbital field is divergence-free; the analytic filling field is too:
 * d(w)/dy = fillVelocity/depth and d(u_z)/dz = -fillVelocity/depth.
 * Air/water clipping and time-varying depth remain visual approximations.
 */
export function sampleFlow(x, y, z, frame) {
  x = finite(x); y = finite(y, FLOOR_Y); z = finite(z);
  if (y < FLOOR_Y || y > sampleWave(x, z, frame).height) return {x: 0, y: 0, z: 0};
  const heightAboveBed = clamp(y - FLOOR_Y, 0, frame.depth);
  let vx = 0, vy = frame.fillVelocity * heightAboveBed / frame.depth;
  let vz = frame.fillVelocity * (frame.front - z) / frame.depth;
  for (let i = 0; i < WAVE_MODES.length; i++) {
    const mode = WAVE_MODES[i], kh = mode.k * frame.depth;
    const ky = mode.k * heightAboveBed;
    // These scaled forms avoid sinh/cosh overflow at large kh and retain the
    // finite-depth return flow near the floor.
    const denominator = -Math.expm1(-2 * kh);
    const upper = Math.exp(ky - kh), lower = Math.exp(-ky - kh);
    const horizontal = (upper + lower) / denominator;
    const vertical = (upper - lower) / denominator;
    const theta = mode.kx * x + mode.kz * z - frame.phases[i];
    const speed = frame.amplitudes[i] * frame.frequencies[i];
    const u = speed * horizontal * Math.cos(theta);
    vx += u * mode.x;
    vz += u * mode.z;
    vy += speed * vertical * Math.sin(theta);
  }
  return {x: vx, y: vy, z: vz};
}

const glslFloat = value => Number(value).toPrecision(12);
/** Generated from WAVE_MODES: CPU surface, normals and GPU surface agree. */
export const WAVE_GLSL = `
uniform vec4 uWavePhase,uWaveAmplitude;
uniform float uWaveLevel;
vec3 water(vec2 q){
  vec3 result=vec3(uWaveLevel,0.0,0.0);
${WAVE_MODES.map((mode, i) => {
  const component = 'xyzw'[i];
  return `  {
    vec2 k=vec2(${glslFloat(mode.kx)},${glslFloat(mode.kz)});
    float theta=dot(k,q)-uWavePhase.${component};
    float a=uWaveAmplitude.${component};
    result+=vec3(a*cos(theta),-a*sin(theta)*k.x,-a*sin(theta)*k.y);
  }`;
}).join('\n')}
  return result;
}
`;
