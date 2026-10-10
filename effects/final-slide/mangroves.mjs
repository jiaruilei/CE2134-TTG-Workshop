/**
 * A sparse stand of rooted Rhizophora saplings, rendered from a transparent
 * three-column atlas. Geometry is shared by the WebGL and Canvas renderers.
 *
 * update() returns triangles with x,y,z,u,v,r,g,b,a (stride 9); UVs use the
 * image convention, with v=0 at the top. Roots end around pixel 987/1024.
 * The lower stem and stilt roots remain fixed. A damped cantilever supplies
 * gentle upper-stem motion from the same local water velocity as the waves.
 * This illustrative plant response is not a calibrated mangrove model.
 */
export const MANGROVE_ATLAS_URL = new URL('./assets/mangrove-saplings.png?v=a408ce6285e4', import.meta.url).href;

const FLOOR = -4.75;
// Calibrated from the transparent atlas: the lowest substantial root pixels
// in its three columns are at y=987, 986, and 988 (of 1024).
const ROOT_V = 987 / 1024;
// Fewer, wider strips keep broad leaves intact. The two basal strips are
// completely rigid; only the upper stem and crown bend.
const BANDS = [1, ROOT_V, .70, .55, .4, .2, 0];
const LAYOUT = [
  {x: .08, z: -6.8, height: 2.85, variant: 1},
  {x: -.74, z: -6.35, height: 3.55, variant: 0},
  {x: .76, z: -5.85, height: 3.25, variant: 2},
  {x: -.30, z: -4.2, height: 2.65, variant: 2},
  {x: -.65, z: -1.8, height: 2.65, variant: 1},
  {x: .58, z: -1.25, height: 2.45, variant: 0},
];

export class MangroveStand {
  constructor() {
    this.floor = FLOOR;
    this.segments = BANDS.length - 1;
    this.plants = LAYOUT.map(plant => ({
      rootX: plant.x, rootZ: plant.z, height: plant.height,
      variant: plant.variant, width: plant.height * .5 / ROOT_V,
      bendX: 0, bendZ: 0, speedX: 0, speedZ: 0,
      // Each ring contains a left and right point (xyz, xyz).
      rings: new Float32Array(BANDS.length * 6),
    }));
    this.count = this.plants.length * this.segments * 6;
    this.vertices = new Float32Array(this.count * 9);
    this.mesh = {vertices: this.vertices, count: this.count, stride: 9, plants: this.plants};
    this.lastTime = null;
  }

  update({time = 0, halfWidth = 8, sampleWater = dryWater} = {}) {
    time = finite(time);
    halfWidth = Math.max(.7, finite(halfWidth, 8));
    const reset = this.lastTime === null || time < this.lastTime;
    const dt = reset ? 0 : clamp(time - this.lastTime, 0, .12);
    this.lastTime = time;
    const steps = Math.max(1, Math.ceil(dt * 120));
    const step = dt / steps;
    let cursor = 0;
    for (const plant of this.plants) {
      // Viewport changes reposition the same six plants, never regenerate a
      // grid. A small margin keeps each crown within narrow tank side walls.
      const width = Math.min(plant.width, halfWidth * .7);
      const x = plant.rootX * Math.max(0, halfWidth - width * .55);
      const z = plant.rootZ;
      const surface = sampleWater(x, FLOOR + plant.height * .52, z) || {};
      const level = finite(surface.height, FLOOR - 1);
      const wetLength = clamp(level - FLOOR, 0, plant.height);
      const wet = wetLength / plant.height;
      // Query inside the wet part, including while the crown remains in air.
      const flow = wetLength > 0
        ? sampleWater(x, FLOOR + wetLength * .55, z) || {}
        : {};
      const vx = clamp(finite(flow.velocityX), -3, 3);
      const vz = clamp(finite(flow.velocityZ), -3, 3);
      // The loading moment grows with immersion; short stilt roots and woody
      // lower stems deflect much less than a submerged leafy crown.
      const loading = wet * wet * (.22 + .78 * smooth(wet));
      const stiffness = 22;
      const damping = 2 * Math.sqrt(stiffness) * .9;
      const maxBend = plant.height * .12;
      if (reset) plant.bendX = plant.bendZ = plant.speedX = plant.speedZ = 0;
      for (let substep = 0; substep < steps; substep++) {
        const relativeX = vx - plant.speedX;
        const relativeZ = vz - plant.speedZ;
        const speed = Math.min(3, Math.hypot(relativeX, relativeZ));
        const drag = 3.7 * loading * speed;
        plant.speedX += (relativeX * drag - plant.bendX * stiffness - plant.speedX * damping) * step;
        plant.speedZ += (relativeZ * drag - plant.bendZ * stiffness - plant.speedZ * damping) * step;
        plant.bendX = clamp(plant.bendX + plant.speedX * step, -maxBend, maxBend);
        plant.bendZ = clamp(plant.bendZ + plant.speedZ * step, -maxBend, maxBend);
        // Avoid accumulating hidden momentum while a bounded crown is held
        // against a very large current.
        if (Math.abs(plant.bendX) === maxBend && Math.sign(plant.speedX) === Math.sign(plant.bendX)) plant.speedX = 0;
        if (Math.abs(plant.bendZ) === maxBend && Math.sign(plant.speedZ) === Math.sign(plant.bendZ)) plant.speedZ = 0;
      }
      for (let ring = 0; ring < BANDS.length; ring++) {
        const fraction = (ROOT_V - BANDS[ring]) / ROOT_V;
        const flexible = clamp((fraction - .30) / .70, 0, 1);
        // Smooth cantilever shape has zero displacement and slope at the
        // rigid lower stem. Leaves move with the crown, without flutter noise.
        const bend = flexible * flexible * (3 - flexible) * .5;
        const dx = plant.bendX * bend;
        const dz = plant.bendZ * bend;
        // Second-order shortening is subtle and keeps the upper stem from
        // visibly stretching as its tip moves sideways.
        const shortening = (dx * dx + dz * dz) / (2 * plant.height);
        const y = FLOOR + fraction * plant.height - shortening;
        plant.rings.set([x - width * .5 + dx, y, z + dz,
          x + width * .5 + dx, y, z + dz], ring * 6);
      }
      for (let segment = 0; segment < this.segments; segment++) {
        for (const [ringOffset, side] of TRIANGLE_POINTS) {
          const ring = segment + ringOffset;
          const offset = ring * 6 + side * 3;
          // Half a texel inset prevents filtering from picking up an adjacent
          // atlas column. The top/bottom inset likewise preserves edge alpha.
          const u = (plant.variant + (side ? 1 - .5 / 512 : .5 / 512)) / 3;
          const v = clamp(BANDS[ring], .5 / 1024, 1 - .5 / 1024);
          this.vertices.set([plant.rings[offset], plant.rings[offset + 1], plant.rings[offset + 2],
            u, v, 1, 1, 1, 1], cursor);
          cursor += 9;
        }
      }
    }
    return this.mesh;
  }

  reset() { this.lastTime = null; }
}

const TRIANGLE_POINTS = [[0, 0], [0, 1], [1, 1], [0, 0], [1, 1], [1, 0]];
const dryWater = () => ({height: -6, velocityX: 0, velocityY: 0, velocityZ: 0});
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const smooth = value => value * value * (3 - 2 * value);
