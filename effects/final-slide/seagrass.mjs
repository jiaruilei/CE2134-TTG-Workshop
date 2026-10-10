/**
 * A small rooted seagrass meadow shared by the WebGL and Canvas renderers.
 *
 * update({time, halfWidth, sampleWater}) returns a reusable triangle buffer:
 * x, y, z, red, green, blue, alpha (stride 7). sampleWater(x,y,z) supplies
 * {height, velocityX, velocityY, velocityZ} in the tank's world coordinates.
 *
 * The blades are inextensible segmented ribbons. Submergence adds a buoyant
 * restoring force; quadratic relative-flow drag bends them, while inertia and
 * damping delay their response. This is a reduced flexible-blade model, not a
 * calibrated vegetation solver. No independent time-driven waving is added.
 */
export class SeagrassBed {
  constructor() {
    this.floor = -4.75;
    this.segments = 6;
    this.blades = [];
    // Keeping fixed counts and normalized root positions prevents plants from
    // appearing or disappearing when the viewport's aspect ratio changes.
    const rows = [{count: 5, z: -7.15}, {count: 6, z: -4.45}, {count: 9, z: -1.4}];
    let tuft = 0;
    for (const row of rows) {
      for (let column = 0; column < row.count; column++, tuft++) {
        const x = ((column + .5) / row.count * 2 - 1) * .95
          + (random(tuft * 19 + 1) - .5) * .065;
        const z = row.z + (random(tuft * 19 + 2) - .5) * 1.15;
        for (let leaf = 0; leaf < 3; leaf++) {
          const seed = tuft * 31 + leaf * 137;
          const angle = (leaf - 1) * .72 + (random(seed + 3) - .5) * .45;
          const height = (1.3 + random(seed + 4) * 1.1) * (z < -5.5 ? .76 : z < -3 ? .88 : 1);
          this.blades.push({
            rootX: x, rootZ: z, offsetX: (leaf - 1) * .055,
            offsetZ: (random(seed + 5) - .5) * .085,
            height, width: .043 + random(seed + 6) * .026,
            angle, leanX: Math.sin(angle) * (.78 + random(seed + 7) * .6),
            leanZ: (random(seed + 8) - .5) * .9,
            green: .48 + random(seed + 9) * .14,
            hue: random(seed + 10),
            bendX: 0, bendZ: 0, speedX: 0, speedZ: 0,
            rings: new Float32Array((this.segments + 1) * 9),
          });
        }
      }
    }
    // Painter's order also works when the renderer has no depth buffer.
    this.blades.sort((a, b) => (a.rootZ + a.offsetZ) - (b.rootZ + b.offsetZ));
    this.count = this.blades.length * this.segments * 12;
    this.vertices = new Float32Array(this.count * 7);
    this.mesh = {vertices: this.vertices, count: this.count, stride: 7};
    this.lastTime = null;
  }

