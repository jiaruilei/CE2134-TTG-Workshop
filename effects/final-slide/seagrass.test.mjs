import test from 'node:test';
import assert from 'node:assert/strict';
import {SeagrassBed} from './seagrass.mjs';

const stillWater = () => ({height: 1, velocityX: 0, velocityY: 0, velocityZ: 0});
const flowingWater = () => ({height: 1, velocityX: .8, velocityY: 0, velocityZ: .4});
const dryWater = () => ({height: -6, velocityX: 0, velocityY: 0, velocityZ: 0});
const frame = (bed, time, sampleWater, halfWidth = 8) => bed.update({time, halfWidth, sampleWater});

function rootVertices(mesh) {
  const values = [];
  for (let i = 0; i < mesh.vertices.length; i += mesh.stride) {
    if (mesh.vertices[i + 1] === -4.75) values.push(...mesh.vertices.slice(i, i + 3));
  }
  return values;
}

function meanTip(bed, axis) {
  return bed.blades.reduce((sum, blade) => sum + blade.rings[bed.segments * 9 + axis], 0) / bed.blades.length;
}

test('rising water and current leave every base vertex fixed', () => {
  const bed = new SeagrassBed();
  const before = rootVertices(frame(bed, 0, dryWater));
  for (let i = 1; i <= 240; i++) frame(bed, i / 60, flowingWater);
  assert.deepEqual(rootVertices(bed.mesh), before);
  assert.ok(before.length > 100, 'the check includes all blade roots');
});

test('still water has no invented time-driven blade motion', () => {
  const bed = new SeagrassBed();
  const before = frame(bed, 0, stillWater).vertices.slice();
  for (let i = 1; i <= 180; i++) frame(bed, i / 60, stillWater);
  assert.deepEqual(bed.vertices, before);
});

test('blades respond in the direction of the shared current', () => {
  const calm = new SeagrassBed(), flowing = new SeagrassBed();
  for (let i = 0; i <= 180; i++) {
    frame(calm, i / 60, stillWater);
    frame(flowing, i / 60, flowingWater);
  }
  assert.ok(meanTip(flowing, 0) - meanTip(calm, 0) > .25);
  assert.ok(meanTip(flowing, 2) - meanTip(calm, 2) > .12);
});

test('partially submerged blades sample drag below the water surface', () => {
  const calm = new SeagrassBed(), flowing = new SeagrassBed();
  const level = -4.75 + .35;
  let airSamples = 0, waterSamples = 0;
  const shallowCurrent = (_x, y) => {
    const submerged = y < level;
    if (submerged) waterSamples++; else airSamples++;
    return {height: level, velocityX: submerged ? 1.2 : 0, velocityY: 0, velocityZ: 0};
  };
  for (let i = 0; i <= 180; i++) {
    frame(calm, i / 60, () => ({height: level, velocityX: 0, velocityY: 0, velocityZ: 0}));
    frame(flowing, i / 60, shallowCurrent);
  }
  assert.ok(airSamples > 0 && waterSamples > 0);
  assert.ok(meanTip(flowing, 0) - meanTip(calm, 0) > .03,
    'flow acting on the wet lower blade bends it even while its midpoint is in air');
});

test('submergence buoyantly straightens dry blades', () => {
  const bed = new SeagrassBed();
  frame(bed, 0, dryWater);
  const dryHeight = meanTip(bed, 1);
  for (let i = 1; i <= 240; i++) frame(bed, i / 60, stillWater);
  assert.ok(meanTip(bed, 1) - dryHeight > .035);
});

test('bending preserves segment length and a bounded reusable mesh', () => {
  const bed = new SeagrassBed();
  const firstMesh = frame(bed, 0, flowingWater);
  for (let i = 1; i <= 180; i++) frame(bed, i / 60, flowingWater);
  assert.equal(bed.mesh, firstMesh);
  assert.ok(firstMesh.count <= 4500);
  assert.equal(firstMesh.vertices.length, firstMesh.count * firstMesh.stride);
  assert.ok(firstMesh.vertices.every(Number.isFinite));
  for (const blade of bed.blades) {
    const center = ring => [0, 1, 2].map(axis =>
      (blade.rings[ring * 9 + axis] + blade.rings[ring * 9 + 6 + axis]) / 2);
    for (let ring = 1; ring <= bed.segments; ring++) {
      const a = center(ring - 1), b = center(ring);
      const length = Math.hypot(...a.map((value, axis) => value - b[axis]));
      assert.ok(Math.abs(length - blade.height / bed.segments) < .000002);
    }
  }
});

test('viewport resizing keeps plant identities and depth ordering', () => {
  const bed = new SeagrassBed();
  const initial = frame(bed, 0, stillWater, 8);
  const depth = bed.blades.map(blade => blade.rootZ + blade.offsetZ);
  for (const halfWidth of [3, 12, 8]) {
    assert.equal(frame(bed, 1, stillWater, halfWidth), initial);
    assert.deepEqual(bed.blades.map(blade => blade.rootZ + blade.offsetZ), depth);
  }
  assert.deepEqual(depth, [...depth].sort((a, b) => a - b));
});

test('replaying resets accumulated blade momentum', () => {
  const bed = new SeagrassBed();
  const initial = frame(bed, 0, dryWater).vertices.slice();
  for (let i = 1; i <= 180; i++) frame(bed, i / 60, flowingWater);
  assert.deepEqual(frame(bed, 0, dryWater).vertices, initial);
});

test('drag integration remains consistent across frame rates', () => {
  const slow = new SeagrassBed(), fast = new SeagrassBed();
  for (let i = 0; i <= 90; i++) frame(slow, i / 30, flowingWater);
  for (let i = 0; i <= 360; i++) frame(fast, i / 120, flowingWater);
  assert.ok(Math.abs(meanTip(slow, 0) - meanTip(fast, 0)) < .01);
  assert.ok(Math.abs(meanTip(slow, 2) - meanTip(fast, 2)) < .01);
});