  update({time = 0, halfWidth = 8, sampleWater = dryWater} = {}) {
    time = finite(time);
    halfWidth = Math.max(.7, finite(halfWidth, 8));
    const reset = this.lastTime === null || time < this.lastTime;
    const dt = reset ? 0 : clamp(time - this.lastTime, 0, .12);
    this.lastTime = time;
    const steps = Math.max(1, Math.ceil(dt * 90));
    const step = dt / steps;
    let cursor = 0;
    for (const blade of this.blades) {
      const x = blade.rootX * (halfWidth - .42) + blade.offsetX;
      const z = blade.rootZ + blade.offsetZ;
      const water = sampleWater(x, this.floor + blade.height * .48, z) || {};
      const level = finite(water.height, this.floor - 1);
      const submergedLength = clamp(level - this.floor, 0, blade.height);
      const wet = smooth(submergedLength / blade.height);
      // During filling the whole-blade midpoint can still be in air. Sample
      // drag inside the wetted portion so the first shallow water moves it.
      const flow = submergedLength > 0 && submergedLength < blade.height
        ? sampleWater(x, this.floor + submergedLength * .48, z) || {}
        : water;
      const vx = clamp(finite(flow.velocityX), -2.5, 2.5);
      const vz = clamp(finite(flow.velocityZ), -2.5, 2.5);
      const restX = blade.leanX * (1 - wet * .78);
      const restZ = blade.leanZ * (1 - wet * .78);
      const stiffness = 12 + wet * 8;
      const damping = 1.6 * Math.sqrt(stiffness);
      if (reset) {
        blade.bendX = restX;
        blade.bendZ = restZ;
        blade.speedX = blade.speedZ = 0;
      }
      for (let substep = 0; substep < steps; substep++) {
        const relativeX = vx - blade.speedX * blade.height * .3;
        const relativeZ = vz - blade.speedZ * blade.height * .3;
        const speed = Math.hypot(relativeX, relativeZ);
        const drag = 16 * wet * Math.min(speed, 3);
        blade.speedX += ((restX - blade.bendX) * stiffness
          + relativeX * drag - blade.speedX * damping) * step;
        blade.speedZ += ((restZ - blade.bendZ) * stiffness
          + relativeZ * drag - blade.speedZ * damping) * step;
        blade.bendX = clamp(blade.bendX + blade.speedX * step, -2.4, 2.4);
        blade.bendZ = clamp(blade.bendZ + blade.speedZ * step, -2.4, 2.4);
      }
      // Integrate unit tangents: every segment retains its length as the leaf
      // bends. All three vertices of the base ring remain fixed to the floor.
      let cx = x, cy = this.floor, cz = z;
      for (let ring = 0; ring <= this.segments; ring++) {
        const u = ring / this.segments;
        if (ring) {
          const flexibility = ((ring - .5) / this.segments) ** 1.35;
          let tx = blade.bendX * flexibility;
          const tz = blade.bendZ * flexibility;
          // Blades close to a side wall bend along it instead of clipping out
          // of the container; the bed is not regenerated on resize.
          const edge = Math.max(0, (Math.abs(cx) - (halfWidth - .25)) / .25);
          if (Math.sign(tx) === Math.sign(cx)) tx *= 1 - clamp(edge, 0, 1);
          const scale = blade.height / this.segments / Math.hypot(tx, 1, tz);
          cx += tx * scale; cy += scale; cz += tz * scale;
        }
        const width = blade.width * (.24 + .76 * Math.sin(Math.PI * u)) * (1 - u ** 4);
        const twist = blade.angle * .28 + u * blade.bendX * .11;
        const wx = Math.cos(twist) * width;
        const wz = Math.sin(twist) * width;
        const offset = ring * 9;
        blade.rings.set([cx - wx, cy, cz - wz, cx, cy, cz + width * .16, cx + wx, cy, cz + wz], offset);
      }
      for (let segment = 0; segment < this.segments; segment++) {
        // Two subtly different faces provide a visible central blade ridge.
        for (const [a, b, c, shade] of FACES) {
          cursor = this.vertex(blade, segment, a, shade, level, cursor);
          cursor = this.vertex(blade, segment, b, shade, level, cursor);
          cursor = this.vertex(blade, segment, c, shade, level, cursor);
        }
      }
    }
    return this.mesh;
  }

  vertex(blade, segment, point, shade, level, cursor) {
    const ring = segment + (point >= 3 ? 1 : 0);
    const offset = ring * 9 + (point % 3) * 3;
    const u = ring / this.segments;
    const x = blade.rings[offset], y = blade.rings[offset + 1], z = blade.rings[offset + 2];
    const underwater = smooth(clamp((level - y) * 2, 0, 1));
    const light = (.66 + u * .45) * shade;
    // A little cyan scattering keeps deep leaves in the same water palette.
    const r = (.14 + blade.hue * .055) * light * (1 - underwater * .18);
    const g = blade.green * light;
    const b = (.16 + blade.hue * .04) * light + underwater * .11;
    this.vertices.set([x, y, z, r, g, b, .96], cursor);
    return cursor + 7;
  }

  reset() { this.lastTime = null; }
}

// Ring points are left=0, ridge=1, right=2; upper ring adds three.
const FACES = [[0, 1, 4, .82], [0, 4, 3, .82], [1, 2, 5, 1.12], [1, 5, 4, 1.12]];
const dryWater = () => ({height: -6, velocityX: 0, velocityY: 0, velocityZ: 0});
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const smooth = value => value * value * (3 - 2 * value);
const random = seed => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
};
